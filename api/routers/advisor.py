"""Multi-Agent Advisor chat endpoint -- multi-provider LLM with tool calling."""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from database import DB_PATH, get_db

router = APIRouter()

# ── Agent definitions ────────────────────────────────────────

AGENT_ROLES: dict[str, dict] = {
    "ceo": {
        "name": "Arturo",
        "label": "Arturo - CEO Strategist",
        "color": "#5eead4",
        "bg_color": "#0a2e2e",
        "avatar": "A",
        "keywords": ["estrategia", "flujo", "decision", "priorizar", "plan", "operacion", "cash", "caja"],
        "soul_file": "arturo.md",
        "voice_id": os.getenv("VOICE_ARTURO", ""),
    },
    "sales": {
        "name": "Elena",
        "label": "Elena - Sales Expert",
        "color": "#fbbf24",
        "bg_color": "#2e2510",
        "avatar": "E",
        "keywords": ["ventas", "precio", "margen", "cliente", "hd", "home depot", "cotizar", "cotizacion", "negociar"],
        "soul_file": "elena.md",
        "voice_id": os.getenv("VOICE_ELENA", ""),
    },
    "architect": {
        "name": "Miguel",
        "label": "Miguel - Software Architect",
        "color": "#a5b4fc",
        "bg_color": "#1e1b4b",
        "avatar": "M",
        "keywords": ["codigo", "api", "arquitectura", "sistema", "herramienta", "automatizar", "software", "tech"],
        "soul_file": "miguel.md",
        "voice_id": os.getenv("VOICE_MIGUEL", ""),
    },
    "marketing": {
        "name": "Valeria",
        "label": "Valeria - Marketing Expert",
        "color": "#fdba74",
        "bg_color": "#2e1a0a",
        "avatar": "V",
        "keywords": ["marketing", "redes", "campana", "contenido", "social", "marca", "branding", "publicidad"],
        "soul_file": "valeria.md",
        "voice_id": os.getenv("VOICE_VALERIA", ""),
    },
}

# ── Model switching (multi-provider) ────────────────────────

# Each entry: (provider_key, full_model_name, display_label)
MODEL_MAP: dict[str, tuple[str, str, str]] = {
    "haiku":    ("anthropic", "claude-haiku-4-5-20251001",  "Haiku 4.5"),
    "sonnet":   ("anthropic", "claude-sonnet-4-6-20250514", "Sonnet 4.6"),
    "flash":    ("gemini",    "gemini-2.5-flash",           "Gemini Flash"),
    "pro":      ("gemini",    "gemini-2.5-pro",             "Gemini Pro"),
    "gpt4o":    ("openai",    "gpt-4o",                     "GPT-4o"),
    "gpt4m":    ("openai",    "gpt-4o-mini",                "GPT-4o Mini"),
    "kimi":     ("kimi",      "moonshot-v1-auto",           "Kimi"),
    "glm":      ("glm",       "glm-4-flash",                "GLM-4 Flash"),
    "glm47":    ("glm",       "glm-4-plus",                 "GLM-4.7"),
}
DEFAULT_MODEL_KEY = "haiku"

DEEP_TRIGGERS = [
    "piensa profundo", "analiza a fondo", "razona esto",
    "estrategia a largo", "brainstorm", "evalua opciones",
    "pros y contras", "analisis profundo", "dame tu mejor analisis",
    "think deep", "pro:", "@pro",
]


