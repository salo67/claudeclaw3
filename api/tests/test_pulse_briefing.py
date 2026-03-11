"""Tests for GET /api/pulse/briefing endpoint."""

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from database import init_db, get_db

init_db()

client = TestClient(app)


def test_briefing_returns_required_fields():
    """Response must contain quote, weather, newsletter_highlights."""
    with patch("routers.pulse_briefing._get_gemini_client") as mock_gc:
        mock_resp = MagicMock()
        mock_resp.text = "Hoy es un gran día para avanzar."
        mock_gc.return_value.models.generate_content.return_value = mock_resp

        resp = client.get("/api/pulse/briefing")

    assert resp.status_code == 200
    body = resp.json()
    assert "quote" in body
    assert "weather" in body
    assert "newsletter_highlights" in body
    assert isinstance(body["quote"], str)
    assert isinstance(body["weather"], dict)
    assert isinstance(body["newsletter_highlights"], list)


def test_briefing_weather_structure():
    """Weather must have temp, condition, forecast."""
    with patch("routers.pulse_briefing._get_gemini_client") as mock_gc:
        mock_resp = MagicMock()
        mock_resp.text = "A darle."
        mock_gc.return_value.models.generate_content.return_value = mock_resp

        resp = client.get("/api/pulse/briefing")

    body = resp.json()
    weather = body["weather"]
    assert "temp" in weather
    assert "condition" in weather
    assert "forecast" in weather


def test_briefing_quote_from_gemini():
    """Quote should come from Gemini when available."""
    with patch("routers.pulse_briefing._get_gemini_client") as mock_gc:
        mock_resp = MagicMock()
        mock_resp.text = "El éxito es la suma de pequeños esfuerzos."
        mock_gc.return_value.models.generate_content.return_value = mock_resp

        resp = client.get("/api/pulse/briefing")

    body = resp.json()
    assert body["quote"] == "El éxito es la suma de pequeños esfuerzos."


def test_briefing_quote_uses_journal_context():
    """Gemini should receive recent journal entries in prompt."""
    db = next(get_db())
    now = int(time.time())
    db.execute(
        "INSERT OR REPLACE INTO journal_entries (id, date, content, mood, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("test-briefing-1", "2026-03-07", "Cerré un deal importante con HD", "great", "[]", now, now),
    )
    db.commit()

    with patch("routers.pulse_briefing._get_gemini_client") as mock_gc:
        mock_resp = MagicMock()
        mock_resp.text = "El momentum se construye con victorias diarias."
        mock_gc.return_value.models.generate_content.return_value = mock_resp

        resp = client.get("/api/pulse/briefing")

    assert resp.status_code == 200
    # Verify Gemini was called and the journal content was in the prompt
    call_args = mock_gc.return_value.models.generate_content.call_args
    prompt_text = str(call_args)
    assert "Cerré un deal importante" in prompt_text


def test_briefing_newsletter_highlights_structure():
    """When newsletters exist, highlights should have subject and key_points."""
    with patch("routers.pulse_briefing._fetch_newsletter_highlights") as mock_nl, \
         patch("routers.pulse_briefing._get_gemini_client") as mock_gc:

        mock_nl.return_value = [
            {"subject": "Weekly Tech Digest", "snippet": "AI advances in 2026..."}
        ]

        # First call: key_points extraction, second call: quote generation
        kp_resp = MagicMock()
        kp_resp.text = json.dumps([{"subject": "Weekly Tech Digest", "key_points": ["AI advances"]}])
        quote_resp = MagicMock()
        quote_resp.text = "A darle."
        mock_gc.return_value.models.generate_content.side_effect = [kp_resp, quote_resp]

        resp = client.get("/api/pulse/briefing")

    body = resp.json()
    assert len(body["newsletter_highlights"]) == 1
    nh = body["newsletter_highlights"][0]
    assert "subject" in nh
    assert "key_points" in nh
    assert nh["subject"] == "Weekly Tech Digest"
    assert "AI advances" in nh["key_points"]


def test_briefing_handles_gemini_error_gracefully():
    """If Gemini fails, should return fallback quote and still work."""
    with patch("routers.pulse_briefing._get_gemini_client") as mock_gc:
        mock_gc.return_value.models.generate_content.side_effect = Exception("API error")

        resp = client.get("/api/pulse/briefing")

    assert resp.status_code == 200
    body = resp.json()
    assert body["quote"] == "Nuevo día, nuevas oportunidades. A darle."
    assert isinstance(body["weather"], dict)
    assert isinstance(body["newsletter_highlights"], list)


def test_briefing_no_newsletters_returns_empty_list():
    """When no newsletters available, newsletter_highlights should be empty."""
    with patch("routers.pulse_briefing._fetch_newsletter_highlights") as mock_nl, \
         patch("routers.pulse_briefing._get_gemini_client") as mock_gc:

        mock_nl.return_value = []
        mock_resp = MagicMock()
        mock_resp.text = "A darle."
        mock_gc.return_value.models.generate_content.return_value = mock_resp

        resp = client.get("/api/pulse/briefing")

    body = resp.json()
    assert body["newsletter_highlights"] == []
