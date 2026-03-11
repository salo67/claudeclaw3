"""Task endpoints for the Control Center API."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from database import get_db
from models import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


@router.get("/tasks", response_model=list[TaskResponse])
def list_tasks(
    project_id: str | None = Query(None),
    feature_id: str | None = Query(None),
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List tasks with optional project_id and feature_id filters. Ordered by position."""
    clauses: list[str] = []
    params: list[str] = []

    if project_id is not None:
        clauses.append("project_id = ?")
        params.append(project_id)
    if feature_id is not None:
        clauses.append("feature_id = ?")
        params.append(feature_id)

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.execute(
        f"SELECT * FROM tasks{where} ORDER BY position ASC",  # noqa: S608
        params,
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: str, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Get a single task by ID."""
    row = db.execute(
        "SELECT * FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return _row_to_dict(row)


@router.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_task(
    body: TaskCreate, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Create a new task. Position is auto-calculated."""
    now = int(time.time())
    task_id = str(uuid4())

    # Auto-calculate position based on parent context
    if body.feature_id is not None:
        pos_row = db.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM tasks WHERE feature_id = ?",
            (body.feature_id,),
        ).fetchone()
    elif body.project_id is not None:
        pos_row = db.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM tasks WHERE project_id = ? AND feature_id IS NULL",
            (body.project_id,),
        ).fetchone()
    else:
        pos_row = db.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM tasks"
        ).fetchone()
    position = pos_row["next_pos"]

    db.execute(
        """
        INSERT INTO tasks (id, project_id, feature_id, description, acceptance_criteria, completed, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        """,
        (task_id, body.project_id, body.feature_id, body.description, body.acceptance_criteria, position, now, now),
    )

    # Auto-promote feature from backlog to in_progress when first task is added
    if body.feature_id is not None:
        db.execute(
            "UPDATE features SET phase = 'in_progress', updated_at = ? WHERE id = ? AND phase = 'backlog'",
            (now, body.feature_id),
        )

    db.commit()

    result = db.execute(
        "SELECT * FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    return _row_to_dict(result)


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: str,
    body: TaskUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update an existing task. Only provided fields are changed."""
    existing = db.execute(
        "SELECT * FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    updates: list[str] = []
    params: list[str | int | float | None] = []

    for field in ("description", "completed", "position", "project_id", "feature_id", "acceptance_criteria", "verification_status", "verification_output"):
        value = getattr(body, field)
        if value is not None:
            updates.append(f"{field} = ?")
            params.append(int(value) if field == "completed" else value)

    if not updates:
        return _row_to_dict(existing)

    updates.append("updated_at = ?")
    params.append(int(time.time()))
    params.append(task_id)

    db.execute(
        f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
        params,
    )
    db.commit()

    row = db.execute(
        "SELECT * FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    return _row_to_dict(row)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str, db: sqlite3.Connection = Depends(get_db)
) -> Response:
    """Delete a task by ID."""
    existing = db.execute(
        "SELECT id FROM tasks WHERE id = ?", (task_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )

    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
