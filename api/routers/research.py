"""Research router -- deep research via Perplexity API with persistent reports."""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from database import get_db

router = APIRouter()

RESEARCH_DIR = Path(__file__).parent.parent.parent / "store" / "research"
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")


class ResearchRequest(BaseModel):
    query: str
    model: str = "sonar"  # "sonar" (fast) or "sonar-deep-research" (thorough)


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _run_perplexity(report_id: str, query: str, model: str) -> None:
    """Call Perplexity API in background and persist results."""
    import sqlite3

    from database import _connect

    conn = _connect()
    try:
        import httpx

        headers = {
            "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a thorough research analyst. Produce well-structured, detailed reports in Markdown. Include headers, bullet points, and data where relevant. Write in Spanish unless the query is in English.",
                },
                {"role": "user", "content": query},
            ],
        }

        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        content_md = data["choices"][0]["message"]["content"]
        citations = data.get("citations", [])
        usage = data.get("usage", {})

        # Estimate cost (Perplexity sonar ~$1/1M tokens, deep ~$5/1M)
        total_tokens = usage.get("total_tokens", 0)
        rate = 5.0 if "deep" in model else 1.0
        cost = (total_tokens / 1_000_000) * rate

        # Save markdown file
        RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
        file_path = RESEARCH_DIR / f"{report_id}.md"
        file_path.write_text(
            f"# {query}\n\n{content_md}\n\n---\n\n## Fuentes\n\n"
            + "\n".join(f"- {url}" for url in citations),
            encoding="utf-8",
        )

        now = int(time.time())
        conn.execute(
            """UPDATE research_reports
               SET status = 'done', content_md = ?, sources = ?, file_path = ?,
                   cost_usd = ?, completed_at = ?
               WHERE id = ?""",
            (
                content_md,
                json.dumps(citations),
                f"store/research/{report_id}.md",
                cost,
                now,
                report_id,
            ),
        )
        conn.commit()

    except Exception as exc:
        conn.execute(
            "UPDATE research_reports SET status = 'error', error = ? WHERE id = ?",
            (str(exc)[:500], report_id),
        )
        conn.commit()
    finally:
        conn.close()


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/research")
def create_research(body: ResearchRequest, db=Depends(get_db)):
    if not PERPLEXITY_API_KEY:
        raise HTTPException(status_code=500, detail="PERPLEXITY_API_KEY not configured")

    if body.model not in ("sonar", "sonar-deep-research"):
        raise HTTPException(status_code=400, detail="Model must be 'sonar' or 'sonar-deep-research'")

    report_id = uuid4().hex[:12]
    now = int(time.time())
    db.execute(
        """INSERT INTO research_reports (id, query, model, status, created_at)
           VALUES (?, ?, ?, 'running', ?)""",
        (report_id, body.query, body.model, now),
    )
    db.commit()

    asyncio.get_event_loop().create_task(_run_perplexity(report_id, body.query, body.model))

    return {"id": report_id, "status": "running"}


@router.get("/research")
def list_research(db=Depends(get_db)):
    rows = db.execute(
        """SELECT id, query, model, status, cost_usd, error, created_at, completed_at
           FROM research_reports ORDER BY created_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/research/{report_id}")
def get_research(report_id: str, db=Depends(get_db)):
    row = db.execute(
        "SELECT * FROM research_reports WHERE id = ?", (report_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    result = dict(row)
    result["sources"] = json.loads(result.get("sources") or "[]")
    return result


@router.get("/research/{report_id}/download")
def download_research(report_id: str, db=Depends(get_db)):
    row = db.execute(
        "SELECT file_path, query FROM research_reports WHERE id = ?", (report_id,)
    ).fetchone()
    if not row or not row["file_path"]:
        raise HTTPException(status_code=404, detail="Report file not found")

    full_path = Path(__file__).parent.parent.parent / row["file_path"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File missing from disk")

    safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in row["query"][:50])
    return FileResponse(full_path, filename=f"{safe_name}.md", media_type="text/markdown")


@router.delete("/research/{report_id}")
def delete_research(report_id: str, db=Depends(get_db)):
    row = db.execute(
        "SELECT file_path FROM research_reports WHERE id = ?", (report_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")

    if row["file_path"]:
        full_path = Path(__file__).parent.parent.parent / row["file_path"]
        if full_path.exists():
            full_path.unlink()

    db.execute("DELETE FROM research_reports WHERE id = ?", (report_id,))
    db.commit()
    return {"ok": True}
