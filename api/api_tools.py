"""API tools for advisor agents -- routes all queries through the Integration Hub."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from google.genai import types

# ── Config ────────────────────────────────────────────────────

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("ALLOWED_CHAT_ID", "")
COST_TRACKER_URL = "http://localhost:8200"
CONTROL_CENTER_URL = "http://localhost:8031"

# All data queries route through the Integration Hub (port 8000)
HUB_URL = "http://localhost:8000"

# Legacy direct connections kept only for PIM (not yet in the hub)
PIM_URL = "http://localhost:3000"

_AUTH_HEADERS: dict[str, str] = {}


def _get_auth_headers() -> dict[str, str]:
    global _AUTH_HEADERS
    if not _AUTH_HEADERS and INTERNAL_API_KEY:
        _AUTH_HEADERS = {"Authorization": f"Bearer {INTERNAL_API_KEY}"}
    return _AUTH_HEADERS


# ── Hub helpers ───────────────────────────────────────────────


async def _hub(path: str, method: str = "GET", params: dict | None = None, body: dict | None = None) -> dict[str, Any]:
    """Make a request to the Integration Hub."""
    url = f"{HUB_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            if method == "GET":
                resp = await client.get(url, headers=_get_auth_headers(), params=params)
            elif method == "POST":
                resp = await client.post(url, headers=_get_auth_headers(), json=body or {}, params=params)
            elif method == "PATCH":
                resp = await client.patch(url, headers=_get_auth_headers(), json=body or {})
            elif method == "PUT":
                resp = await client.put(url, headers=_get_auth_headers(), json=body or {})
            else:
                return {"error": f"Unsupported method: {method}"}
            if resp.status_code in (200, 201):
                return resp.json()
            return {"error": f"Hub HTTP {resp.status_code}", "path": path, "detail": resp.text[:500]}
    except httpx.ConnectError:
        return {"error": f"Cannot connect to Integration Hub at {HUB_URL}"}
    except Exception as e:
        return {"error": str(e)[:300]}


async def _hub_ask(query: str, params: dict | None = None) -> dict[str, Any]:
    """Natural language query through the Hub's /intents/ask endpoint."""
    body = {"query": query}
    if params:
        body["params"] = params
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{HUB_URL}/intents/ask", json=body)
            if resp.status_code == 200:
                return resp.json()
            return {"error": f"Hub /intents/ask HTTP {resp.status_code}", "detail": resp.text[:500]}
    except httpx.ConnectError:
        return {"error": "Cannot connect to Integration Hub"}
    except Exception as e:
        return {"error": str(e)[:300]}


async def _pim_fetch(path: str, params: dict | None = None) -> dict[str, Any]:
    """Direct PIM call (not yet routed through hub)."""
    url = f"{PIM_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=_get_auth_headers(), params=params)
            if resp.status_code == 200:
                return resp.json()
            return {"error": f"HTTP {resp.status_code}", "detail": resp.text[:500]}
    except httpx.ConnectError:
        return {"error": f"Cannot connect to PIM at {PIM_URL}"}
    except Exception as e:
        return {"error": str(e)[:300]}


async def _cc_request(method: str, path: str, body: dict | None = None, params: dict | None = None) -> dict[str, Any]:
    """Make a request to the Control Center API (localhost:8031)."""
    url = f"{CONTROL_CENTER_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if method == "GET":
                resp = await client.get(url, params=params)
            elif method == "POST":
                resp = await client.post(url, json=body or {})
            elif method == "PATCH":
                resp = await client.patch(url, json=body or {})
            else:
                return {"error": f"Unsupported method: {method}"}
            if resp.status_code in (200, 201):
                return resp.json()
            return {"error": f"HTTP {resp.status_code}", "detail": resp.text[:500]}
    except httpx.ConnectError:
        return {"error": "Cannot connect to Control Center API"}
    except Exception as e:
        return {"error": str(e)[:300]}


# ── Web helpers ───────────────────────────────────────────────


async def _web_search(query: str) -> dict[str, Any]:
    """Search the web using DuckDuckGo HTML (no API key needed)."""
    import re
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            if resp.status_code != 200:
                return {"error": f"Search failed: HTTP {resp.status_code}"}
            html = resp.text
            results = []
            for match in re.finditer(
                r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?'
                r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
                html, re.DOTALL,
            ):
                url = match.group(1)
                title = re.sub(r"<[^>]+>", "", match.group(2)).strip()
                snippet = re.sub(r"<[^>]+>", "", match.group(3)).strip()
                if title and snippet:
                    results.append({"title": title, "url": url, "snippet": snippet})
                if len(results) >= 8:
                    break
            if not results:
                return {"message": "No results found", "query": query}
            return {"results": results, "query": query}
    except Exception as e:
        return {"error": f"Search failed: {str(e)[:200]}"}


async def _web_fetch(url: str) -> dict[str, Any]:
    """Fetch a URL and extract readable text content."""
    import re
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            if resp.status_code != 200:
                return {"error": f"Fetch failed: HTTP {resp.status_code}"}
            content_type = resp.headers.get("content-type", "")
            if "json" in content_type:
                return {"url": url, "content": resp.text[:6000]}
            text = resp.text
            text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            if len(text) > 6000:
                text = text[:6000] + "... [truncated]"
            return {"url": url, "content": text}
    except Exception as e:
        return {"error": f"Fetch failed: {str(e)[:200]}"}


# ── Tool declarations for Gemini ──────────────────────────────

