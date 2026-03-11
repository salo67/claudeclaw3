"""Alerts endpoints for the Control Center API — proactive notifications."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from database import get_db
from models import AlertCreate, AlertResponse

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


@router.get("/alerts", response_model=list[AlertResponse])
def list_alerts(
    dismissed: bool = False,
    severity: str | None = None,
    category: str | None = None,
    limit: int = 50,
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List alerts, most recent first. By default only active (non-dismissed)."""
    conditions = ["dismissed = ?"]
    params: list = [int(dismissed)]

    if severity:
        conditions.append("severity = ?")
        params.append(severity)

    if category:
        conditions.append("category = ?")
        params.append(category)

    where = f" WHERE {' AND '.join(conditions)}"
    params.append(limit)
    rows = db.execute(
        f"SELECT * FROM alerts{where} ORDER BY created_at DESC LIMIT ?",  # noqa: S608
        params,
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/alerts", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(body: AlertCreate, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Create a new alert (typically called by scheduled tasks or the bot)."""
    now = int(time.time())
    alert_id = str(uuid4())
    db.execute(
        "INSERT INTO alerts (id, category, severity, title, description, action, source, dismissed, executed, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
        (alert_id, body.category, body.severity, body.title, body.description, body.action, body.source, now),
    )
    db.commit()
    row = db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    return _row_to_dict(row)


@router.patch("/alerts/{alert_id}/dismiss", response_model=AlertResponse)
def dismiss_alert(alert_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Dismiss an alert."""
    existing = db.execute("SELECT id FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    db.execute("UPDATE alerts SET dismissed = 1 WHERE id = ?", (alert_id,))
    db.commit()
    row = db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    return _row_to_dict(row)


@router.patch("/alerts/{alert_id}/execute", response_model=AlertResponse)
def mark_executed(alert_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Mark an alert's suggested action as executed."""
    existing = db.execute("SELECT id FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    db.execute("UPDATE alerts SET executed = 1 WHERE id = ?", (alert_id,))
    db.commit()
    row = db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    return _row_to_dict(row)


@router.delete("/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(alert_id: str, db: sqlite3.Connection = Depends(get_db)) -> Response:
    """Delete an alert permanently."""
    db.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
