"""Daily Journal endpoints for the Control Center API."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from database import DB_PATH, get_db
from models import JournalCreate, JournalResponse, JournalUpdate

router = APIRouter()

# ── LLM provider (reuse multi-provider abstraction) ─────────────
from llm_providers import get_provider, is_provider_available


def _pick_provider() -> tuple[str, str]:
    """Pick the best available provider/model for journal AI."""
    preferences = [
        ("anthropic", "claude-haiku-4-5-20251001"),
        ("gemini", "gemini-2.5-flash"),
        ("openai", "gpt-4o-mini"),
        ("glm", "glm-4-flash"),
        ("kimi", "moonshot-v1-auto"),
    ]
    for pkey, model in preferences:
        if is_provider_available(pkey):
            return pkey, model
    return preferences[0]


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


# ── List + static routes (BEFORE /{date} to avoid shadowing) ──

@router.get("/journal", response_model=list[JournalResponse])
def list_entries(
    limit: int = 30,
    offset: int = 0,
    search: str | None = None,
    mood: str | None = None,
    tags: str | None = None,
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List journal entries with optional search, mood and tag filters."""
    conditions: list[str] = []
    params: list = []

    if search:
        conditions.append("(content LIKE ? OR tags LIKE ? OR date LIKE ?)")
        term = f"%{search}%"
        params.extend([term, term, term])

    if mood:
        conditions.append("mood = ?")
        params.append(mood)

    if tags:
        for tag in tags.split(","):
            tag = tag.strip()
            if tag:
                conditions.append("tags LIKE ?")
                params.append(f"%{tag}%")

    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = db.execute(
        f"SELECT * FROM journal_entries{where} ORDER BY date DESC LIMIT ? OFFSET ?",  # noqa: S608
        [*params, limit, offset],
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/journal/dates")
def list_dates(
    year: int | None = None,
    month: int | None = None,
    db: sqlite3.Connection = Depends(get_db),
) -> list[str]:
    """Return dates that have journal entries (for calendar dots)."""
    if year and month:
        pattern = f"{year:04d}-{month:02d}-%"
        rows = db.execute(
            "SELECT date FROM journal_entries WHERE date LIKE ? ORDER BY date",
            (pattern,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT date FROM journal_entries ORDER BY date DESC LIMIT 90"
        ).fetchall()
    return [r["date"] for r in rows]


@router.get("/journal/tags")
def list_journal_tags(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """Return all journal tags with entry counts."""
    rows = db.execute("SELECT tags FROM journal_entries WHERE tags != ''").fetchall()
    tag_counts: dict[str, int] = {}
    for r in rows:
        for tag in r["tags"].split(","):
            tag = tag.strip()
            if tag:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(tag_counts.items(), key=lambda x: -x[1])]


# ── AI-powered endpoints (static paths, must be before /{date}) ──

class PromptResponse(BaseModel):
    prompt: str


@router.get("/journal/ai/prompt", response_model=PromptResponse)
async def get_daily_prompt(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Generate an AI prompt based on recent journal entries + projects."""
    recent = db.execute(
        "SELECT date, content, mood FROM journal_entries ORDER BY date DESC LIMIT 7"
    ).fetchall()
    entries_ctx = "\n".join(
        f"- {r['date']} (mood: {r['mood'] or 'N/A'}): {r['content'][:200]}"
        for r in recent
    ) or "No hay entradas recientes."

    projects = db.execute(
        "SELECT name, phase, priority FROM projects WHERE completed = 0 ORDER BY priority DESC LIMIT 10"
    ).fetchall()
    projects_ctx = "\n".join(
        f"- [{p['priority']}] {p['name']} ({p['phase']})" for p in projects
    ) or "No hay proyectos activos."

    system = (
        "Eres un coach de journal para un CEO mexicano. "
        "Genera UNA pregunta reflexiva para hoy basada en el contexto. "
        "Que sea directa, especifica, y relevante. No genérica. "
        "Solo la pregunta, nada mas."
    )
    user_msg = (
        f"Entradas recientes del journal:\n{entries_ctx}\n\n"
        f"Proyectos activos:\n{projects_ctx}\n\n"
        "Genera una pregunta reflexiva para hoy."
    )

    try:
        pkey, model = _pick_provider()
        provider = get_provider(pkey)
        resp = await provider.chat(
            model=model,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
            tools=[],
            max_tokens=200,
            temperature=0.8,
        )
        prompt = resp.text.strip() if resp.text else "Que es lo mas importante que necesitas resolver hoy?"
    except Exception:
        prompt = "Que es lo mas importante que necesitas resolver hoy?"

    return {"prompt": prompt}


@router.post("/journal/ai/summary")
async def get_summary(weeks: int = 1, db: sqlite3.Connection = Depends(get_db)):
    """Stream a weekly summary of journal entries via SSE."""
    import datetime

    cutoff = (
        datetime.date.today() - datetime.timedelta(weeks=weeks)
    ).isoformat()

    rows = db.execute(
        "SELECT date, content, mood, tags FROM journal_entries WHERE date >= ? ORDER BY date ASC",
        (cutoff,),
    ).fetchall()

    if not rows:
        async def empty_stream() -> AsyncGenerator[dict, None]:
            yield {"event": "delta", "data": json.dumps({"text": "No hay entradas en este periodo."})}
            yield {"event": "done", "data": json.dumps({"text": "No hay entradas en este periodo."})}
        return EventSourceResponse(empty_stream())

    entries_text = "\n\n".join(
        f"### {r['date']} (mood: {r['mood'] or 'N/A'})\n{r['content']}"
        for r in rows
    )

    system = (
        "Eres un analista de journal para un CEO mexicano. "
        "Analiza las entradas y produce:\n"
        "1. Temas principales\n"
        "2. Patrones de mood/energía\n"
        "3. Decisiones pendientes detectadas\n"
        "4. Action items sugeridos\n"
        "Sé directo y conciso. Responde en español."
    )
    user_msg = f"Entradas del journal (últimas {weeks} semana(s)):\n\n{entries_text}"

    async def event_stream() -> AsyncGenerator[dict, None]:
        try:
            pkey, model = _pick_provider()
            provider = get_provider(pkey)
            full = ""
            async for delta in provider.chat_stream(
                model=model,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
                tools=[],
                max_tokens=2048,
                temperature=0.5,
            ):
                if delta.text:
                    full += delta.text
                    yield {"event": "delta", "data": json.dumps({"text": delta.text})}
            yield {"event": "done", "data": json.dumps({"text": full})}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_stream())


# ── Date-based CRUD (AFTER all static routes) ────────────────

@router.get("/journal/{date}", response_model=JournalResponse)
def get_entry(date: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Get journal entry for a specific date."""
    row = db.execute(
        "SELECT * FROM journal_entries WHERE date = ?", (date,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No entry for this date"
        )
    return _row_to_dict(row)


@router.put("/journal/{date}", response_model=JournalResponse)
def upsert_entry(
    date: str, body: JournalCreate, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Create or update journal entry for a date (upsert)."""
    now = int(time.time())
    existing = db.execute(
        "SELECT id FROM journal_entries WHERE date = ?", (date,)
    ).fetchone()

    if existing:
        updates: list[str] = []
        params: list = []
        if body.content is not None:
            updates.append("content = ?")
            params.append(body.content)
        if body.mood is not None:
            updates.append("mood = ?")
            params.append(body.mood)
        if body.tags is not None:
            updates.append("tags = ?")
            params.append(body.tags)
        if body.linked_task_ids is not None:
            updates.append("linked_task_ids = ?")
            params.append(body.linked_task_ids)
        updates.append("updated_at = ?")
        params.append(now)
        params.append(date)
        db.execute(
            f"UPDATE journal_entries SET {', '.join(updates)} WHERE date = ?",  # noqa: S608
            params,
        )
    else:
        entry_id = str(uuid4())
        db.execute(
            "INSERT INTO journal_entries (id, date, content, mood, tags, linked_task_ids, bot_prompts, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)",
            (entry_id, date, body.content, body.mood, body.tags, body.linked_task_ids, now, now),
        )
    db.commit()
    row = db.execute(
        "SELECT * FROM journal_entries WHERE date = ?", (date,)
    ).fetchone()
    return _row_to_dict(row)


@router.delete("/journal/{date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(date: str, db: sqlite3.Connection = Depends(get_db)):
    """Delete journal entry for a date."""
    db.execute("DELETE FROM journal_entries WHERE date = ?", (date,))
    db.commit()
