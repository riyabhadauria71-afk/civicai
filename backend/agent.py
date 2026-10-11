import os
import re

SESSIONS = {}   # session_id -> conversation state (kept in memory for the demo)
TICKET_RE = re.compile(r"CIV-?(\d+)", re.I)
HELP = ("Hi! Upload a photo of a civic problem (pothole, garbage, fallen tree, water leak) "
        "and I'll report it. You can also ask for a ticket's status, for example: status of CIV-0001.")

SYSTEM_PROMPT = """You are CivicAI, an assistant that helps citizens report civic problems in a DEMO app
(fake municipal data, not connected to any real authority).

Rules:
- If the user attached a photo, call analyze_photo first.
- Only these categories exist: pothole, garbage, fallen_tree, water_leakage, streetlight, drainage, electricity, other.
- To create a ticket you need a category (from the photo analysis or the user) and a location (a street or landmark).
  If the location is missing, ask for it. Never guess a location.
- Once you have both, call check_duplicate, then ALWAYS call create_ticket, even if a duplicate exists.
  check_duplicate only looks; it saves nothing. create_ticket is what records the report and merges it into an
  existing ticket. Never say a report was created, added or merged unless create_ticket returned that result in this turn.
- If the user asks about a ticket (like CIV-0001), call get_ticket_status.
- If analyze_photo finds nothing, ask for a clearer photo. If confidence is below 50%, say you are not sure and ask the
  user to confirm the category before creating a ticket.
- Never invent ticket numbers or statuses; only report what the tools return.
- Never say a government authority received or will fix the issue. Say the report was saved in this demo system.
- Keep replies short and friendly (1 to 3 sentences). Reply in the user's language."""


def pretty(category: str) -> str:
    return category.replace("_", " ")


class RuleBrain:
    """Scripted planner: returns the next tool to run, or the final reply."""
    name = "scripted"

    def next(self, ctx):
        msg = (ctx["message"] or "").strip()
        state = ctx["state"]
        done = {t["tool"]: t["result"] for t in ctx["trace"]}

        # 1) Status question about a ticket
        m = TICKET_RE.search(msg)
        if m and not ctx["has_image"]:
            tid = f"CIV-{int(m.group(1)):04d}"
            if "get_ticket_status" not in done:
                return {"tool": "get_ticket_status", "args": {"ticket_id": tid}}
            r = done["get_ticket_status"]
            if r.get("error"):
                return {"final": f"I couldn't find ticket {tid}. Please check the number."}
            return {"final": (f"Ticket {r['ticket_id']} ({pretty(r['category'])} at "
                              f"{r.get('location') or 'an unknown location'}) is {pretty(r['status'])}, "
                              f"priority {r['priority']}, reported {r['report_count']} time(s).")}

        # 2) A new photo
        if ctx["has_image"]:
            if "analyze_photo" not in done:
                return {"tool": "analyze_photo"}
            dets = done["analyze_photo"].get("detections", [])
            if not dets:
                return {"final": "I couldn't see a clear civic issue in that photo. Could you upload a closer, brighter one?"}
            top = max(dets, key=lambda d: d["confidence"])
            state["pending"] = {"category": top["class"], "confidence": top["confidence"],
                                "location": ctx["location"]}

        pending = state.get("pending")
        if not pending:
            return {"final": HELP}
        if msg.lower() in ("cancel", "stop", "no"):
            state["pending"] = None
            return {"final": "Okay, I've cancelled that report."}

        # 3) Where is it?
        loc = pending.get("location")
        if not loc and not ctx["has_image"] and msg and not msg.endswith("?") and len(msg) < 120:
            loc = msg
        if not loc:
            pct = round(pending["confidence"] * 100)
            return {"final": f"This looks like {pretty(pending['category'])} (about {pct}% sure). "
                             f"Where is it? Tell me the street or a landmark."}
        pending["location"] = loc

        # 4) Check for duplicates, then create the ticket
        if "check_duplicate" not in done:
            return {"tool": "check_duplicate", "args": {"category": pending["category"], "location": loc}}
        if "create_ticket" not in done:
            return {"tool": "create_ticket",
                    "args": {"category": pending["category"], "location": loc,
                             "description": "Reported through the assistant",
                             "confidence": pending["confidence"]}}

        r = done["create_ticket"]
        if r.get("error"):
            return {"final": "Sorry, I couldn't create the ticket. Please try again."}
        t = r["ticket"]
        state["pending"] = None
        state["last_ticket"] = t["ticket_id"]
        if r["created"]:
            return {"final": f"Done! I created ticket {t['ticket_id']} for {pretty(t['category'])} at "
                             f"{t['location']}. Priority: {t['priority']}. Ask me for its status any time."}
        return {"final": f"This looks already reported (ticket {t['ticket_id']}), so I added your report to it. "
                         f"It now has {t['report_count']} reports, priority {t['priority']}."}


