"""Scheduler CRUD endpoints for scheduled tasks."""

from __future__ import annotations

import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_db

router = APIRouter()


class ScheduledTaskResponse(BaseModel):
    id: str
    prompt: str
    schedule: str
    next_run: int
    last_run: Optional[int] = None
    last_result: Optional[str] = None
    status: str
    created_at: int


class SchedulerLogResponse(BaseModel):
    id: int
    task_id: str
    task_prompt: str
    status: str
    output: str = ""
    error: str = ""
    started_at: int
    finished_at: int
    duration_ms: int = 0


class ScheduledTaskCreate(BaseModel):
    prompt: str
    schedule: str  # cron expression


class ScheduledTaskUpdate(BaseModel):
    prompt: Optional[str] = None
    schedule: Optional[str] = None


def _get_bot_db() -> sqlite3.Connection:
    """Connect to the bot's SQLite database (store/claudeclaw.db)."""
    store_dir = os.environ.get(
        "STORE_DIR", str(Path(__file__).parent.parent.parent / "store")
    )
    db_path = Path(store_dir) / "claudeclaw.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _compute_next_run(cron_expr: str) -> int:
    """Compute next run timestamp from a cron expression. Simple fallback: 1 hour from now."""
    try:
        from croniter import croniter
        c = croniter(cron_expr)
        return int(c.get_next())
    except Exception:
        return int(time.time()) + 3600


@router.get("/scheduler/tasks", response_model=list[ScheduledTaskResponse])
def list_tasks(
    status: Optional[str] = Query(None),
    db: sqlite3.Connection = Depends(get_db),
):
    if status:
        rows = db.execute(
            "SELECT * FROM scheduled_tasks WHERE status = ? ORDER BY next_run ASC",
            (status,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM scheduled_tasks ORDER BY next_run ASC"
        ).fetchall()
    return [ScheduledTaskResponse(**dict(r)) for r in rows]


@router.post("/scheduler/tasks", response_model=ScheduledTaskResponse, status_code=201)
def create_task(
    body: ScheduledTaskCreate,
    db: sqlite3.Connection = Depends(get_db),
):
    task_id = str(uuid.uuid4())[:8]
    now = int(time.time())
    next_run = _compute_next_run(body.schedule)

    db.execute(
        "INSERT INTO scheduled_tasks (id, prompt, schedule, next_run, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
        (task_id, body.prompt, body.schedule, next_run, now),
    )
    db.commit()

    row = db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    return ScheduledTaskResponse(**dict(row))


@router.patch("/scheduler/tasks/{task_id}", response_model=ScheduledTaskResponse)
def update_task(
    task_id: str,
    body: ScheduledTaskUpdate,
    db: sqlite3.Connection = Depends(get_db),
):
    existing = db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = []
    params = []
    if body.prompt is not None:
        updates.append("prompt = ?")
        params.append(body.prompt)
    if body.schedule is not None:
        updates.append("schedule = ?")
        params.append(body.schedule)
        updates.append("next_run = ?")
        params.append(_compute_next_run(body.schedule))

    if not updates:
        return ScheduledTaskResponse(**dict(existing))

    params.append(task_id)
    db.execute(f"UPDATE scheduled_tasks SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()

    row = db.execute("SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    return ScheduledTaskResponse(**dict(row))


@router.post("/scheduler/tasks/{task_id}/pause")
def pause_task(task_id: str, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    db.execute("UPDATE scheduled_tasks SET status = 'paused' WHERE id = ?", (task_id,))
    db.commit()
    return {"ok": True}


@router.post("/scheduler/tasks/{task_id}/resume")
def resume_task(task_id: str, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    db.execute("UPDATE scheduled_tasks SET status = 'active' WHERE id = ?", (task_id,))
    db.commit()
    return {"ok": True}


@router.delete("/scheduler/tasks/{task_id}")
def delete_task(task_id: str, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    db.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
    db.commit()
    return {"ok": True}


@router.get("/scheduler/logs", response_model=list[SchedulerLogResponse])
def list_logs(
    task_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Fetch execution logs from the bot's scheduler."""
    try:
        conn = _get_bot_db()
        if task_id:
            rows = conn.execute(
                "SELECT * FROM scheduler_logs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
                (task_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scheduler_logs ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        conn.close()
        return [SchedulerLogResponse(**dict(r)) for r in rows]
    except Exception:
        # Table might not exist yet (bot hasn't been rebuilt)
        return []
