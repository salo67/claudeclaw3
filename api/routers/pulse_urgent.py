"""Pulse Urgent Alert -- sends urgent items to Telegram after pulse generation."""

from __future__ import annotations

import json
import os
import sqlite3

import httpx
from fastapi import APIRouter, Depends

from database import get_db

router = APIRouter()

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _extract_urgent_items(snapshot: dict, db: sqlite3.Connection) -> dict:
    """Extract urgent items from a pulse snapshot + active alerts from DB."""
    urgent: dict = {"stockouts": [], "pending_approvals": [], "alerts": []}

    # Stockouts
    so = snapshot.get("stockouts", {})
    if so.get("status") == "ok":
        data = so.get("data", {}).get("stockouts", {})
        # Handle both list and dict shapes from upstream
        items = data if isinstance(data, list) else data.get("items", data.get("products", []))
        if isinstance(items, list):
            urgent["stockouts"] = items

    # Pending approvals
    pa = snapshot.get("pending_approvals", {})
    if pa.get("status") == "ok":
        data = pa.get("data", {}).get("approvals", {})
        items = data if isinstance(data, list) else data.get("items", data.get("pending", []))
        if isinstance(items, list):
            urgent["pending_approvals"] = items

    # Active alerts from DB (non-dismissed, last 24h)
    try:
        rows = db.execute(
            "SELECT category, severity, title, description FROM alerts WHERE dismissed = 0 ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
        urgent["alerts"] = [dict(r) for r in rows]
    except Exception:
        pass

    return urgent


def _format_telegram_message(urgent: dict) -> str | None:
    """Format urgent items as a Telegram HTML message. Returns None if nothing urgent."""
    lines: list[str] = []

    stockouts = urgent.get("stockouts", [])
    approvals = urgent.get("pending_approvals", [])
    alerts = urgent.get("alerts", [])

    if not stockouts and not approvals and not alerts:
        return None

    lines.append("<b>ALERTA URGENTE</b>")
    lines.append("")

    if stockouts:
        lines.append(f"<b>Stockouts ({len(stockouts)})</b>")
        for item in stockouts[:10]:
            if isinstance(item, dict):
                name = item.get("product_name", item.get("name", item.get("modelo", item.get("sku", "?"))))
                sku = item.get("sku", "")
                huecos = item.get("tiendas_con_hueco", "")
                if sku and sku != name:
                    label = f"{name} ({sku})"
                elif huecos:
                    label = f"{name} - {huecos} tiendas"
                else:
                    label = str(name)
            else:
                label = str(item)
            lines.append(f"  - {label}")
        if len(stockouts) > 10:
            lines.append(f"  ... y {len(stockouts) - 10} mas")
        lines.append("")

    if approvals:
        lines.append(f"<b>Aprobaciones pendientes ({len(approvals)})</b>")
        for item in approvals[:10]:
            if isinstance(item, dict):
                desc = item.get("description", item.get("title", item.get("vendor", "?")))
                amount = item.get("amount", item.get("total", ""))
                label = f"{desc} - ${amount}" if amount else str(desc)
            else:
                label = str(item)
            lines.append(f"  - {label}")
        if len(approvals) > 10:
            lines.append(f"  ... y {len(approvals) - 10} mas")
        lines.append("")

    if alerts:
        lines.append(f"<b>Alertas activas ({len(alerts)})</b>")
        for a in alerts[:10]:
            severity = a.get("severity", "info").upper()
            title = a.get("title", "?")
            lines.append(f"  [{severity}] {title}")
        lines.append("")

    return "\n".join(lines)


async def _send_telegram(text: str) -> bool:
    """Send a message via Telegram Bot API. Returns True on success."""
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("ALLOWED_CHAT_ID", "")
    if not token or not chat_id:
        return False

    url = _TELEGRAM_API.format(token=token)
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }, timeout=10.0)
        return r.status_code == 200


async def send_urgent_alert(snapshot: dict, db: sqlite3.Connection) -> dict:
    """Extract urgent items from snapshot and send via Telegram. Returns result summary."""
    urgent = _extract_urgent_items(snapshot, db)
    message = _format_telegram_message(urgent)

    if message is None:
        return {"sent": False, "reason": "no_urgent_items", "urgent": urgent}

    sent = await _send_telegram(message)
    return {"sent": sent, "message": message, "urgent": urgent}


@router.post("/pulse/urgent-alert")
async def pulse_urgent_alert(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Read latest pulse and send urgent items via Telegram."""
    row = db.execute(
        "SELECT snapshot FROM daily_pulses ORDER BY created_at DESC LIMIT 1"
    ).fetchone()

    if not row:
        return {"sent": False, "reason": "no_pulse_data"}

    snapshot = json.loads(row["snapshot"])
    return await send_urgent_alert(snapshot, db)
