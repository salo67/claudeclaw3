"""Discovery Loop -- autonomous advisor insight generation.

Runs 3 advisors (CEO, Sales, Marketing) in parallel, each with their own
area of focus. Advisors query real data, cross-reference sources, and
produce structured findings with severity levels.

Critical/warning findings are sent to Telegram as a consolidated message.
All findings (including insights) are persisted for the dashboard.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

import google.genai as genai
import httpx
from fastapi import APIRouter, Query
from google.genai import types
from pydantic import BaseModel

from api_tools import TOOL_DECLARATIONS, execute_tool, log_cost
from discovery_prompts import DISCOVERY_PROMPTS

logger = logging.getLogger(__name__)

router = APIRouter()

DB_PATH = Path(__file__).parent.parent.parent / "store" / "claudeclaw.db"

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("ALLOWED_CHAT_ID", "")

MAX_TOOL_ROUNDS = 3
MAX_TOOL_CALLS = 12
DISCOVERY_MODEL = "gemini-2.5-flash"  # Change to "gemini-2.5-pro" for deeper reasoning (10x cost)

PARTICIPATING_ADVISORS = ["ceo", "sales", "marketing"]

ADVISOR_NAMES = {"ceo": "Arturo", "sales": "Elena", "marketing": "Valeria"}

_gemini_client: genai.Client | None = None


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GOOGLE_API_KEY", "")
        os.environ.pop("GEMINI_API_KEY", None)
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.row_factory = sqlite3.Row
    return conn


# ── Models ────────────────────────────────────────────────────


class Finding(BaseModel):
    severity: str  # critical, warning, insight
    title: str
    detail: str
    data_sources_used: list[str] = []
    recommended_action: str = ""


class DiscoveryRunOut(BaseModel):
    run_id: str
    triggered_by: str
    started_at: int
    completed_at: int
    total_findings: int
    critical_count: int
    warning_count: int
    insight_count: int
    cost_usd: float
    telegram_sent: bool
    findings: list[dict]


# ── Single advisor execution ──────────────────────────────────


async def _run_advisor(advisor_key: str) -> tuple[list[dict], int, int]:
    """Run a single advisor's discovery loop. Returns (findings, input_tokens, output_tokens)."""
    system_prompt = DISCOVERY_PROMPTS.get(advisor_key, "")
    if not system_prompt:
        return [], 0, 0

    client = _get_gemini_client()
    contents: list = []
    total_in = 0
    total_out = 0
    total_calls = 0

    # Initial user message to trigger the loop
    contents.append({"role": "user", "parts": [{"text": "Ejecuta tu analisis de descubrimiento ahora. Usa las herramientas para consultar datos reales y responde con findings en JSON."}]})

    for _round in range(MAX_TOOL_ROUNDS):
        try:
            result = client.models.generate_content(
                model=DISCOVERY_MODEL,
                contents=contents,
                config={
                    "system_instruction": system_prompt,
                    "temperature": 0.7,
                    "max_output_tokens": 4096,
                    "tools": [TOOL_DECLARATIONS],
                },
            )
        except Exception as e:
            logger.error("Discovery Gemini error for %s: %s", advisor_key, e)
            return [], total_in, total_out

        if result.usage_metadata:
            total_in += result.usage_metadata.prompt_token_count or 0
            total_out += result.usage_metadata.candidates_token_count or 0

        if not result.candidates or not result.candidates[0].content or not result.candidates[0].content.parts:
            break

        # Check for function calls
        function_calls = [p for p in result.candidates[0].content.parts if p.function_call]

        if function_calls and total_calls < MAX_TOOL_CALLS:
            contents.append(result.candidates[0].content)

            function_responses = []
            for fc_part in function_calls:
                if total_calls >= MAX_TOOL_CALLS:
                    break
                fc = fc_part.function_call
                tool_name = fc.name
                tool_args = dict(fc.args) if fc.args else {}
                total_calls += 1

                logger.info("Discovery [%s] calling tool: %s", advisor_key, tool_name)
                try:
                    tool_result = await execute_tool(tool_name, tool_args, advisor_key=advisor_key)
                except Exception as e:
                    tool_result = json.dumps({"error": str(e)[:300]})

                function_responses.append(
                    types.Part(function_response=types.FunctionResponse(
                        name=tool_name,
                        response={"result": tool_result},
                    ))
                )

            contents.append(types.Content(role="user", parts=function_responses))
            continue

        # No function calls -- extract text response
        text_parts = [p.text for p in result.candidates[0].content.parts if p.text]
        full_text = "".join(text_parts)

        # Parse findings JSON from response
        findings = _parse_findings(full_text, advisor_key)
        return findings, total_in, total_out

    # If we exhausted rounds, make one final call telling the model to summarize as JSON
    try:
        # Filter out any None content entries that could crash the SDK
        contents = [c for c in contents if c is not None]
        contents.append({"role": "user", "parts": [{"text": "Ya tienes toda la informacion. Ahora responde UNICAMENTE con el JSON array de findings. No hagas mas tool calls."}]})
        final_result = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.3,
                "max_output_tokens": 4096,
            },
        )
        if final_result.usage_metadata:
            total_in += final_result.usage_metadata.prompt_token_count or 0
            total_out += final_result.usage_metadata.candidates_token_count or 0

        if final_result.candidates and final_result.candidates[0].content and final_result.candidates[0].content.parts:
            text_parts = [p.text for p in final_result.candidates[0].content.parts if p.text]
            full_text = "".join(text_parts)
            findings = _parse_findings(full_text, advisor_key)
            return findings, total_in, total_out
    except Exception as e:
        logger.error("Discovery final call error for %s: %s", advisor_key, e)

    return [], total_in, total_out


