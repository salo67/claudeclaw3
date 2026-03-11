# APIs Lloyds - Documentacion de Endpoints

Referencia completa de las 5 APIs internas con URLs, metodos, parametros, autenticacion y ejemplos de respuesta JSON.

---

## Indice

1. [Stockout Zero Platform (puerto 8021)](#1-stockout-zero-platform-puerto-8021)
2. [Monitor de Margenes (puerto 8180)](#2-monitor-de-margenes-puerto-8180)
3. [Lloyds Forecast (puerto 8009)](#3-lloyds-forecast-puerto-8009)
4. [Dashboard HD Cientifico (puerto 8002)](#4-dashboard-hd-cientifico-puerto-8002)
5. [Scheduler API (puerto 8020)](#5-scheduler-api-puerto-8020)

---

## 1. Stockout Zero Platform (puerto 8021)

**Proyecto:** `codigo-Stockout-Zero-Platform`
**Framework:** FastAPI
**Base URL:** `http://localhost:8021`
**Base API:** `http://localhost:8021/api/v1`

### Autenticacion

| Campo | Valor |
|-------|-------|
| Tipo | JWT Bearer Token |
| Header | `Authorization: Bearer <access_token>` |
| Login | `POST /api/v1/auth/login` con email + password |
| Google | `POST /api/v1/auth/google` con Google ID token |
| Refresh | `POST /api/v1/auth/refresh` |

**Endpoints publicos (sin auth):** `/health`, `/health/db`, `/api/v1/auth/login`, `/api/v1/auth/google`, `/api/v1/seed`, `/api/v1/seed-projections`, `/ws`

---

### 1.1 Auth (`/api/v1/auth`)

| Endpoint | Metodo | Auth | Descripcion |
|----------|--------|------|-------------|
| `/api/v1/auth/register` | POST | Admin | Registrar nuevo usuario |
| `/api/v1/auth/login` | POST | No | Login email/password |
| `/api/v1/auth/google` | POST | No | Login Google OAuth |
| `/api/v1/auth/refresh` | POST | No | Refrescar token |
| `/api/v1/auth/logout` | POST | Si | Cerrar sesion |
| `/api/v1/auth/me` | GET | Si | Info del usuario actual |

**Login - Request:**
```json
{ "email": "usuario@lloyds.com", "password": "mipassword" }
```

**Login - Response:**
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "token_type": "bearer"
}
```

**Me - Response:**
```json
{
  "id": 1,
  "email": "usuario@lloyds.com",
  "full_name": "Nombre Completo",
  "is_active": true,
  "is_admin": false,
  "auth_provider": "local",
  "created_at": "2025-03-01T10:00:00Z"
}
```

---

### 1.2 Cashflow (`/api/v1/cashflow`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/v1/cashflow/summary` | GET | - | Resumen de flujo con proyecciones |
| `/api/v1/cashflow/transactions` | GET | `transaction_type?`, `status_filter?`, `start_date?`, `end_date?`, `limit=100`, `offset=0` | Listar transacciones |
| `/api/v1/cashflow/transactions` | POST | Body: TransactionCreate | Crear transaccion |
| `/api/v1/cashflow/transactions/{id}` | GET | - | Detalle de transaccion |
| `/api/v1/cashflow/transactions/{id}` | PATCH | Body: TransactionUpdate | Actualizar transaccion |
| `/api/v1/cashflow/transactions/{id}` | DELETE | - | Eliminar transaccion |
| `/api/v1/cashflow/projections` | GET | `scenario?=realistic`, `days?=90` | Proyecciones de caja |
| `/api/v1/cashflow/alerts` | GET | `active_only?=true`, `severity?` | Alertas de flujo |
| `/api/v1/cashflow/alerts/{id}/acknowledge` | POST | - | Reconocer alerta |
| `/api/v1/cashflow/simulate` | POST | Body: WhatIfSimulation | Simulacion what-if |

**Summary - Response:**
```json
{
  "current_balance": 1500000.00,
  "projected_30_days": 1200000.00,
  "projected_60_days": 980000.00,
  "projected_90_days": 850000.00,
  "pending_inflows": 2000000.00,
  "pending_outflows": 1800000.00,
  "critical_alerts": 2,
  "currency": "MXN"
}
```

**Transaction - Response:**
```json
{
  "id": 1,
  "project_id": 1,
  "type": "INCOME",
  "status": "PENDING",
  "amount": 150000.00,
  "currency": "MXN",
  "description": "Pago HD factura 1234",
  "category": "ventas",
  "counterparty": "Home Depot",
  "expected_date": "2025-03-15",
  "probability": 0.95,
  "reference": "FAC-1234",
  "notes": "",
  "created_at": "2025-03-01T10:00:00Z",
  "updated_at": "2025-03-01T10:00:00Z"
}
```

---

### 1.3 Inventario (`/api/v1/inventory`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/v1/inventory/summary` | GET | - | Resumen de inventario |
| `/api/v1/inventory/items` | GET | `status_filter?`, `category?`, `search?`, `sort_by?=name`, `sort_order?=asc`, `limit=100`, `offset=0` | Listar items |
| `/api/v1/inventory/items` | POST | Body: InventoryItemCreate | Crear item |
| `/api/v1/inventory/items/{id}` | GET | - | Detalle de item |
| `/api/v1/inventory/items/{id}` | PATCH | Body: InventoryItemUpdate | Actualizar item |
| `/api/v1/inventory/items/{id}` | DELETE | - | Eliminar item |
| `/api/v1/inventory/allocations` | GET | `active_only?=true`, `priority?` | Recomendaciones de capital |
| `/api/v1/inventory/categories` | GET | - | Categorias unicas |

**Summary - Response:**
```json
{
  "total_items": 250,
  "total_capital_invested": 5000000.00,
  "items_low_stock": 15,
  "items_out_of_stock": 3,
  "average_turnover_rate": 4.5
}
```

**Item - Response:**
```json
{
  "id": 1,
  "sku": "OYD-TORCH-001",
  "name": "Antorcha Solar OYD",
  "category": "Iluminacion",
  "brand": "OYD",
  "current_stock": 500,
  "min_stock_level": 100,
  "max_stock_level": 2000,
  "reorder_point": 200,
  "unit_cost": 85.50,
  "unit_price": 299.00,
  "capital_invested": 42750.00,
  "currency": "MXN",
  "lead_time_days": 105,
  "status": "ACTIVE",
  "turnover_rate": 4.2,
  "last_movement_date": "2025-02-28T10:00:00Z"
}
```

---

### 1.4 Ordenes de Compra (`/api/v1/orders`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/v1/orders/summary` | GET | - | Resumen de ordenes |
| `/api/v1/orders/` | GET | `status_filter?`, `payment_status?`, `supplier?`, `start_date?`, `end_date?`, `limit=100`, `offset=0` | Listar ordenes |
| `/api/v1/orders/` | POST | Body: PurchaseOrderCreate | Crear orden |
| `/api/v1/orders/{id}` | GET | - | Detalle de orden |
| `/api/v1/orders/{id}` | PATCH | Body: PurchaseOrderUpdate | Actualizar orden |
| `/api/v1/orders/{id}` | DELETE | - | Eliminar borrador |
| `/api/v1/orders/{id}/tracking` | GET | - | Historial de tracking |
| `/api/v1/orders/{id}/tracking` | POST | Body: `{status_val, description, location?}` | Agregar evento |

**Summary - Response:**
```json
{
  "total_orders": 25,
  "pending_orders": 8,
  "in_transit_orders": 5,
  "total_pending_value": 3500000.00,
  "currency": "MXN"
}
```

**Status values:** `DRAFT`, `SUBMITTED`, `CONFIRMED`, `IN_PRODUCTION`, `SHIPPED`, `IN_TRANSIT`, `DELIVERED`, `CANCELLED`
**Payment status:** `PENDING`, `PARTIAL`, `PAID`

---

### 1.5 Workflows y Predicciones (`/api/v1/workflows`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/v1/workflows/runs` | GET | `workflow_type?`, `status_filter?`, `limit=50`, `offset=0` | Listar ejecuciones |
| `/api/v1/workflows/runs/{id}` | GET | - | Detalle de ejecucion |
| `/api/v1/workflows/runs/{type}/trigger` | POST | - | Ejecutar workflow manual |
| `/api/v1/workflows/predictions/summary` | GET | - | Resumen de predicciones |
| `/api/v1/workflows/predictions` | GET | `item_id?`, `start_date?`, `end_date?`, `limit=100`, `offset=0` | Listar predicciones |
| `/api/v1/workflows/predictions/{id}/history` | GET | `days?=90` | Historial por item |
| `/api/v1/workflows/predictions/chart-data` | GET | `item_ids?=[]`, `weeks?=8` | Data para graficas |
| `/api/v1/workflows/predictions/sku-risk` | GET | `risk_filter?`, `limit=50` | SKUs en riesgo |
| `/api/v1/workflows/alerts` | GET | `active_only?=true`, `risk_level?`, `limit=100`, `offset=0` | Alertas de stockout |
| `/api/v1/workflows/alerts/{id}` | GET | - | Detalle de alerta |
| `/api/v1/workflows/alerts/{id}/acknowledge` | POST | - | Reconocer alerta |
| `/api/v1/workflows/alerts/{id}/dismiss` | POST | `resolution_notes?` | Descartar alerta |

**Alerta de Stockout - Response:**
```json
{
  "id": 1,
  "inventory_item_id": 42,
  "title": "Riesgo de stockout: Antorcha Solar",
  "message": "Stock actual insuficiente para cubrir demanda proyectada",
  "risk_level": "HIGH",
  "current_stock": 50,
  "predicted_demand": 200,
  "days_until_stockout": 12,
  "stockout_probability": 0.85,
  "suggested_action": "Crear orden de compra urgente",
  "is_active": true,
  "is_acknowledged": false,
  "created_at": "2025-03-01T10:00:00Z"
}
```

**SKU Risk - Response:**
```json
{
  "items": [
    {
      "id": 42,
      "sku": "OYD-TORCH-001",
      "name": "Antorcha Solar OYD",
      "current_stock": 50,
      "predicted_demand": 200,
      "days_until_stockout": 12,
      "risk_level": "HIGH",
      "stockout_probability": 0.85,
      "recommended_action": "Orden urgente"
    }
  ],
  "total_at_risk": 15,
  "critical_count": 5,
  "high_count": 10
}
```

---

### 1.6 Dashboard (`/api/v1/dashboard`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/v1/dashboard/kpis` | GET | - | KPIs principales |
| `/api/v1/dashboard/timeline` | GET | `days?=7` | Eventos proximos |
| `/api/v1/dashboard/system-status` | GET | - | Estado del sistema |

**KPIs - Response:**
```json
{
  "current_cash_balance": 1500000.00,
  "projected_30_days": 1200000.00,
  "cash_trend": "down",
  "total_capital_in_inventory": 5000000.00,
  "items_low_stock": 15,
  "items_out_of_stock": 3,
  "pending_orders": 8,
  "total_pending_value": 3500000.00,
  "orders_in_transit": 5,
  "critical_alerts": 2,
  "high_alerts": 8,
  "stockout_risks": 15,
  "active_workflows": 3,
  "last_sync": "2025-03-01T10:00:00Z",
  "system_health": "healthy",
  "currency": "MXN"
}
```

---

### 1.7 Scheduler (`/api/v1/scheduler`)

| Endpoint | Metodo | Auth | Descripcion |
|----------|--------|------|-------------|
| `/api/v1/scheduler/summary` | GET | Si | Resumen del scheduler |
| `/api/v1/scheduler/jobs` | GET | Si | Listar jobs |
| `/api/v1/scheduler/jobs` | POST | Admin | Crear job |
| `/api/v1/scheduler/jobs/{id}` | GET | Si | Detalle de job |
| `/api/v1/scheduler/jobs/{id}` | PATCH | Admin | Actualizar job |
| `/api/v1/scheduler/jobs/{id}` | DELETE | Admin | Eliminar job |
| `/api/v1/scheduler/jobs/{id}/run` | POST | Admin | Ejecutar job ahora |
| `/api/v1/scheduler/jobs/{id}/pause` | POST | Admin | Pausar job |
| `/api/v1/scheduler/jobs/{id}/resume` | POST | Admin | Reanudar job |
| `/api/v1/scheduler/jobs/{id}/logs` | GET | Si | Logs del job |
| `/api/v1/scheduler/logs` | GET | Si | Todos los logs |

**Job types:** `RADAR_SEMANAL`, `ALERTA_TEMPRANA`, `CASH_PROJECTION`
**Trigger types:** `CRON`, `INTERVAL`

---

### 1.8 Admin (`/api/v1/admin`)

| Endpoint | Metodo | Auth | Descripcion |
|----------|--------|------|-------------|
| `/api/v1/admin/summary` | GET | Si | Resumen admin |
| `/api/v1/admin/thresholds` | GET | Si | Umbrales de alerta |
| `/api/v1/admin/thresholds/{type}` | PUT | Si | Actualizar umbral |
| `/api/v1/admin/thresholds/reset` | POST | Admin | Reset a defaults |
| `/api/v1/admin/logs` | GET | Si | Logs del sistema |
| `/api/v1/admin/audit/run` | POST | Admin | Ejecutar auditoria |
| `/api/v1/admin/audit/history` | GET | Si | Historial de auditorias |

**Threshold types:** `CASH_CRITICAL`, `LOW_STOCK_WARNING`, `STOCKOUT_PROBABILITY`, `INVENTORY_CAPITAL_LIMIT`

---

### 1.9 Health y WebSocket

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/health` | GET | Health check basico |
| `/health/db` | GET | Check de base de datos |
| `/ws?token=<jwt>` | WS | WebSocket para actualizaciones en tiempo real |

**Eventos WebSocket:** `connected`, `alert`, `critical_alert`, `job_complete`

---

## 2. Monitor de Margenes (puerto 8180)

**Proyecto:** `codigo-Monitor-De-Margenes-De-Utilidad`
**Framework:** FastAPI
**Base URL:** `http://localhost:8180`

### Autenticacion

| Campo | Valor |
|-------|-------|
| Tipo | JWT Bearer Token (Google OAuth) |
| Login | `POST /api/auth/google` con Google ID token |
| Header | `Authorization: Bearer <access_token>` |
| Expiracion | 24 horas |

**Endpoints publicos:** `/health`, `/api/auth/*`, `/api/margins/hq-summary`, `/api/margins/latest`, `/api/margins/product-margins`, `/api/margins/{sku}/monthly`, `/api/margins/summary`, `/api/margins/totals`, `/api/stockout/*`, `/api/supply-tracker/*`, `/api/calcular-margenes/*`, `/api/webhooks/*`

---

### 2.1 Auth (`/api/auth`)

| Endpoint | Metodo | Auth | Descripcion |
|----------|--------|------|-------------|
| `/api/auth/google` | POST | No | Login con Google |
| `/api/auth/me` | GET | Si | Info del usuario |

**Login - Request:**
```json
{ "credential": "google_id_token_aqui" }
```

**Login - Response:**
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "user": { "email": "user@lloyds.com", "name": "Nombre", "picture": "url" }
}
```

---

### 2.2 Productos (`/api/products`) - Auth requerida

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/products/top` | GET | `months` (1-12, default 6), `limit` (1-500, default 100) | Top productos por revenue |
| `/api/products/refresh-from-cube` | POST | `months`, `limit` | Refrescar desde cubo SSAS |
| `/api/products/{sku}` | GET | - | Detalle de producto |
| `/api/products/{sku}/margin` | GET | - | Margen detallado del producto |

**Producto - Response:**
```json
{
  "sku": "OYD-TORCH-001",
  "name": "Antorcha Solar OYD",
  "revenue_6m": 2500000.00,
  "quantity_6m": 8500,
  "unit_price": 299.00,
  "unit_cost": 85.50,
  "unit_expenses": 12.00,
  "unit_discounts": 5.50
}
```

---

### 2.3 Margenes (`/api/margins`) - Mixto publico/privado

| Endpoint | Metodo | Auth | Parametros | Descripcion |
|----------|--------|------|------------|-------------|
| `/api/margins/latest` | GET | No | `limit` (1-500, default 100) | Margenes actuales (frontend) |
| `/api/margins/product-margins` | GET | No | `limit` | Margenes con estado vacio graceful |
| `/api/margins/{sku}/monthly` | GET | No | `months` (1-12, default 6) | Tendencia mensual por SKU |
| `/api/margins/summary` | GET | No | - | Resumen de margenes |
| `/api/margins/totals` | GET | No | - | Totales dashboard |
| `/api/margins/` | GET | Si | `color` (green/yellow/orange/red), `limit` | Margenes con filtro |
| `/api/margins/{sku}` | GET | Si | - | Margen por SKU |
| `/api/margins/{sku}/history` | GET | Si | `days` (7-365, default 180) | Historial de margen |
| `/api/margins/calculate` | POST | Si | - | Disparar calculo de margenes |
| `/api/margins/hq-summary` | GET | No | - | Resumen consolidado para HQ |

**Latest - Response (cada item):**
```json
{
  "id": "uuid",
  "sku": "OYD-TORCH-001",
  "product_name": "Antorcha Solar OYD",
  "revenue_6m": 2500000.00,
  "utilidad_real_pct": 12.5,
  "utilidad_estimada_pct": 15.0,
  "pareto_class": "A",
  "contribution_pct": 3.5,
  "margin_color": "green",
  "calculated_at": "2025-03-01T10:00:00Z",
  "costo_sin_adfa": 85.50,
  "costo_con_adfa": 92.00,
  "impacto_adfa_pct": 7.6,
  "margen_objetivo_hd": 15.0,
  "desviacion_vs_hd": -2.5,
  "revision_necesaria": false,
  "categoria": "Iluminacion",
  "subcategoria": "Solar"
}
```

**Semaforo de colores:** Green >= 10%, Yellow 5-9.9%, Orange 0-4.9%, Red < 0%

**Summary - Response:**
```json
{
  "total": 100,
  "by_color": { "green": 45, "yellow": 25, "orange": 20, "red": 10 },
  "avg_margin": 8.5,
  "critical_count": 10
}
```

**HQ Summary - Response:**
```json
{
  "timestamp": "2025-03-01T10:00:00Z",
  "product_count": 100,
  "avg_margin_pct": 8.5,
  "risk_summary": { "green": 45, "yellow": 25, "orange": 20, "red": 10 },
  "at_risk_count": 30,
  "monthly_trend": [
    { "month": "2025-01", "avg_margin_pct": 9.2 },
    { "month": "2025-02", "avg_margin_pct": 8.5 }
  ],
  "worst_products": [
    { "sku": "SKU-X", "name": "Producto X", "margin_pct": -2.5, "color": "red", "recommendation": "Revisar pricing" }
  ]
}
```

---

### 2.4 Baselines (`/api/baseline`) - Auth requerida

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/baseline/` | GET | `limit` (1-500, default 100) | Targets de margen |
| `/api/baseline/deviations` | GET | `threshold` (0-10, default 3.0) | Productos con desviacion |
| `/api/baseline/upload` | POST | File: Excel (.xlsx) con SKU, Producto, Margen Objetivo (%) | Subir baseline |

---

### 2.5 Alertas (`/api/alerts`) - Auth requerida

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/alerts/` | GET | `channel?`, `severity?`, `days` (1-30, default 7), `limit` | Alertas recientes |
| `/api/alerts/summary` | GET | `days` (1-30, default 7) | Resumen de alertas |
| `/api/alerts/pending` | GET | - | Alertas no entregadas |

**Channels:** `radar_semanal`, `lloyds_hq`, `stockout_zero`
**Severities:** `critical`, `warning`, `info`

---

### 2.6 Integracion Stockout Zero (`/api/stockout`) - Publico

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/stockout/priorities` | GET | `color?`, `limit` | Prioridades de reorden |
| `/api/stockout/priorities/{sku}` | GET | - | Prioridad por SKU |
| `/api/stockout/update-priority` | POST | `{sku, margin_color, priority_level}` | Actualizar prioridad |
| `/api/stockout/sync-priorities` | POST | - | Sincronizar todas las prioridades |
| `/api/stockout/blocked-products` | GET | - | Productos bloqueados |

**Priority modifiers:** Red: -100 (block), Orange: -50, Yellow: -20, Green: +10/+20/+30

---

### 2.7 Integracion Supply Tracker (`/api/supply-tracker`) - Publico

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/supply-tracker/validate/{sku}` | GET | - | Validar margen antes de compra |
| `/api/supply-tracker/validate-purchase` | POST | `{sku, quantity, unit_cost?}` | Validar orden de compra |
| `/api/supply-tracker/validate-batch` | POST | `{skus: ["SKU1", "SKU2"]}` | Validar multiples SKUs |
| `/api/supply-tracker/quick-check/{sku}` | GET | - | Lookup rapido |

**Decision values:** `OK`, `REVIEW`, `BLOCK`

**Validate - Response:**
```json
{
  "sku": "OYD-TORCH-001",
  "margin_pct": 12.5,
  "margin_color": "green",
  "decision": "OK",
  "recommendation": "Margen saludable, proceder con compra",
  "last_updated": "2025-03-01T10:00:00Z",
  "source": "calculated"
}
```

---

### 2.8 Tendencias y Recomendaciones (`/api/trends`) - Auth requerida

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/trends/trend/{sku}` | GET | `days` (7-180, default 30) | Analisis de tendencia |
| `/api/trends/deteriorating` | GET | `threshold` (0.5-10, default 2.0), `days` (7-30, default 14) | Productos deteriorandose |
| `/api/trends/early-warnings` | GET | - | Alertas tempranas |
| `/api/trends/recommendations` | GET | `priority?`, `limit` | Recomendaciones accionables |
| `/api/trends/recommendations/{sku}` | GET | - | Recomendacion por SKU |
| `/api/trends/calculate-adjustment` | POST | `unit_price`, `unit_cost`, `unit_expenses=0`, `unit_discounts=0`, `target_margin=10.0` | Calcular ajuste de precio |

**Trend - Response:**
```json
{
  "sku": "OYD-TORCH-001",
  "current_margin": 12.5,
  "avg_margin_7d": 12.2,
  "avg_margin_30d": 11.8,
  "change_7d": 0.3,
  "change_30d": 0.7,
  "trend": "up",
  "projected_margin_30d": 13.0,
  "alert_level": "none",
  "recommendation": "Margen estable y en crecimiento"
}
```

---

### 2.9 Calculo de Margenes (`/api/calcular-margenes`) - Publico

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/calcular-margenes` | POST | `background` (bool, default false) | Calcular margenes top 100 productos |

**Response:**
```json
{
  "status": "completed",
  "execution_id": "uuid",
  "timestamp": "2025-03-01T10:00:00Z",
  "productos_procesados": 100,
  "margenes_calculados": 98,
  "distribucion_semaforo": { "green": 45, "yellow": 25, "orange": 20, "red": 8 },
  "productos": [
    {
      "sku": "OYD-TORCH-001",
      "nombre": "Antorcha Solar",
      "revenue": 2500000.00,
      "costo": 726750.00,
      "gastos": 102000.00,
      "descuentos": 46750.00,
      "margen_pct": 12.5,
      "color_semaforo": "green"
    }
  ]
}
```

---

### 2.10 Webhooks (`/api/webhooks`) - Publico

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/webhooks/radar-semanal` | POST | Recibir alertas del Radar Semanal |
| `/api/webhooks/lloyds-hq` | POST | Recibir alertas de Lloyds HQ |

---

## 3. Lloyds Forecast (puerto 8009)

**Proyecto:** `Proyecto Lloyds_Forecast`
**Framework:** FastAPI
**Base URL:** `http://localhost:8009`
**Nota:** Puerto configurable. Dev: 8085, Docker: 8011, Default: 8080. Verificar `.env` para el puerto actual.

### Autenticacion

| Campo | Valor |
|-------|-------|
| Tipo | JWT Bearer Token (Google OAuth) |
| Login | `POST /auth/login/google` con Google ID token |
| Header | `Authorization: Bearer <access_token>` |
| Expiracion | 8 horas |
| Whitelist | salomon@, karen@, jacobo@, abarios@ lloydselectronica.com |

**La mayoria de endpoints son publicos.** Solo `/auth/me` requiere auth.

---

### 3.1 Auth (`/auth`)

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/auth/login/google` | POST | Login Google OAuth |
| `/auth/me` | GET | Info del usuario (auth requerida) |
| `/auth/logout` | POST | Cerrar sesion |
| `/auth/config` | GET | Config de auth para frontend |

---

### 3.2 Forecast (`/forecast`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/forecast/subcategorias` | GET | - | Subcategorias disponibles |
| `/forecast/{subcategoria}` | GET | `horizonte_dias` (30-365, default 150) | Pronostico por subcategoria |
| `/forecast/run` | POST | `{subcategorias?, horizonte_dias, guardar_historial}` | Ejecutar pronostico manual |
| `/forecast/historial/` | GET | `subcategoria?` | Historial de pronosticos |
| `/forecast/sku/{sku}` | GET | - | Pronostico por SKU |

**Forecast por subcategoria - Response:**
```json
{
  "subcategoria": "Iluminacion Solar",
  "fecha_pronostico": "2025-03-01T10:00:00Z",
  "horizonte_dias": 150,
  "modelo_usado": "prophet",
  "metricas": { "mape": 15.5, "rmse": 250.3 },
  "historico": [
    { "fecha": "2024-01-01", "cantidad": 1000.5 }
  ],
  "pronostico_subcategoria": [
    { "fecha": "2025-03-01", "cantidad": 950.2, "lower": 900.0, "upper": 1000.0 }
  ],
  "pronostico_por_sku": [
    {
      "sku": "OYD-TORCH-001",
      "descripcion": "Antorcha Solar",
      "clasificacion_abc": "A",
      "proporcion": 0.35,
      "pronostico_mensual": [
        { "fecha": "2025-03-01", "cantidad": 150.5, "lower": 140.0, "upper": 160.0 }
      ],
      "pronostico_total": 2500.5
    }
  ]
}
```

---

### 3.3 Alertas (`/alerts`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/alerts/` | GET | `subcategoria?`, `clasificacion?` (A/B/C) | Alertas activas |
| `/alerts/urgent` | GET | - | Alertas urgentes (Clase A < 60 dias) |
| `/alerts/summary` | GET | - | Resumen de alertas |
| `/alerts/generate` | POST | - | Generar nuevas alertas |
| `/alerts/sync` | POST | - | Sincronizar con inventario actual |
| `/alerts/export/excel` | GET | `subcategoria?`, `clasificacion?` | Exportar a Excel |
| `/alerts/{alerta_id}` | GET | - | Detalle de alerta |
| `/alerts/{alerta_id}/resolve` | PUT | `{estado, notas?, resuelto_por?}` | Resolver alerta |
| `/alerts/{alerta_id}/status` | PUT | `estado` (query) | Cambiar estado |
| `/alerts/external` | POST | Body: ExternalAlert | Recibir alerta externa |
| `/alerts/external/batch` | POST | Body: lista de ExternalAlert | Batch de alertas externas |
| `/alerts/hq/preview` | GET | `solo_criticas?`, `solo_clase_a?`, `limite?` | Preview para HQ |
| `/alerts/hq/summary` | GET | - | Resumen para HQ |
| `/alerts/hq/sync` | POST | `{solo_criticas?, solo_clase_a?, limite?}` | Enviar alertas a HQ |
| `/alerts/hq/test-connection` | POST | - | Test conexion con HQ |

**Alert estados:** `PENDIENTE`, `EN_PROCESO`, `RESUELTA`, `DESCARTADA`

**Alerta - Response:**
```json
{
  "id": 1,
  "sku": "OYD-TORCH-001",
  "subcategoria": "Iluminacion Solar",
  "clasificacion_abc": "A",
  "dias_inventario": 45.5,
  "stock_actual": 150.0,
  "stock_transito": 200.0,
  "venta_diaria_promedio": 5.2,
  "fecha_alerta": "2025-03-01T10:00:00Z",
  "estado": "PENDIENTE"
}
```

**Summary - Response:**
```json
{
  "total": 45,
  "urgentes": 12,
  "clase_a": 30,
  "clase_b": 10,
  "clase_c": 5,
  "por_subcategoria": { "Iluminacion Solar": 15, "Herramientas": 10 }
}
```

---

### 3.4 Inventario (`/inventory`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/inventory/` | GET | `subcategoria?`, `clasificacion?`, `solo_alertas?`, `ordenar_por?`, `orden?`, `limite?`, `offset?` | Status de inventario |
| `/inventory/summary` | GET | - | Resumen de inventario |
| `/inventory/abc` | GET | `subcategoria?`, `clasificacion?` | Clasificacion ABC |
| `/inventory/abc/summary` | GET | - | Resumen ABC |
| `/inventory/abc/recalculate` | POST | `{subcategorias?, dias_ventas}` | Recalcular ABC |
| `/inventory/abc/{sku}` | GET | - | ABC por SKU |
| `/inventory/abc/{sku}/resurtible` | PUT | `resurtible` (query bool) | Marcar resurtible |
| `/inventory/abc/resurtible/batch` | PUT | `{skus, resurtible}` | Batch resurtible |
| `/inventory/abc/no-resurtibles` | GET | - | SKUs no resurtibles |
| `/inventory/dias/{sku}` | GET | - | Dias de inventario por SKU |
| `/inventory/compras-pendientes` | GET | - | Compras pendientes |
| `/inventory/stock-transito` | GET | - | Stock en transito |
| `/inventory/compras-detalle/{sku}` | GET | - | Detalle de compras por SKU |
| `/inventory/compras-todos` | GET | - | Compras de todos los SKUs |
| `/inventory/ventas-cliente/{sku}` | GET | - | Ventas YTD vs LYTD por cliente |
| `/inventory/imagen/{sku}` | GET | - | URL de imagen del producto |

**Inventory Status - Response:**
```json
{
  "sku": "OYD-TORCH-001",
  "descripcion": "Antorcha Solar",
  "subcategoria": "Iluminacion Solar",
  "clasificacion_abc": "A",
  "stock_actual": 150.0,
  "stock_transito": 200.0,
  "stock_total": 350.0,
  "venta_diaria_promedio": 5.2,
  "dias_inventario": 67.3,
  "en_alerta": true,
  "umbral_dias": 119
}
```

**Reglas de negocio:**
- Lead time: 105 dias
- Buffer de seguridad: 14 dias
- Umbral de alerta: 119 dias (lead time + buffer)
- Umbral critico: < 60 dias

---

### 3.5 HQ Sync (`/hq`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/hq/departamentos` | GET | - | Departamentos disponibles |
| `/hq/kpis/preview` | GET | - | Preview de KPIs |
| `/hq/kpis/sync` | POST | - | Enviar KPIs a HQ |
| `/hq/clientes/sync` | POST | - | Enviar KPIs de clientes |
| `/hq/clientes/preview` | GET | - | Preview KPIs clientes |
| `/hq/alertas/sync` | POST | `solo_criticas?`, `solo_clase_a?`, `limite?` | Enviar alertas a HQ |
| `/hq/sync-completo` | POST | - | Sync completo (KPIs + alertas) |
| `/hq/sync-background` | POST | - | Sync en background |
| `/hq/status` | GET | - | Status de conexion con HQ |
| `/hq/scheduler/status` | GET | - | Status del scheduler diario |
| `/hq/scheduler/run-now` | POST | - | Ejecutar sync ahora |

---

### 3.6 Scheduler (`/scheduler`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/scheduler/status` | GET | - | Status y jobs programados |
| `/scheduler/run/{job_id}` | POST | job_id: `generar_alertas`, `sync_hq`, `forecast`, `correlaciones` | Ejecutar job |
| `/scheduler/config/{job_id}` | PUT | `hour`, `minute`, `day_of_week?` | Actualizar horario |

**Jobs programados:**
- `generar_alertas`: Diario 5:30 AM
- `sync_hq`: Diario 6:00 AM
- `correlaciones`: Lunes 7:00 AM
- `forecast`: Bajo demanda

---

## 4. Dashboard HD Cientifico (puerto 8002)

**Proyecto:** `Proyecto Dashboard_HD_Cientifico`
**Framework:** FastAPI
**Base URL:** `http://localhost:8002`
**Fuente de datos:** Cubo SSAS HomeDepotSellout

### Autenticacion

| Campo | Valor |
|-------|-------|
| Tipo | JWT Bearer Token (Google OAuth) |
| Login | `POST /api/auth/google` |
| Header | `Authorization: Bearer <access_token>` |
| Expiracion | 24 horas |

**La mayoria de endpoints de datos son publicos.** Auth es opcional en hipotesis y reportes narrativos.

---

### 4.1 Auth y Cache

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/auth/google` | POST | Login Google OAuth |
| `/api/auth/me` | GET | Info usuario (auth requerida) |
| `/api/auth/logout` | POST | Cerrar sesion |
| `/api/auth/status` | GET | Estado de auth |
| `/api/cache/clear` | POST | Limpiar cache |
| `/api/cache/warmup` | POST | Pre-calentar cache desde SSAS |
| `/api/connection/reset` | POST | Reset conexion SSAS |

---

### 4.2 KPIs y Dashboard Principal

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/kpis` | GET | `departamento`, `categoria`, `subcategoria`, `period_type` (ytd/rolling12) | KPIs principales |
| `/api/comps/monthly` | GET | `departamento`, `categoria`, `subcategoria`, `period_type` | COMPS mensuales |

**KPIs - Response:**
```json
{
  "comps_pct": 5.2,
  "ventas_ytd": 45000000.00,
  "ventas_lytd": 42800000.00,
  "productos_con_hueco": 120,
  "total_huecos": 450
}
```

---

### 4.3 Productos

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/products/top` | GET | `departamento`, `categoria`, `subcategoria`, `limit` (1-50, default 10), `period_type` | Top productos |
| `/api/products/pareto` | GET | `departamento`, `categoria`, `subcategoria`, `limit` (1-500, default 100), `period_type` | Analisis Pareto 80/20 |
| `/api/products/compare` | GET | `modelo_old` (req), `modelo_new` (req), `departamento`, `months` (3-24, default 12) | Comparar 2 productos |
| `/api/products/compare-by-store` | GET | `modelo_old`, `modelo_new`, `departamento`, `months` | Comparar por tienda |
| `/api/products/compare-multi` | GET | `modelos_old` (CSV), `modelos_new` (CSV), `departamento`, `months` | Comparacion multiple |
| `/api/products/compare-multi-by-store` | GET | mismos params | Comparacion multiple por tienda |
| `/api/products/{modelo}/image` | GET | - | URL imagen del producto |
| `/api/products/{modelo}/lloyds-inventory` | GET | - | Inventario en bodega Lloyds |

**Top Product - Response:**
```json
{
  "modelo": "OYD-TORCH-001",
  "ventas": 2500000.00,
  "ventasLYTD": 2200000.00,
  "growth": 13.6,
  "pct_individual": 5.5,
  "pct_acumulado": 35.2,
  "clasificacion": "A"
}
```

---

### 4.4 Modelos / Detalle de Producto

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/models/search` | GET | `query` (min 2 chars), `departamento`, `limit` (1-50, default 20) | Busqueda autocomplete |
| `/api/models/{modelo}/summary` | GET | `departamento`, `period_type` | KPIs del producto |
| `/api/models/{modelo}/weekly-sales` | GET | `semana`, `departamento` | Ventas semanales |
| `/api/models/{modelo}/store-distribution` | GET | `departamento`, `period_type` | Distribucion por tienda |

**Model Summary - Response:**
```json
{
  "modelo": "OYD-TORCH-001",
  "ventas_total": 2500000.00,
  "unidades_total": 8500,
  "tiendas_con_venta": 95,
  "tiendas_con_hueco": 15,
  "inventario_total": 3200
}
```

---

### 4.5 Stockouts / Huecos

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/stockouts` | GET | `departamento`, `categoria`, `subcategoria`, `min_tiendas` (default 5) | Stockouts activos |
| `/api/stockouts/by-district` | GET | mismos filtros | Por distrito |
| `/api/stockouts/by-store` | GET | mismos filtros | Por tienda |
| `/api/stockouts/monthly-trend` | GET | mismos filtros | Tendencia mensual |
| `/api/stockouts/historical` | GET | `departamento`, `modelo`, `months` | Historial |
| `/api/stockouts/historical-cache` | GET | `departamento` (req), `modelo` | Cache pre-calculado |
| `/api/stockouts/by-store-cache` | GET | `departamento` (req), `modelo`, `tienda_id`, `limit` | Cache por tienda |
| `/api/stockouts/monthly-trend-cache` | GET | `departamento` (req) | Tendencia desde cache |
| `/api/stockouts/products-with-history` | GET | `departamento` (req) | Productos con historial |

**Stockout - Response:**
```json
{
  "modelo": "OYD-TORCH-001",
  "inventario": 0,
  "tiendas_con_hueco": 15
}
```

---

### 4.6 Ventas

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/sales/by-subcategory` | GET | `departamento`, `categoria`, `subcategoria`, `period_type` | Ventas por subcategoria |
| `/api/sales/by-department` | GET | mismos filtros | Ventas por departamento |

---

### 4.7 Tiendas y Distritos

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/stores` | GET | - | Todas las tiendas |
| `/api/stores/by-district` | GET | `departamento`, `distrito`, `categoria`, `subcategoria` | Tiendas por distrito |
| `/api/stores/{store_id}/products` | GET | `departamento` | Productos en tienda |
| `/api/districts` | GET | `departamento`, `categoria`, `subcategoria`, `period_type` | Performance por distrito |

---

### 4.8 Estructura y Metadata

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/structure` | GET | - | Jerarquia departamento/categoria/subcategoria |
| `/api/departamentos` | GET | - | Lista de departamentos |
| `/api/categorias` | GET | `departamento` | Categorias |
| `/api/subcategorias` | GET | `departamento`, `categoria` | Subcategorias |

---

### 4.9 Correlacion Stockouts vs Ventas

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/correlation/stockouts-sales` | GET | `modelo` (req), `departamento`, `tienda_id`, `months` (3-24, default 12) | Correlacion Pearson |
| `/api/correlations/complete` | GET | `departamento`, `distrito`, `modelo`, `min_r`, `limit` (1-5000, default 500), `offset` | Correlaciones pre-generadas |

**Correlation - Response:**
```json
{
  "data": [
    { "mes": "2025-01", "huecos": 15, "ventas": 250000, "año": 2025, "mes_num": 1 }
  ],
  "correlation_coefficient": -0.82,
  "r_squared": 0.67,
  "interpretation": "Correlacion negativa fuerte",
  "impact_per_stockout": -12500.00,
  "modelo": "OYD-TORCH-001",
  "tienda_id": null
}
```

---

### 4.10 Hipotesis Cientificas

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/hypotheses` | GET | `departamento` (req), `period_type`, `month`, `year`, `iso_week`, `iso_year`, `start_date`, `end_date` | 8 hipotesis cientificas |
| `/api/hypothesis-detail/{hypothesis_id}` | GET | `departamento` (req), `period_type`, etc. | Drill-down por hipotesis |

**Period types:** `ytd`, `rolling12`, `monthly` (req month+year), `iso_week` (req iso_week+iso_year), `custom` (req start_date+end_date en YYYY-MM-DD)

---

### 4.11 Reporte Narrativo

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/narrative-report` | GET | `departamento` (req), `period_type`, etc. | Reporte markdown generado |

---

### 4.12 Reporte Semanal ISO

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/weekly/kpis` | GET | `semana`, `departamento`, `categoria`, `subcategoria` | KPIs semanales |
| `/api/weekly/top-products` | GET | `semana`, `departamento`, `top_n` (1-50, default 10), `sort_by`, `direction` | Top productos |
| `/api/weekly/districts` | GET | `semana`, `departamento` | Distritos |
| `/api/weekly/stockouts` | GET | `semana`, `departamento`, `min_tiendas`, `limit` | Stockouts semanales |
| `/api/weekly/available-weeks` | GET | `count` (default 13), `departamento` | Semanas disponibles |
| `/api/weekly/report` | GET | `semana`, `departamento`, `categoria`, `subcategoria`, `top_n` | Reporte consolidado |

**Weekly KPIs - Response:**
```json
{
  "semana_iso": "2026-W03",
  "semana_inicio": "2026-01-13",
  "semana_fin": "2026-01-19",
  "ventas_actual": 3500000.00,
  "ventas_ly": 3200000.00,
  "comps_pct": 9.4,
  "unidades_actual": 12000,
  "unidades_ly": 11200,
  "tiendas_comparables": 110,
  "total_tiendas": 125
}
```

---

## 5. Scheduler API (puerto 8020)

**Proyecto:** `Proyecto-Sistema-Scheduler`
**Framework:** FastAPI
**Base URL:** `http://localhost:8020`

### Autenticacion

**Sin autenticacion.** Todos los endpoints son abiertos.

**CORS Origins:** `http://localhost:5180`, `http://127.0.0.1:5180`

---

### 5.1 Health

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/` | GET | Info y status de la API |

**Response:**
```json
{ "app": "Sistema Scheduler API", "version": "1.0.0", "status": "healthy" }
```

---

### 5.2 Jobs (`/api/jobs`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/jobs` | GET | - | Listar todos los jobs |
| `/api/jobs/{name}` | GET | - | Detalle de job |
| `/api/jobs` | POST | Body: JobCreate | Crear job |
| `/api/jobs/{name}` | PUT | Body: JobUpdate | Actualizar job |
| `/api/jobs/{name}` | DELETE | - | Eliminar job |
| `/api/jobs/{name}/toggle` | PATCH | - | Activar/desactivar job |
| `/api/jobs/{name}/run` | POST | - | Ejecutar job manual (background) |
| `/api/jobs/{name}/status` | GET | - | Status de ejecucion |

**JobCreate - Request:**
```json
{
  "name": "sync_inventario",
  "description": "Sincronizar inventario diariamente",
  "script": "python scripts/sync_inventario.py",
  "schedule": "cron",
  "cron": "0 6 * * *",
  "enabled": true,
  "retry": 3,
  "retry_delay": [60, 120, 300],
  "timeout": 300,
  "notify_on_success": false,
  "notify_on_failure": true,
  "priority": "high"
}
```

**Job Status - Response:**
```json
{
  "job": "sync_inventario",
  "status": "running",
  "started": 1709280000.0,
  "result": null,
  "error": null
}
```

---

### 5.3 Scheduler (`/api/scheduler`)

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/scheduler/status` | GET | Status del scheduler y jobs registrados |
| `/api/scheduler/start` | POST | Iniciar scheduler |
| `/api/scheduler/stop` | POST | Detener scheduler |
| `/api/scheduler/restart` | POST | Reiniciar scheduler |

---

### 5.4 Logs (`/api/logs`)

| Endpoint | Metodo | Parametros | Descripcion |
|----------|--------|------------|-------------|
| `/api/logs` | GET | `days` (1-90, default 7), `job_name?`, `event?`, `limit` (1-500, default 50), `offset=0` | Logs paginados |
| `/api/logs/stats` | GET | `days` (1-365, default 30) | Estadisticas de todos los jobs |
| `/api/logs/stats/{job_name}` | GET | `days` | Estadisticas de un job |
| `/api/logs/recent` | GET | `limit` (1-100, default 10) | Actividad reciente |

**Stats - Response:**
```json
{
  "stats": {
    "sync_inventario": {
      "executions": 30,
      "successes": 28,
      "failures": 2,
      "success_rate": 93.3
    }
  }
}
```

---

### 5.5 Settings (`/api/settings`)

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/settings/telegram` | GET | Config de Telegram |
| `/api/settings/telegram/test` | POST | Test de conexion Telegram |
| `/api/settings/scheduler` | GET | Config del scheduler |
| `/api/settings/scheduler` | PUT | Actualizar config scheduler |
| `/api/settings/monitoring` | GET | Config de monitoreo |
| `/api/settings/monitoring` | PUT | Actualizar monitoreo |
| `/api/settings/features` | GET | Config de features |
| `/api/settings/features` | PUT | Actualizar features |

---

## Resumen General

| API | Puerto | Endpoints | Auth | Framework |
|-----|--------|-----------|------|-----------|
| Stockout Zero Platform | 8021 | ~50 | JWT (email/Google) | FastAPI |
| Monitor de Margenes | 8180 | ~43 | JWT (Google) / Mixto | FastAPI |
| Lloyds Forecast | 8009 | ~55 | JWT (Google) / Mayoria publico | FastAPI |
| Dashboard HD Cientifico | 8002 | ~52 | JWT (Google) / Opcional | FastAPI |
| Scheduler API | 8020 | ~20 | Sin auth | FastAPI |

**Total aproximado: ~220 endpoints**

### Patron de autenticacion comun

Todas las APIs con auth usan el mismo patron:

1. `POST /api/auth/google` con `{ "credential": "google_id_token" }` (o `/auth/login/google`)
2. Respuesta incluye `access_token`
3. Usar en header: `Authorization: Bearer <access_token>`
4. Tokens expiran entre 8-24 horas segun la API