def _resolve_model(explicit: str | None, message: str, thread_id: str | None = None) -> tuple[str, str, str]:
    """Resolve which model to use. Returns (provider_key, full_model_name, short_key)."""
    # 1. Explicit override from request body
    if explicit and explicit in MODEL_MAP:
        prov, model, _label = MODEL_MAP[explicit]
        return prov, model, explicit

    # 2. Auto-detect deep thinking triggers -> upgrade to sonnet
    lower = message.lower()
    for trigger in DEEP_TRIGGERS:
        if trigger in lower:
            prov, model, _label = MODEL_MAP["sonnet"]
            return prov, model, "sonnet"

    # 3. Thread-level default
    if thread_id:
        try:
            conn = sqlite3.connect(str(DB_PATH))
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT default_model FROM advisor_threads WHERE id = ?", (thread_id,)).fetchone()
            conn.close()
            if row and row["default_model"] in MODEL_MAP and row["default_model"] != DEFAULT_MODEL_KEY:
                prov, model, _label = MODEL_MAP[row["default_model"]]
                return prov, model, row["default_model"]
        except Exception:
            pass

    # 4. Default
    prov, model, _label = MODEL_MAP[DEFAULT_MODEL_KEY]
    return prov, model, DEFAULT_MODEL_KEY


# Load system context files
_docs_dir = Path(__file__).parent.parent.parent / "docs"
_souls_dir = _docs_dir / "souls"
_user_path = _docs_dir / "user.md"


def _detect_agent(message: str) -> str:
    """Detect which agent should respond. @mention overrides auto-detection."""
    lower = message.lower()

    # Check for explicit @mentions
    for role_key in AGENT_ROLES:
        if f"@{role_key}" in lower:
            return role_key
    for role_key, role in AGENT_ROLES.items():
        label_lower = role["label"].lower().split()[0]
        if f"@{label_lower}" in lower:
            return role_key

    # Auto-detect by keyword scoring
    scores: dict[str, int] = {}
    for role_key, role in AGENT_ROLES.items():
        score = sum(1 for kw in role["keywords"] if kw in lower)
        if score > 0:
            scores[role_key] = score

    if scores:
        return max(scores, key=scores.get)  # type: ignore[arg-type]

    return "ceo"


def _load_system_context(agent_role: str = "ceo", user_message: str = "") -> str:
    """Build context from individual soul file + user.md + projects + journal + notes + memories."""
    parts: list[str] = []
    role = AGENT_ROLES.get(agent_role, AGENT_ROLES["ceo"])

    # Load individual soul file
    soul_file = _souls_dir / role.get("soul_file", "arturo.md")
    if soul_file.exists():
        parts.append(soul_file.read_text(encoding="utf-8"))
    else:
        parts.append(
            f"Eres {role['name']}, el {role['label']} del equipo de asesores de Salomon. "
            "Respondes en espanol mexicano, directo y sin rodeos. "
            "No uses em dashes. No uses cliches de AI. No seas sycophant."
        )

    if _user_path.exists():
        parts.append(f"\n---\n{_user_path.read_text(encoding='utf-8')}")

    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row

        projects = conn.execute(
            "SELECT name, phase, priority, paused, description FROM projects ORDER BY priority DESC LIMIT 20"
        ).fetchall()
        if projects:
            lines = ["\n---\n## Proyectos activos"]
            for p in projects:
                st = "PAUSADO" if p["paused"] else p["phase"]
                lines.append(f"- [{p['priority'].upper()}] {p['name']} ({st}): {p['description'][:100]}")
            parts.append("\n".join(lines))

        journal = conn.execute(
            "SELECT date, content, mood FROM journal_entries ORDER BY date DESC LIMIT 7"
        ).fetchall()
        if journal:
            lines = ["\n---\n## Journal reciente"]
            for j in journal:
                lines.append(f"- {j['date']} (mood: {j['mood'] or 'N/A'}): {j['content'][:150]}")
            parts.append("\n".join(lines))

        pinned_notes = conn.execute(
            "SELECT title, content FROM notes WHERE pinned = 1 ORDER BY updated_at DESC LIMIT 5"
        ).fetchall()
        if pinned_notes:
            lines = ["\n---\n## Notas clave (pinned)"]
            for n in pinned_notes:
                lines.append(f"- **{n['title']}**: {n['content'][:150]}")
            parts.append("\n".join(lines))

        conn.close()
    except Exception:
        pass

    # Cross-thread persistent memory
    try:
        from advisor_memory import build_memory_context

        memory_ctx = build_memory_context(user_message)
        if memory_ctx:
            parts.append(memory_ctx)
    except Exception:
        pass

    # Intelligence from hive_mind agents (mail-triage, ab-optimizer, competitor-tracker)
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        hive_rows = conn.execute(
            "SELECT action, summary, artifacts, created_at FROM hive_mind "
            "WHERE agent_id IN ('mail-triage', 'ab-optimizer', 'competitor-tracker') ORDER BY created_at DESC LIMIT 8"
        ).fetchall()
        conn.close()
        if hive_rows:
            lines = ["\n---\n## Inteligencia de agentes (mail-triage, ab-optimizer, competitor-tracker)"]
            for h in hive_rows:
                from datetime import datetime
                ts = datetime.fromtimestamp(h["created_at"]).strftime("%Y-%m-%d %H:%M") if h["created_at"] else ""
                lines.append(f"- [{h['action']}] ({ts}): {h['summary'][:200]}")
                if h["artifacts"]:
                    try:
                        arts = json.loads(h["artifacts"])
                        if isinstance(arts, dict):
                            for k in ("type", "entities", "importance", "email", "name", "confidence", "pattern_type"):
                                if k in arts:
                                    lines.append(f"  {k}: {arts[k]}")
                    except (json.JSONDecodeError, TypeError):
                        pass
            parts.append("\n".join(lines))
    except Exception:
        pass

    return "\n".join(parts)


