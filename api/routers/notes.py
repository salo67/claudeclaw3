"""Notes endpoints for the Control Center API — knowledge base."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from database import get_db
from models import NoteCreate, NoteResponse, NoteUpdate

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    # Load linked task IDs if the column exists
    if "linked_task_ids" not in d:
        d["linked_task_ids"] = ""
    return d


@router.get("/notes", response_model=list[NoteResponse])
def list_notes(
    search: str | None = None,
    tags: str | None = None,
    project_id: str | None = None,
    pinned: bool | None = None,
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List notes with optional filters. Uses FTS5 when available for search."""
    conditions: list[str] = []
    params: list[str | int] = []

    if search:
        # Try FTS5 first, fallback to LIKE
        try:
            fts_rows = db.execute(
                "SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?", (search,)
            ).fetchall()
            if fts_rows:
                ids = [str(r["rowid"]) for r in fts_rows]
                conditions.append(f"rowid IN ({','.join('?' * len(ids))})")
                params.extend(ids)
            else:
                # FTS returned nothing, use LIKE as fallback
                conditions.append("(title LIKE ? OR content LIKE ? OR tags LIKE ?)")
                term = f"%{search}%"
                params.extend([term, term, term])
        except sqlite3.OperationalError:
            # FTS table doesn't exist yet
            conditions.append("(title LIKE ? OR content LIKE ? OR tags LIKE ?)")
            term = f"%{search}%"
            params.extend([term, term, term])

    if tags:
        for tag in tags.split(","):
            tag = tag.strip()
            if tag:
                conditions.append("tags LIKE ?")
                params.append(f"%{tag}%")

    if project_id:
        conditions.append("project_id = ?")
        params.append(project_id)

    if pinned is not None:
        conditions.append("pinned = ?")
        params.append(int(pinned))

    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = db.execute(
        f"SELECT * FROM notes{where} ORDER BY pinned DESC, updated_at DESC",  # noqa: S608
        params,
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/notes/tags")
def list_note_tags(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """Return all note tags with note counts."""
    rows = db.execute("SELECT tags FROM notes WHERE tags != ''").fetchall()
    tag_counts: dict[str, int] = {}
    for r in rows:
        for tag in r["tags"].split(","):
            tag = tag.strip()
            if tag:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(tag_counts.items(), key=lambda x: -x[1])]


@router.get("/notes/{note_id}", response_model=NoteResponse)
def get_note(note_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Get a single note."""
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return _row_to_dict(row)


@router.post("/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(body: NoteCreate, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Create a new note."""
    now = int(time.time())
    note_id = str(uuid4())
    db.execute(
        "INSERT INTO notes (id, title, content, tags, project_id, pinned, linked_task_ids, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (note_id, body.title, body.content, body.tags, body.project_id, int(body.pinned),
         body.linked_task_ids if hasattr(body, 'linked_task_ids') else "", now, now),
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return _row_to_dict(row)


@router.patch("/notes/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: str, body: NoteUpdate, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Update an existing note."""
    existing = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    updates: list[str] = []
    params: list[str | int | None] = []

    for field in ("title", "content", "tags", "project_id", "linked_task_ids"):
        value = getattr(body, field, None)
        if value is not None:
            updates.append(f"{field} = ?")
            params.append(value)

    if body.pinned is not None:
        updates.append("pinned = ?")
        params.append(int(body.pinned))

    if not updates:
        return _row_to_dict(existing)

    updates.append("updated_at = ?")
    params.append(int(time.time()))
    params.append(note_id)

    db.execute(
        f"UPDATE notes SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
        params,
    )
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return _row_to_dict(row)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: str, db: sqlite3.Connection = Depends(get_db)) -> Response:
    """Delete a note."""
    existing = db.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
