# CivicAI: an Alexa+-style assistant for reporting civic problems

Citizens send a photo of a civic problem (pothole, garbage, fallen tree, water leak).
An AI assistant analyses it, asks for the location, checks for duplicate reports,
creates a ticket, and answers status questions. An officer dashboard lets staff
review tickets and update their status.

**Hackathon track:** Alexa+ (simulated Alexa+ experience in a web app).
All municipal data in this project is demo data and is not connected to any real authority.

## What it does

1. **Vision:** a YOLO11 model trained on four classes (pothole, garbage, fallen_tree, water_leakage)
   detects the problem in the uploaded photo.
2. **Agent:** a Gemini model decides which tool to call next. Tools: `analyze_photo`,
   `check_duplicate`, `create_ticket`, `get_ticket_status`. Every tool call is shown
   in the chat under "Agent actions".
3. **Tickets:** a SQLite database stores tickets. Repeat reports of the same problem at the
   same place are merged into one ticket, and priority rises as reports accumulate.
4. **Officer dashboard:** summary cards, filters, and status updates that the citizen
   can then see through the assistant.
5. **Fallback:** if the Gemini API is unavailable or rate-limited, a scripted planner keeps
   the assistant working. The API response says which one answered (`"brain"` field).

## Architecture

```
Browser (React app) --> FastAPI backend --> YOLO model (best.pt)
                              |
                              +--> Gemini API (tool-calling agent)
                              +--> SQLite (tickets)
```

- `backend/main.py`: API, ticket database, detection endpoint, agent tools
- `backend/agent.py`: the agent loop, the Gemini brain, and the scripted fallback
- `backend/best.pt`: the trained detection model
- `frontend/`: the web app (report form, assistant chat, officer dashboard)

## Run it locally

### Backend

```powershell
cd backend
python -m venv yolo-env
yolo-env\Scripts\activate
python -m pip install -r requirements.txt
$env:GEMINI_API_KEY = "your-key"        # from aistudio.google.com
$env:GEMINI_MODEL = "gemini-3.1-flash-lite"   # optional; any current Gemini Flash model
python -m uvicorn main:app --reload
```

On macOS or Linux, use `source yolo-env/bin/activate` and `export GEMINI_API_KEY=...`.
Without `GEMINI_API_KEY`, the scripted fallback is used. The database `civic.db` is created
on first start with six demo tickets. Delete it and restart to reset the data.

API docs: http://127.0.0.1:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend calls the backend at `http://127.0.0.1:8000` (the `API_URL` constant in
`src/components/civicai/civic-dashboard.tsx`). Copy `.env.example` to `.env` and fill in
your own Supabase values if you use the sign-in feature.

## What is new in this hackathon

- Trained and integrated a four-class YOLO11 detection model
- Built the FastAPI backend, ticket database, duplicate detection and priority escalation
- Built the tool-calling agent with a Gemini brain and a scripted fallback
- Added the Assistant chat page with an "Agent actions" trace
- Added the Officer Dashboard connected to the same backend

Existing before the hackathon: the Lovable-generated website (layout, report form and
citizen sign-in, where citizens log in to see their reports).

## Honest limitations

- Demo data only. Nothing is sent to a real authority.
- Location matching is by text, so "Main Street" and "Main St" are treated as different places.
- The garbage and fallen-tree classes were trained on small datasets and are less accurate than potholes.
- The Gemini free tier has rate limits and may use inputs to improve Google products. Use only public photos.
- Detection runs on CPU and the backend has no authentication. It is built for a demo, not production.

## Credits

Built by **Riya Bhadauria**. Detection datasets came from Roboflow Universe.
Check each dataset's license before reusing the model.

## License

MIT, see [LICENSE](LICENSE).