TOOL_DECLARATIONS = types.Tool(
    function_declarations=[
        # ── Hub NL query (the power tool) ──
        types.FunctionDeclaration(
            name="hub_query",
            description=(
                "Consulta en lenguaje natural al Integration Hub. El hub resuelve automaticamente "
                "a que API interna dirigir la consulta. Usa esto cuando quieras explorar datos "
                "sin saber exactamente que endpoint usar, o cuando quieras cruzar informacion. "
                "Ejemplos: 'dame las ventas del modelo LP-321', 'cuanto inventario hay de sillas', "
                "'costos del articulo ABC-123'."
            ),
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "query": types.Schema(type="STRING", description="Pregunta en lenguaje natural sobre datos del negocio"),
                    "params": types.Schema(type="STRING", description="Parametros adicionales en JSON (opcional, ej: {\"model_no\": \"LP-321\"})"),
                },
                required=["query"],
            ),
        ),
        # ── Stockout / Cashflow (via hub) ──
        types.FunctionDeclaration(
            name="query_stockout_dashboard",
            description="Dashboard de Stockout Zero: balance actual, proyecciones, entradas/salidas pendientes, alertas activas.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_stockout_products",
            description="Buscar productos en Stockout Zero con niveles de stock, forecast de demanda y riesgo de desabasto.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "search": types.Schema(type="STRING", description="Termino de busqueda por nombre o SKU"),
                    "limit": types.Schema(type="INTEGER", description="Max resultados (default 20)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="query_stockout_alerts",
            description="Alertas activas de stockout e inventario.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "active_only": types.Schema(type="BOOLEAN", description="Solo alertas activas (default true)"),
                },
            ),
        ),
        # ── Margins (via hub) ──
        types.FunctionDeclaration(
            name="query_margin_summary",
            description="Resumen HQ de margenes: salud general, riesgo, tendencias, peores productos.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_margin_products",
            description="Margenes por producto o categoria.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "search": types.Schema(type="STRING", description="Buscar por nombre de producto o categoria"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="query_margin_trends",
            description="Productos con margenes deteriorandose. Detecta tendencias negativas para accion preventiva.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_margin_recommendations",
            description="Recomendaciones accionables de margenes: que ajustar, que revisar, oportunidades.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_margin_blocked",
            description="Productos bloqueados por margen rojo (no deben venderse hasta ajuste de precio).",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Forecast (via hub) ──
        types.FunctionDeclaration(
            name="query_forecast",
            description="Forecast de ventas y demanda. Sin producto: resumen de alertas. Con producto: forecast especifico por SKU.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "product": types.Schema(type="STRING", description="SKU o modelo a consultar (opcional)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="query_forecast_alerts",
            description="Alertas urgentes de forecast: desabasto inminente, anomalias de demanda.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_forecast_abc",
            description="Clasificacion ABC de productos: cuales son A (80% revenue), B, C. Para priorizar atencion.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_forecast_inventory",
            description="Dias de inventario por producto. Identifica cuales estan en zona critica.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_transit_stock",
            description="Stock en transito: que viene en camino, cuando llega, cantidades.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Supply Tracker (NEW via hub) ──
        types.FunctionDeclaration(
            name="query_supply_dashboard",
            description="Dashboard de supply chain: ordenes activas, valor total, pendientes de pago.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_supply_orders",
            description="Ordenes de compra con estado, proveedor, valor y fechas.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "status": types.Schema(type="STRING", description="Filtrar por estado de orden"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="query_supply_debt",
            description="Analisis de deuda por proveedor: cuanto debemos, a quien, antiguedad.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_supply_overdue",
            description="Pagos vencidos: cuales ya pasaron de fecha, montos, urgencia.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_supply_arrivals",
            description="Llegadas esperadas: que mercancia viene en camino y cuando llega.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Fill Rate (NEW via hub) ──
        types.FunctionDeclaration(
            name="query_fill_rate",
            description="Fill rate de Home Depot: porcentaje de cumplimiento de ordenes, tendencia.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Transactional SQL (NEW via hub) ──
        types.FunctionDeclaration(
            name="query_sales_data",
            description="Ventas de un articulo/modelo: YTD, LYTD, R3M, R6M, R12M. Datos transaccionales reales.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "articulo": types.Schema(type="STRING", description="Codigo de articulo o modelo"),
                },
                required=["articulo"],
            ),
        ),
        types.FunctionDeclaration(
            name="query_cost_data",
            description="Costos de un articulo con desglose ADFA (arancel, flete, etc).",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "articulo": types.Schema(type="STRING", description="Codigo de articulo"),
                },
                required=["articulo"],
            ),
        ),
        types.FunctionDeclaration(
            name="query_inventory_levels",
            description="Niveles de inventario actual por articulo desde el sistema transaccional.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="query_pending_purchases",
            description="Ordenes de compra pendientes con cantidades por recibir.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── HD Analytics (via hub) ──
        types.FunctionDeclaration(
            name="query_hd_analytics",
            description="Analiticas de Home Depot: KPIs, ventas por subcategoria, top productos, analisis de stockouts.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "report_type": types.Schema(
                        type="STRING",
                        description="Tipo: 'summary' (KPIs), 'categories' (por subcategoria), 'products' (top productos), 'stockouts' (analisis desabasto)",
                    ),
                },
            ),
        ),
        # ── Scheduler ──
        types.FunctionDeclaration(
            name="query_scheduler_jobs",
            description="Jobs programados y su estado.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Cashflow ──
        types.FunctionDeclaration(
            name="query_cashflow_summary",
            description="Resumen de flujo de caja: balance, proyecciones, transacciones pendientes.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Telegram ──
        types.FunctionDeclaration(
            name="send_telegram_notification",
            description="Envia una notificacion a Salomon por Telegram. Usa para alertas urgentes o hallazgos importantes.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "message": types.Schema(type="STRING", description="Mensaje a enviar. HTML basico: <b>bold</b>, <i>italic</i>, <code>code</code>."),
                },
                required=["message"],
            ),
        ),
        # ── Memory ──
        types.FunctionDeclaration(
            name="save_advisor_memory",
            description=(
                "Guarda un hecho, decision o aprendizaje importante en la memoria persistente del equipo. "
                "NO guardes info trivial. Ejemplos: 'Salomon decidio aumentar margenes en cat X un 5%', "
                "'El ciclo de PO de Home Depot es cada 2 semanas'."
            ),
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "content": types.Schema(type="STRING", description="El hecho o decision a recordar"),
                    "importance": types.Schema(
                        type="STRING",
                        description="'permanent' (reglas clave), 'important' (decisiones), 'normal' (contexto)",
                    ),
                },
                required=["content", "importance"],
            ),
        ),
        # ── Web research ──
        types.FunctionDeclaration(
            name="web_search",
            description="Busca en internet. Para datos actualizados, noticias, precios de mercado, competidores.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "query": types.Schema(type="STRING", description="La busqueda a realizar"),
                },
                required=["query"],
            ),
        ),
        types.FunctionDeclaration(
            name="web_fetch",
            description="Lee el contenido de una URL.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "url": types.Schema(type="STRING", description="La URL a leer"),
                },
                required=["url"],
            ),
        ),
        # ── Control Center project management tools ──
        types.FunctionDeclaration(
            name="cc_list_projects",
            description="Lista todos los proyectos del Control Center con su fase, prioridad y estado.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="cc_create_project",
            description="Crea un nuevo proyecto en el Control Center.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "name": types.Schema(type="STRING", description="Nombre del proyecto"),
                    "description": types.Schema(type="STRING", description="Descripcion del proyecto"),
                    "priority": types.Schema(type="STRING", description="Prioridad: none, low, medium, high, critical"),
                    "phase": types.Schema(type="STRING", description="Fase: backlog, in_progress, review, released"),
                },
                required=["name"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_update_project",
            description="Actualiza un proyecto: nombre, fase, prioridad, pausar, completar, autopilot.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "project_id": types.Schema(type="STRING", description="ID del proyecto"),
                    "name": types.Schema(type="STRING", description="Nuevo nombre"),
                    "description": types.Schema(type="STRING", description="Nueva descripcion"),
                    "phase": types.Schema(type="STRING", description="Nueva fase"),
                    "priority": types.Schema(type="STRING", description="Nueva prioridad"),
                    "paused": types.Schema(type="BOOLEAN", description="Pausar/reanudar"),
                    "completed": types.Schema(type="BOOLEAN", description="Marcar completado"),
                    "autopilot": types.Schema(type="BOOLEAN", description="On/off autopilot"),
                },
                required=["project_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_list_features",
            description="Lista features de un proyecto.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"project_id": types.Schema(type="STRING", description="ID del proyecto")},
                required=["project_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_create_feature",
            description="Crea feature en un proyecto.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "project_id": types.Schema(type="STRING", description="ID del proyecto padre"),
                    "description": types.Schema(type="STRING", description="Descripcion"),
                    "objective": types.Schema(type="STRING", description="Objetivo"),
                    "priority": types.Schema(type="STRING", description="Prioridad"),
                },
                required=["project_id", "description"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_create_task",
            description="Crea tarea en una feature o proyecto.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "description": types.Schema(type="STRING", description="Descripcion de la tarea"),
                    "feature_id": types.Schema(type="STRING", description="Feature padre"),
                    "project_id": types.Schema(type="STRING", description="Proyecto padre"),
                },
                required=["description"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_update_feature",
            description="Actualiza feature: descripcion, fase, prioridad, completar, autopilot.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "feature_id": types.Schema(type="STRING", description="ID de la feature"),
                    "description": types.Schema(type="STRING", description="Nueva descripcion"),
                    "objective": types.Schema(type="STRING", description="Nuevo objetivo"),
                    "acceptance_criteria": types.Schema(type="STRING", description="Criterios"),
                    "phase": types.Schema(type="STRING", description="Nueva fase"),
                    "priority": types.Schema(type="STRING", description="Nueva prioridad"),
                    "autopilot": types.Schema(type="BOOLEAN", description="On/off autopilot"),
                    "completed": types.Schema(type="BOOLEAN", description="Completada"),
                },
                required=["feature_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_list_tasks",
            description="Lista tareas filtradas por proyecto o feature.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "project_id": types.Schema(type="STRING", description="Filtrar por proyecto"),
                    "feature_id": types.Schema(type="STRING", description="Filtrar por feature"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="cc_update_task",
            description="Actualiza tarea: completar, mover, cambiar descripcion.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_id": types.Schema(type="STRING", description="ID de la tarea"),
                    "description": types.Schema(type="STRING", description="Nueva descripcion"),
                    "completed": types.Schema(type="BOOLEAN", description="Completada"),
                    "feature_id": types.Schema(type="STRING", description="Mover a feature"),
                    "project_id": types.Schema(type="STRING", description="Mover a proyecto"),
                    "verification_status": types.Schema(type="STRING", description="pending, passed, failed"),
                },
                required=["task_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_decompose_project",
            description="Descompone features en tareas atomicas usando Claude CLI.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"project_id": types.Schema(type="STRING", description="ID del proyecto")},
                required=["project_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_list_autopilot_queue",
            description="Lista tareas del autopilot (pending, running, completed, failed).",
            parameters=types.Schema(
                type="OBJECT",
                properties={"status": types.Schema(type="STRING", description="Filtrar por estado")},
            ),
        ),
        types.FunctionDeclaration(
            name="cc_retry_autopilot_task",
            description="Reintenta tarea fallida del autopilot.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"item_id": types.Schema(type="STRING", description="ID del item")},
                required=["item_id"],
            ),
        ),
        # ── Notes/Wiki ──
        types.FunctionDeclaration(
            name="cc_create_note",
            description="Crea nota en la wiki.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "title": types.Schema(type="STRING", description="Titulo"),
                    "content": types.Schema(type="STRING", description="Contenido markdown"),
                    "tags": types.Schema(type="STRING", description="Tags separados por coma"),
                    "project_id": types.Schema(type="STRING", description="Vincular a proyecto"),
                    "pinned": types.Schema(type="BOOLEAN", description="Fijar como importante"),
                },
                required=["title", "content"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_search_notes",
            description="Busca notas por texto, tags o proyecto.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "search": types.Schema(type="STRING", description="Texto a buscar"),
                    "tags": types.Schema(type="STRING", description="Filtrar por tags"),
                    "project_id": types.Schema(type="STRING", description="Filtrar por proyecto"),
                    "pinned": types.Schema(type="BOOLEAN", description="Solo fijadas"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="cc_read_note",
            description="Lee contenido completo de una nota.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"note_id": types.Schema(type="STRING", description="ID de la nota")},
                required=["note_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_update_note",
            description="Actualiza nota: titulo, contenido, tags, pin.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "note_id": types.Schema(type="STRING", description="ID de la nota"),
                    "title": types.Schema(type="STRING", description="Nuevo titulo"),
                    "content": types.Schema(type="STRING", description="Nuevo contenido"),
                    "tags": types.Schema(type="STRING", description="Nuevos tags"),
                    "project_id": types.Schema(type="STRING", description="Vincular a proyecto"),
                    "pinned": types.Schema(type="BOOLEAN", description="Fijar/desfijar"),
                },
                required=["note_id"],
            ),
        ),
        # ── Alerts ──
        types.FunctionDeclaration(
            name="cc_create_alert",
            description="Crea alerta en el Control Center.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "title": types.Schema(type="STRING", description="Titulo"),
                    "description": types.Schema(type="STRING", description="Descripcion"),
                    "severity": types.Schema(type="STRING", description="info, warning, error, critical"),
                    "category": types.Schema(type="STRING", description="info, stockout, margin, cashflow, system, general"),
                    "action": types.Schema(type="STRING", description="Accion sugerida"),
                },
                required=["title"],
            ),
        ),
        # ── PIM (direct, not via hub yet) ──
        types.FunctionDeclaration(
            name="pim_search_products",
            description="Busca productos en PIM por nombre, SKU o modelo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "search": types.Schema(type="STRING", description="Texto a buscar"),
                    "limit": types.Schema(type="INTEGER", description="Max resultados (default 20)"),
                },
                required=["search"],
            ),
        ),
        types.FunctionDeclaration(
            name="pim_get_product",
            description="Detalle completo de un producto del PIM: atributos, precios, costos, media, marketplace.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"product_id": types.Schema(type="INTEGER", description="ID del producto")},
                required=["product_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="pim_get_inventory",
            description="Inventario actual desde PIM: stock disponible, en transito, comprometido.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pim_get_sales_ytd",
            description="Ventas acumuladas del anio (YTD) por producto o categoria.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pim_get_quality_score",
            description="Score de calidad de producto para un canal (Amazon, MercadoLibre, Home Depot).",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "product_id": types.Schema(type="INTEGER", description="ID del producto"),
                    "channel": types.Schema(type="STRING", description="Canal: amazon, mercadolibre, homedepot"),
                },
                required=["product_id"],
            ),
        ),
        # ── Daily Business Pulse tools ──
        types.FunctionDeclaration(
            name="pulse_today",
            description="Obtener snapshot en tiempo real del Daily Business Pulse: cashflow, stockouts, KPIs HD, aprobaciones pendientes, tipo de cambio, email stats.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pulse_latest",
            description="Obtener el ultimo pulse generado y persistido (snapshot historico mas reciente).",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pulse_history",
            description="Historial de pulses generados. Util para comparar metricas entre dias.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "limit": types.Schema(type="INTEGER", description="Cantidad de pulses a obtener (default 10)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="pulse_briefing",
            description="Briefing personal diario: frase motivacional, clima Monterrey, highlights de newsletters.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pulse_advisors_overnight",
            description="Resumen de actividad de advisors en las ultimas 12 horas: decisiones tomadas, aprobaciones pendientes, acciones.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="pulse_modules",
            description="Listar modulos configurados del Daily Business Pulse con su estado (enabled/disabled).",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Journal (CEO diary / reflexion) ──
        types.FunctionDeclaration(
            name="journal_list_entries",
            description="Lista entradas del diario/journal del CEO. Busca por texto, mood o tags. Util para entender contexto emocional y decisiones recientes.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "search": types.Schema(type="STRING", description="Buscar en contenido, tags o fecha"),
                    "mood": types.Schema(type="STRING", description="Filtrar por mood (ej: focused, stressed, optimistic)"),
                    "tags": types.Schema(type="STRING", description="Filtrar por tags separados por coma"),
                    "limit": types.Schema(type="INTEGER", description="Max entradas (default 10)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="journal_get_entry",
            description="Lee una entrada especifica del journal por fecha (formato: YYYY-MM-DD).",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "date": types.Schema(type="STRING", description="Fecha en formato YYYY-MM-DD"),
                },
                required=["date"],
            ),
        ),
        types.FunctionDeclaration(
            name="journal_create_entry",
            description="Crea o actualiza una entrada en el journal del CEO. Util para registrar hallazgos, decisiones o reflexiones importantes.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "date": types.Schema(type="STRING", description="Fecha YYYY-MM-DD (default: hoy)"),
                    "content": types.Schema(type="STRING", description="Contenido de la entrada"),
                    "mood": types.Schema(type="STRING", description="Mood: focused, stressed, optimistic, neutral, tired, energized"),
                    "tags": types.Schema(type="STRING", description="Tags separados por coma"),
                },
                required=["content"],
            ),
        ),
        # ── Scheduler management ──
        types.FunctionDeclaration(
            name="scheduler_list_tasks",
            description="Lista todas las tareas programadas (cron jobs) con su estado, proxima ejecucion y resultado.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "status": types.Schema(type="STRING", description="Filtrar por estado: active, paused"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="scheduler_create_task",
            description="Crea una nueva tarea programada (cron job). Requiere prompt (que ejecutar) y schedule (expresion cron).",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "prompt": types.Schema(type="STRING", description="El prompt o comando a ejecutar"),
                    "schedule": types.Schema(type="STRING", description="Expresion cron: '0 9 * * *' (9am diario), '0 9 * * 1' (lunes 9am), '0 */4 * * *' (cada 4h)"),
                },
                required=["prompt", "schedule"],
            ),
        ),
        types.FunctionDeclaration(
            name="scheduler_pause_task",
            description="Pausa una tarea programada.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_id": types.Schema(type="STRING", description="ID de la tarea a pausar"),
                },
                required=["task_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="scheduler_resume_task",
            description="Reanuda una tarea programada que estaba pausada.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_id": types.Schema(type="STRING", description="ID de la tarea a reanudar"),
                },
                required=["task_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="scheduler_delete_task",
            description="Elimina una tarea programada permanentemente.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_id": types.Schema(type="STRING", description="ID de la tarea a eliminar"),
                },
                required=["task_id"],
            ),
        ),
        # ── Discovery Loop control ──
        types.FunctionDeclaration(
            name="discovery_trigger_run",
            description="Dispara un ciclo de Discovery Loop inmediato. Los 3 advisors (CEO, Sales, Marketing) analizan datos en paralelo y generan findings.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="discovery_get_history",
            description="Historial de ejecuciones del Discovery Loop: cuando se corrio, cuantos findings, costo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "limit": types.Schema(type="INTEGER", description="Max resultados (default 10)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="discovery_get_findings",
            description="Consulta findings del Discovery Loop. Filtra por severidad o run_id. Util para ver que han detectado los otros advisors.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "severity": types.Schema(type="STRING", description="Filtrar: critical, warning, insight"),
                    "run_id": types.Schema(type="STRING", description="Filtrar por ID de run especifico"),
                    "limit": types.Schema(type="INTEGER", description="Max resultados (default 20)"),
                },
            ),
        ),
        # ── Alerts management (read/dismiss) ──
        types.FunctionDeclaration(
            name="cc_list_alerts",
            description="Lista alertas activas del Control Center. Filtra por severidad o categoria.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "severity": types.Schema(type="STRING", description="Filtrar: info, warning, error, critical"),
                    "category": types.Schema(type="STRING", description="Filtrar: info, stockout, margin, cashflow, system, general"),
                    "dismissed": types.Schema(type="BOOLEAN", description="Incluir alertas descartadas (default false)"),
                    "limit": types.Schema(type="INTEGER", description="Max resultados (default 50)"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="cc_dismiss_alert",
            description="Descarta/cierra una alerta del Control Center.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "alert_id": types.Schema(type="STRING", description="ID de la alerta a descartar"),
                },
                required=["alert_id"],
            ),
        ),
        # ── Action Items (business decision pipeline) ──
        types.FunctionDeclaration(
            name="cc_create_action_item",
            description="Crea un action item: propuesta de decision de negocio que requiere aprobacion del CEO. Usa esto cuando detectes algo que necesita accion pero no puedes ejecutar solo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "title": types.Schema(type="STRING", description="Titulo corto de la propuesta"),
                    "detail": types.Schema(type="STRING", description="Detalle completo: que, por que, opciones, costos, riesgos"),
                    "estimated_impact": types.Schema(type="STRING", description="Impacto estimado en $ o KPIs"),
                    "category": types.Schema(type="STRING", description="pricing, supply, marketing, operations, finance, general"),
                    "priority": types.Schema(type="STRING", description="urgent, high, normal, low"),
                    "finding_id": types.Schema(type="STRING", description="ID del discovery finding relacionado"),
                },
                required=["title", "detail"],
            ),
        ),
        types.FunctionDeclaration(
            name="cc_list_action_items",
            description="Lista action items pendientes. Usa para ver propuestas en revision, aprobadas pendientes de ejecucion, o rechazadas con feedback del CEO.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "status": types.Schema(type="STRING", description="proposed, in_review, approved, rejected, done"),
                    "limit": types.Schema(type="INTEGER", description="Max resultados"),
                },
            ),
        ),
        types.FunctionDeclaration(
            name="cc_comment_action_item",
            description="Agrega un comentario a un action item. Usa para responder feedback del CEO, enriquecer la propuesta, o agregar datos nuevos.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "action_item_id": types.Schema(type="STRING", description="ID del action item"),
                    "content": types.Schema(type="STRING", description="Contenido del comentario"),
                },
                required=["action_item_id", "content"],
            ),
        ),
        # ── Exchange rate (FX) ──
        types.FunctionDeclaration(
            name="query_exchange_rate",
            description="Tipo de cambio actual USD/MXN. Util para calcular impacto de importaciones y costos.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        # ── Weather (Monterrey) ──
        types.FunctionDeclaration(
            name="query_weather",
            description="Clima actual y pronostico de Monterrey. Util para campanas de temporada y forecast de demanda estacional.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "city": types.Schema(type="STRING", description="Ciudad (default: Monterrey)"),
                },
            ),
        ),
        # ── API Cost tracking ──
        types.FunctionDeclaration(
            name="query_api_costs",
            description="Consulta costos de uso de APIs (Gemini, etc). Cuanto hemos gastado, por proyecto, por periodo.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "period": types.Schema(type="STRING", description="Periodo: today, week, month (default: today)"),
                },
            ),
        ),
        # ── Delete note ──
        types.FunctionDeclaration(
            name="cc_delete_note",
            description="Elimina una nota permanentemente.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "note_id": types.Schema(type="STRING", description="ID de la nota a eliminar"),
                },
                required=["note_id"],
            ),
        ),
        # ── Delete task ──
        types.FunctionDeclaration(
            name="cc_delete_task",
            description="Elimina una tarea permanentemente.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_id": types.Schema(type="STRING", description="ID de la tarea a eliminar"),
                },
                required=["task_id"],
            ),
        ),
        # ── Research tools ──
        types.FunctionDeclaration(
            name="research_list",
            description="Lista los reportes de research existentes. Devuelve id, query, modelo, status y fecha.",
            parameters=types.Schema(type="OBJECT", properties={}),
        ),
        types.FunctionDeclaration(
            name="research_read",
            description="Lee el contenido completo de un reporte de research por su ID.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "report_id": types.Schema(type="STRING", description="ID del reporte a leer"),
                },
                required=["report_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="research_query",
            description="Lanza una investigacion profunda via Perplexity AI. Usa 'sonar' para rapido o 'sonar-deep-research' para profundo. El resultado se guarda automaticamente.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "query": types.Schema(type="STRING", description="Tema o pregunta a investigar"),
                    "model": types.Schema(type="STRING", description="Modelo: 'sonar' (rapido) o 'sonar-deep-research' (profundo). Default: sonar"),
                },
                required=["query"],
            ),
        ),
    ]
)