def _parse_findings(text: str, advisor_key: str) -> list[dict]:
    """Parse JSON findings from advisor response text."""
    import re

    text = text.strip()
    if not text:
        logger.warning("Discovery [%s]: empty response text", advisor_key)
        return []

    # Strip ALL markdown code fences (```json ... ``` anywhere in text)
    text = re.sub(r"```(?:json)?\s*\n?", "", text).strip()

    # Strategy 1: Try parsing entire text as JSON array
    try:
        raw = json.loads(text)
        if isinstance(raw, list):
            return _extract_findings(raw, advisor_key)
    except json.JSONDecodeError:
        pass

    # Strategy 2: Find outermost JSON array using bracket matching
    start = text.find("[")
    if start != -1:
        depth = 0
        end = -1
        for i in range(start, len(text)):
            if text[i] == "[":
                depth += 1
            elif text[i] == "]":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end != -1:
            json_str = text[start:end + 1]
            try:
                raw = json.loads(json_str)
                if isinstance(raw, list):
                    return _extract_findings(raw, advisor_key)
            except json.JSONDecodeError:
                pass

    # Strategy 3: Try to find individual JSON objects and collect them
    objects = re.findall(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text)
    if objects:
        findings_raw = []
        for obj_str in objects:
            try:
                obj = json.loads(obj_str)
                if isinstance(obj, dict) and "title" in obj:
                    findings_raw.append(obj)
            except json.JSONDecodeError:
                continue
        if findings_raw:
            return _extract_findings(findings_raw, advisor_key)

    logger.warning("Discovery [%s]: no JSON findings found in response (len=%d, preview=%s)",
                   advisor_key, len(text), text[:200])
    return []


