"""Tests for pulse endpoints: /api/pulse/today, generate, history, latest, advisors-overnight."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Add api/ to path so imports resolve
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from database import init_db, get_db

# Ensure tables exist for tests
init_db()

client = TestClient(app)

EXPECTED_SECTIONS = [
    "cashflow",
    "stockouts",
    "kpis_hd",
    "pending_approvals",
    "exchange_rate",
    "email_stats",
]


def test_pulse_today_returns_all_sections():
    """Each section must appear in response with status ok or error."""
    resp = client.get("/api/pulse/today")
    assert resp.status_code == 200
    body = resp.json()
    assert "generated_at" in body
    for section in EXPECTED_SECTIONS:
        assert section in body, f"Missing section: {section}"
        assert body[section]["status"] in ("ok", "error"), (
            f"Section {section} has invalid status: {body[section].get('status')}"
        )


def test_pulse_today_sections_have_error_on_unreachable():
    """When upstream APIs are unreachable, sections should report error status, not crash."""
    resp = client.get("/api/pulse/today")
    assert resp.status_code == 200
    body = resp.json()
    # In test env, upstream services are not running, so all internal sections should error
    for section in ["cashflow", "stockouts", "kpis_hd", "pending_approvals", "email_stats"]:
        assert body[section]["status"] in ("ok", "error")
        if body[section]["status"] == "error":
            assert "error" in body[section]


def test_pulse_today_exchange_rate_structure():
    """Exchange rate section should have status and either data or error."""
    resp = client.get("/api/pulse/today")
    body = resp.json()
    er = body["exchange_rate"]
    assert er["status"] in ("ok", "error")
    if er["status"] == "ok":
        assert "usd_mxn" in er["data"]
        assert "source" in er["data"]


def test_pulse_today_generated_at():
    """generated_at should be an ISO timestamp ending with Z."""
    resp = client.get("/api/pulse/today")
    body = resp.json()
    assert body["generated_at"].endswith("Z")


# --- POST /api/pulse/generate ---

def test_pulse_generate_creates_and_returns_pulse():
    """POST /api/pulse/generate should run aggregator and persist snapshot."""
    resp = client.post("/api/pulse/generate")
    assert resp.status_code == 200
    body = resp.json()
    assert "id" in body
    assert "date" in body
    assert "snapshot" in body
    assert "generated_at" in body
    assert "created_at" in body
    # snapshot should contain all expected sections
    for section in EXPECTED_SECTIONS:
        assert section in body["snapshot"], f"Missing section in snapshot: {section}"


# --- GET /api/pulse/history ---

def test_pulse_history_returns_paginated_list():
    """GET /api/pulse/history should return paginated results."""
    # Generate a pulse first so there's data
    client.post("/api/pulse/generate")
    resp = client.get("/api/pulse/history")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert "page" in body
    assert "page_size" in body
    assert body["total"] >= 1
    assert body["page"] == 1
    assert len(body["items"]) >= 1
    # Each item should have the right structure
    item = body["items"][0]
    assert "id" in item
    assert "date" in item
    assert "snapshot" in item
    assert "generated_at" in item


def test_pulse_history_pagination_params():
    """GET /api/pulse/history should respect page and page_size."""
    resp = client.get("/api/pulse/history?page=1&page_size=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["page"] == 1
    assert body["page_size"] == 1
    assert len(body["items"]) <= 1


# --- GET /api/pulse/latest ---

def test_pulse_latest_returns_most_recent():
    """GET /api/pulse/latest should return the most recently generated pulse."""
    # Generate one to be sure
    gen_resp = client.post("/api/pulse/generate")
    gen_id = gen_resp.json()["id"]

    resp = client.get("/api/pulse/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pulse"] is not None
    assert "id" in body["pulse"]
    assert "snapshot" in body["pulse"]
    assert "date" in body["pulse"]


# --- GET /api/pulse/advisors-overnight ---


def test_advisors_overnight_empty_when_no_messages():
    """Should return empty arrays and summary when no recent advisor messages."""
    import sqlite3 as _sqlite3

    def _empty_db():
        conn = _sqlite3.connect(":memory:")
        conn.row_factory = _sqlite3.Row
        conn.execute(
            "CREATE TABLE advisor_messages (id TEXT, thread_id TEXT, role TEXT, content TEXT, agent_role TEXT, created_at INTEGER)"
        )
        yield conn
        conn.close()

    app.dependency_overrides[get_db] = _empty_db
    try:
        resp = client.get("/api/pulse/advisors-overnight")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body["decisions"] == []
    assert body["pending_approvals"] == []
    assert body["actions_taken"] == []
    assert body["summary"] == ""
    assert body["message_count"] == 0


def test_advisors_overnight_response_structure():
    """Response must always have decisions, pending_approvals, actions_taken, summary."""
    resp = client.get("/api/pulse/advisors-overnight")
    assert resp.status_code == 200
    body = resp.json()
    assert "decisions" in body
    assert "pending_approvals" in body
    assert "actions_taken" in body
    assert "summary" in body
    assert "message_count" in body
    assert isinstance(body["decisions"], list)
    assert isinstance(body["pending_approvals"], list)
    assert isinstance(body["actions_taken"], list)
    assert isinstance(body["summary"], str)
    assert isinstance(body["message_count"], int)


def test_advisors_overnight_queries_last_12h():
    """Should only include messages from the last 12 hours."""
    from database import get_db
    import uuid

    db = next(get_db())
    now = int(time.time())
    thread_id = "test-overnight-" + str(uuid.uuid4())[:8]
    db.execute(
        "INSERT OR IGNORE INTO advisor_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (thread_id, "Test Thread", now, now),
    )
    # Insert a recent message (1 hour ago)
    db.execute(
        "INSERT INTO advisor_messages (id, thread_id, role, content, agent_role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), thread_id, "model", "Recent decision: increase inventory", "ceo", now - 3600),
    )
    # Insert an old message (24 hours ago -- outside window)
    db.execute(
        "INSERT INTO advisor_messages (id, thread_id, role, content, agent_role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), thread_id, "model", "Old message should not appear", "sales", now - 86400),
    )
    db.commit()

    # Mock Gemini to capture what messages it receives
    mock_response = MagicMock()
    mock_response.text = '{"decisions": ["increase inventory"], "pending_approvals": [], "actions_taken": [], "summary": "CEO recommended inventory increase"}'

    with patch("routers.pulse_today._get_gemini_client") as mock_client:
        mock_client.return_value.models.generate_content.return_value = mock_response
        resp = client.get("/api/pulse/advisors-overnight")

    assert resp.status_code == 200
    body = resp.json()
    assert body["message_count"] >= 1
    assert body["decisions"] == ["increase inventory"]
    assert body["summary"] == "CEO recommended inventory increase"

    # Verify Gemini was called with the recent message but not the old one
    call_args = mock_client.return_value.models.generate_content.call_args
    prompt_text = call_args[1]["contents"] if "contents" in call_args[1] else call_args[0][0]
    assert "Recent decision" in str(prompt_text)
    assert "Old message should not appear" not in str(prompt_text)


def test_advisors_overnight_handles_gemini_error():
    """Should return graceful fallback if Gemini call fails."""
    from database import get_db
    import uuid

    db = next(get_db())
    now = int(time.time())
    thread_id = "test-error-" + str(uuid.uuid4())[:8]
    db.execute(
        "INSERT OR IGNORE INTO advisor_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (thread_id, "Test Thread", now, now),
    )
    db.execute(
        "INSERT INTO advisor_messages (id, thread_id, role, content, agent_role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), thread_id, "model", "Some advisor message", "ceo", now - 1800),
    )
    db.commit()

    with patch("routers.pulse_today._get_gemini_client") as mock_client:
        mock_client.return_value.models.generate_content.side_effect = Exception("API error")
        resp = client.get("/api/pulse/advisors-overnight")

    assert resp.status_code == 200
    body = resp.json()
    assert body["decisions"] == []
    assert body["pending_approvals"] == []
    assert body["actions_taken"] == []
    assert body["summary"] == "Error generating summary"
    assert body["message_count"] >= 1