def _build_neutral_history(history: list[dict]) -> list[dict]:
    """Convert DB history to neutral message format for providers."""
    messages = []
    for msg in history:
        m: dict = {
            "role": msg["role"],  # "user" or "assistant"
            "content": msg.get("content", ""),
            "image_data": msg.get("image_data", ""),
        }
        # Add agent role name for tagging assistant messages
        agent_role = msg.get("agent_role", "")
        if agent_role:
            agent_name = AGENT_ROLES.get(agent_role, {}).get("name", "")
            m["agent_role_name"] = agent_name
        messages.append(m)
    return messages


# ── Models ───────────────────────────────────────────────────

class ThreadCreate(BaseModel):
    title: str = ""

class MessageSend(BaseModel):
    content: str
    agent_role: str | None = None
    image_data: str | None = None
    source: str = "web"
    model: str | None = None  # any key from MODEL_MAP, or None (auto-detect)

class ThreadOut(BaseModel):
    id: str
    title: str
    created_at: int
    updated_at: int
    last_message: str = ""

class MessageOut(BaseModel):
    id: str
    thread_id: str
    role: str
    content: str
    agent_role: str
    image_data: str
    source: str = "web"
    model_used: str = ""
    created_at: int

class AgentInfo(BaseModel):
    key: str
    name: str
    label: str
    color: str
    bg_color: str
    avatar: str
    voice_id: str


# ── Agent info endpoint ──────────────────────────────────────

@router.get("/advisor/agents", response_model=list[AgentInfo])
def list_agents():
    """Return available agent roles."""
    return [
        AgentInfo(
            key=k, name=v["name"], label=v["label"], color=v["color"],
            bg_color=v["bg_color"], avatar=v["avatar"], voice_id=v.get("voice_id", ""),
        )
        for k, v in AGENT_ROLES.items()
    ]


# ── Available models endpoint ────────────────────────────────

@router.get("/advisor/models")
def list_models():
    """Return available models (only those with configured API keys)."""
    from llm_providers import is_provider_available

    result = []
    for key, (provider_key, full_model, label) in MODEL_MAP.items():
        result.append({
            "key": key,
            "provider": provider_key,
            "label": label,
            "model": full_model,
            "available": is_provider_available(provider_key),
        })
    return result


# ── Thread CRUD ──────────────────────────────────────────────

