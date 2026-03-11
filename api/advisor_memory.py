"""Cross-thread persistent memory for advisor agents.

Uses the shared memories + memories_fts tables (created by TS bot in db.ts).
All advisor memories use chat_id = 'advisor' to avoid colliding with the
Telegram bot's per-user memories.
"""

from __future__ import annotations

import re
import sqlite3
import time
from typing import Any

from database import DB_PATH

ADVISOR_CHAT_ID = "advisor"
MAX_MEMORY_CONTEXT_CHARS = 3000  # ~750 tokens


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.row_factory = sqlite3.Row
    return conn


def save_memory(
    content: str,
    sector: str = "semantic",
    agent_name: str = "",
    salience: float = 1.0,
) -> int:
    """Save a memory to the shared advisor memory store."""
    now = int(time.time())
    tagged = f"[{agent_name}] {content}" if agent_name else content
    conn = _get_conn()
    try:
        cursor = conn.execute(
            "INSERT INTO memories (chat_id, content, sector, salience, created_at, accessed_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (ADVISOR_CHAT_ID, tagged, sector, salience, now, now),
        )
        mem_id = cursor.lastrowid or 0
        conn.commit()
        return mem_id
    finally:
        conn.close()


def search_memories(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """FTS5 search against advisor memories."""
    sanitized = re.sub(r"[^\w\s]", "", query).strip()
    if not sanitized:
        return []
    words = [w for w in sanitized.split() if len(w) > 2]
    if not words:
        return []
    terms = " OR ".join(f'"{w}"' for w in words[:8])
    conn = _get_conn()
    try:
        rows = conn.execute(
            """SELECT memories.* FROM memories
               JOIN memories_fts ON memories.id = memories_fts.rowid
               WHERE memories_fts MATCH ? AND memories.chat_id = ?
               ORDER BY rank
               LIMIT ?""",
            (terms, ADVISOR_CHAT_ID, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


def get_knowledge_memories() -> list[dict[str, Any]]:
    """Get all permanent knowledge memories for advisors."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM memories WHERE chat_id = ? AND sector = 'knowledge' "
            "ORDER BY created_at DESC LIMIT 30",
            (ADVISOR_CHAT_ID,),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


def get_recent_memories(limit: int = 5) -> list[dict[str, Any]]:
    """Get most recently accessed advisor memories."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM memories WHERE chat_id = ? AND sector != 'knowledge' "
            "ORDER BY accessed_at DESC LIMIT ?",
            (ADVISOR_CHAT_ID, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


def touch_memory(mem_id: int) -> None:
    """Bump access time and slightly increase salience."""
    now = int(time.time())
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0) WHERE id = ?",
            (now, mem_id),
        )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def build_memory_context(user_message: str) -> str:
    """Build a compact memory string for the advisor system prompt.

    Three layers:
      0. Knowledge (permanent facts) -- always included
      1. FTS5 search results matching user's message
      2. Recent memories (deduplicated)
    Capped at MAX_MEMORY_CONTEXT_CHARS.
    """
    seen: set[int] = set()
    lines: list[str] = []
    total_chars = 0

    # Layer 0: permanent knowledge
    for mem in get_knowledge_memories():
        if total_chars >= MAX_MEMORY_CONTEXT_CHARS:
            break
        seen.add(mem["id"])
        line = f"- [PERMANENTE] {mem['content'][:200]}"
        lines.append(line)
        total_chars += len(line)

    # Layer 1: FTS5 search on user message
    for mem in search_memories(user_message, limit=5):
        if mem["id"] in seen or total_chars >= MAX_MEMORY_CONTEXT_CHARS:
            continue
        seen.add(mem["id"])
        touch_memory(mem["id"])
        line = f"- {mem['content'][:200]}"
        lines.append(line)
        total_chars += len(line)

    # Layer 2: recent memories
    for mem in get_recent_memories(limit=3):
        if mem["id"] in seen or total_chars >= MAX_MEMORY_CONTEXT_CHARS:
            continue
        seen.add(mem["id"])
        touch_memory(mem["id"])
        line = f"- {mem['content'][:200]}"
        lines.append(line)
        total_chars += len(line)

    if not lines:
        return ""
    return "\n---\n## Memoria del equipo\n" + "\n".join(lines)


def summarize_thread_messages(messages: list[dict[str, Any]]) -> str:
    """Create an extractive summary from thread messages (no LLM call).

    Takes the first sentence of the last 10 assistant messages as key points.
    """
    assistant_msgs = [
        m["content"]
        for m in messages
        if m.get("role") == "assistant" and m.get("content")
    ]
    if len(assistant_msgs) < 3:
        return ""
    points: list[str] = []
    for msg in assistant_msgs[-10:]:
        first_line = msg.split("\n")[0].strip()
        if len(first_line) > 20:
            points.append(first_line[:150])
    if not points:
        return ""
    return "Resumen de conversacion: " + " | ".join(points[:5])


def decay_advisor_memories() -> None:
    """Run salience decay on advisor memories. Call periodically or on startup."""
    one_day_ago = int(time.time()) - 86400
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE memories SET salience = salience * 0.98 "
            "WHERE chat_id = ? AND accessed_at < ? AND sector != 'knowledge'",
            (ADVISOR_CHAT_ID, one_day_ago),
        )
        conn.execute(
            "DELETE FROM memories WHERE chat_id = ? AND salience < 0.1 AND sector != 'knowledge'",
            (ADVISOR_CHAT_ID,),
        )
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()