def _extract_findings(raw: list, advisor_key: str) -> list[dict]:
    """Convert raw JSON list into normalized finding dicts."""
    findings = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        severity = item.get("severity", "insight")
        if severity not in ("critical", "warning", "insight"):
            severity = "insight"
        findings.append({
            "severity": severity,
            "title": str(item.get("title", ""))[:200],
            "detail": str(item.get("detail", ""))[:1000],
            "data_sources_used": item.get("data_sources_used", []),
            "actions_taken": item.get("actions_taken", []),
            "recommended_action": str(item.get("recommended_action", ""))[:500],
            "advisor_key": advisor_key,
            "advisor_name": ADVISOR_NAMES.get(advisor_key, advisor_key),
        })
    return findings


# ── Telegram notification ─────────────────────────────────────


async def _send_telegram_findings(findings: list[dict], run_time: str) -> bool:
    """Send consolidated Telegram message with critical/warning findings."""
    important = [f for f in findings if f["severity"] in ("critical", "warning")]
    if not important:
        return False

    severity_emoji = {"critical": "\U0001f534", "warning": "\U0001f7e1"}  # red circle, yellow circle

    lines = [f"\U0001f50d <b>Discovery Loop ({run_time})</b>\n"]

    for f in important:
        emoji = severity_emoji.get(f["severity"], "\u2139\ufe0f")
        lines.append(f'{emoji} <b>{f["advisor_name"]}</b>: {f["title"]}')
        # Truncate detail for Telegram
        detail = f["detail"][:200]
        if len(f["detail"]) > 200:
            detail += "..."
        lines.append(f"   {detail}")
        if f.get("actions_taken"):
            for act in f["actions_taken"][:3]:
                lines.append(f"   \u2705 {str(act)[:100]}")
        if f.get("recommended_action"):
            action = f["recommended_action"][:150]
            lines.append(f"   \u2192 {action}")
        lines.append("")

    insight_count = sum(1 for f in findings if f["severity"] == "insight")
    if insight_count:
        lines.append(f"\U0001f4ca {insight_count} insights mas en el dashboard.")

    message = "\n".join(lines)

    # Truncate if too long for Telegram (4096 char limit)
    if len(message) > 4000:
        message = message[:4000] + "\n\n[truncado]"

    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("Discovery: Telegram not configured, skipping notification")
        return False

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"},
            )
            return resp.status_code == 200
    except Exception as e:
        logger.error("Discovery Telegram error: %s", e)
        return False


# ── Persistence ───────────────────────────────────────────────


