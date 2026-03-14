"""Pulse endpoints -- daily business metrics aggregator + persistence."""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, Query

from database import get_db
from llm_providers import get_provider, is_provider_available

router = APIRouter()

_TIMEOUT = 5.0  # seconds per upstream call
_HUB_TIMEOUT = 8.0  # hub may aggregate from multiple sources

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
HUB_URL = "http://localhost:8000"

_hub_headers: dict[str, str] = {}


def _get_hub_headers() -> dict[str, str]:
    global _hub_headers
    if not _hub_headers and INTERNAL_API_KEY:
        _hub_headers = {"Authorization": f"Bearer {INTERNAL_API_KEY}"}
    return _hub_headers


async def _fetch_json(client: httpx.AsyncClient, url: str, headers: dict | None = None, timeout: float = _TIMEOUT) -> dict:
    """Fetch JSON from an internal API. Returns the parsed body or raises."""
    r = await client.get(url, timeout=timeout, headers=headers or {})
    r.raise_for_status()
    return r.json()


async def _section(client: httpx.AsyncClient, name: str, urls: dict[str, str], headers: dict | None = None, timeout: float = _TIMEOUT) -> dict:
    """Fetch one or more URLs for a section, returning {status, data} or {status, error}."""
    try:
        data = {}
        for key, url in urls.items():
            data[key] = await _fetch_json(client, url, headers=headers, timeout=timeout)
        return {"status": "ok", "data": data}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


async def _hub_section(client: httpx.AsyncClient, name: str, paths: dict[str, str]) -> dict:
    """Fetch from the Integration Hub (port 8000) with auth."""
    urls = {k: f"{HUB_URL}{p}" for k, p in paths.items()}
    return await _section(client, name, urls, headers=_get_hub_headers(), timeout=_HUB_TIMEOUT)


def _local_section(db: sqlite3.Connection, name: str, query_fn) -> dict:
    """Run a local DB query, returning {status, data} or {status, error}."""
    try:
        return {"status": "ok", "data": query_fn(db)}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def _query_active_alerts(db: sqlite3.Connection) -> dict:
    """Active (undismissed) alerts from Control Center, last 48h."""
    cutoff = int(time.time()) - 48 * 3600
    rows = db.execute(
        "SELECT id, category, severity, title, description, source, created_at FROM alerts WHERE dismissed = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 20",
        (cutoff,),
    ).fetchall()
    alerts = [dict(r) for r in rows]
    critical = sum(1 for a in alerts if a.get("severity") == "critical")
    warning = sum(1 for a in alerts if a.get("severity") == "warning")
    return {"alerts": alerts, "total": len(alerts), "critical": critical, "warning": warning}


def _query_pending_action_items(db: sqlite3.Connection) -> dict:
    """Action items pending CEO decision (proposed or in_review)."""
    rows = db.execute(
        "SELECT id, advisor_key, title, detail, estimated_impact, category, priority, status, created_at FROM action_items WHERE status IN ('proposed', 'in_review') ORDER BY created_at DESC LIMIT 10",
    ).fetchall()
    items = [dict(r) for r in rows]
    proposed = sum(1 for i in items if i.get("status") == "proposed")
    in_review = sum(1 for i in items if i.get("status") == "in_review")
    return {"items": items, "total": len(items), "proposed": proposed, "in_review": in_review}


def _query_discovery_recent(db: sqlite3.Connection) -> dict:
    """Recent discovery findings (last 48h, undismissed)."""
    cutoff = int(time.time()) - 48 * 3600
    rows = db.execute(
        "SELECT id, advisor_key, severity, title, detail, recommended_action, estimated_impact, created_at FROM discovery_findings WHERE dismissed = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 15",
        (cutoff,),
    ).fetchall()
    findings = [dict(r) for r in rows]
    critical = sum(1 for f in findings if f.get("severity") == "critical")
    warning = sum(1 for f in findings if f.get("severity") == "warning")
    return {"findings": findings, "total": len(findings), "critical": critical, "warning": warning}


