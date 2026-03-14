"""HD Forecast Feedback Loop -- auto-calibrating ensemble weights with weekly evaluation.

Components:
- PredictionStore: persists each forecast run with per-model predictions
- WeeklyEvaluator: compares predictions vs real sellout from HD cube
- WeightOptimizer: adjusts model weights (min 10%, max 60%, max 10pp/week, 70/30 smoothing)
- FeedbackLoopRunner: orchestrates the full weekly cycle

Data sources:
- Forecast predictions: port 8009 (Lloyds Forecast API) via Integration Hub
- Real sellout: port 8002 (Dashboard HD Cientifico / SSAS Cube)
- Transactional sales: Integration Hub /api/v1/lloyds-sql/ventas/{sku}
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query

from database import get_db

router = APIRouter()
logger = logging.getLogger("forecast_feedback")

# ── Config ─────────────────────────────────────────────────

HUB_URL = "http://localhost:8000"
CUBE_URL = "http://localhost:8002"
FORECAST_URL = "http://localhost:8009"

TIMEOUT = 8.0

# Weight optimizer constraints
MIN_WEIGHT = 0.10
MAX_WEIGHT = 0.60
MAX_CHANGE_PP = 0.10  # max 10 percentage points per week
SMOOTHING_ALPHA = 0.70  # 70% old, 30% new
MIN_WEEKS_FOR_OPTIMIZATION = 4

# Default model weights
DEFAULT_WEIGHTS = {
    "prophet": 0.50,
    "arima": 0.25,
    "xgboost": 0.25,
}


# ── DB Schema ──────────────────────────────────────────────

FEEDBACK_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS forecast_predictions (
    id              TEXT PRIMARY KEY,
    sku             TEXT NOT NULL,
    fecha_prediccion TEXT NOT NULL,
    fecha_objetivo  TEXT NOT NULL,
    horizonte_dias  INTEGER NOT NULL,
    modelo_ml       TEXT NOT NULL,
    valor_predicho  REAL NOT NULL,
    intervalo_inferior REAL,
    intervalo_superior REAL,
    es_ensemble     INTEGER NOT NULL DEFAULT 0,
    run_id          TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fp_sku ON forecast_predictions(sku);
CREATE INDEX IF NOT EXISTS idx_fp_fecha_obj ON forecast_predictions(fecha_objetivo);
CREATE INDEX IF NOT EXISTS idx_fp_run ON forecast_predictions(run_id);
CREATE INDEX IF NOT EXISTS idx_fp_modelo ON forecast_predictions(modelo_ml);

CREATE TABLE IF NOT EXISTS forecast_evaluations (
    id              TEXT PRIMARY KEY,
    sku             TEXT NOT NULL,
    semana_iso      TEXT NOT NULL,
    fecha_inicio    TEXT NOT NULL,
    fecha_fin       TEXT NOT NULL,
    modelo_ml       TEXT NOT NULL,
    valor_predicho  REAL NOT NULL,
    valor_real      REAL NOT NULL,
    error_abs       REAL NOT NULL,
    error_pct       REAL,
    mape            REAL,
    rmse            REAL,
    run_id          TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fe_sku ON forecast_evaluations(sku);
CREATE INDEX IF NOT EXISTS idx_fe_semana ON forecast_evaluations(semana_iso);
CREATE INDEX IF NOT EXISTS idx_fe_modelo ON forecast_evaluations(modelo_ml);

CREATE TABLE IF NOT EXISTS forecast_weights (
    id              TEXT PRIMARY KEY,
    semana_iso      TEXT NOT NULL,
    modelo_ml       TEXT NOT NULL,
    peso_anterior   REAL NOT NULL,
    peso_nuevo      REAL NOT NULL,
    mape_promedio   REAL NOT NULL,
    motivo          TEXT NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fw_semana ON forecast_weights(semana_iso);

CREATE TABLE IF NOT EXISTS forecast_feedback_runs (
    id              TEXT PRIMARY KEY,
    semana_iso      TEXT NOT NULL,
    skus_evaluados  INTEGER NOT NULL DEFAULT 0,
    skus_con_datos  INTEGER NOT NULL DEFAULT 0,
    mape_global     REAL,
    pesos_actualizados INTEGER NOT NULL DEFAULT 0,
    errores         TEXT NOT NULL DEFAULT '[]',
    duracion_seg    REAL NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ffr_semana ON forecast_feedback_runs(semana_iso);
"""


