"""ClaudeClaw Control Center -- FastAPI entry point."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="ClaudeClaw Control Center")

# CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import action_items, advisor, alerts, autopilot, discovery, documents, features, forecast_feedback, journal, notes, projects, pulse_briefing, pulse_config, pulse_today, pulse_urgent, research, scheduler, status, tasks, tts

app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(features.router, prefix="/api", tags=["features"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
app.include_router(status.router, prefix="/api", tags=["status"])
app.include_router(advisor.router, prefix="/api", tags=["advisor"])
app.include_router(autopilot.router, prefix="/api", tags=["autopilot"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(journal.router, prefix="/api", tags=["journal"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(action_items.router, prefix="/api", tags=["action-items"])
app.include_router(scheduler.router, prefix="/api", tags=["scheduler"])
app.include_router(tts.router, prefix="/api", tags=["tts"])
app.include_router(discovery.router, prefix="/api", tags=["discovery"])
app.include_router(pulse_config.router, prefix="/api", tags=["pulse"])
app.include_router(pulse_today.router, prefix="/api", tags=["pulse"])
app.include_router(pulse_briefing.router, prefix="/api", tags=["pulse"])
app.include_router(pulse_urgent.router, prefix="/api", tags=["pulse"])
app.include_router(research.router, prefix="/api", tags=["research"])
app.include_router(forecast_feedback.router, prefix="/api", tags=["forecast-feedback"])

# Serve dashboard static files (after dashboard is built)
dashboard_dist = Path(__file__).parent.parent / "dashboard" / "dist"
if dashboard_dist.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(dashboard_dist), html=True),
        name="dashboard",
    )


@app.on_event("startup")
def on_startup() -> None:
    """Initialize the database tables on server start."""
    from database import init_db

    init_db()

    # Initialize forecast feedback tables
    try:
        from routers.forecast_feedback import init_feedback_tables
        import sqlite3
        conn = sqlite3.connect(str(Path(__file__).parent.parent / "store" / "claudeclaw.db"), timeout=10)
        conn.row_factory = sqlite3.Row
        init_feedback_tables(conn)
        conn.close()
    except Exception:
        pass

    # Run salience decay on advisor memories
    try:
        from advisor_memory import decay_advisor_memories

        decay_advisor_memories()
    except Exception:
        pass
