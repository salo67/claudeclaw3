"""Project endpoints for the Control Center API."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status

from database import DB_PATH, get_db
from models import (
    ProjectCreate,
    ProjectDetailResponse,
    ProjectResponse,
    ProjectUpdate,
)

logger = logging.getLogger(__name__)

PROJECTS_ROOT = Path(r"C:\Users\salomon.DC0\Documents\Python")

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """List all projects ordered by creation date descending."""
    rows = db.execute(
        "SELECT * FROM projects ORDER BY created_at DESC"
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/projects/{project_id}", response_model=ProjectDetailResponse)
def get_project(
    project_id: str, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Get a single project with its associated features, tasks, and documents."""
    row = db.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    project = _row_to_dict(row)

    # Features with their nested tasks
    feature_rows = db.execute(
        "SELECT * FROM features WHERE project_id = ? ORDER BY position ASC",
        (project_id,),
    ).fetchall()
    features = []
    for f in feature_rows:
        feature = _row_to_dict(f)
        feature_tasks = db.execute(
            "SELECT * FROM tasks WHERE feature_id = ? ORDER BY position ASC",
            (f["id"],),
        ).fetchall()
        feature["tasks"] = [_row_to_dict(t) for t in feature_tasks]
        features.append(feature)
    project["features"] = features

    # Project-level tasks (no feature_id)
    tasks = db.execute(
        "SELECT * FROM tasks WHERE project_id = ? AND feature_id IS NULL ORDER BY position ASC",
        (project_id,),
    ).fetchall()
    project["tasks"] = [_row_to_dict(t) for t in tasks]

    # Documents
    documents = db.execute(
        "SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()
    project["documents"] = [_row_to_dict(d) for d in documents]

    return project


def _create_project_folder(name: str) -> Path | None:
    """Create a project folder under PROJECTS_ROOT. Returns the path or None on failure."""
    folder = PROJECTS_ROOT / f"Proyecto {name}"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        logger.info("Created project folder: %s", folder)
        return folder
    except Exception as e:
        logger.error("Failed to create project folder: %s", e)
        return None


def _run_autopilot_decomposition(project_id: str, project_name: str, project_description: str, features: list[dict]) -> None:
    """Background task: call Claude CLI to decompose each feature into atomic tasks."""
    try:
        import subprocess

        feature_list = "\n".join(
            f"- Feature {i+1}: {f['description']}" + (f" (objetivo: {f['objective']})" if f.get("objective") else "")
            for i, f in enumerate(features)
        )

        prompt = (
            f"Proyecto: {project_name}\n"
            f"Descripcion: {project_description}\n\n"
            f"Features:\n{feature_list}\n\n"
            "Para CADA feature, genera tareas atomicas (simples, una sola accion cada una). "
            "Responde SOLO con JSON valido, sin markdown, sin explicaciones. "
            "Formato exacto:\n"
            '[{"feature_index": 0, "tasks": ["tarea 1", "tarea 2"]}, '
            '{"feature_index": 1, "tasks": ["tarea 1"]}]'
        )

        claude_cmd = r"C:\Users\salomon.DC0\AppData\Roaming\npm\claude.cmd"
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        result = subprocess.run(
            [claude_cmd, "-p", "--output-format", "text"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
            shell=True,
        )

        if result.returncode != 0:
            logger.error("Claude CLI failed: %s", result.stderr)
            return

        raw = result.stdout.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3].strip()

        decomposition = json.loads(raw)

        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.row_factory = sqlite3.Row

        now = int(time.time())
        tasks_created = 0

        for item in decomposition:
            idx = item.get("feature_index", 0)
            if idx >= len(features):
                continue
            feature = features[idx]
            for pos, task_desc in enumerate(item.get("tasks", []), start=1):
                task_id = str(uuid4())
                conn.execute(
                    "INSERT INTO tasks (id, project_id, feature_id, description, completed, position, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
                    (task_id, project_id, feature["id"], task_desc, pos, now, now),
                )
                tasks_created += 1

        conn.commit()
        conn.close()
        logger.info("Autopilot created %d tasks for project %s", tasks_created, project_name)

    except Exception as e:
        logger.error("Autopilot decomposition failed: %s", e)


@router.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    body: ProjectCreate, bg: BackgroundTasks, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Create a new project."""
    now = int(time.time())
    project_id = str(uuid4())
    db.execute(
        """
        INSERT INTO projects (id, name, description, phase, autopilot, paused, priority, tags, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            body.name,
            body.description,
            body.phase,
            int(body.autopilot),
            int(body.paused),
            body.priority,
            body.tags,
            body.color,
            now,
            now,
        ),
    )
    db.commit()

    # Create physical project folder
    _create_project_folder(body.name)

    row = db.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    return _row_to_dict(row)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update an existing project. Only provided fields are changed."""
    existing = db.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    bool_fields = {"completed", "autopilot", "paused"}
    updates: list[str] = []
    params: list[str | int | float] = []

    for field in ("name", "description", "phase", "completed", "autopilot", "paused", "priority", "tags", "color"):
        value = getattr(body, field)
        if value is not None:
            updates.append(f"{field} = ?")
            params.append(int(value) if field in bool_fields else value)

    if not updates:
        return _row_to_dict(existing)

    updates.append("updated_at = ?")
    params.append(int(time.time()))
    params.append(project_id)

    db.execute(
        f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
        params,
    )
    db.commit()

    row = db.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    return _row_to_dict(row)


@router.post("/projects/{project_id}/decompose")
def decompose_project(
    project_id: str,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Trigger autopilot decomposition: break features into atomic tasks via Gemini."""
    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project = _row_to_dict(row)

    features = [
        _row_to_dict(f)
        for f in db.execute(
            "SELECT * FROM features WHERE project_id = ? ORDER BY position ASC", (project_id,)
        ).fetchall()
    ]
    if not features:
        raise HTTPException(status_code=400, detail="No features to decompose")

    bg.add_task(
        _run_autopilot_decomposition,
        project_id,
        project["name"],
        project["description"],
        features,
    )
    return {"ok": True, "message": f"Decomposing {len(features)} features in background"}


@router.delete(
    "/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_project(
    project_id: str, db: sqlite3.Connection = Depends(get_db)
) -> Response:
    """Delete a project by ID. Cascades to features, tasks, and documents."""
    existing = db.execute(
        "SELECT id FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
