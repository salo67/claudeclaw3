"""Pulse Briefing endpoint -- daily personal briefing with quote, weather, newsletters."""

from __future__ import annotations

import json
import os
import sqlite3
import time

import httpx
from fastapi import APIRouter, Depends

from database import get_db
from llm_providers import get_provider, is_provider_available

router = APIRouter()

_TIMEOUT = 5.0


def _pick_provider() -> tuple[str, str]:
    """Pick the best available provider/model for briefing generation."""
    preferences = [
        ("anthropic", "claude-haiku-4-5-20251001"),
        ("gemini", "gemini-2.0-flash"),
        ("openai", "gpt-4o-mini"),
        ("glm", "glm-4-flash"),
        ("kimi", "moonshot-v1-auto"),
    ]
    for pkey, model in preferences:
        if is_provider_available(pkey):
            return pkey, model
    return preferences[0]


async def _llm_generate(system: str, user_content: str, temperature: float = 0.3, max_tokens: int = 500) -> str:
    """Generate text using the best available LLM provider."""
    pkey, model = _pick_provider()
    provider = get_provider(pkey)
    resp = await provider.chat(
        model=model,
        system=system,
        messages=[{"role": "user", "content": user_content}],
        tools=[],
        max_tokens=max_tokens,
        temperature=temperature,
    )
    raw = resp.text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return raw


async def _fetch_weather() -> dict:
    """Fetch weather from wttr.in for Monterrey."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "https://wttr.in/Monterrey?format=j1",
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
            current = data["current_condition"][0]
            forecast_today = data["weather"][0]
            return {
                "temp": current.get("temp_C", ""),
                "condition": current.get("weatherDesc", [{}])[0].get("value", ""),
                "forecast": forecast_today.get("maxtempC", "") + "°C max, " + forecast_today.get("mintempC", "") + "°C min",
            }
    except Exception:
        return {"temp": "", "condition": "unavailable", "forecast": ""}


async def _fetch_newsletter_highlights() -> list[dict]:
    """Fetch newsletter emails and extract subject + key_points placeholder."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                "http://localhost:8055/api/emails?category=newsletter",
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            emails = r.json()
            if isinstance(emails, dict) and "emails" in emails:
                emails = emails["emails"]
            if not isinstance(emails, list):
                return []
            highlights = []
            for email in emails[:5]:
                subject = email.get("subject", "")
                snippet = email.get("snippet", email.get("body", ""))[:300]
                highlights.append({"subject": subject, "snippet": snippet})
            return highlights
    except Exception:
        return []


async def _generate_quote(journal_entries: list[dict], newsletter_highlights: list[dict]) -> str:
    """Generate a motivational quote based on recent journal entries."""
    try:
        journal_context = ""
        for entry in journal_entries[:5]:
            date = entry.get("date", "")
            content = entry.get("content", "")[:200]
            mood = entry.get("mood", "")
            journal_context += f"- {date} (mood: {mood}): {content}\n"

        newsletter_context = ""
        for nh in newsletter_highlights[:3]:
            newsletter_context += f"- {nh.get('subject', '')}\n"

        system = "Eres un coach ejecutivo. Genera UNA frase motivacional corta y poderosa (maximo 2 oraciones) para empezar el dia. Responde SOLO con la frase, sin comillas, sin explicacion."
        user_content = f"""Journal reciente:
{journal_context if journal_context else "Sin entradas recientes."}

Newsletters del dia:
{newsletter_context if newsletter_context else "Sin newsletters."}"""

        return await _llm_generate(system, user_content, temperature=0.9, max_tokens=150)
    except Exception:
        return "Nuevo dia, nuevas oportunidades. A darle."


def _get_recent_journal_entries(db: sqlite3.Connection) -> list[dict]:
    """Get the 5 most recent journal entries."""
    rows = db.execute(
        "SELECT date, content, mood, tags FROM journal_entries ORDER BY date DESC LIMIT 5"
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/pulse/briefing")
async def pulse_briefing(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Daily personal briefing: motivational quote, weather, newsletter highlights."""

    # Fetch weather and newsletters concurrently
    weather = await _fetch_weather()
    newsletter_highlights = await _fetch_newsletter_highlights()

    # Get journal entries for context
    journal_entries = _get_recent_journal_entries(db)

    # Build key_points from newsletters via LLM if we have content
    final_highlights = []
    if newsletter_highlights:
        try:
            nl_text = ""
            for nh in newsletter_highlights:
                nl_text += f"Subject: {nh['subject']}\nSnippet: {nh.get('snippet', '')}\n\n"

            system = "Extrae los puntos clave de cada newsletter. Responde SOLO con un JSON array, sin markdown."
            user_content = f"""Newsletters:
{nl_text}

Formato esperado: [{{"subject": "...", "key_points": ["punto1", "punto2"]}}]"""

            text = await _llm_generate(system, user_content, temperature=0.3, max_tokens=500)
            final_highlights = json.loads(text)
        except Exception:
            final_highlights = [{"subject": nh["subject"], "key_points": []} for nh in newsletter_highlights]

    # Generate motivational quote (uses journal context)
    quote = await _generate_quote(journal_entries, newsletter_highlights)

    return {
        "quote": quote,
        "weather": weather,
        "newsletter_highlights": final_highlights,
    }