def init_feedback_tables(db: sqlite3.Connection) -> None:
    """Create feedback loop tables if they don't exist."""
    for stmt in FEEDBACK_TABLES_SQL.strip().split(";"):
        stmt = stmt.strip()
        if stmt:
            try:
                db.execute(stmt)
            except sqlite3.OperationalError:
                pass
    db.commit()


# ── PredictionStore ────────────────────────────────────────


class PredictionStore:
    """Persists forecast predictions for later evaluation."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    def store_prediction(
        self,
        sku: str,
        fecha_prediccion: str,
        fecha_objetivo: str,
        horizonte_dias: int,
        modelo_ml: str,
        valor_predicho: float,
        intervalo_inferior: float | None = None,
        intervalo_superior: float | None = None,
        es_ensemble: bool = False,
        run_id: str = "",
    ) -> str:
        """Store a single prediction. Returns the prediction ID."""
        pred_id = uuid.uuid4().hex[:12]
        if not run_id:
            run_id = uuid.uuid4().hex[:12]
        self.db.execute(
            """INSERT INTO forecast_predictions
               (id, sku, fecha_prediccion, fecha_objetivo, horizonte_dias,
                modelo_ml, valor_predicho, intervalo_inferior, intervalo_superior,
                es_ensemble, run_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pred_id, sku, fecha_prediccion, fecha_objetivo, horizonte_dias,
                modelo_ml, valor_predicho, intervalo_inferior, intervalo_superior,
                1 if es_ensemble else 0, run_id, int(time.time()),
            ),
        )
        self.db.commit()
        return pred_id

    def store_forecast_run(self, forecast_response: dict, run_id: str | None = None) -> str:
        """Store all predictions from a forecast API response.

        Expected format from port 8009:
        {
            "pronostico_por_sku": [
                {
                    "sku": "OYD-TORCH-001",
                    "pronostico_mensual": [
                        {"fecha": "2026-03-01", "cantidad": 150.5, "lower": 140, "upper": 160}
                    ]
                }
            ]
        }
        """
        if not run_id:
            run_id = uuid.uuid4().hex[:12]
        fecha_prediccion = datetime.utcnow().strftime("%Y-%m-%d")
        modelo = forecast_response.get("modelo_usado", "prophet")

        for sku_data in forecast_response.get("pronostico_por_sku", []):
            sku = sku_data.get("sku", "")
            for punto in sku_data.get("pronostico_mensual", []):
                fecha_obj = punto.get("fecha", "")
                cantidad = punto.get("cantidad", 0)
                lower = punto.get("lower")
                upper = punto.get("upper")

                # Days between prediction and target
                try:
                    d_pred = datetime.strptime(fecha_prediccion, "%Y-%m-%d")
                    d_obj = datetime.strptime(fecha_obj, "%Y-%m-%d")
                    horizonte = (d_obj - d_pred).days
                except ValueError:
                    horizonte = 30

                self.store_prediction(
                    sku=sku,
                    fecha_prediccion=fecha_prediccion,
                    fecha_objetivo=fecha_obj,
                    horizonte_dias=horizonte,
                    modelo_ml=modelo,
                    valor_predicho=cantidad,
                    intervalo_inferior=lower,
                    intervalo_superior=upper,
                    es_ensemble=False,
                    run_id=run_id,
                )
        self.db.commit()
        return run_id

    def get_predictions_for_week(self, semana_inicio: str, semana_fin: str) -> list[dict]:
        """Get all predictions whose target date falls within the given week."""
        rows = self.db.execute(
            """SELECT * FROM forecast_predictions
               WHERE fecha_objetivo >= ? AND fecha_objetivo <= ?
               ORDER BY sku, modelo_ml""",
            (semana_inicio, semana_fin),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_skus_with_predictions(self) -> list[str]:
        """Get distinct SKUs that have stored predictions."""
        rows = self.db.execute(
            "SELECT DISTINCT sku FROM forecast_predictions ORDER BY sku"
        ).fetchall()
        return [r["sku"] for r in rows]


# ── WeeklyEvaluator ───────────────────────────────────────


class WeeklyEvaluator:
    """Compares forecast predictions vs actual sellout data from HD cube."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db
        self.prediction_store = PredictionStore(db)

    async def fetch_actual_sales(self, sku: str) -> dict | None:
        """Fetch actual sellout from the HD cube (port 8002) and hub."""
        async with httpx.AsyncClient() as client:
            try:
                # Try cube KPIs first for aggregated data
                r = await client.get(
                    f"{HUB_URL}/api/v1/lloyds-sql/ventas/{sku}",
                    timeout=TIMEOUT,
                )
                if r.status_code == 200:
                    return r.json()
            except Exception as e:
                logger.warning(f"Failed to fetch sales for {sku}: {e}")

            try:
                # Fallback to cube
                r = await client.get(
                    f"{CUBE_URL}/api/kpis",
                    params={"modelo": sku},
                    timeout=TIMEOUT,
                )
                if r.status_code == 200:
                    return r.json()
            except Exception as e:
                logger.warning(f"Cube fallback failed for {sku}: {e}")

        return None

    async def evaluate_week(self, semana_iso: str, fecha_inicio: str, fecha_fin: str) -> list[dict]:
        """Evaluate all predictions for a given ISO week against actuals.

        Returns list of evaluation records created.
        """
        predictions = self.prediction_store.get_predictions_for_week(fecha_inicio, fecha_fin)
        if not predictions:
            return []

        # Group predictions by SKU
        by_sku: dict[str, list[dict]] = {}
        for p in predictions:
            by_sku.setdefault(p["sku"], []).append(p)

        evaluations = []
        for sku, preds in by_sku.items():
            actual_data = await self.fetch_actual_sales(sku)
            if not actual_data:
                continue

            # Extract actual units sold - adapt to whatever format the API returns
            actual_units = self._extract_actual_units(actual_data, fecha_inicio, fecha_fin)
            if actual_units is None:
                continue

            for pred in preds:
                predicted = pred["valor_predicho"]
                error_abs = abs(predicted - actual_units)
                error_pct = (error_abs / actual_units * 100) if actual_units > 0 else None
                mape = error_pct  # For single observation, MAPE = APE

                eval_id = uuid.uuid4().hex[:12]
                eval_record = {
                    "id": eval_id,
                    "sku": sku,
                    "semana_iso": semana_iso,
                    "fecha_inicio": fecha_inicio,
                    "fecha_fin": fecha_fin,
                    "modelo_ml": pred["modelo_ml"],
                    "valor_predicho": predicted,
                    "valor_real": actual_units,
                    "error_abs": error_abs,
                    "error_pct": error_pct,
                    "mape": mape,
                    "rmse": error_abs,  # Single observation: RMSE = abs error
                    "run_id": pred.get("run_id", ""),
                    "created_at": int(time.time()),
                }

                self.db.execute(
                    """INSERT INTO forecast_evaluations
                       (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                        valor_predicho, valor_real, error_abs, error_pct, mape, rmse,
                        run_id, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        eval_record["id"], eval_record["sku"], eval_record["semana_iso"],
                        eval_record["fecha_inicio"], eval_record["fecha_fin"],
                        eval_record["modelo_ml"], eval_record["valor_predicho"],
                        eval_record["valor_real"], eval_record["error_abs"],
                        eval_record["error_pct"], eval_record["mape"], eval_record["rmse"],
                        eval_record["run_id"], eval_record["created_at"],
                    ),
                )
                evaluations.append(eval_record)

        self.db.commit()
        return evaluations

    def _extract_actual_units(self, data: dict, fecha_inicio: str, fecha_fin: str) -> float | None:
        """Extract actual units sold from API response.

        Handles multiple response formats from the hub and cube.
        """
        # Format 1: Direct ventas response from lloyds-sql
        if "ventas" in data:
            ventas = data["ventas"]
            if isinstance(ventas, list):
                # Sum units within date range
                total = 0.0
                for v in ventas:
                    fecha = v.get("fecha", "")
                    if fecha_inicio <= fecha <= fecha_fin:
                        total += v.get("unidades", v.get("cantidad", 0))
                return total if total > 0 else None
            elif isinstance(ventas, (int, float)):
                return float(ventas)

        # Format 2: KPI response from cube
        if "unidades" in data:
            return float(data["unidades"])
        if "ventas_unidades" in data:
            return float(data["ventas_unidades"])

        # Format 3: Nested data
        if "data" in data and isinstance(data["data"], dict):
            return self._extract_actual_units(data["data"], fecha_inicio, fecha_fin)

        # Format 4: ytd/r3m from lloyds-sql summary
        if "ytd" in data:
            return float(data["ytd"].get("unidades", 0)) if isinstance(data["ytd"], dict) else None

        return None

    def get_model_mape_history(self, modelo_ml: str, n_weeks: int = 4) -> list[float]:
        """Get MAPE values for a model over the last N weeks."""
        rows = self.db.execute(
            """SELECT semana_iso, AVG(mape) as avg_mape
               FROM forecast_evaluations
               WHERE modelo_ml = ? AND mape IS NOT NULL
               GROUP BY semana_iso
               ORDER BY semana_iso DESC
               LIMIT ?""",
            (modelo_ml, n_weeks),
        ).fetchall()
        return [r["avg_mape"] for r in rows if r["avg_mape"] is not None]

    def get_global_mape(self, semana_iso: str) -> float | None:
        """Get overall MAPE for a given week across all models and SKUs."""
        row = self.db.execute(
            """SELECT AVG(mape) as global_mape
               FROM forecast_evaluations
               WHERE semana_iso = ? AND mape IS NOT NULL""",
            (semana_iso,),
        ).fetchone()
        return row["global_mape"] if row and row["global_mape"] is not None else None


