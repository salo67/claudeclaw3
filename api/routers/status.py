"""Status endpoints for the Control Center API."""

from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from database import get_db

router = APIRouter()

# Track when the API process started
_STARTUP_TIME: int = int(time.time())


def _rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    """Convert a list of sqlite3.Row objects to a list of dicts."""
    return [dict(r) for r in rows]


def _safe_query(
    db: sqlite3.Connection, sql: str, params: tuple = ()
) -> list[sqlite3.Row]:
    """Execute a query, returning an empty list if the table doesn't exist."""
    try:
        return db.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return []


@router.get("/status")
def get_status(db: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    """Return ClaudeClaw system status including scheduled tasks, memories, and usage."""
    now = int(time.time())

    # Scheduled tasks
    scheduled_tasks = _safe_query(
        db,
        "SELECT id, prompt, schedule, next_run, last_run, last_result, status, created_at "
        "FROM scheduled_tasks ORDER BY next_run ASC",
    )

    # Recent memories (last 10)
    recent_memories = _safe_query(
        db,
        "SELECT id, chat_id, topic_key, content, sector, salience, created_at, accessed_at "
        "FROM memories ORDER BY accessed_at DESC LIMIT 10",
    )

    # Recent conversation (last 15)
    recent_conversation = _safe_query(
        db,
        "SELECT id, chat_id, session_id, role, content, created_at "
        "FROM conversation_log ORDER BY created_at DESC LIMIT 15",
    )

    # Token usage for today -- aggregate from midnight UTC
    today_start = int(
        datetime.now(timezone.utc)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .timestamp()
    )
    usage_rows = _safe_query(
        db,
        """
        SELECT
            COUNT(*)            AS turns,
            COALESCE(SUM(input_tokens), 0)  AS total_input,
            COALESCE(SUM(output_tokens), 0) AS total_output,
            COALESCE(MAX(cache_read), 0)    AS peak_cache_read,
            COALESCE(SUM(cost_usd), 0)      AS total_cost,
            COALESCE(SUM(did_compact), 0)   AS compactions
        FROM token_usage
        WHERE created_at >= ?
        """,
        (today_start,),
    )

    token_usage_today: dict[str, Any] = {}
    if usage_rows:
        row = usage_rows[0]
        token_usage_today = {
            "turns": row["turns"],
            "total_input": row["total_input"],
            "total_output": row["total_output"],
            "peak_cache_read": row["peak_cache_read"],
            "total_cost": round(row["total_cost"], 4),
            "compactions": row["compactions"],
        }

    return {
        "online": True,
        "uptime_seconds": now - _STARTUP_TIME,
        "timestamp": now,
        "scheduled_tasks": _rows_to_list(scheduled_tasks),
        "recent_memories": _rows_to_list(recent_memories),
        "recent_conversation": _rows_to_list(recent_conversation),
        "token_usage_today": token_usage_today,
    }