class LLMBrain:
    """Lets a Gemini model decide which tool to call next."""
    name = "gemini"

    def __init__(self):
        from google import genai
        from google.genai import types
        self.t = types
        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.model = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
        self.contents = None
        self.seen = 0
        self.user_text = ""

    def _tools(self):
        t = self.t
        S, T = t.Schema, t.Type
        cats = ("one of: pothole, garbage, fallen_tree, water_leakage, "
                "streetlight, drainage, electricity, other")
        return [t.Tool(function_declarations=[
            t.FunctionDeclaration(
                name="analyze_photo",
                description="Run the vision model on the photo the user attached this turn. "
                            "Returns the detected issues with confidence."),
            t.FunctionDeclaration(
                name="check_duplicate",
                description="Check whether an unresolved ticket already exists for the same category and location.",
                parameters=S(type=T.OBJECT, required=["category", "location"], properties={
                    "category": S(type=T.STRING, description=cats),
                    "location": S(type=T.STRING, description="street or landmark")})),
            t.FunctionDeclaration(
                name="create_ticket",
                description="Create a ticket (or add the report to an existing duplicate).",
                parameters=S(type=T.OBJECT, required=["category", "location"], properties={
                    "category": S(type=T.STRING, description=cats),
                    "location": S(type=T.STRING, description="street or landmark"),
                    "description": S(type=T.STRING, description="short description"),
                    "confidence": S(type=T.NUMBER, description="vision confidence from 0 to 1")})),
            t.FunctionDeclaration(
                name="get_ticket_status",
                description="Look up a ticket by its id, for example CIV-0001.",
                parameters=S(type=T.OBJECT, required=["ticket_id"], properties={
                    "ticket_id": S(type=T.STRING, description="ticket id like CIV-0001")})),
        ])]

    def next(self, ctx):
        t = self.t
        state = ctx["state"]

        if self.contents is None:
            self.contents = [t.Content(role=role, parts=[t.Part(text=text)])
                             for role, text in state.get("history", [])[-10:]]
            self.user_text = (ctx["message"] or "").strip()
            bits = [self.user_text]
            if ctx["has_image"]:
                bits.append("[The user attached a photo to this message.]")
            if ctx["location"]:
                bits.append(f"[Location field: {ctx['location']}]")
            if state.get("last_detection"):
                d = state["last_detection"]
                bits.append(f"[Last photo analysis in this chat: {d['category']}, "
                            f"{round(d['confidence'] * 100)}% sure.]")
            if state.get("last_ticket"):
                bits.append(f"[Last ticket in this chat: {state['last_ticket']}.]")
            text = " ".join(b for b in bits if b).strip() or "(empty message)"
            self.contents.append(t.Content(role="user", parts=[t.Part(text=text)]))

        # give the model the results of tools that ran since the last call
        new_items = ctx["trace"][self.seen:]
        if new_items:
            parts = [t.Part.from_function_response(name=i["tool"], response={"result": i["result"]})
                     for i in new_items]
            self.contents.append(t.Content(role="user", parts=parts))
            self.seen = len(ctx["trace"])
            for i in new_items:
                dets = i["result"].get("detections") if isinstance(i["result"], dict) else None
                if i["tool"] == "analyze_photo" and dets:
                    top = max(dets, key=lambda d: d["confidence"])
                    state["last_detection"] = {"category": top["class"], "confidence": top["confidence"]}
                if i["tool"] == "create_ticket" and isinstance(i["result"], dict) and i["result"].get("ticket"):
                    state["last_ticket"] = i["result"]["ticket"]["ticket_id"]

        config = t.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=self._tools(),
            automatic_function_calling=t.AutomaticFunctionCallingConfig(disable=True),
        )
        resp = self.client.models.generate_content(model=self.model, contents=self.contents, config=config)
        parts = resp.candidates[0].content.parts or []

        call_part = next((p for p in parts if p.function_call), None)
        if call_part:
            self.contents.append(t.Content(role="model", parts=[call_part]))
            return {"tool": call_part.function_call.name, "args": dict(call_part.function_call.args or {})}

        text = "".join(p.text for p in parts if getattr(p, "text", None)).strip() or "Sorry, I didn't catch that."

        names = [i["tool"] for i in ctx["trace"]]
        if "check_duplicate" in names and "create_ticket" not in names and not getattr(self, "nudged", False):
            self.nudged = True
            self.contents.append(t.Content(role="model", parts=[t.Part(text=text)]))
            self.contents.append(t.Content(role="user", parts=[t.Part(text=(
                "[System note: you have not called create_ticket yet, so nothing has been saved. "
                "Call create_ticket now, then report only what it returns.]"))]))
            return self.next(ctx)

        hist = state.setdefault("history", [])
        hist.append(("user", self.user_text or "(photo)"))
        hist.append(("model", text))
        return {"final": text}

def make_brain():
    if os.environ.get("GEMINI_API_KEY"):
        try:
            return LLMBrain()
        except Exception:
            pass
    return RuleBrain()


def run_agent(session_id, message, image_bytes, location, tools, brain=None):
    state = SESSIONS.setdefault(session_id, {"pending": None, "last_ticket": None})
    brain = brain or make_brain()
    trace, notes = [], []
    ctx = {"message": message, "has_image": image_bytes is not None,
           "location": location, "trace": trace, "state": state}

    for _ in range(8):   # safety limit on the number of steps
        try:
            action = brain.next(ctx)
        except Exception as e:
            notes.append(f"{brain.name} brain failed ({type(e).__name__}: {str(e)[:300]}); used the scripted fallback.")
            brain = RuleBrain()
            action = brain.next(ctx)
        if "final" in action:
            return {"reply": action["final"], "trace": trace, "brain": brain.name, "notes": notes}
        name, args = action["tool"], action.get("args", {})
        try:
            if name not in tools:
                result = {"error": f"Unknown tool {name}"}
            elif name == "analyze_photo":
                result = tools[name](image_bytes) if image_bytes else {"error": "No photo was attached."}
            else:
                result = tools[name](**args)
        except Exception as e:
            result = {"error": str(e)}
        trace.append({"tool": name, "args": args, "result": result})
    return {"reply": "Sorry, I got stuck. Please try again.", "trace": trace,
            "brain": brain.name, "notes": notes}