# ── WeightOptimizer ────────────────────────────────────────


class WeightOptimizer:
    """Adjusts ensemble model weights based on recent accuracy.

    Constraints:
    - Min weight: 10% (no model drops below this)
    - Max weight: 60% (no model dominates)
    - Max change: 10 percentage points per week
    - Smoothing: 70% old weight + 30% calculated weight
    - Minimum 4 weeks of data before optimizing
    """

    def __init__(self, db: sqlite3.Connection):
        self.db = db
        self.evaluator = WeeklyEvaluator(db)

    def get_current_weights(self) -> dict[str, float]:
        """Get current model weights (latest from DB or defaults)."""
        row = self.db.execute(
            """SELECT modelo_ml, peso_nuevo
               FROM forecast_weights
               ORDER BY created_at DESC
               LIMIT 10""",
        ).fetchall()

        if not row:
            return dict(DEFAULT_WEIGHTS)

        # Get latest weights per model
        weights = {}
        seen = set()
        for r in row:
            if r["modelo_ml"] not in seen:
                weights[r["modelo_ml"]] = r["peso_nuevo"]
                seen.add(r["modelo_ml"])

        # Fill in any missing models with defaults
        for model, default_weight in DEFAULT_WEIGHTS.items():
            if model not in weights:
                weights[model] = default_weight

        return weights

    def optimize(self, semana_iso: str) -> dict[str, Any]:
        """Run weight optimization for the given week.

        Returns dict with old_weights, new_weights, changes, and whether update happened.
        """
        current_weights = self.get_current_weights()
        models = list(current_weights.keys())

        # Check if we have enough data
        mape_by_model: dict[str, list[float]] = {}
        for model in models:
            mapes = self.evaluator.get_model_mape_history(model, n_weeks=MIN_WEEKS_FOR_OPTIMIZATION)
            mape_by_model[model] = mapes

        # Need at least MIN_WEEKS_FOR_OPTIMIZATION weeks for all models
        min_weeks_available = min(len(v) for v in mape_by_model.values()) if mape_by_model else 0
        if min_weeks_available < MIN_WEEKS_FOR_OPTIMIZATION:
            return {
                "updated": False,
                "reason": f"Need {MIN_WEEKS_FOR_OPTIMIZATION} weeks of data, have {min_weeks_available}",
                "old_weights": current_weights,
                "new_weights": current_weights,
            }

        # Calculate average MAPE per model
        avg_mape: dict[str, float] = {}
        for model, mapes in mape_by_model.items():
            avg_mape[model] = sum(mapes) / len(mapes) if mapes else 100.0

        # Calculate raw weights (inverse MAPE)
        inverse_sum = sum(1.0 / m for m in avg_mape.values() if m > 0)
        if inverse_sum == 0:
            return {
                "updated": False,
                "reason": "All models have zero MAPE (or no data)",
                "old_weights": current_weights,
                "new_weights": current_weights,
            }

        raw_weights = {m: (1.0 / avg_mape[m]) / inverse_sum for m in models if avg_mape[m] > 0}

        # Apply smoothing: 70% old + 30% new
        smoothed = {}
        for model in models:
            old = current_weights.get(model, 1.0 / len(models))
            new_raw = raw_weights.get(model, old)
            smoothed[model] = SMOOTHING_ALPHA * old + (1 - SMOOTHING_ALPHA) * new_raw

        # Apply constraints
        constrained = self._apply_constraints(current_weights, smoothed)

        # Normalize to sum to 1.0
        total = sum(constrained.values())
        if total > 0:
            constrained = {m: w / total for m, w in constrained.items()}

        # Store weight changes
        now = int(time.time())
        for model in models:
            weight_id = uuid.uuid4().hex[:12]
            self.db.execute(
                """INSERT INTO forecast_weights
                   (id, semana_iso, modelo_ml, peso_anterior, peso_nuevo, mape_promedio, motivo, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    weight_id, semana_iso, model,
                    current_weights.get(model, 0),
                    constrained[model],
                    avg_mape.get(model, 0),
                    f"Auto-optimized: MAPE {avg_mape.get(model, 0):.1f}%",
                    now,
                ),
            )
        self.db.commit()

        return {
            "updated": True,
            "old_weights": current_weights,
            "new_weights": constrained,
            "avg_mape": avg_mape,
            "weeks_used": min_weeks_available,
        }

    def _apply_constraints(
        self, old_weights: dict[str, float], new_weights: dict[str, float]
    ) -> dict[str, float]:
        """Apply min/max weight and max change constraints."""
        result = {}
        for model, new_w in new_weights.items():
            # Clamp to [MIN_WEIGHT, MAX_WEIGHT]
            clamped = max(MIN_WEIGHT, min(MAX_WEIGHT, new_w))

            # Limit change to MAX_CHANGE_PP
            old_w = old_weights.get(model, 1.0 / len(new_weights))
            delta = clamped - old_w
            if abs(delta) > MAX_CHANGE_PP:
                clamped = old_w + (MAX_CHANGE_PP if delta > 0 else -MAX_CHANGE_PP)

            # Re-clamp after limiting
            clamped = max(MIN_WEIGHT, min(MAX_WEIGHT, clamped))
            result[model] = clamped

        return result


# ── FeedbackLoopRunner ─────────────────────────────────────


class FeedbackLoopRunner:
    """Orchestrates the full weekly feedback loop cycle.

    Steps:
    1. Determine which ISO week to evaluate (previous week)
    2. Run WeeklyEvaluator on all SKUs with predictions
    3. Run WeightOptimizer if enough data
    4. Store run metadata
    5. Return summary for Telegram notification
    """

    def __init__(self, db: sqlite3.Connection):
        self.db = db
        self.evaluator = WeeklyEvaluator(db)
        self.optimizer = WeightOptimizer(db)
        self.prediction_store = PredictionStore(db)

    def _get_previous_week(self) -> tuple[str, str, str]:
        """Get previous ISO week (semana_iso, fecha_inicio, fecha_fin)."""
        today = datetime.utcnow()
        # Go back to last Monday
        last_monday = today - timedelta(days=today.weekday() + 7)
        last_sunday = last_monday + timedelta(days=6)
        iso_year, iso_week, _ = last_monday.isocalendar()
        semana_iso = f"{iso_year}-W{iso_week:02d}"
        return (
            semana_iso,
            last_monday.strftime("%Y-%m-%d"),
            last_sunday.strftime("%Y-%m-%d"),
        )

    async def run(self, semana_iso: str | None = None) -> dict:
        """Execute the full feedback loop for a given week (or previous week)."""
        start_time = time.time()
        errors = []
        run_id = uuid.uuid4().hex[:12]

        if semana_iso:
            # Parse the ISO week to get date range
            try:
                year, week = semana_iso.split("-W")
                monday = datetime.strptime(f"{year}-W{int(week)}-1", "%Y-W%W-%w")
                # Adjust for ISO week
                from datetime import date
                d = date.fromisocalendar(int(year), int(week), 1)
                monday = datetime(d.year, d.month, d.day)
                sunday = monday + timedelta(days=6)
                fecha_inicio = monday.strftime("%Y-%m-%d")
                fecha_fin = sunday.strftime("%Y-%m-%d")
            except (ValueError, AttributeError) as e:
                semana_iso_calc, fecha_inicio, fecha_fin = self._get_previous_week()
                semana_iso = semana_iso_calc
        else:
            semana_iso, fecha_inicio, fecha_fin = self._get_previous_week()

        logger.info(f"Running feedback loop for {semana_iso} ({fecha_inicio} to {fecha_fin})")

        # Step 1: Evaluate predictions
        skus = self.prediction_store.get_skus_with_predictions()
        evaluations = []
        try:
            evaluations = await self.evaluator.evaluate_week(semana_iso, fecha_inicio, fecha_fin)
        except Exception as e:
            errors.append(f"Evaluation error: {str(e)}")
            logger.error(f"Evaluation failed: {e}")

        skus_con_datos = len(set(e["sku"] for e in evaluations))

        # Step 2: Get global MAPE
        mape_global = self.evaluator.get_global_mape(semana_iso)

        # Step 3: Optimize weights
        weight_result = {"updated": False, "reason": "No evaluations"}
        if evaluations:
            try:
                weight_result = self.optimizer.optimize(semana_iso)
            except Exception as e:
                errors.append(f"Optimization error: {str(e)}")
                logger.error(f"Optimization failed: {e}")

        duration = time.time() - start_time

        # Step 4: Store run metadata
        self.db.execute(
            """INSERT INTO forecast_feedback_runs
               (id, semana_iso, skus_evaluados, skus_con_datos, mape_global,
                pesos_actualizados, errores, duracion_seg, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, semana_iso, len(skus), skus_con_datos,
                mape_global, 1 if weight_result.get("updated") else 0,
                json.dumps(errors), duration, int(time.time()),
            ),
        )
        self.db.commit()

        return {
            "run_id": run_id,
            "semana_iso": semana_iso,
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin,
            "skus_evaluados": len(skus),
            "skus_con_datos": skus_con_datos,
            "evaluaciones": len(evaluations),
            "mape_global": round(mape_global, 2) if mape_global else None,
            "pesos": weight_result,
            "errores": errors,
            "duracion_seg": round(duration, 2),
        }


