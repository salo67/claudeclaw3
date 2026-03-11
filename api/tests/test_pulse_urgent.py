"""Tests for pulse urgent alert: extraction, formatting, Telegram sending, and post-generate hook."""

import json
import time
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from database import init_db, get_db

init_db()

client = TestClient(app)


# ── Unit tests for extraction and formatting ──


def _make_snapshot(stockouts=None, approvals=None):
    """Build a minimal pulse snapshot for testing."""
    snap = {
        "generated_at": "2025-01-01T00:00:00Z",
        "cashflow": {"status": "ok", "data": {}},
        "stockouts": {"status": "error", "error": "unreachable"},
        "kpis_hd": {"status": "error", "error": "unreachable"},
        "pending_approvals": {"status": "error", "error": "unreachable"},
        "exchange_rate": {"status": "ok", "data": {"usd_mxn": 17.5}},
        "email_stats": {"status": "error", "error": "unreachable"},
    }
    if stockouts is not None:
        snap["stockouts"] = {"status": "ok", "data": {"stockouts": stockouts}}
    if approvals is not None:
        snap["pending_approvals"] = {"status": "ok", "data": {"approvals": approvals}}
    return snap


def test_extract_urgent_no_data():
    """With all sections errored, urgent items should be empty (except DB alerts)."""
    from routers.pulse_urgent import _extract_urgent_items

    db = next(get_db())
    snap = _make_snapshot()
    urgent = _extract_urgent_items(snap, db)
    assert urgent["stockouts"] == []
    assert urgent["pending_approvals"] == []


def test_extract_urgent_with_stockouts():
    """Stockout items should be extracted from the snapshot."""
    from routers.pulse_urgent import _extract_urgent_items

    db = next(get_db())
    items = [{"sku": "ABC123", "product_name": "Widget"}, {"sku": "DEF456", "name": "Gadget"}]
    snap = _make_snapshot(stockouts=items)
    urgent = _extract_urgent_items(snap, db)
    assert len(urgent["stockouts"]) == 2
    assert urgent["stockouts"][0]["sku"] == "ABC123"


def test_extract_urgent_with_approvals():
    """Pending approval items should be extracted from the snapshot."""
    from routers.pulse_urgent import _extract_urgent_items

    db = next(get_db())
    items = [{"description": "Invoice #100", "amount": 5000}]
    snap = _make_snapshot(approvals=items)
    urgent = _extract_urgent_items(snap, db)
    assert len(urgent["pending_approvals"]) == 1


def test_format_message_returns_none_when_empty():
    """If there are no urgent items, message should be None."""
    from routers.pulse_urgent import _format_telegram_message

    result = _format_telegram_message({"stockouts": [], "pending_approvals": [], "alerts": []})
    assert result is None


def test_format_message_includes_stockouts():
    """Message should list stockout items."""
    from routers.pulse_urgent import _format_telegram_message

    urgent = {
        "stockouts": [{"product_name": "Widget", "sku": "ABC"}],
        "pending_approvals": [],
        "alerts": [],
    }
    msg = _format_telegram_message(urgent)
    assert msg is not None
    assert "ALERTA URGENTE" in msg
    assert "Stockouts (1)" in msg
    assert "Widget (ABC)" in msg


def test_format_message_includes_approvals():
    """Message should list pending approvals."""
    from routers.pulse_urgent import _format_telegram_message

    urgent = {
        "stockouts": [],
        "pending_approvals": [{"description": "Invoice #100", "amount": 5000}],
        "alerts": [],
    }
    msg = _format_telegram_message(urgent)
    assert msg is not None
    assert "Aprobaciones pendientes (1)" in msg
    assert "Invoice #100 - $5000" in msg


def test_format_message_includes_alerts():
    """Message should list active alerts."""
    from routers.pulse_urgent import _format_telegram_message

    urgent = {
        "stockouts": [],
        "pending_approvals": [],
        "alerts": [{"severity": "high", "title": "Low inventory"}],
    }
    msg = _format_telegram_message(urgent)
    assert msg is not None
    assert "Alertas activas (1)" in msg
    assert "[HIGH] Low inventory" in msg


# ── Integration: POST /api/pulse/urgent-alert ──


def test_urgent_alert_endpoint_no_pulse():
    """Should return sent=False when no pulse data exists."""
    # Clear all pulses for a clean state
    db = next(get_db())
    db.execute("DELETE FROM daily_pulses")
    db.commit()

    resp = client.post("/api/pulse/urgent-alert")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sent"] is False
    assert body["reason"] == "no_pulse_data"


def test_urgent_alert_endpoint_with_pulse_no_urgent():
    """With a pulse but no urgent items, should return sent=False."""
    db = next(get_db())
    # Clear alerts so nothing is urgent
    db.execute("DELETE FROM alerts")
    # Insert a pulse with all-error sections (no urgent data)
    snap = _make_snapshot()
    db.execute(
        "INSERT INTO daily_pulses (id, date, snapshot, generated_at, created_at) VALUES (?, ?, ?, ?, ?)",
        ("test-no-urgent", "2025-01-01", json.dumps(snap), snap["generated_at"], int(time.time())),
    )
    db.commit()

    resp = client.post("/api/pulse/urgent-alert")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sent"] is False
    assert body["reason"] == "no_urgent_items"


@patch("routers.pulse_urgent._send_telegram", new_callable=AsyncMock, return_value=True)
def test_urgent_alert_endpoint_sends_when_urgent(mock_send):
    """With stockout data in pulse, should format and send Telegram message."""
    db = next(get_db())
    # Clear previous test pulses so this one is definitively latest
    db.execute("DELETE FROM daily_pulses WHERE id LIKE 'test-%'")
    snap = _make_snapshot(stockouts=[{"sku": "X1", "product_name": "Critical Item"}])
    db.execute(
        "INSERT INTO daily_pulses (id, date, snapshot, generated_at, created_at) VALUES (?, ?, ?, ?, ?)",
        ("test-urgent-send", "2025-01-02", json.dumps(snap), snap["generated_at"], int(time.time()) + 9999),
    )
    db.commit()

    resp = client.post("/api/pulse/urgent-alert")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sent"] is True
    assert "Critical Item" in body["message"]
    mock_send.assert_called_once()


# ── Integration: pulse_generate triggers urgent alert ──


@patch("routers.pulse_urgent._send_telegram", new_callable=AsyncMock, return_value=True)
def test_pulse_generate_includes_urgent_alert(mock_send):
    """POST /api/pulse/generate should include urgent_alert in response."""
    resp = client.post("/api/pulse/generate")
    assert resp.status_code == 200
    body = resp.json()
    assert "urgent_alert" in body
    assert "sent" in body["urgent_alert"]