def _save_run(run: dict) -> None:
    conn = _connect()
    try:
        conn.execute(
            """INSERT INTO discovery_runs
               (id, triggered_by, started_at, completed_at, advisors_run, total_findings,
                critical_count, warning_count, insight_count, cost_usd)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run["id"], run["triggered_by"], run["started_at"], run["completed_at"],
                json.dumps(run["advisors_run"]), run["total_findings"],
                run["critical_count"], run["warning_count"], run["insight_count"],
                run["cost_usd"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _save_findings(findings: list[dict], run_id: str) -> None:
    conn = _connect()
    try:
        for f in findings:
            conn.execute(
                """INSERT INTO discovery_findings
                   (id, run_id, advisor_key, severity, title, detail,
                    data_sources_used, recommended_action, estimated_impact, created_at, dismissed)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (
                    str(uuid.uuid4()), run_id, f["advisor_key"], f["severity"],
                    f["title"], f["detail"],
                    json.dumps(f.get("data_sources_used", [])),
                    f.get("recommended_action", ""),
                    f.get("estimated_impact", ""),
                    int(time.time()),
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ── Gemini cost estimation ────────────────────────────────────

# Gemini 2.5 Flash pricing (approximate)
GEMINI_FLASH_COST_PER_1K_INPUT = 0.00015
GEMINI_FLASH_COST_PER_1K_OUTPUT = 0.0006


def _estimate_cost(total_in: int, total_out: int) -> float:
    return (total_in / 1000 * GEMINI_FLASH_COST_PER_1K_INPUT +
            total_out / 1000 * GEMINI_FLASH_COST_PER_1K_OUTPUT)


# ── Endpoints ─────────────────────────────────────────────────


@router.post("/advisor/discover")
async def run_discovery(triggered_by: str = Query("manual", pattern="^(manual|scheduled)$")):
    """Execute the discovery loop: fan out to advisors, collect findings, notify."""
    run_id = str(uuid.uuid4())
    started_at = int(time.time())

    from datetime import datetime
    run_time = datetime.now().strftime("%H:%M")

    # Fan out to all advisors in parallel
    tasks = [_run_advisor(key) for key in PARTICIPATING_ADVISORS]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_findings: list[dict] = []
    total_in = 0
    total_out = 0

    for i, result in enumerate(results):
        advisor_key = PARTICIPATING_ADVISORS[i]
        if isinstance(result, BaseException):
            logger.error("Discovery advisor %s failed: %s", advisor_key, result)
            continue
        findings, tokens_in, tokens_out = result
        all_findings.extend(findings)
        total_in += tokens_in
        total_out += tokens_out

        # Log cost per advisor
        await log_cost(
            api_name="google",
            endpoint=DISCOVERY_MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            notes=f"discovery:{advisor_key}",
        )

    completed_at = int(time.time())
    cost_usd = _estimate_cost(total_in, total_out)

    critical_count = sum(1 for f in all_findings if f["severity"] == "critical")
    warning_count = sum(1 for f in all_findings if f["severity"] == "warning")
    insight_count = sum(1 for f in all_findings if f["severity"] == "insight")

    # Persist
    run_data = {
        "id": run_id,
        "triggered_by": triggered_by,
        "started_at": started_at,
        "completed_at": completed_at,
        "advisors_run": PARTICIPATING_ADVISORS,
        "total_findings": len(all_findings),
        "critical_count": critical_count,
        "warning_count": warning_count,
        "insight_count": insight_count,
        "cost_usd": cost_usd,
    }
    _save_run(run_data)
    _save_findings(all_findings, run_id)

    # Send Telegram if there are critical/warning findings
    telegram_sent = await _send_telegram_findings(all_findings, run_time)

    logger.info(
        "Discovery complete: %d findings (%d critical, %d warning, %d insight), cost=$%.4f, telegram=%s",
        len(all_findings), critical_count, warning_count, insight_count, cost_usd, telegram_sent,
    )

    return {
        "run_id": run_id,
        "triggered_by": triggered_by,
        "duration_seconds": completed_at - started_at,
        "total_findings": len(all_findings),
        "critical_count": critical_count,
        "warning_count": warning_count,
        "insight_count": insight_count,
        "cost_usd": round(cost_usd, 4),
        "telegram_sent": telegram_sent,
        "findings": all_findings,
    }


@router.get("/advisor/discover/history")
async def discovery_history(limit: int = Query(10, ge=1, le=50)):
    """List past discovery runs."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.get("/advisor/discover/findings")
async def discovery_findings(
    run_id: str | None = Query(None),
    severity: str | None = Query(None),
    dismissed: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
):
    """List findings, optionally filtered by run, severity, or dismissed status."""
    conn = _connect()
    try:
        query = "SELECT * FROM discovery_findings WHERE dismissed = ?"
        params: list[Any] = [1 if dismissed else 0]

        if run_id:
            query += " AND run_id = ?"
            params.append(run_id)
        if severity:
            query += " AND severity = ?"
            params.append(severity)

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("data_sources_used"), str):
                try:
                    d["data_sources_used"] = json.loads(d["data_sources_used"])
                except json.JSONDecodeError:
                    pass
            results.append(d)
        return results
    finally:
        conn.close()


@router.patch("/advisor/discover/findings/{finding_id}/dismiss")
async def dismiss_finding(finding_id: str):
    """Mark a finding as dismissed."""
    conn = _connect()
    try:
        conn.execute("UPDATE discovery_findings SET dismissed = 1 WHERE id = ?", (finding_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