# ── API Endpoints ──────────────────────────────────────────


@router.post("/forecast-feedback/run")
async def run_feedback_loop(
    semana: str | None = Query(None, description="ISO week to evaluate, e.g. 2026-W11"),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Execute the weekly feedback loop (evaluation + weight optimization)."""
    init_feedback_tables(db)
    runner = FeedbackLoopRunner(db)
    result = await runner.run(semana)
    return result


@router.post("/forecast-feedback/store-prediction")
async def store_prediction(
    sku: str,
    fecha_objetivo: str,
    valor_predicho: float,
    modelo_ml: str = "prophet",
    horizonte_dias: int = 30,
    intervalo_inferior: float | None = None,
    intervalo_superior: float | None = None,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Store a single forecast prediction for later evaluation."""
    init_feedback_tables(db)
    store = PredictionStore(db)
    pred_id = store.store_prediction(
        sku=sku,
        fecha_prediccion=datetime.utcnow().strftime("%Y-%m-%d"),
        fecha_objetivo=fecha_objetivo,
        horizonte_dias=horizonte_dias,
        modelo_ml=modelo_ml,
        valor_predicho=valor_predicho,
        intervalo_inferior=intervalo_inferior,
        intervalo_superior=intervalo_superior,
    )
    return {"id": pred_id, "stored": True}


@router.post("/forecast-feedback/capture-forecast")
async def capture_forecast(
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Capture current forecast from port 8009 and store all predictions."""
    init_feedback_tables(db)
    store = PredictionStore(db)

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                f"{FORECAST_URL}/forecast/run",
                json={"horizonte_dias": 30, "guardar_historial": True},
                timeout=30.0,
            )
            r.raise_for_status()
            forecast_data = r.json()
        except Exception as e:
            return {"error": f"Failed to fetch forecast: {str(e)}"}

    run_id = store.store_forecast_run(forecast_data)
    skus = store.get_skus_with_predictions()
    return {
        "run_id": run_id,
        "predictions_stored": True,
        "modelo": forecast_data.get("modelo_usado", "unknown"),
        "skus_count": len(skus),
    }


@router.get("/forecast-feedback/weights")
def get_weights(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Get current model weights."""
    init_feedback_tables(db)
    optimizer = WeightOptimizer(db)
    weights = optimizer.get_current_weights()
    return {"weights": weights}


@router.get("/forecast-feedback/history")
def feedback_history(
    limit: int = Query(10, ge=1, le=100),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Get history of feedback loop runs."""
    init_feedback_tables(db)
    rows = db.execute(
        """SELECT * FROM forecast_feedback_runs
           ORDER BY created_at DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    return {"runs": [dict(r) for r in rows]}


@router.get("/forecast-feedback/evaluations")
def get_evaluations(
    semana: str | None = Query(None),
    sku: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Get evaluation records, optionally filtered by week or SKU."""
    init_feedback_tables(db)
    query = "SELECT * FROM forecast_evaluations WHERE 1=1"
    params: list = []

    if semana:
        query += " AND semana_iso = ?"
        params.append(semana)
    if sku:
        query += " AND sku = ?"
        params.append(sku)

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    rows = db.execute(query, params).fetchall()
    return {"evaluations": [dict(r) for r in rows]}


@router.get("/forecast-feedback/accuracy-trend")
def accuracy_trend(
    n_weeks: int = Query(12, ge=1, le=52),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Get MAPE trend over the last N weeks -- shows if the system is improving."""
    init_feedback_tables(db)
    rows = db.execute(
        """SELECT semana_iso,
                  AVG(mape) as avg_mape,
                  MIN(mape) as min_mape,
                  MAX(mape) as max_mape,
                  COUNT(*) as evaluations
           FROM forecast_evaluations
           WHERE mape IS NOT NULL
           GROUP BY semana_iso
           ORDER BY semana_iso DESC
           LIMIT ?""",
        (n_weeks,),
    ).fetchall()
    return {"trend": [dict(r) for r in rows]}