# ── Tool execution ────────────────────────────────────────────


async def execute_tool(name: str, args: dict[str, Any], advisor_key: str = "") -> str:
    """Execute a tool call and return JSON string result."""
    result: Any

    # ── Hub NL query ──
    if name == "hub_query":
        query = args.get("query", "")
        params = None
        if args.get("params"):
            try:
                params = json.loads(args["params"]) if isinstance(args["params"], str) else args["params"]
            except json.JSONDecodeError:
                params = None
        result = await _hub_ask(query, params)

    # ── Stockout/Cashflow (now via hub) ──
    elif name == "query_stockout_dashboard":
        result = await _hub("/api/v1/forecast/alerts/summary")

    elif name == "query_stockout_products":
        params = {}
        if args.get("search"):
            params["search"] = args["search"]
        params["limit"] = args.get("limit", 20)
        result = await _hub("/api/v1/forecast/products", params=params)

    elif name == "query_stockout_alerts":
        result = await _hub("/api/v1/forecast/alerts/urgent")

    # ── Margins (via hub) ──
    elif name == "query_margin_summary":
        result = await _hub("/api/v1/margenes/margins/hq-summary")

    elif name == "query_margin_products":
        params = {}
        if args.get("search"):
            params["search"] = args["search"]
        result = await _hub("/api/v1/margenes/margins", params=params)

    elif name == "query_margin_trends":
        result = await _hub("/api/v1/margenes/trends/deteriorating")

    elif name == "query_margin_recommendations":
        result = await _hub("/api/v1/margenes/trends/recommendations")

    elif name == "query_margin_blocked":
        result = await _hub("/api/v1/margenes/stockout/blocked")

    # ── Forecast (via hub) ──
    elif name == "query_forecast":
        product = args.get("product", "")
        if product:
            result = await _hub(f"/api/v1/forecast/sku/{product}")
        else:
            alerts = await _hub("/api/v1/forecast/alerts/summary")
            subcats = await _hub("/api/v1/forecast/subcategorias")
            result = {"alerts_summary": alerts, "subcategorias": subcats}

    elif name == "query_forecast_alerts":
        result = await _hub("/api/v1/forecast/alerts/urgent")

    elif name == "query_forecast_abc":
        result = await _hub("/api/v1/forecast/abc/summary")

    elif name == "query_forecast_inventory":
        result = await _hub("/api/v1/forecast/inventory")

    elif name == "query_transit_stock":
        result = await _hub("/api/v1/forecast/transit-stock")

    # ── Supply Tracker (NEW - via hub) ──
    elif name == "query_supply_dashboard":
        result = await _hub("/api/v1/supply-tracker/dashboard")

    elif name == "query_supply_orders":
        params = {}
        if args.get("status"):
            params["status"] = args["status"]
        result = await _hub("/api/v1/supply-tracker/orders", params=params)

    elif name == "query_supply_debt":
        result = await _hub("/api/v1/supply-tracker/debt-analysis")

    elif name == "query_supply_overdue":
        result = await _hub("/api/v1/supply-tracker/payments/overdue")

    elif name == "query_supply_arrivals":
        result = await _hub("/api/v1/supply-tracker/arrivals")

    # ── Fill Rate (NEW - via hub) ──
    elif name == "query_fill_rate":
        result = await _hub("/api/v1/fill-rate")

    # ── Transactional SQL (NEW - via hub) ──
    elif name == "query_sales_data":
        articulo = args.get("articulo", "")
        if not articulo:
            result = {"error": "articulo is required"}
        else:
            result = await _hub(f"/api/v1/lloyds-sql/ventas/{articulo}")

    elif name == "query_cost_data":
        articulo = args.get("articulo", "")
        if not articulo:
            result = {"error": "articulo is required"}
        else:
            result = await _hub("/api/v1/lloyds-sql/costos", params={"articulo": articulo})

    elif name == "query_inventory_levels":
        result = await _hub("/api/v1/lloyds-sql/inventario")

    elif name == "query_pending_purchases":
        result = await _hub("/api/v1/lloyds-sql/compras-pendientes")

    # ── HD Analytics (via hub) ──
    elif name == "query_hd_analytics":
        report_type = args.get("report_type", "summary")
        if report_type == "summary":
            result = await _hub("/api/v1/forecast/alerts/summary")
        elif report_type == "categories":
            result = await _hub_ask("ventas por subcategoria home depot")
        elif report_type == "products":
            result = await _hub_ask("top productos home depot")
        elif report_type == "stockouts":
            result = await _hub("/api/v1/forecast/alerts/urgent")
        else:
            result = await _hub("/api/v1/forecast/alerts/summary")

    # ── Scheduler ──
    elif name == "query_scheduler_jobs":
        result = await _hub("/api/v1/hq/jobs")

    # ── Cashflow ──
    elif name == "query_cashflow_summary":
        result = await _hub("/api/v1/supply-tracker/dashboard")

    # ── Memory ──
    elif name == "save_advisor_memory":
        from advisor_memory import save_memory

        content = args.get("content", "")
        importance = args.get("importance", "normal")
        if not content:
            result = {"error": "No content provided"}
        else:
            sector_map = {"permanent": "knowledge", "important": "semantic", "normal": "episodic"}
            sector = sector_map.get(importance, "semantic")
            salience_map = {"permanent": 999.0, "important": 3.0, "normal": 1.0}
            salience = salience_map.get(importance, 1.0)
            agent_name = args.get("_agent_name", "")
            mem_id = save_memory(content, sector=sector, agent_name=agent_name, salience=salience)
            result = {"ok": True, "memory_id": mem_id, "sector": sector, "message": "Memoria guardada"}

    # ── Web research ──
    elif name == "web_search":
        query = args.get("query", "")
        if not query:
            result = {"error": "No query provided"}
        else:
            result = await _web_search(query)

    elif name == "web_fetch":
        url = args.get("url", "")
        if not url:
            result = {"error": "No URL provided"}
        else:
            result = await _web_fetch(url)

    # ── Control Center tools ──
    elif name == "cc_list_projects":
        result = await _cc_request("GET", "/api/projects")

    elif name == "cc_create_project":
        body: dict[str, Any] = {"name": args.get("name", "")}
        if args.get("description"):
            body["description"] = args["description"]
        if args.get("priority"):
            body["priority"] = args["priority"]
        if args.get("phase"):
            body["phase"] = args["phase"]
        result = await _cc_request("POST", "/api/projects", body)

    elif name == "cc_update_project":
        project_id = args.get("project_id", "")
        if not project_id:
            result = {"error": "project_id is required"}
        else:
            body = {}
            for field in ("name", "description", "phase", "priority"):
                if args.get(field) is not None:
                    body[field] = args[field]
            for field in ("paused", "completed", "autopilot"):
                if args.get(field) is not None:
                    body[field] = args[field]
            result = await _cc_request("PATCH", f"/api/projects/{project_id}", body)

    elif name == "cc_list_features":
        project_id = args.get("project_id", "")
        result = await _cc_request("GET", "/api/features", params={"project_id": project_id})

    elif name == "cc_create_feature":
        body = {
            "project_id": args.get("project_id", ""),
            "description": args.get("description", ""),
        }
        if args.get("objective"):
            body["objective"] = args["objective"]
        if args.get("priority"):
            body["priority"] = args["priority"]
        result = await _cc_request("POST", "/api/features", body)

    elif name == "cc_create_task":
        body = {"description": args.get("description", "")}
        if args.get("feature_id"):
            body["feature_id"] = args["feature_id"]
        if args.get("project_id"):
            body["project_id"] = args["project_id"]
        result = await _cc_request("POST", "/api/tasks", body)

    elif name == "cc_update_feature":
        feature_id = args.get("feature_id", "")
        if not feature_id:
            result = {"error": "feature_id is required"}
        else:
            body = {}
            for field in ("description", "objective", "acceptance_criteria", "phase", "priority"):
                if args.get(field) is not None:
                    body[field] = args[field]
            for field in ("autopilot", "completed"):
                if args.get(field) is not None:
                    body[field] = args[field]
            result = await _cc_request("PATCH", f"/api/features/{feature_id}", body)

    elif name == "cc_list_tasks":
        params = {}
        if args.get("project_id"):
            params["project_id"] = args["project_id"]
        if args.get("feature_id"):
            params["feature_id"] = args["feature_id"]
        result = await _cc_request("GET", "/api/tasks", params=params)

    elif name == "cc_update_task":
        task_id = args.get("task_id", "")
        if not task_id:
            result = {"error": "task_id is required"}
        else:
            body = {}
            for field in ("description", "feature_id", "project_id", "verification_status"):
                if args.get(field) is not None:
                    body[field] = args[field]
            if args.get("completed") is not None:
                body["completed"] = args["completed"]
            result = await _cc_request("PATCH", f"/api/tasks/{task_id}", body)

    elif name == "cc_decompose_project":
        project_id = args.get("project_id", "")
        if not project_id:
            result = {"error": "project_id is required"}
        else:
            result = await _cc_request("POST", f"/api/projects/{project_id}/decompose")

    elif name == "cc_list_autopilot_queue":
        params = {}
        if args.get("status"):
            params["status"] = args["status"]
        result = await _cc_request("GET", "/api/autopilot/queue", params=params)

    elif name == "cc_retry_autopilot_task":
        item_id = args.get("item_id", "")
        if not item_id:
            result = {"error": "item_id is required"}
        else:
            result = await _cc_request("POST", f"/api/autopilot/queue/{item_id}/retry")

    elif name == "cc_create_note":
        body = {"title": args.get("title", ""), "content": args.get("content", "")}
        if args.get("tags"):
            body["tags"] = args["tags"]
        if args.get("project_id"):
            body["project_id"] = args["project_id"]
        if args.get("pinned") is not None:
            body["pinned"] = args["pinned"]
        result = await _cc_request("POST", "/api/notes", body)

    elif name == "cc_search_notes":
        params = {}
        if args.get("search"):
            params["search"] = args["search"]
        if args.get("tags"):
            params["tags"] = args["tags"]
        if args.get("project_id"):
            params["project_id"] = args["project_id"]
        if args.get("pinned") is not None:
            params["pinned"] = args["pinned"]
        result = await _cc_request("GET", "/api/notes", params=params)

    elif name == "cc_read_note":
        note_id = args.get("note_id", "")
        if not note_id:
            result = {"error": "note_id is required"}
        else:
            result = await _cc_request("GET", f"/api/notes/{note_id}")

    elif name == "cc_update_note":
        note_id = args.get("note_id", "")
        if not note_id:
            result = {"error": "note_id is required"}
        else:
            body = {}
            for field in ("title", "content", "tags", "project_id"):
                if args.get(field) is not None:
                    body[field] = args[field]
            if args.get("pinned") is not None:
                body["pinned"] = args["pinned"]
            result = await _cc_request("PATCH", f"/api/notes/{note_id}", body)

    elif name == "cc_create_alert":
        body = {"title": args.get("title", "")}
        if args.get("description"):
            body["description"] = args["description"]
        if args.get("severity"):
            body["severity"] = args["severity"]
        if args.get("category"):
            body["category"] = args["category"]
        if args.get("action"):
            body["action"] = args["action"]
        result = await _cc_request("POST", "/api/alerts", body)

    elif name == "cc_list_alerts":
        params = {}
        if args.get("severity"):
            params["severity"] = args["severity"]
        if args.get("category"):
            params["category"] = args["category"]
        if args.get("dismissed") is not None:
            params["dismissed"] = args["dismissed"]
        if args.get("limit"):
            params["limit"] = args["limit"]
        result = await _cc_request("GET", "/api/alerts", params=params)

    elif name == "cc_dismiss_alert":
        alert_id = args.get("alert_id", "")
        if not alert_id:
            result = {"error": "alert_id is required"}
        else:
            result = await _cc_request("PATCH", f"/api/alerts/{alert_id}/dismiss")

    # ── Action Items ──
    elif name == "cc_create_action_item":
        body = {"title": args.get("title", ""), "detail": args.get("detail", "")}
        for field in ("estimated_impact", "category", "priority", "finding_id"):
            if args.get(field):
                body[field] = args[field]
        body["advisor_key"] = args.get("advisor_key", advisor_key or "")
        result = await _cc_request("POST", "/api/action-items", body)

    elif name == "cc_list_action_items":
        params = {}
        if args.get("status"):
            params["status"] = args["status"]
        if args.get("limit"):
            params["limit"] = args["limit"]
        result = await _cc_request("GET", "/api/action-items", params=params)

    elif name == "cc_comment_action_item":
        action_item_id = args.get("action_item_id", "")
        if not action_item_id:
            result = {"error": "action_item_id is required"}
        else:
            body = {
                "author": advisor_key or "advisor",
                "content": args.get("content", ""),
            }
            result = await _cc_request("POST", f"/api/action-items/{action_item_id}/comments", body)

    elif name == "cc_delete_note":
        note_id = args.get("note_id", "")
        if not note_id:
            result = {"error": "note_id is required"}
        else:
            result = await _cc_request("GET", f"/api/notes/{note_id}")
            if "error" not in result:
                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        resp = await client.delete(f"{CONTROL_CENTER_URL}/api/notes/{note_id}")
                        if resp.status_code in (200, 204):
                            result = {"ok": True, "message": f"Note {note_id} deleted"}
                        else:
                            result = {"error": f"HTTP {resp.status_code}"}
                except Exception as e:
                    result = {"error": str(e)[:300]}

    elif name == "cc_delete_task":
        task_id = args.get("task_id", "")
        if not task_id:
            result = {"error": "task_id is required"}
        else:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.delete(f"{CONTROL_CENTER_URL}/api/tasks/{task_id}")
                    if resp.status_code in (200, 204):
                        result = {"ok": True, "message": f"Task {task_id} deleted"}
                    else:
                        result = {"error": f"HTTP {resp.status_code}"}
            except Exception as e:
                result = {"error": str(e)[:300]}

    # ── PIM tools (direct, not via hub) ──
    elif name == "pim_search_products":
        query = args.get("search", "")
        if not query:
            result = {"error": "search term is required"}
        else:
            params = {"q": query, "limit": args.get("limit", 20)}
            result = await _pim_fetch("/api/ai/db/search", params)

    elif name == "pim_get_product":
        product_id = args.get("product_id")
        if not product_id:
            result = {"error": "product_id is required"}
        else:
            result = await _pim_fetch(f"/api/ai/db/product/{product_id}")

    elif name == "pim_get_inventory":
        result = await _pim_fetch("/api/operational/inventory")

    elif name == "pim_get_sales_ytd":
        result = await _pim_fetch("/api/operational/sales/ytd")

    elif name == "pim_get_quality_score":
        product_id = args.get("product_id")
        if not product_id:
            result = {"error": "product_id is required"}
        else:
            channel = args.get("channel", "")
            if channel:
                result = await _pim_fetch(f"/api/quality/products/{product_id}/score/{channel}")
            else:
                result = await _pim_fetch(f"/api/quality/products/{product_id}/score")

    # ── Telegram ──
    elif name == "send_telegram_notification":
        msg_text = args.get("message", "")
        if not msg_text:
            result = {"error": "No message provided"}
        elif not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
            result = {"error": "Telegram credentials not configured"}
        else:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                        json={"chat_id": TELEGRAM_CHAT_ID, "text": msg_text, "parse_mode": "HTML"},
                    )
                    if resp.status_code == 200:
                        result = {"ok": True, "message": "Notification sent to Telegram"}
                    else:
                        result = {"error": f"Telegram API returned {resp.status_code}", "detail": resp.text[:300]}
            except Exception as e:
                result = {"error": f"Failed to send Telegram message: {str(e)[:200]}"}

    # ── Daily Business Pulse tools ──
    elif name == "pulse_today":
        result = await _cc_request("GET", "/api/pulse/today")

    elif name == "pulse_latest":
        result = await _cc_request("GET", "/api/pulse/latest")

    elif name == "pulse_history":
        params = {}
        if args.get("limit"):
            params["limit"] = args["limit"]
        result = await _cc_request("GET", "/api/pulse/history", params=params)

    elif name == "pulse_briefing":
        result = await _cc_request("GET", "/api/pulse/briefing")

    elif name == "pulse_advisors_overnight":
        result = await _cc_request("GET", "/api/pulse/advisors-overnight")

    elif name == "pulse_modules":
        result = await _cc_request("GET", "/api/pulse/modules")

    # ── Journal tools ──
    elif name == "journal_list_entries":
        params: dict[str, Any] = {}
        if args.get("search"):
            params["search"] = args["search"]
        if args.get("mood"):
            params["mood"] = args["mood"]
        if args.get("tags"):
            params["tags"] = args["tags"]
        params["limit"] = args.get("limit", 10)
        result = await _cc_request("GET", "/api/journal", params=params)

    elif name == "journal_get_entry":
        date = args.get("date", "")
        if not date:
            result = {"error": "date is required (YYYY-MM-DD)"}
        else:
            result = await _cc_request("GET", f"/api/journal/{date}")

    elif name == "journal_create_entry":
        content = args.get("content", "")
        if not content:
            result = {"error": "content is required"}
        else:
            from datetime import date as date_type
            entry_date = args.get("date", date_type.today().isoformat())
            body = {"content": content}
            if args.get("mood"):
                body["mood"] = args["mood"]
            if args.get("tags"):
                body["tags"] = args["tags"]
            result = await _cc_request("PUT", f"/api/journal/{entry_date}", body)

    # ── Scheduler management tools ──
    elif name == "scheduler_list_tasks":
        params = {}
        if args.get("status"):
            params["status"] = args["status"]
        result = await _cc_request("GET", "/api/scheduler/tasks", params=params)

    elif name == "scheduler_create_task":
        prompt = args.get("prompt", "")
        schedule = args.get("schedule", "")
        if not prompt or not schedule:
            result = {"error": "prompt and schedule are required"}
        else:
            result = await _cc_request("POST", "/api/scheduler/tasks", {"prompt": prompt, "schedule": schedule})

    elif name == "scheduler_pause_task":
        task_id = args.get("task_id", "")
        if not task_id:
            result = {"error": "task_id is required"}
        else:
            result = await _cc_request("POST", f"/api/scheduler/tasks/{task_id}/pause")

    elif name == "scheduler_resume_task":
        task_id = args.get("task_id", "")
        if not task_id:
            result = {"error": "task_id is required"}
        else:
            result = await _cc_request("POST", f"/api/scheduler/tasks/{task_id}/resume")

    elif name == "scheduler_delete_task":
        task_id = args.get("task_id", "")
        if not task_id:
            result = {"error": "task_id is required"}
        else:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.delete(f"{CONTROL_CENTER_URL}/api/scheduler/tasks/{task_id}")
                    if resp.status_code in (200, 204):
                        result = {"ok": True, "message": f"Scheduled task {task_id} deleted"}
                    else:
                        result = {"error": f"HTTP {resp.status_code}", "detail": resp.text[:300]}
            except Exception as e:
                result = {"error": str(e)[:300]}

    # ── Discovery Loop control ──
    elif name == "discovery_trigger_run":
        result = await _cc_request("POST", "/api/advisor/discover", params={"triggered_by": "manual"})

    elif name == "discovery_get_history":
        params = {"limit": args.get("limit", 10)}
        result = await _cc_request("GET", "/api/advisor/discover/history", params=params)

    elif name == "discovery_get_findings":
        params = {}
        if args.get("severity"):
            params["severity"] = args["severity"]
        if args.get("run_id"):
            params["run_id"] = args["run_id"]
        params["limit"] = args.get("limit", 20)
        result = await _cc_request("GET", "/api/advisor/discover/findings", params=params)

    # ── Exchange rate (FX) ──
    elif name == "query_exchange_rate":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get("https://open.er-api.com/v6/latest/USD")
                if resp.status_code == 200:
                    data = resp.json()
                    mxn = data.get("rates", {}).get("MXN", 0)
                    result = {
                        "usd_mxn": mxn,
                        "last_update": data.get("time_last_update_utc", ""),
                        "source": "open.er-api.com",
                    }
                else:
                    result = {"error": f"FX API HTTP {resp.status_code}"}
        except Exception as e:
            result = {"error": f"FX fetch failed: {str(e)[:200]}"}

    # ── Weather ──
    elif name == "query_weather":
        city = args.get("city", "Monterrey")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"https://wttr.in/{city}?format=j1")
                if resp.status_code == 200:
                    data = resp.json()
                    current = data.get("current_condition", [{}])[0]
                    forecast = data.get("weather", [])[:3]
                    result = {
                        "city": city,
                        "current": {
                            "temp_c": current.get("temp_C"),
                            "feels_like_c": current.get("FeelsLikeC"),
                            "description": current.get("lang_es", [{}])[0].get("value", current.get("weatherDesc", [{}])[0].get("value", "")),
                            "humidity": current.get("humidity"),
                            "wind_kmph": current.get("windspeedKmph"),
                        },
                        "forecast": [
                            {
                                "date": day.get("date"),
                                "max_c": day.get("maxtempC"),
                                "min_c": day.get("mintempC"),
                                "description": day.get("hourly", [{}])[4].get("lang_es", [{}])[0].get("value", "") if day.get("hourly") else "",
                            }
                            for day in forecast
                        ],
                    }
                else:
                    result = {"error": f"Weather API HTTP {resp.status_code}"}
        except Exception as e:
            result = {"error": f"Weather fetch failed: {str(e)[:200]}"}

    # ── API Cost tracking ──
    elif name == "query_api_costs":
        period = args.get("period", "today")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{COST_TRACKER_URL}/api/summary", params={"period": period})
                if resp.status_code == 200:
                    result = resp.json()
                else:
                    result = {"error": f"Cost tracker HTTP {resp.status_code}"}
        except httpx.ConnectError:
            result = {"error": "Cannot connect to cost tracker service"}
        except Exception as e:
            result = {"error": f"Cost query failed: {str(e)[:200]}"}

    # ── Research tools ──
    elif name == "research_list":
        result = await _cc_request("GET", "/api/research")

    elif name == "research_read":
        report_id = args.get("report_id", "")
        if not report_id:
            result = {"error": "report_id is required"}
        else:
            result = await _cc_request("GET", f"/api/research/{report_id}")

    elif name == "research_query":
        query = args.get("query", "")
        if not query:
            result = {"error": "query is required"}
        else:
            model = args.get("model", "sonar")
            result = await _cc_request("POST", "/api/research", {"query": query, "model": model})

    else:
        result = {"error": f"Unknown tool: {name}"}

    # Truncate large results to avoid blowing up context
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > 8000:
        text = text[:8000] + "... [truncated]"
    return text


# ── Cost tracker integration ──────────────────────────────────


async def log_cost(
    api_name: str,
    endpoint: str,
    tokens_in: int,
    tokens_out: int,
    cached_tokens_in: int = 0,
    project_name: str = "ClaudeClaw Advisors",
    notes: str = "",
) -> None:
    """Log an API call cost to the cost tracker."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{COST_TRACKER_URL}/api/log_request",
                json={
                    "api_name": api_name,
                    "endpoint": endpoint,
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "cached_tokens_in": cached_tokens_in,
                    "project_name": project_name,
                    "notes": notes,
                },
            )
    except Exception:
        pass
