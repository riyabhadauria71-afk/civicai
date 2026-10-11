import io
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO
from agent import run_agent

app = FastAPI(title="CivicAI API (demo municipal data)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # restrict to your website before going public
    allow_methods=["*"],
    allow_headers=["*"],
)

model = YOLO("best.pt")
DB_PATH = os.environ.get("DB_PATH", "civic.db")

CATEGORIES = {"pothole", "garbage", "fallen_tree", "water_leakage",
              "streetlight", "drainage", "electricity", "other"}
STATUSES = {"open", "in_progress", "resolved"}
BASE_PRIORITY = {
    "water_leakage": "high", "fallen_tree": "high", "electricity": "high",
    "pothole": "medium", "drainage": "medium", "streetlight": "medium",
    "garbage": "low", "other": "low",
}
PRIORITY_ORDER = ["low", "medium", "high"]


# ---------- database helpers ----------
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now_iso(delta: timedelta = timedelta(0)) -> str:
    return (datetime.now(timezone.utc) - delta).isoformat(timespec="seconds")


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


async def read_image_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    return data


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                description TEXT,
                location TEXT,
                lat REAL,
                lng REAL,
                priority TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                confidence REAL,
                report_count INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )""")
        if conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] == 0:
            # Clearly fake demo data
            seed = [
                ("pothole", "Deep pothole near the bus stop", "Main Street & 5th Avenue", 22.5726, 88.3639, "medium", "open", 0.82, 2, timedelta(days=2)),
                ("garbage", "Overflowing waste pile", "Market Road, Block C", 22.5800, 88.3700, "low", "in_progress", 0.74, 1, timedelta(days=5)),
                ("water_leakage", "Pipe leaking onto the road", "Lake View Lane", 22.5650, 88.3600, "high", "open", 0.91, 3, timedelta(days=1)),
                ("fallen_tree", "Tree blocking half the road", "Park Avenue", 22.5900, 88.3500, "high", "resolved", 0.88, 1, timedelta(days=9)),
                ("pothole", "Cracked road surface", "Station Road", 22.5500, 88.3800, "medium", "resolved", 0.69, 1, timedelta(days=12)),
                ("garbage", "Dumped waste near the park gate", "Park Avenue", 22.5905, 88.3505, "low", "open", 0.77, 1, timedelta(hours=6)),
            ]
            for cat, desc, loc, lat, lng, pri, st, conf, cnt, age in seed:
                conn.execute(
                    "INSERT INTO tickets (category, description, location, lat, lng, priority, status, confidence, report_count, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (cat, desc, loc, lat, lng, pri, st, conf, cnt, now_iso(age), now_iso(age)),
                )


def ticket_out(row) -> dict:
    d = dict(row)
    d["ticket_id"] = f"CIV-{d['id']:04d}"
    return d


def parse_ticket_id(ticket_id: str) -> int:
    try:
        return int(ticket_id.upper().replace("CIV-", ""))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ticket id, expected something like CIV-0007")


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def find_duplicate(conn, category, location, lat, lng):
    """An unresolved ticket of the same category, created in the last 14 days,
    within 100 m (if coordinates are given) or at the same named location."""
    rows = conn.execute(
        "SELECT * FROM tickets WHERE category=? AND status!='resolved' AND created_at>=?",
        (category, now_iso(timedelta(days=14))),
    ).fetchall()
    for r in rows:
        if lat is not None and lng is not None and r["lat"] is not None and r["lng"] is not None:
            if haversine_m(lat, lng, r["lat"], r["lng"]) <= 100:
                return r
        elif location and r["location"] and r["location"].strip().lower() == location.strip().lower():
            return r
    return None


def check_category(category: str):
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category. Use one of: {sorted(CATEGORIES)}")


init_db()


# ---------- request models ----------
class DuplicateQuery(BaseModel):
    category: str
    location: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class TicketIn(DuplicateQuery):
    description: Optional[str] = None
    confidence: Optional[float] = None


class StatusUpdate(BaseModel):
    status: str


# ---------- endpoints ----------
@app.get("/")
def health():
    return {"status": "ok", "classes": list(model.names.values()),
            "note": "Demo municipal data. Not connected to any real authority."}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    data = await read_image_upload(file)
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

        
    result = model(image, conf=0.30, verbose=False)[0]
    detections = [
        {
            "class": model.names[int(box.cls)],
            "confidence": round(float(box.conf), 3),
            "box": [round(v, 1) for v in box.xyxy[0].tolist()],
        }
        for box in result.boxes
    ]
    return {"count": len(detections), "detections": detections}


@app.post("/tickets/check-duplicate")
def check_duplicate(q: DuplicateQuery):
    check_category(q.category)
    with get_db() as conn:
        dup = find_duplicate(conn, q.category, q.location, q.lat, q.lng)
        return {"duplicate": dup is not None, "ticket": ticket_out(dup) if dup else None}


@app.post("/tickets")
def create_ticket(t: TicketIn):
    check_category(t.category)
    with get_db() as conn:
        dup = find_duplicate(conn, t.category, t.location, t.lat, t.lng)
        if dup:
            # Same problem reported again: count it and escalate if many people report it
            count = dup["report_count"] + 1
            priority = dup["priority"]
            if count >= 3 and priority != "high":
                priority = PRIORITY_ORDER[PRIORITY_ORDER.index(priority) + 1]
            conn.execute(
                "UPDATE tickets SET report_count=?, priority=?, updated_at=? WHERE id=?",
                (count, priority, now_iso(), dup["id"]),
            )
            row = conn.execute("SELECT * FROM tickets WHERE id=?", (dup["id"],)).fetchone()
            return {"created": False, "message": "Duplicate found; added your report to the existing ticket.",
                    "ticket": ticket_out(row)}

        cur = conn.execute(
            "INSERT INTO tickets (category, description, location, lat, lng, priority, status, confidence, report_count, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (t.category, t.description, t.location, t.lat, t.lng, BASE_PRIORITY[t.category],
             "open", t.confidence, 1, now_iso(), now_iso()),
        )
        row = conn.execute("SELECT * FROM tickets WHERE id=?", (cur.lastrowid,)).fetchone()
        return {"created": True, "message": "New ticket created.", "ticket": ticket_out(row)}


@app.get("/tickets")
def list_tickets(status: Optional[str] = None, priority: Optional[str] = None, category: Optional[str] = None):
    query, params = "SELECT * FROM tickets WHERE 1=1", []
    for col, val in (("status", status), ("priority", priority), ("category", category)):
        if val:
            query += f" AND {col}=?"
            params.append(val)
    query += " ORDER BY id DESC"
    with get_db() as conn:
        return [ticket_out(r) for r in conn.execute(query, params).fetchall()]


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE id=?", (parse_ticket_id(ticket_id),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket_out(row)


@app.patch("/tickets/{ticket_id}")
def update_status(ticket_id: str, body: StatusUpdate):
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {sorted(STATUSES)}")
    tid = parse_ticket_id(ticket_id)
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM tickets WHERE id=?", (tid,)).fetchone():
            raise HTTPException(status_code=404, detail="Ticket not found")
        conn.execute("UPDATE tickets SET status=?, updated_at=? WHERE id=?", (body.status, now_iso(), tid))
        row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    return ticket_out(row)


@app.get("/stats")
def stats():
    def group(col):
        return {r[col]: r["n"] for r in conn.execute(f"SELECT {col}, COUNT(*) AS n FROM tickets GROUP BY {col}")}
    with get_db() as conn:
        return {"total": conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0],
                "by_category": group("category"), "by_status": group("status"), "by_priority": group("priority")}


# ---------- agent tools and chat endpoint ----------
def tool_analyze_photo(image_bytes):
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result = model(image, conf=0.30, verbose=False)[0]
    return {"detections": [{"class": model.names[int(b.cls)], "confidence": round(float(b.conf), 3)}
                           for b in result.boxes]}


def tool_check_duplicate(category, location=None):
    return check_duplicate(DuplicateQuery(category=category, location=location))


def tool_create_ticket(category, location=None, description=None, confidence=None):
    return create_ticket(TicketIn(category=category, location=location,
                                  description=description, confidence=confidence))


def tool_get_ticket_status(ticket_id):
    try:
        return get_ticket(ticket_id)
    except HTTPException as e:
        return {"error": e.detail}


TOOLS = {
    "analyze_photo": tool_analyze_photo,
    "check_duplicate": tool_check_duplicate,
    "create_ticket": tool_create_ticket,
    "get_ticket_status": tool_get_ticket_status,
}


@app.post("/agent/chat")
async def agent_chat(message: str = Form(""), session_id: str = Form("default"),
                     location: Optional[str] = Form(None), file: Optional[UploadFile] = File(None)):
    image_bytes = (await read_image_upload(file)) if file is not None else None
    return run_agent(session_id, message, image_bytes or None, location or None, TOOLS)