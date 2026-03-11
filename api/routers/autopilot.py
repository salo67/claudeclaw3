"""Autopilot queue, budget, and wave endpoints."""

from __future__ import annotations

import sqlite3
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_db

router = APIRouter()


class QueueItemResponse(BaseModel):
    id: int
    task_id: str
    feature_id: str
    project_id: str
    task_desc: str
    project_name: str
    status: str
    started_at: Optional[int] = None
    completed_at: Optional[int] = None
    output: str
    commit_sha: str
    error: str
    created_at: int


@router.get("/autopilot/queue", response_model=list[QueueItemResponse])
def list_queue(
    status: Optional[str] = Query(None),
    db: sqlite3.Connection = Depends(get_db),
):
    if status:
        rows = db.execute(
            "SELECT * FROM autopilot_queue WHERE status = ? ORDER BY created_at DESC",
            (status,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM autopilot_queue ORDER BY created_at DESC"
        ).fetchall()
    return [QueueItemResponse(**dict(r)) for r in rows]


@router.post("/autopilot/queue/{item_id}/retry")
def retry_item(item_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT id FROM autopilot_queue WHERE id = ?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")
    db.execute(
        "UPDATE autopilot_queue SET status = 'pending', started_at = NULL, completed_at = NULL, error = '' WHERE id = ?",
        (item_id,),
    )
    db.commit()
    return {"ok": True}


@router.delete("/autopilot/queue/{item_id}")
def delete_item(item_id: int, db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM autopilot_queue WHERE id = ?", (item_id,))
    db.commit()
    return {"ok": True}


# ── Budget endpoints ──────────────────────────────────────────


class BudgetRecord(BaseModel):
    project_id: str
    date: str
    cost_usd: float


@router.get("/autopilot/budget")
def get_budget(
    date: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    db: sqlite3.Connection = Depends(get_db),
):
    """Get today's autopilot budget usage."""
    target_date = date or time.strftime("%Y-%m-%d")

    if project_id:
        row = db.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) as total_cost_usd, COALESCE(SUM(cli_calls), 0) as total_calls FROM autopilot_budget WHERE project_id = ? AND date = ?",
            (project_id, target_date),
        ).fetchone()
    else:
        row = db.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) as total_cost_usd, COALESCE(SUM(cli_calls), 0) as total_calls FROM autopilot_budget WHERE date = ?",
            (target_date,),
        ).fetchone()

    return {
        "date": target_date,
        "total_cost_usd": row["total_cost_usd"],
        "total_calls": row["total_calls"],
    }


@router.post("/autopilot/budget")
def record_budget(body: BudgetRecord, db: sqlite3.Connection = Depends(get_db)):
    """Record a cost entry for autopilot execution."""
    db.execute(
        """INSERT INTO autopilot_budget (project_id, date, cost_usd, cli_calls)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(project_id, date) DO UPDATE SET
             cost_usd = cost_usd + ?,
             cli_calls = cli_calls + 1""",
        (body.project_id, body.date, body.cost_usd, body.cost_usd),
    )
    db.commit()
    return {"ok": True}


# ── Wave status endpoint ──────────────────────────────────────


@router.get("/autopilot/waves/{project_id}")
def get_waves(project_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Get wave status for a project: features grouped by wave with completion %."""
    features = db.execute(
        "SELECT id, description, phase, wave, completed FROM features WHERE project_id = ? ORDER BY wave, position",
        (project_id,),
    ).fetchall()

    waves: dict[int, list[dict]] = {}
    for f in features:
        fd = dict(f)
        w = fd.get("wave", 0)
        if w not in waves:
            waves[w] = []
        waves[w].append(fd)

    result = []
    for wave_num in sorted(waves.keys()):
        wave_features = waves[wave_num]
        done = sum(1 for f in wave_features if f["phase"] == "done")
        result.append({
            "wave": wave_num,
            "features": wave_features,
            "total": len(wave_features),
            "done": done,
            "complete": done == len(wave_features),
        })

    return result