@router.get("/pulse/today")
async def pulse_today(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Return unified daily business pulse with all metric sections."""
    async with httpx.AsyncClient() as client:
        # Run all fetches in parallel for speed
        (
            cashflow,
            stockouts,
            kpis_hd,
            pending_approvals,
            exchange_rate_result,
            email_stats,
            email_learning,
            # Hub-sourced sections
            margin_health,
            forecast_alerts,
            supply_chain,
            sales_summary,
            # ── NEW: enriched sections ──
            inventory_health,
            hd_performance,
            debt_analysis,
        ) = await asyncio.gather(
            # Cashflow from port 8310
            _section(client, "cashflow", {
                "balance": "http://localhost:8310/api/cashflow/balance",
                "pending": "http://localhost:8310/api/cashflow/pending",
            }),
            # Stockouts from port 8002
            _section(client, "stockouts", {
                "stockouts": "http://localhost:8002/api/stockouts",
            }),
            # KPIs HD from port 8002
            _section(client, "kpis_hd", {
                "kpis": "http://localhost:8002/api/kpis",
            }),
            # Pending approvals from port 8310
            _section(client, "pending_approvals", {
                "approvals": "http://localhost:8310/api/cxp-management/approvals/pending",
            }),
            # Exchange rate from free external API
            _fetch_exchange_rate(client),
            # Email stats from port 8055
            _section(client, "email_stats", {
                "stats": "http://localhost:8055/api/emails/stats",
            }),
            # Email learning intelligence from port 8055
            _section(client, "email_learning", {
                "stats": "http://localhost:8055/api/learning/stats",
                "sender_scores": "http://localhost:8055/api/learning/sender-scores?limit=10",
            }),
            # ── Hub-sourced business intelligence ──
            # Margin health: summary + deteriorating + blocked + recommendations
            _hub_section(client, "margin_health", {
                "summary": "/api/v1/margenes/margins/summary",
                "deteriorating": "/api/v1/margenes/trends/deteriorating",
                "blocked": "/api/v1/margenes/stockout/blocked",
                "recommendations": "/api/v1/margenes/trends/recommendations",
            }),
            # Forecast alerts: demand warnings + ABC summary
            _hub_section(client, "forecast_alerts", {
                "summary": "/api/v1/forecast/alerts/summary",
                "abc": "/api/v1/forecast/abc/summary",
            }),
            # Supply chain: dashboard + overdue payments + arrivals + orders
            _hub_section(client, "supply_chain", {
                "dashboard": "/api/v1/supply-tracker/dashboard",
                "overdue": "/api/v1/supply-tracker/payments/overdue",
                "arrivals": "/api/v1/supply-tracker/arrivals",
                "orders": "/api/v1/supply-tracker/orders",
            }),
            # Sales: multi-channel summary
            _hub_section(client, "sales_summary", {
                "summary": "/api/v1/hq/lloyd-sales/summary",
            }),
            # ── NEW: Inventory health (transit stock + days of inventory) ──
            _hub_section(client, "inventory_health", {
                "transit_stock": "/api/v1/forecast/transit-stock",
                "inventory_days": "/api/v1/forecast/inventory",
            }),
            # ── NEW: HD fill rate performance ──
            _hub_section(client, "hd_performance", {
                "fill_rate": "/api/v1/fill-rate",
            }),
            # ── NEW: Debt analysis by vendor ──
            _hub_section(client, "debt_analysis", {
                "debt": "/api/v1/supply-tracker/debt-analysis",
            }),
            return_exceptions=True,
        )

        # Normalize any exceptions from gather
        def _safe(result):
            if isinstance(result, BaseException):
                return {"status": "error", "error": str(result)}
            return result

        # Local DB queries (fast, no network)
        cc_alerts = _local_section(db, "cc_alerts", _query_active_alerts)
        discovery = _local_section(db, "discovery", _query_discovery_recent)
        action_items = _local_section(db, "action_items", _query_pending_action_items)

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        # Original sections
        "cashflow": _safe(cashflow),
        "stockouts": _safe(stockouts),
        "kpis_hd": _safe(kpis_hd),
        "pending_approvals": _safe(pending_approvals),
        "exchange_rate": _safe(exchange_rate_result),
        "email_stats": _safe(email_stats),
        "email_learning": _safe(email_learning),
        # Hub-sourced business intelligence
        "margin_health": _safe(margin_health),
        "forecast_alerts": _safe(forecast_alerts),
        "supply_chain": _safe(supply_chain),
        "sales_summary": _safe(sales_summary),
        # Enriched sections
        "inventory_health": _safe(inventory_health),
        "hd_performance": _safe(hd_performance),
        "debt_analysis": _safe(debt_analysis),
        # Local DB sections
        "cc_alerts": cc_alerts,
        "discovery": discovery,
        "action_items": action_items,
    }


async def _fetch_exchange_rate(client: httpx.AsyncClient) -> dict:
    """Fetch USD/MXN exchange rate from free API."""
    try:
        r = await client.get("https://open.er-api.com/v6/latest/USD", timeout=_TIMEOUT)
        r.raise_for_status()
        er_data = r.json()
        return {
            "status": "ok",
            "data": {
                "usd_mxn": er_data.get("rates", {}).get("MXN"),
                "source": "open.er-api.com",
                "time_last_update": er_data.get("time_last_update_utc"),
            },
        }
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


async def _aggregate_pulse(db: sqlite3.Connection) -> dict:
    """Run the pulse aggregator and return the snapshot dict."""
    return await pulse_today(db)


@router.post("/pulse/generate")
async def pulse_generate(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Run the aggregator, persist snapshot to daily_pulses, and return it."""
    snapshot = await _aggregate_pulse(db)
    now = int(time.time())
    pulse_id = uuid.uuid4().hex[:12]
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    generated_at = snapshot["generated_at"]

    db.execute(
        "INSERT INTO daily_pulses (id, date, snapshot, generated_at, created_at) VALUES (?, ?, ?, ?, ?)",
        (pulse_id, date_str, json.dumps(snapshot), generated_at, now),
    )
    db.commit()

    # Post-generate: send urgent items via Telegram
    from routers.pulse_urgent import send_urgent_alert
    try:
        alert_result = await send_urgent_alert(snapshot, db)
    except Exception:
        alert_result = {"sent": False, "reason": "error"}

    return {"id": pulse_id, "date": date_str, "snapshot": snapshot, "generated_at": generated_at, "created_at": now, "urgent_alert": alert_result}


@router.get("/pulse/history")
def pulse_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Return paginated list of persisted pulses, newest first."""
    total = db.execute("SELECT COUNT(*) FROM daily_pulses").fetchone()[0]
    offset = (page - 1) * page_size
    rows = db.execute(
        "SELECT id, date, snapshot, generated_at, created_at FROM daily_pulses ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (page_size, offset),
    ).fetchall()

    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "date": r["date"],
            "snapshot": json.loads(r["snapshot"]),
            "generated_at": r["generated_at"],
            "created_at": r["created_at"],
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/pulse/latest")
def pulse_latest(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Return the most recent persisted pulse, or 404-style empty."""
    row = db.execute(
        "SELECT id, date, snapshot, generated_at, created_at FROM daily_pulses ORDER BY created_at DESC LIMIT 1"
    ).fetchone()

    if not row:
        return {"pulse": None}

    return {
        "pulse": {
            "id": row["id"],
            "date": row["date"],
            "snapshot": json.loads(row["snapshot"]),
            "generated_at": row["generated_at"],
            "created_at": row["created_at"],
        }
    }


# ── Advisor Overnight Summary ───────────────────────────────


_OVERNIGHT_SYSTEM = """Analiza los siguientes mensajes de los asesores de las ultimas 12 horas.
Extrae y clasifica en tres categorias:

1. decisions: Decisiones tomadas o recomendadas por los asesores
2. pending_approvals: Items que requieren aprobacion o accion del usuario
3. actions_taken: Acciones concretas que los asesores ejecutaron

Responde UNICAMENTE con JSON valido, sin markdown ni backticks:
{
  "decisions": ["..."],
  "pending_approvals": ["..."],
  "actions_taken": ["..."],
  "summary": "Resumen breve de la actividad overnight"
}

Si no hay mensajes relevantes para alguna categoria, usa un array vacio."""


def _pick_overnight_provider() -> tuple[str, str]:
    """Pick the best available provider/model for overnight summary."""
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
    return preferences[0]  # fallback, will error but that's handled


@router.get("/pulse/advisors-overnight")
async def advisors_overnight(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Summarize advisor activity from the last 12 hours."""
    cutoff = int(time.time()) - 12 * 3600
    rows = db.execute(
        "SELECT role, content, agent_role, created_at FROM advisor_messages WHERE created_at > ? ORDER BY created_at ASC",
        (cutoff,),
    ).fetchall()

    if not rows:
        return {
            "decisions": [],
            "pending_approvals": [],
            "actions_taken": [],
            "summary": "",
            "message_count": 0,
        }

    lines = []
    for r in rows:
        agent = r["agent_role"] or r["role"]
        lines.append(f"[{agent}]: {r['content']}")
    messages_text = "\n".join(lines)

    try:
        pkey, model = _pick_overnight_provider()
        provider = get_provider(pkey)
        resp = await provider.chat(
            model=model,
            system=_OVERNIGHT_SYSTEM,
            messages=[{"role": "user", "content": messages_text}],
            tools=[],
            max_tokens=1024,
            temperature=0.3,
        )
        raw = resp.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3].strip()
        parsed = json.loads(raw)
    except Exception:
        parsed = {
            "decisions": [],
            "pending_approvals": [],
            "actions_taken": [],
            "summary": "Error generating summary",
        }

    return {
        "decisions": parsed.get("decisions", []),
        "pending_approvals": parsed.get("pending_approvals", []),
        "actions_taken": parsed.get("actions_taken", []),
        "summary": parsed.get("summary", ""),
        "message_count": len(rows),
    }
