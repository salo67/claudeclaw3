"""Pulse Config endpoints -- CRUD for pulse_modules."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from database import get_db

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["enabled"] = bool(d.get("enabled", 0))
    return d


# ── List all modules ────────────────────────────────────

@router.get("/pulse/modules")
def list_modules(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        "SELECT * FROM pulse_modules ORDER BY position ASC, created_at ASC"
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ── Create module ───────────────────────────────────────

class ModuleCreate(BaseModel):
    key: str
    name: str
    description: str = ""
    category: str = "business"
    icon: str = "chart"
    config: str = "{}"


@router.post("/pulse/modules", status_code=status.HTTP_201_CREATED)
def create_module(body: ModuleCreate, db: sqlite3.Connection = Depends(get_db)) -> dict:
    now = int(time.time())
    mod_id = str(uuid4())
    max_pos = db.execute("SELECT COALESCE(MAX(position), -1) FROM pulse_modules").fetchone()[0]
    db.execute(
        "INSERT INTO pulse_modules (id, key, name, description, category, enabled, config, icon, position, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
        (mod_id, body.key, body.name, body.description, body.category, body.config, body.icon, max_pos + 1, now, now),
    )
    db.commit()
    row = db.execute("SELECT * FROM pulse_modules WHERE id = ?", (mod_id,)).fetchone()
    return _row_to_dict(row)


# ── Update module ───────────────────────────────────────

class ModulePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    icon: str | None = None
    config: str | None = None
    enabled: bool | None = None


@router.patch("/pulse/modules/{module_id}")
def patch_module(module_id: str, body: ModulePatch, db: sqlite3.Connection = Depends(get_db)) -> dict:
    existing = db.execute("SELECT id FROM pulse_modules WHERE id = ?", (module_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Module not found")

    updates: list[str] = []
    params: list = []
    for field in ("name", "description", "category", "icon", "config"):
        val = getattr(body, field)
        if val is not None:
            updates.append(f"{field} = ?")
            params.append(val)
    if body.enabled is not None:
        updates.append("enabled = ?")
        params.append(int(body.enabled))
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    updates.append("updated_at = ?")
    params.append(int(time.time()))
    params.append(module_id)
    db.execute(f"UPDATE pulse_modules SET {', '.join(updates)} WHERE id = ?", params)  # noqa: S608
    db.commit()
    row = db.execute("SELECT * FROM pulse_modules WHERE id = ?", (module_id,)).fetchone()
    return _row_to_dict(row)


# ── Reorder modules ────────────────────────────────────

@router.put("/pulse/modules/reorder")
def reorder_modules(order: list[str], db: sqlite3.Connection = Depends(get_db)) -> dict:
    now = int(time.time())
    for idx, mod_id in enumerate(order):
        db.execute(
            "UPDATE pulse_modules SET position = ?, updated_at = ? WHERE id = ?",
            (idx, now, mod_id),
        )
    db.commit()
    return {"ok": True}


# ── Delete module ───────────────────────────────────────

@router.delete("/pulse/modules/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_module(module_id: str, db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM pulse_modules WHERE id = ?", (module_id,))
    db.commit()
