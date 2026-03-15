# Landing Page A/B Autoresearch — Design Plan

## Objetivo

Sistema que genera variantes A/B de landing pages para productos OYD's/Noveltia,
captura leads (WhatsApp/email), redirige a marketplaces (HD/Amazon/ML), y
auto-optimiza las variantes basándose en métricas de conversión. Mismo patrón
que el autoresearch de Seeking Alpha pero aplicado a marketing.

## Arquitectura

El sistema vive en el **Proyecto PIM** (ya tiene modelos LandingPage, API pública,
y datos de productos). Se agregan 3 módulos nuevos:

```
Proyecto PIM/backend/
├── models.py              # Ya tiene: LandingPage, LandingPageProduct, LandingPageSection
├── ab_testing/            # NUEVO
│   ├── __init__.py
│   ├── models.py          # ABExperiment, ABVariant, ABEvent, ABOptimizationRun
│   ├── schemas.py         # Pydantic schemas
│   ├── repository.py      # CRUD SQLAlchemy
│   ├── analyzer.py        # Calcular métricas por variante (CTR, conversion, bounce)
│   ├── optimizer.py       # Ajustar traffic split basado en resultados
│   ├── loop.py            # Orquestador: analyze -> optimize -> report
│   └── generator.py       # Generar variantes A/B con IA (copy, CTA, layout)
├── api/routers/
│   ├── ab_testing.py      # Admin endpoints (crear experimento, ver resultados)
│   └── ab_public.py       # Público: servir variante + registrar eventos
```

## Modelos de Datos

### ABExperiment
```
id, name, landing_page_id (FK), status (draft/running/paused/completed),
traffic_split (JSON: {"A": 0.5, "B": 0.5}),
goal_metric (clicks/leads/redirects), min_events_for_optimization (100),
created_at, started_at, completed_at
```

### ABVariant
```
id, experiment_id (FK), variant_key ("A"/"B"/"C"),
config_overrides (JSON): {
  "cta_text": "Comprar en Home Depot",
  "cta_url": "https://homedepot.com.mx/...",
  "headline": "Protege tu hogar con tecnología inteligente",
  "theme": "dark",
  "layout": "hero-feature",
  "show_prices": true,
  "badge": "Más vendido"
},
is_control (bool), created_at
```

### ABEvent
```
id, experiment_id, variant_key, event_type (view/click/lead/redirect),
session_id (cookie), utm_source, utm_medium, utm_campaign,
lead_data (JSON: {email, whatsapp, name}),
user_agent, ip_hash, created_at
```

### ABOptimizationRun
```
id, experiment_id, run_date,
old_split (JSON), new_split (JSON),
metrics_per_variant (JSON), winning_variant,
total_events, trigger (scheduled/manual)
```

## Flujo

### 1. Crear Experimento
- Admin selecciona un landing page existente del PIM
- El generador IA (Claude) crea 2-3 variantes del copy/CTA/layout
- Cada variante se guarda como ABVariant con sus config_overrides
- Traffic split inicial: 50/50 (o 33/33/33)

### 2. Servir Variantes (API pública)
- `GET /api/public/ab/{slug}` - determina variante según cookie + traffic split
- Retorna la landing page con los overrides de la variante aplicados
- Registra evento "view" automáticamente

### 3. Registrar Eventos
- `POST /api/public/ab/{slug}/event` - click, lead capture, redirect
- Lead capture: guarda email/WhatsApp en lead_data
- Redirect: registra click hacia marketplace destino

### 4. Auto-Optimize (Loop semanal)
Mismo patrón que SA autoresearch:
```
1. Recopilar métricas por variante (CTR, lead_rate, redirect_rate)
2. Si total_events < min_events (100): skip
3. Calcular winning variant por goal_metric
4. Ajustar traffic_split: incrementar ganador en 10%, decrementar perdedor
5. Constraints: min 10% traffic por variante (nunca eliminar del todo)
6. Blend factor 0.3 (conservador, igual que SA)
7. Guardar ABOptimizationRun
8. Notificar por Telegram: "Variante B ganando +23% CTR, ajustando tráfico"
```

### 5. Reportes
- Dashboard en PIM frontend con métricas por experimento
- Telegram: resumen semanal de performance

## Dimensiones A/B Testables

| Dimensión | Variantes ejemplo |
|-----------|-------------------|
| headline | "Protege tu hogar" vs "Seguridad inteligente" vs "Cámara WiFi 3MP" |
| cta_text | "Ver en Home Depot" vs "Comprar ahora" vs "Cotizar" |
| cta_url | homedepot.com.mx vs amazon.com.mx vs whatsapp directo |
| theme | dark vs light |
| layout | hero-feature vs grid vs minimal |
| show_prices | true vs false |
| badge | "Más vendido" vs "Nuevo" vs ninguno |
| image_style | lifestyle vs producto puro vs infografía |

## Implementación por Waves

### Wave 1: Foundation (modelos + API admin)
- Modelos SQLAlchemy: ABExperiment, ABVariant, ABEvent, ABOptimizationRun
- Migración Alembic
- Schemas Pydantic
- Repository CRUD
- Router admin: crear/listar/pausar experimentos
- Tests unitarios

### Wave 2: Public API + Variant Serving
- Endpoint público que sirve variante según cookie + split
- Registro de eventos (view, click, lead, redirect)
- Lead capture con validación
- Middleware de tracking (session_id cookie)
- UTM parameter parsing

### Wave 3: AI Variant Generator
- Integración con Claude para generar variantes de copy
- Input: producto del PIM (descripción, bullets, imágenes)
- Output: 2-3 variantes con headline, CTA, layout sugerido
- Usar banana-squad/lovart para variantes de imagen si aplica

### Wave 4: Autoresearch Loop
- Analyzer: calcular métricas por variante
- Optimizer: ajustar traffic split con constraints
- Loop orchestrator: scheduled via cron (semanal)
- Notificaciones Telegram
- Cron en claudeclaw: `0 9 * * 1` (lunes 9am)

### Wave 5: Dashboard + Reporting
- Componentes React en PIM frontend
- Gráficas de performance por variante
- Tabla de optimization runs
- Export de leads

## Integración con Infraestructura Existente

- **PIM**: Productos, landing pages, API pública (ya existe)
- **ClaudeClaw**: Cron scheduling, notificaciones Telegram
- **Banana Squad**: Generar variantes de imagen
- **Hive Mind**: Publicar resultados para otros agentes
- **Cash Flow**: Vincular leads convertidos con revenue

## Métricas de Éxito

- CTR (Click-Through Rate): clicks / views
- Lead Rate: leads capturados / views
- Redirect Rate: redirects a marketplace / views
- Cost per Lead: inversión ads / leads
- Conversion Attribution: leads que llegan a comprar (via UTM tracking)
