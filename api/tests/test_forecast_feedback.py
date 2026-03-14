"""Tests for HD Forecast Feedback Loop components."""

import asyncio
import sqlite3
import time
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.forecast_feedback import (
    PredictionStore,
    WeeklyEvaluator,
    WeightOptimizer,
    FeedbackLoopRunner,
    init_feedback_tables,
    DEFAULT_WEIGHTS,
    MIN_WEIGHT,
    MAX_WEIGHT,
    MAX_CHANGE_PP,
    SMOOTHING_ALPHA,
    MIN_WEEKS_FOR_OPTIMIZATION,
)


@pytest.fixture
def db():
    """In-memory SQLite DB with feedback tables."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_feedback_tables(conn)
    yield conn
    conn.close()


# ── PredictionStore Tests ──────────────────────────────────


class TestPredictionStore:

    def test_store_single_prediction(self, db):
        store = PredictionStore(db)
        pred_id = store.store_prediction(
            sku="OYD-LAMP-001",
            fecha_prediccion="2026-03-01",
            fecha_objetivo="2026-03-15",
            horizonte_dias=14,
            modelo_ml="prophet",
            valor_predicho=150.0,
            intervalo_inferior=130.0,
            intervalo_superior=170.0,
        )
        assert pred_id
        row = db.execute("SELECT * FROM forecast_predictions WHERE id = ?", (pred_id,)).fetchone()
        assert row["sku"] == "OYD-LAMP-001"
        assert row["valor_predicho"] == 150.0
        assert row["modelo_ml"] == "prophet"

    def test_store_multiple_predictions_same_sku(self, db):
        store = PredictionStore(db)
        run_id = "run001"
        for modelo in ["prophet", "arima", "xgboost"]:
            store.store_prediction(
                sku="OYD-LAMP-001",
                fecha_prediccion="2026-03-01",
                fecha_objetivo="2026-03-15",
                horizonte_dias=14,
                modelo_ml=modelo,
                valor_predicho=100.0 + hash(modelo) % 50,
                run_id=run_id,
            )
        rows = db.execute("SELECT * FROM forecast_predictions WHERE run_id = ?", (run_id,)).fetchall()
        assert len(rows) == 3

    def test_store_forecast_run_from_api_response(self, db):
        store = PredictionStore(db)
        response = {
            "modelo_usado": "prophet",
            "pronostico_por_sku": [
                {
                    "sku": "OYD-TORCH-001",
                    "pronostico_mensual": [
                        {"fecha": "2026-04-01", "cantidad": 200.0, "lower": 180.0, "upper": 220.0},
                        {"fecha": "2026-05-01", "cantidad": 250.0, "lower": 220.0, "upper": 280.0},
                    ],
                },
                {
                    "sku": "OYD-LAMP-002",
                    "pronostico_mensual": [
                        {"fecha": "2026-04-01", "cantidad": 80.0, "lower": 70.0, "upper": 90.0},
                    ],
                },
            ],
        }
        run_id = store.store_forecast_run(response)
        assert run_id
        rows = db.execute("SELECT * FROM forecast_predictions WHERE run_id = ?", (run_id,)).fetchall()
        assert len(rows) == 3  # 2 + 1

    def test_get_predictions_for_week(self, db):
        store = PredictionStore(db)
        # Predictions targeting different weeks
        store.store_prediction("SKU1", "2026-03-01", "2026-03-10", 9, "prophet", 100.0)
        store.store_prediction("SKU1", "2026-03-01", "2026-03-15", 14, "prophet", 120.0)
        store.store_prediction("SKU1", "2026-03-01", "2026-03-20", 19, "prophet", 140.0)

        # Week of March 9-15
        preds = store.get_predictions_for_week("2026-03-09", "2026-03-15")
        assert len(preds) == 2  # March 10 and 15

    def test_get_skus_with_predictions(self, db):
        store = PredictionStore(db)
        store.store_prediction("AAA", "2026-03-01", "2026-03-15", 14, "prophet", 100.0)
        store.store_prediction("BBB", "2026-03-01", "2026-03-15", 14, "prophet", 200.0)
        store.store_prediction("AAA", "2026-03-01", "2026-03-20", 19, "prophet", 150.0)

        skus = store.get_skus_with_predictions()
        assert skus == ["AAA", "BBB"]

    def test_empty_forecast_response(self, db):
        store = PredictionStore(db)
        run_id = store.store_forecast_run({"pronostico_por_sku": []})
        rows = db.execute("SELECT * FROM forecast_predictions WHERE run_id = ?", (run_id,)).fetchall()
        assert len(rows) == 0


# ── WeeklyEvaluator Tests ─────────────────────────────────


class TestWeeklyEvaluator:

    def test_extract_actual_units_ventas_list(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {
            "ventas": [
                {"fecha": "2026-03-09", "unidades": 10},
                {"fecha": "2026-03-10", "unidades": 15},
                {"fecha": "2026-03-11", "unidades": 20},
                {"fecha": "2026-03-16", "unidades": 5},  # outside range
            ]
        }
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result == 45.0  # 10 + 15 + 20

    def test_extract_actual_units_direct_number(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {"ventas": 500}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result == 500.0

    def test_extract_actual_units_kpi_format(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {"unidades": 300}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result == 300.0

    def test_extract_actual_units_nested_data(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {"data": {"unidades": 250}}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result == 250.0

    def test_extract_actual_units_none_on_unknown(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {"random_field": 123}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result is None

    @pytest.mark.asyncio
    async def test_evaluate_week_with_mocked_sales(self, db):
        store = PredictionStore(db)
        store.store_prediction("SKU1", "2026-03-01", "2026-03-10", 9, "prophet", 100.0, run_id="r1")
        store.store_prediction("SKU1", "2026-03-01", "2026-03-12", 11, "arima", 110.0, run_id="r1")

        evaluator = WeeklyEvaluator(db)

        # Mock fetch_actual_sales to return known data
        async def mock_fetch(sku):
            return {"ventas": 95}

        evaluator.fetch_actual_sales = mock_fetch

        evals = await evaluator.evaluate_week("2026-W11", "2026-03-09", "2026-03-15")
        assert len(evals) == 2

        prophet_eval = [e for e in evals if e["modelo_ml"] == "prophet"][0]
        assert prophet_eval["valor_predicho"] == 100.0
        assert prophet_eval["valor_real"] == 95.0
        assert prophet_eval["error_abs"] == 5.0
        assert abs(prophet_eval["error_pct"] - 5.26) < 0.1  # ~5.26%

    @pytest.mark.asyncio
    async def test_evaluate_week_no_predictions(self, db):
        evaluator = WeeklyEvaluator(db)
        evals = await evaluator.evaluate_week("2026-W11", "2026-03-09", "2026-03-15")
        assert evals == []

    def test_get_model_mape_history(self, db):
        # Insert evaluation records directly
        for i, (week, mape) in enumerate([
            ("2026-W08", 12.0),
            ("2026-W09", 10.0),
            ("2026-W10", 8.0),
            ("2026-W11", 6.0),
        ]):
            db.execute(
                """INSERT INTO forecast_evaluations
                   (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                    valor_predicho, valor_real, error_abs, error_pct, mape, rmse, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"e{i}", "SKU1", week, "2026-03-01", "2026-03-07", "prophet",
                 100, 90, 10, 10, mape, 10, int(time.time()) + i),
            )
        db.commit()

        evaluator = WeeklyEvaluator(db)
        history = evaluator.get_model_mape_history("prophet", n_weeks=4)
        assert len(history) == 4
        # Most recent first
        assert history[0] == 6.0

    def test_get_global_mape(self, db):
        for i, modelo in enumerate(["prophet", "arima"]):
            db.execute(
                """INSERT INTO forecast_evaluations
                   (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                    valor_predicho, valor_real, error_abs, error_pct, mape, rmse, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"g{i}", "SKU1", "2026-W11", "2026-03-09", "2026-03-15", modelo,
                 100, 90, 10, 10, 10.0 + i * 5, 10, int(time.time())),
            )
        db.commit()

        evaluator = WeeklyEvaluator(db)
        global_mape = evaluator.get_global_mape("2026-W11")
        assert global_mape == 12.5  # avg(10, 15)


# ── WeightOptimizer Tests ─────────────────────────────────


class TestWeightOptimizer:

    def test_default_weights(self, db):
        optimizer = WeightOptimizer(db)
        weights = optimizer.get_current_weights()
        assert weights == DEFAULT_WEIGHTS
        assert abs(sum(weights.values()) - 1.0) < 0.001

    def test_optimize_insufficient_data(self, db):
        optimizer = WeightOptimizer(db)
        result = optimizer.optimize("2026-W11")
        assert result["updated"] is False
        assert "Need" in result["reason"]

    def test_optimize_with_enough_data(self, db):
        # Insert 4 weeks of evaluations for each model
        now = int(time.time())
        for week_num in range(8, 12):
            semana = f"2026-W{week_num:02d}"
            for j, (modelo, mape) in enumerate([
                ("prophet", 10.0),   # Best
                ("arima", 20.0),     # Middle
                ("xgboost", 15.0),   # Good
            ]):
                db.execute(
                    """INSERT INTO forecast_evaluations
                       (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                        valor_predicho, valor_real, error_abs, error_pct, mape, rmse, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"opt_{week_num}_{j}", "SKU1", semana, "2026-03-01", "2026-03-07",
                     modelo, 100, 90, 10, mape, mape, 10, now + week_num * 100 + j),
                )
        db.commit()

        optimizer = WeightOptimizer(db)
        result = optimizer.optimize("2026-W12")

        assert result["updated"] is True
        new_weights = result["new_weights"]

        # Prophet should have highest weight (lowest MAPE)
        assert new_weights["prophet"] > new_weights["arima"]
        # All weights within bounds
        for w in new_weights.values():
            assert w >= MIN_WEIGHT - 0.001
            assert w <= MAX_WEIGHT + 0.001
        # Weights sum to ~1.0
        assert abs(sum(new_weights.values()) - 1.0) < 0.01

    def test_constraints_min_max(self, db):
        optimizer = WeightOptimizer(db)
        old = {"prophet": 0.50, "arima": 0.25, "xgboost": 0.25}
        new = {"prophet": 0.90, "arima": 0.05, "xgboost": 0.05}  # Violates constraints
        constrained = optimizer._apply_constraints(old, new)

        for w in constrained.values():
            assert w >= MIN_WEIGHT
            assert w <= MAX_WEIGHT

    def test_constraints_max_change(self, db):
        optimizer = WeightOptimizer(db)
        old = {"prophet": 0.40, "arima": 0.30, "xgboost": 0.30}
        new = {"prophet": 0.60, "arima": 0.20, "xgboost": 0.20}  # 20pp change for prophet
        constrained = optimizer._apply_constraints(old, new)

        # Prophet can only move 10pp from 0.40
        assert constrained["prophet"] <= old["prophet"] + MAX_CHANGE_PP + 0.001

    def test_weights_persisted_to_db(self, db):
        # Insert enough evaluations
        now = int(time.time())
        for week_num in range(8, 12):
            for j, (modelo, mape) in enumerate([("prophet", 10), ("arima", 20), ("xgboost", 15)]):
                db.execute(
                    """INSERT INTO forecast_evaluations
                       (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                        valor_predicho, valor_real, error_abs, error_pct, mape, rmse, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"p_{week_num}_{j}", "SKU1", f"2026-W{week_num:02d}", "2026-03-01",
                     "2026-03-07", modelo, 100, 90, 10, mape, mape, 10, now + week_num * 100 + j),
                )
        db.commit()

        optimizer = WeightOptimizer(db)
        optimizer.optimize("2026-W12")

        rows = db.execute("SELECT * FROM forecast_weights WHERE semana_iso = '2026-W12'").fetchall()
        assert len(rows) == 3  # One per model

    def test_get_current_weights_from_db(self, db):
        now = int(time.time())
        for modelo, peso in [("prophet", 0.55), ("arima", 0.20), ("xgboost", 0.25)]:
            db.execute(
                """INSERT INTO forecast_weights
                   (id, semana_iso, modelo_ml, peso_anterior, peso_nuevo, mape_promedio, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (f"w_{modelo}", "2026-W11", modelo, 0.33, peso, 10.0, now),
            )
        db.commit()

        optimizer = WeightOptimizer(db)
        weights = optimizer.get_current_weights()
        assert weights["prophet"] == 0.55
        assert weights["arima"] == 0.20
        assert weights["xgboost"] == 0.25


# ── FeedbackLoopRunner Tests ──────────────────────────────


class TestFeedbackLoopRunner:

    def test_get_previous_week(self, db):
        runner = FeedbackLoopRunner(db)
        semana, inicio, fin = runner._get_previous_week()
        assert semana.startswith("20")
        assert "-W" in semana
        assert inicio < fin

    @pytest.mark.asyncio
    async def test_full_run_no_predictions(self, db):
        runner = FeedbackLoopRunner(db)
        result = await runner.run("2026-W11")

        assert result["run_id"]
        assert result["semana_iso"] == "2026-W11"
        assert result["evaluaciones"] == 0
        assert result["pesos"]["updated"] is False

        # Run metadata persisted
        row = db.execute(
            "SELECT * FROM forecast_feedback_runs WHERE id = ?", (result["run_id"],)
        ).fetchone()
        assert row is not None

    @pytest.mark.asyncio
    async def test_full_run_with_predictions_and_sales(self, db):
        store = PredictionStore(db)
        # Store predictions for the target week
        for modelo, valor in [("prophet", 100), ("arima", 110), ("xgboost", 95)]:
            store.store_prediction(
                "SKU1", "2026-03-01", "2026-03-10", 9, modelo, valor, run_id="r1"
            )

        runner = FeedbackLoopRunner(db)

        # Mock the evaluator's fetch to return known sales
        async def mock_fetch(sku):
            return {"ventas": 100}

        runner.evaluator.fetch_actual_sales = mock_fetch

        result = await runner.run("2026-W11")
        assert result["evaluaciones"] == 3
        assert result["skus_con_datos"] == 1

    @pytest.mark.asyncio
    async def test_run_stores_errors(self, db):
        runner = FeedbackLoopRunner(db)

        # Force evaluator to raise
        async def exploding_evaluate(*a, **kw):
            raise RuntimeError("Cube is down")

        runner.evaluator.evaluate_week = exploding_evaluate

        # Need at least one SKU with predictions
        store = PredictionStore(db)
        store.store_prediction("SKU1", "2026-03-01", "2026-03-10", 9, "prophet", 100)

        result = await runner.run("2026-W11")
        assert len(result["errores"]) > 0
        assert "Cube is down" in result["errores"][0]


# ── API Endpoint Tests ────────────────────────────────────


class TestAPIEndpoints:

    @pytest.fixture(autouse=True)
    def setup_client(self):
        from main import app
        from fastapi.testclient import TestClient
        self.client = TestClient(app)

    def test_get_weights(self):
        resp = self.client.get("/api/forecast-feedback/weights")
        assert resp.status_code == 200
        body = resp.json()
        assert "weights" in body
        assert "prophet" in body["weights"]

    def test_store_prediction_endpoint(self):
        resp = self.client.post(
            "/api/forecast-feedback/store-prediction",
            params={
                "sku": "TEST-001",
                "fecha_objetivo": "2026-04-01",
                "valor_predicho": 200.0,
                "modelo_ml": "prophet",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["stored"] is True

    def test_feedback_history(self):
        resp = self.client.get("/api/forecast-feedback/history")
        assert resp.status_code == 200
        assert "runs" in resp.json()

    def test_get_evaluations(self):
        resp = self.client.get("/api/forecast-feedback/evaluations")
        assert resp.status_code == 200
        assert "evaluations" in resp.json()

    def test_accuracy_trend(self):
        resp = self.client.get("/api/forecast-feedback/accuracy-trend")
        assert resp.status_code == 200
        assert "trend" in resp.json()

    def test_run_feedback_loop_endpoint(self):
        resp = self.client.post(
            "/api/forecast-feedback/run",
            params={"semana": "2026-W10"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["semana_iso"] == "2026-W10"
        assert "run_id" in body


# ── Edge Cases ────────────────────────────────────────────


class TestEdgeCases:

    def test_zero_actual_sales_no_division_error(self, db):
        evaluator = WeeklyEvaluator(db)
        # Zero sales should return error_pct as None
        data = {"ventas": 0}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        # Returns 0.0 which is fine, the evaluator handles division by checking > 0
        assert result == 0.0

    def test_empty_ventas_list_returns_none(self, db):
        evaluator = WeeklyEvaluator(db)
        data = {"ventas": []}
        result = evaluator._extract_actual_units(data, "2026-03-09", "2026-03-15")
        assert result is None

    def test_optimizer_all_equal_mape(self, db):
        """When all models perform equally, weights should stay balanced."""
        now = int(time.time())
        for week_num in range(8, 12):
            for j, modelo in enumerate(["prophet", "arima", "xgboost"]):
                db.execute(
                    """INSERT INTO forecast_evaluations
                       (id, sku, semana_iso, fecha_inicio, fecha_fin, modelo_ml,
                        valor_predicho, valor_real, error_abs, error_pct, mape, rmse, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"eq_{week_num}_{j}", "SKU1", f"2026-W{week_num:02d}", "2026-03-01",
                     "2026-03-07", modelo, 100, 90, 10, 10, 10.0, 10, now + week_num * 100 + j),
                )
        db.commit()

        optimizer = WeightOptimizer(db)
        result = optimizer.optimize("2026-W12")
        assert result["updated"] is True
        # Weights should be roughly equal
        weights = result["new_weights"]
        values = list(weights.values())
        assert max(values) - min(values) < 0.20  # Close to equal (smoothing pulls toward defaults)

    def test_prediction_store_handles_missing_fields(self, db):
        store = PredictionStore(db)
        response = {
            "pronostico_por_sku": [
                {
                    "sku": "PARTIAL",
                    "pronostico_mensual": [
                        {"fecha": "2026-04-01", "cantidad": 50.0},  # No lower/upper
                    ],
                },
            ],
        }
        run_id = store.store_forecast_run(response)
        row = db.execute(
            "SELECT * FROM forecast_predictions WHERE run_id = ?", (run_id,)
        ).fetchone()
        assert row["valor_predicho"] == 50.0
        assert row["intervalo_inferior"] is None