@router.get("/advisor/threads", response_model=list[ThreadOut])
def list_threads(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT t.*, "
        "(SELECT content FROM advisor_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message "
        "FROM advisor_threads t ORDER BY t.updated_at DESC"
    ).fetchall()
    return [
        ThreadOut(
            id=r["id"],
            title=r["title"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            last_message=r["last_message"] or "",
        )
        for r in rows
    ]


@router.post("/advisor/threads", response_model=ThreadOut)
def create_thread(body: ThreadCreate, db: sqlite3.Connection = Depends(get_db)):
    now = int(time.time())
    tid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO advisor_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (tid, body.title or "Nuevo chat", now, now),
    )
    db.commit()
    return ThreadOut(id=tid, title=body.title or "Nuevo chat", created_at=now, updated_at=now)


@router.delete("/advisor/threads/{thread_id}")
def delete_thread(thread_id: str, db: sqlite3.Connection = Depends(get_db)):
    # Auto-summarize meaningful conversations before deleting
    try:
        from advisor_memory import summarize_thread_messages, save_memory

        rows = db.execute(
            "SELECT role, content FROM advisor_messages WHERE thread_id = ? ORDER BY created_at ASC",
            (thread_id,),
        ).fetchall()
        messages = [{"role": r["role"], "content": r["content"]} for r in rows]
        if len(messages) >= 6:
            summary = summarize_thread_messages(messages)
            if summary:
                save_memory(summary, sector="semantic", salience=2.0)
    except Exception:
        pass

    db.execute("DELETE FROM advisor_threads WHERE id = ?", (thread_id,))
    db.commit()
    return {"ok": True}


# ── Messages ─────────────────────────────────────────────────

