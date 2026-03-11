"""Feature endpoints for the Control Center API."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from database import get_db
from models import FeatureCreate, FeatureDetailResponse, FeatureResponse, FeatureUpdate

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


@router.get("/features", response_model=list[FeatureResponse])
def list_features(
    project_id: str | None = Query(None),
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List features, optionally filtered by project."""
    if project_id:
        rows = db.execute(
            "SELECT * FROM features WHERE project_id = ? ORDER BY position ASC",
            (project_id,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM features ORDER BY position ASC").fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/features/{feature_id}", response_model=FeatureDetailResponse)
def get_feature(
    feature_id: str, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Get a single feature with its tasks."""
    row = db.execute(
        "SELECT * FROM features WHERE id = ?", (feature_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
        )
    feature = _row_to_dict(row)

    tasks = db.execute(
        "SELECT * FROM tasks WHERE feature_id = ? ORDER BY position ASC",
        (feature_id,),
    ).fetchall()
    feature["tasks"] = [_row_to_dict(t) for t in tasks]

    return feature


@router.post(
    "/features",
    response_model=FeatureResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_feature(
    body: FeatureCreate, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Create a new feature. Position is auto-calculated."""
    now = int(time.time())
    feature_id = str(uuid4())

    pos_row = db.execute(
        "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM features WHERE project_id = ?",
        (body.project_id,),
    ).fetchone()
    position = pos_row["next_pos"]

    db.execute(
        """
        INSERT INTO features (id, project_id, description, objective, acceptance_criteria, phase, autopilot, priority, completed, position, wave, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        """,
        (
            feature_id,
            body.project_id,
            body.description,
            body.objective,
            body.acceptance_criteria,
            body.phase,
            int(body.autopilot),
            body.priority,
            position,
            body.wave,
            now,
            now,
        ),
    )
    db.commit()

    result = db.execute(
        "SELECT * FROM features WHERE id = ?", (feature_id,)
    ).fetchone()
    return _row_to_dict(result)


@router.patch("/features/{feature_id}", response_model=FeatureResponse)
def update_feature(
    feature_id: str,
    body: FeatureUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update an existing feature. Only provided fields are changed."""
    existing = db.execute(
        "SELECT * FROM features WHERE id = ?", (feature_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
        )

    bool_fields = {"autopilot", "completed"}
    int_fields = {"wave"}
    updates: list[str] = []
    params: list[str | int | float] = []

    for field in ("description", "objective", "acceptance_criteria", "phase", "autopilot", "priority", "completed", "wave"):
        value = getattr(body, field)
        if value is not None:
            updates.append(f"{field} = ?")
            if field in bool_fields:
                params.append(int(value))
            elif field in int_fields:
                params.append(int(value))
            else:
                params.append(value)

    if not updates:
        return _row_to_dict(existing)

    updates.append("updated_at = ?")
    params.append(int(time.time()))
    params.append(feature_id)

    db.execute(
        f"UPDATE features SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
        params,
    )
    db.commit()

    row = db.execute(
        "SELECT * FROM features WHERE id = ?", (feature_id,)
    ).fetchone()
    return _row_to_dict(row)


@router.delete(
    "/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_feature(
    feature_id: str, db: sqlite3.Connection = Depends(get_db)
) -> Response:
    """Delete a feature by ID. Cascades to its tasks."""
    existing = db.execute(
        "SELECT id FROM features WHERE id = ?", (feature_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found"
        )

    db.execute("DELETE FROM features WHERE id = ?", (feature_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