@router.get("/advisor/threads/{thread_id}/messages", response_model=list[MessageOut])
def get_messages(thread_id: str, db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM advisor_messages WHERE thread_id = ? ORDER BY created_at ASC",
        (thread_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        if "agent_role" not in d:
            d["agent_role"] = ""
        if "image_data" not in d:
            d["image_data"] = ""
        if "source" not in d:
            d["source"] = "web"
        if "model_used" not in d:
            d["model_used"] = ""
        result.append(MessageOut(**d))
    return result


class ThreadModelUpdate(BaseModel):
    default_model: str  # any key from MODEL_MAP


@router.patch("/advisor/threads/{thread_id}/model")
def update_thread_model(thread_id: str, body: ThreadModelUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Set the default model for a thread."""
    if body.default_model not in MODEL_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid model. Use: {', '.join(MODEL_MAP.keys())}")
    row = db.execute("SELECT id FROM advisor_threads WHERE id = ?", (thread_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Thread not found")
    db.execute("UPDATE advisor_threads SET default_model = ? WHERE id = ?", (body.default_model, thread_id))
    db.commit()
    return {"ok": True, "default_model": body.default_model}


@router.post("/advisor/threads/{thread_id}/send")
async def send_message(thread_id: str, body: MessageSend):
    """Send a message and stream the advisor response via SSE using configurable LLM provider."""
    from api_tools import TOOLS_SCHEMA, execute_tool, log_cost
    from llm_providers import get_provider

    now = int(time.time())
    msg_id = str(uuid.uuid4())

    # Detect or use forced agent
    agent_role = body.agent_role or _detect_agent(body.content)

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys=ON;")

    thread = conn.execute("SELECT id FROM advisor_threads WHERE id = ?", (thread_id,)).fetchone()
    if not thread:
        conn.close()
        raise HTTPException(status_code=404, detail="Thread not found")

    # Save user message with agent_role, optional image, and source channel
    source = body.source if body.source in ("web", "telegram") else "web"
    conn.execute(
        "INSERT INTO advisor_messages (id, thread_id, role, content, agent_role, image_data, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (msg_id, thread_id, "user", body.content or ("[Imagen adjunta]" if body.image_data else ""), "", body.image_data or "", source, now),
    )
    conn.execute("UPDATE advisor_threads SET updated_at = ? WHERE id = ?", (now, thread_id))
    conn.commit()

    # Sliding window: keep only last N message pairs to control cost.
    MAX_HISTORY_MESSAGES = 20
    rows = conn.execute(
        "SELECT role, content, COALESCE(image_data, '') as image_data, COALESCE(agent_role, '') as agent_role FROM advisor_messages WHERE thread_id = ? ORDER BY created_at ASC",
        (thread_id,),
    ).fetchall()
    all_history = [{"role": r[0], "content": r[1], "image_data": r[2], "agent_role": r[3]} for r in rows]
    history = all_history[-MAX_HISTORY_MESSAGES:]
    conn.close()

    if len(history) == 1:
        title = body.content[:60] + ("..." if len(body.content) > 60 else "")
        c2 = sqlite3.connect(str(DB_PATH))
        c2.execute("UPDATE advisor_threads SET title = ? WHERE id = ?", (title, thread_id))
        c2.commit()
        c2.close()

    system_context = _load_system_context(agent_role, user_message=body.content)
    role_info = AGENT_ROLES.get(agent_role, AGENT_ROLES["ceo"])
    identity_reminder = (
        f"\n\n---\n## IDENTIDAD\n"
        f"Tu nombre es {role_info['name']}. Eres {role_info['label']}. "
        f"NUNCA te presentes como otro asesor ni respondas como si fueras alguien mas. "
        f"En el historial de chat, los mensajes de otros asesores aparecen etiquetados con su nombre entre corchetes "
        f"(ej. [Miguel]:, [Elena]:). Esos NO son tuyos. Tu eres {role_info['name']} y solo {role_info['name']}. "
        f"NUNCA empieces tu respuesta con '[{role_info['name']}]:' ni con '(Como {role_info['name']})'. Solo responde directamente."
    )
    system_context += identity_reminder
    tool_context = (
        "\n\n---\n## Herramientas disponibles\n"
        "Tienes acceso a las APIs internas de Lloyds. Cuando el usuario pregunte sobre "
        "datos reales (ventas, margenes, inventario, stockouts, forecast, etc.), USA las "
        "herramientas para consultar los datos en vez de inventar numeros. "
        "Si una herramienta falla, informa al usuario que no pudiste acceder a los datos."
    )
    system_context += tool_context
    memory_instructions = (
        "\n\n---\n## Memoria persistente\n"
        "Tienes una memoria compartida con los demas asesores del equipo. "
        "Arriba en tu contexto puedes ver memorias relevantes del equipo (si las hay). "
        "Usa la herramienta save_advisor_memory cuando el usuario comparta una decision clave, "
        "una preferencia importante, un dato estrategico, o cuando llegues a una conclusion "
        "significativa basada en analisis de datos. NO guardes trivialidades ni saludos."
    )
    system_context += memory_instructions
    cc_instructions = (
        "\n\n---\n## Control Center\n"
        "Cuando el usuario pida mover un proyecto a 'in_progress', SIEMPRE enciende tambien "
        "el autopilot (autopilot: true) en la misma llamada a cc_update_project. "
        "El autopilot permite que las tareas se ejecuten automaticamente."
    )
    system_context += cc_instructions
    research_instructions = (
        "\n\n---\n## Research (Perplexity)\n"
        "Tienes acceso a un sistema de research profundo via Perplexity AI. "
        "Usa research_list para ver investigaciones previas, research_read para leer un reporte completo, "
        "y research_query para lanzar una investigacion nueva cuando necesites datos externos, "
        "tendencias de mercado, analisis de competencia, o informacion que no esta en el Hub. "
        "El modelo 'sonar' es rapido (segundos), 'sonar-deep-research' es profundo (1-2 min). "
        "Los reportes se guardan automaticamente y quedan disponibles para consultas futuras."
    )
    system_context += research_instructions

    neutral_messages = _build_neutral_history(history)

    async def event_stream() -> AsyncGenerator[dict, None]:
        # Send agent info first so frontend knows who is responding
        yield {
            "event": "agent",
            "data": json.dumps({
                "role": agent_role,
                "name": role_info["name"],
                "label": role_info["label"],
                "color": role_info["color"],
                "bg_color": role_info["bg_color"],
                "avatar": role_info["avatar"],
                "voice_id": role_info.get("voice_id", ""),
            }),
        }

        try:
            assistant_id = str(uuid.uuid4())
            full_response = ""
            total_input_tokens = 0
            total_output_tokens = 0

            # Resolve model and provider
            provider_key, resolved_model, model_key = _resolve_model(body.model, body.content, thread_id)

            # Let frontend know which model is being used
            yield {"event": "model", "data": json.dumps({"model": model_key, "model_full": resolved_model, "provider": provider_key})}

            provider = get_provider(provider_key)

            # Tool calling loop -- uses text-based tool results for cross-provider compat
            MAX_TOOL_ROUNDS = 3
            tool_context_parts: list[str] = []  # Text summaries of tool interactions
            has_used_tools = False

            for _round in range(MAX_TOOL_ROUNDS):
                # Build messages: original history + tool context as assistant/user text pairs
                call_messages = list(neutral_messages)
                if tool_context_parts:
                    # Append tool interactions as a single assistant+user exchange
                    call_messages.append({"role": "assistant", "content": "\n".join(tool_context_parts)})
                    call_messages.append({"role": "user", "content": "Continua con tu respuesta usando los datos obtenidos."})

                result = await provider.chat(
                    model=resolved_model,
                    system=system_context,
                    messages=call_messages,
                    tools=TOOLS_SCHEMA,
                    max_tokens=4096,
                    temperature=0.7,
                )

                total_input_tokens += result.input_tokens
                total_output_tokens += result.output_tokens

                if result.tool_calls:
                    has_used_tools = True

                    for tc in result.tool_calls:
                        tool_args = dict(tc.args)
                        if tc.name == "save_advisor_memory":
                            tool_args["_agent_name"] = role_info["name"]

                        yield {"event": "delta", "data": json.dumps({"text": f"\n> Consultando {tc.name}...\n"})}

                        tool_result_str = await execute_tool(tc.name, tool_args)

                        # Store as text for next round
                        tool_context_parts.append(
                            f"[Herramienta: {tc.name}({json.dumps(tc.args, ensure_ascii=False)[:200]})]\n"
                            f"Resultado: {tool_result_str[:4000]}"
                        )

                    continue  # Loop back for model to process results

                # No tool calls -- use this response text directly
                if result.text:
                    full_response = result.text
                    yield {"event": "delta", "data": json.dumps({"text": result.text})}
                break

            # If tools were used, make a final streaming call for synthesis
            if has_used_tools:
                full_response = ""
                stream_messages = list(neutral_messages)
                if tool_context_parts:
                    stream_messages.append({"role": "assistant", "content": "\n\n".join(tool_context_parts)})
                    stream_messages.append({"role": "user", "content": "Ahora responde mi pregunta original usando los datos que obtuviste de las herramientas."})

                async for delta in provider.chat_stream(
                    model=resolved_model,
                    system=system_context,
                    messages=stream_messages,
                    max_tokens=4096,
                    temperature=0.7,
                ):
                    if delta.text:
                        full_response += delta.text
                        yield {"event": "delta", "data": json.dumps({"text": delta.text})}
                    if delta.input_tokens:
                        total_input_tokens = delta.input_tokens
                    if delta.output_tokens:
                        total_output_tokens = delta.output_tokens

            if full_response:
                save_conn = sqlite3.connect(str(DB_PATH))
                save_now = int(time.time())
                save_conn.execute(
                    "INSERT INTO advisor_messages (id, thread_id, role, content, agent_role, source, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (assistant_id, thread_id, "assistant", full_response, agent_role, source, model_key, save_now),
                )
                save_conn.execute("UPDATE advisor_threads SET updated_at = ? WHERE id = ?", (save_now, thread_id))
                save_conn.commit()
                save_conn.close()

                yield {"event": "done", "data": json.dumps({"id": assistant_id, "content": full_response, "agent_role": agent_role, "model_used": model_key})}

            # Log cost
            await log_cost(
                api_name=provider_key,
                endpoint=resolved_model,
                tokens_in=total_input_tokens,
                tokens_out=total_output_tokens,
                notes=f"advisor:{agent_role}:model={model_key}",
            )

        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_stream())
