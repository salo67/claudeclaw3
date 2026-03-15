# Autoresearch Karpathy-Style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the existing A/B testing system with autonomous hypothesis generation, auto-revert, compound experiments, cross-product learning, and overnight batch generation -- inspired by Karpathy's autoresearch loop.

**Architecture:** Add 3 new models (ABStrategy, ABHypothesis, ABPlaybook) and extend existing services (ab_loop, ab_optimizer, ab_generator) with autonomous decision-making. The loop becomes a true autoresearch agent that generates hypotheses, tests them, keeps/reverts, and learns across products.

**Tech Stack:** Python, FastAPI, SQLAlchemy, Anthropic Claude API, MSSQL

**Existing code lives in:** `C:\Users\salomon.DC0\Documents\Python\Proyecto PIM\backend\`

---

## Task 1: New Models (ABStrategy, ABHypothesis, ABPlaybook)

**Files:**
- Modify: `backend/models.py` (append after ABOptimizationRun, ~line 1689)
- Modify: `backend/schemas.py` (append new Pydantic schemas)
- Create: `backend/migrations/create_autoresearch_tables.sql`

**Step 1: Add ABStrategy model to models.py**

Append after the ABOptimizationRun class:

```python
class ABStrategy(Base):
    """Strategy document for an experiment -- equivalent to Karpathy's program.md.

    Defines the goal, constraints, frozen dimensions, audience, and fitness weights
    that guide the autonomous agent when generating and evaluating variants.
    """
    __tablename__ = "ab_strategies"

    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(Integer, ForeignKey("ab_experiments.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Goal and constraints (human-authored, agent reads)
    objective = Column(Text, nullable=False)  # e.g. "maximizar redirect_rate a Home Depot"
    audience = Column(String(500), nullable=True)  # e.g. "homeowners 30-55, México"
    constraints = Column(JSON, nullable=True)  # ["No prometer precios", "Mantener branding OYD's"]

    # Dimension control
    explore_dimensions = Column(JSON, nullable=True)  # ["headline", "cta_text", "badge", "layout"]
    frozen_dimensions = Column(JSON, nullable=True)  # {"theme": "dark", "logo": "oyds-white.svg"}

    # Multi-metric fitness weights
    fitness_weights = Column(JSON, nullable=True)  # {"redirect_rate": 0.4, "lead_rate": 0.3, "ctr": 0.2, "avg_time": 0.1}

    # Exploration budget
    champion_traffic = Column(Float, default=0.80)  # 80% to current winner
    test_traffic = Column(Float, default=0.15)  # 15% to variants under evaluation
    wild_traffic = Column(Float, default=0.05)  # 5% to new AI-generated variants

    # Auto-revert config
    auto_revert_enabled = Column(Boolean, default=True)
    auto_revert_min_events = Column(Integer, default=50)  # Min events before reverting
    auto_revert_threshold = Column(Float, default=-0.10)  # Revert if fitness < control by this %

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    experiment = relationship("ABExperiment", backref="strategy", uselist=False)


class ABHypothesis(Base):
    """Tracks each hypothesis the agent generates and tests -- equivalent to results.tsv.

    Every variant change starts as a hypothesis. The agent measures before/after
    and either KEEPs or REVERTs the change.
    """
    __tablename__ = "ab_hypotheses"

    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(Integer, ForeignKey("ab_experiments.id", ondelete="CASCADE"), nullable=False)
    variant_id = Column(Integer, ForeignKey("ab_variants.id", ondelete="SET NULL"), nullable=True)

    # Hypothesis details
    hypothesis = Column(Text, nullable=False)  # "badge 'Más Vendido' increases CTR"
    dimension = Column(String(100), nullable=True)  # "badge", "headline", "cta_text"
    change_description = Column(Text, nullable=True)  # "Changed badge from null to 'Más Vendido'"

    # Metrics
    fitness_before = Column(Float, nullable=True)
    fitness_after = Column(Float, nullable=True)
    delta_pct = Column(Float, nullable=True)  # % change
    events_observed = Column(Integer, default=0)

    # Outcome
    status = Column(String(20), default="testing")  # testing, kept, reverted, pending
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    experiment = relationship("ABExperiment", backref="hypotheses")
    variant = relationship("ABVariant")


class ABPlaybook(Base):
    """Cross-product learning: patterns that win across multiple products.

    When a pattern wins in one experiment, it gets added to the playbook.
    New experiments start with playbook patterns as baseline.
    """
    __tablename__ = "ab_playbook"

    id = Column(Integer, primary_key=True, index=True)

    # Pattern identification
    dimension = Column(String(100), nullable=False)  # "theme", "cta_text", "layout"
    pattern_value = Column(String(500), nullable=False)  # "dark", "Comprar ahora", "hero-feature"

    # Evidence
    wins = Column(Integer, default=0)  # Times this pattern won
    losses = Column(Integer, default=0)  # Times it lost
    avg_fitness_delta = Column(Float, default=0.0)  # Average improvement when winning

    # Context
    product_categories = Column(JSON, nullable=True)  # ["camaras", "sensores"] -- where it won
    source_experiment_ids = Column(JSON, nullable=True)  # [1, 5, 12]

    # Confidence
    confidence = Column(Float, default=0.0)  # wins / (wins + losses) weighted by sample size

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

**Step 2: Add Pydantic schemas to schemas.py**

Append after existing AB schemas:

```python
# ============================================================================
# AUTORESEARCH SCHEMAS
# ============================================================================

class ABStrategyBase(BaseModel):
    objective: str
    audience: str | None = None
    constraints: list[str] | None = None
    explore_dimensions: list[str] | None = None
    frozen_dimensions: dict[str, Any] | None = None
    fitness_weights: dict[str, float] | None = None
    champion_traffic: float = 0.80
    test_traffic: float = 0.15
    wild_traffic: float = 0.05
    auto_revert_enabled: bool = True
    auto_revert_min_events: int = 50
    auto_revert_threshold: float = -0.10

class ABStrategyCreate(ABStrategyBase):
    experiment_id: int

class ABStrategyUpdate(BaseModel):
    objective: str | None = None
    audience: str | None = None
    constraints: list[str] | None = None
    explore_dimensions: list[str] | None = None
    frozen_dimensions: dict[str, Any] | None = None
    fitness_weights: dict[str, float] | None = None
    champion_traffic: float | None = None
    test_traffic: float | None = None
    wild_traffic: float | None = None
    auto_revert_enabled: bool | None = None
    auto_revert_min_events: int | None = None
    auto_revert_threshold: float | None = None

class ABStrategyResponse(ABStrategyBase):
    id: int
    experiment_id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class ABHypothesisBase(BaseModel):
    hypothesis: str
    dimension: str | None = None
    change_description: str | None = None

class ABHypothesisCreate(ABHypothesisBase):
    experiment_id: int
    variant_id: int | None = None

class ABHypothesisResponse(ABHypothesisBase):
    id: int
    experiment_id: int
    variant_id: int | None = None
    fitness_before: float | None = None
    fitness_after: float | None = None
    delta_pct: float | None = None
    events_observed: int = 0
    status: str = "testing"
    resolved_at: datetime | None = None
    created_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class ABPlaybookEntry(BaseModel):
    id: int
    dimension: str
    pattern_value: str
    wins: int = 0
    losses: int = 0
    avg_fitness_delta: float = 0.0
    product_categories: list[str] | None = None
    confidence: float = 0.0
    model_config = ConfigDict(from_attributes=True)


class ABAutoresearchReport(BaseModel):
    """Full report from an autoresearch loop run."""
    run_date: str
    trigger: str
    experiments_processed: int
    hypotheses_tested: int
    hypotheses_kept: int
    hypotheses_reverted: int
    new_variants_generated: int
    playbook_entries_updated: int
    results: list[dict[str, Any]]
```

**Step 3: Create SQL migration**

Create `backend/migrations/create_autoresearch_tables.sql`:

```sql
-- Autoresearch extension tables
-- Run after existing A/B testing tables are created

CREATE TABLE ab_strategies (
    id INT IDENTITY(1,1) PRIMARY KEY,
    experiment_id INT NOT NULL UNIQUE,
    objective NVARCHAR(MAX) NOT NULL,
    audience NVARCHAR(500) NULL,
    constraints NVARCHAR(MAX) NULL,  -- JSON
    explore_dimensions NVARCHAR(MAX) NULL,  -- JSON
    frozen_dimensions NVARCHAR(MAX) NULL,  -- JSON
    fitness_weights NVARCHAR(MAX) NULL,  -- JSON
    champion_traffic FLOAT DEFAULT 0.80,
    test_traffic FLOAT DEFAULT 0.15,
    wild_traffic FLOAT DEFAULT 0.05,
    auto_revert_enabled BIT DEFAULT 1,
    auto_revert_min_events INT DEFAULT 50,
    auto_revert_threshold FLOAT DEFAULT -0.10,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NULL,
    CONSTRAINT fk_strategy_experiment FOREIGN KEY (experiment_id) REFERENCES ab_experiments(id) ON DELETE CASCADE
);

CREATE TABLE ab_hypotheses (
    id INT IDENTITY(1,1) PRIMARY KEY,
    experiment_id INT NOT NULL,
    variant_id INT NULL,
    hypothesis NVARCHAR(MAX) NOT NULL,
    dimension NVARCHAR(100) NULL,
    change_description NVARCHAR(MAX) NULL,
    fitness_before FLOAT NULL,
    fitness_after FLOAT NULL,
    delta_pct FLOAT NULL,
    events_observed INT DEFAULT 0,
    status NVARCHAR(20) DEFAULT 'testing',  -- testing, kept, reverted, pending
    resolved_at DATETIMEOFFSET NULL,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT fk_hypothesis_experiment FOREIGN KEY (experiment_id) REFERENCES ab_experiments(id) ON DELETE CASCADE,
    CONSTRAINT fk_hypothesis_variant FOREIGN KEY (variant_id) REFERENCES ab_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_hypotheses_experiment ON ab_hypotheses(experiment_id, status);
CREATE INDEX idx_hypotheses_dimension ON ab_hypotheses(dimension);

CREATE TABLE ab_playbook (
    id INT IDENTITY(1,1) PRIMARY KEY,
    dimension NVARCHAR(100) NOT NULL,
    pattern_value NVARCHAR(500) NOT NULL,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    avg_fitness_delta FLOAT DEFAULT 0.0,
    product_categories NVARCHAR(MAX) NULL,  -- JSON
    source_experiment_ids NVARCHAR(MAX) NULL,  -- JSON
    confidence FLOAT DEFAULT 0.0,
    created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET NULL
);

CREATE UNIQUE INDEX idx_playbook_pattern ON ab_playbook(dimension, pattern_value);
```

**Step 4: Commit**

```bash
git add backend/models.py backend/schemas.py backend/migrations/create_autoresearch_tables.sql
git commit -m "feat: add autoresearch models (ABStrategy, ABHypothesis, ABPlaybook)"
```

---

## Task 2: Multi-Metric Fitness Function

**Files:**
- Create: `backend/services/ab_fitness.py`

**Step 1: Create fitness calculator**

```python
"""Multi-metric fitness function for A/B variant evaluation.

Instead of optimizing a single metric (CTR or lead_rate), computes a weighted
fitness score using the strategy's fitness_weights. Falls back to goal_metric
if no strategy exists.

Equivalent to Karpathy's val_bpb -- one number to compare variants.
"""
from sqlalchemy.orm import Session
from .. import models


DEFAULT_WEIGHTS = {
    "redirect_rate": 0.4,
    "lead_rate": 0.3,
    "ctr": 0.2,
}


def compute_fitness(variant_metrics: dict, weights: dict | None = None) -> float:
    """Compute weighted fitness score for a variant.

    Args:
        variant_metrics: Dict with keys like ctr, lead_rate, redirect_rate.
        weights: Dict mapping metric names to weights (must sum to ~1.0).

    Returns:
        Float fitness score (higher = better).
    """
    w = weights or DEFAULT_WEIGHTS
    score = 0.0
    for metric, weight in w.items():
        score += variant_metrics.get(metric, 0) * weight
    return round(score, 6)


def compute_experiment_fitness(
    db: Session,
    experiment_id: int,
    variant_metrics: list[dict],
) -> dict[str, float]:
    """Compute fitness for all variants in an experiment.

    Looks up ABStrategy for custom weights, falls back to defaults.

    Returns:
        Dict mapping variant_key to fitness score.
    """
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    weights = strategy.fitness_weights if strategy else None

    fitness_scores = {}
    for vm in variant_metrics:
        fitness_scores[vm["variant_key"]] = compute_fitness(vm, weights)

    return fitness_scores


def get_control_fitness(
    db: Session,
    experiment_id: int,
    variant_metrics: list[dict],
) -> float | None:
    """Get fitness of the control variant."""
    fitness = compute_experiment_fitness(db, experiment_id, variant_metrics)

    # Find control variant
    control = db.query(models.ABVariant).filter(
        models.ABVariant.experiment_id == experiment_id,
        models.ABVariant.is_control == True,
    ).first()

    if control and control.variant_key in fitness:
        return fitness[control.variant_key]

    # Fallback: return fitness of variant "A"
    return fitness.get("A")
```

**Step 2: Commit**

```bash
git add backend/services/ab_fitness.py
git commit -m "feat: add multi-metric fitness function for variant evaluation"
```

---

## Task 3: Auto-Revert for Underperforming Variants

**Files:**
- Create: `backend/services/ab_reverter.py`

**Step 1: Create auto-revert service**

```python
"""Auto-revert underperforming variants.

Karpathy pattern: if experiment doesn't improve, revert and try something else.

For each testing hypothesis:
1. Check if variant has enough events (min_events)
2. Compute fitness vs control
3. If fitness < control by threshold -> REVERT (remove variant, redistribute traffic)
4. If fitness > control -> KEEP (promote variant)
"""
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from .. import models
from .ab_fitness import compute_experiment_fitness, get_control_fitness
from .ab_analyzer import compute_experiment_metrics

log = logging.getLogger(__name__)


def check_and_revert(db: Session, experiment_id: int) -> list[dict]:
    """Check all testing hypotheses and revert underperformers.

    Returns list of actions taken: [{variant_key, action, reason, delta_pct}]
    """
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    if not strategy or not strategy.auto_revert_enabled:
        return []

    metrics = compute_experiment_metrics(db, experiment_id)
    if not metrics or not metrics.get("variants"):
        return []

    variant_metrics = metrics["variants"]
    fitness_scores = compute_experiment_fitness(db, experiment_id, variant_metrics)
    control_fitness = get_control_fitness(db, experiment_id, variant_metrics)

    if control_fitness is None or control_fitness == 0:
        return []

    # Get testing hypotheses
    hypotheses = db.query(models.ABHypothesis).filter(
        models.ABHypothesis.experiment_id == experiment_id,
        models.ABHypothesis.status == "testing",
    ).all()

    actions = []
    now = datetime.now(timezone.utc)

    for hyp in hypotheses:
        variant_key = None
        if hyp.variant:
            variant_key = hyp.variant.variant_key

        if not variant_key or variant_key not in fitness_scores:
            continue

        # Find events for this variant
        vm = next((v for v in variant_metrics if v["variant_key"] == variant_key), None)
        if not vm:
            continue

        events = vm.get("views", 0)
        if events < strategy.auto_revert_min_events:
            continue  # Not enough data yet

        variant_fitness = fitness_scores[variant_key]
        delta_pct = (variant_fitness - control_fitness) / control_fitness if control_fitness else 0

        hyp.fitness_before = control_fitness
        hyp.fitness_after = variant_fitness
        hyp.delta_pct = round(delta_pct * 100, 2)
        hyp.events_observed = events

        if delta_pct < strategy.auto_revert_threshold:
            # REVERT: variant underperforms
            hyp.status = "reverted"
            hyp.resolved_at = now

            # Remove variant from traffic split
            experiment = db.query(models.ABExperiment).filter(
                models.ABExperiment.id == experiment_id
            ).first()
            if experiment and experiment.traffic_split:
                split = dict(experiment.traffic_split)
                removed_traffic = split.pop(variant_key, 0)
                # Redistribute to remaining variants proportionally
                remaining_total = sum(split.values())
                if remaining_total > 0:
                    for k in split:
                        split[k] = round(split[k] + (removed_traffic * split[k] / remaining_total), 4)
                experiment.traffic_split = split

            actions.append({
                "variant_key": variant_key,
                "action": "reverted",
                "reason": f"fitness {delta_pct*100:+.1f}% vs control (threshold: {strategy.auto_revert_threshold*100:.0f}%)",
                "delta_pct": hyp.delta_pct,
                "events": events,
            })
            log.info(
                "Auto-reverted variant %s in experiment %d: %+.1f%% fitness vs control",
                variant_key, experiment_id, delta_pct * 100,
            )

        elif delta_pct > 0.05:  # At least 5% improvement
            # KEEP: variant outperforms
            hyp.status = "kept"
            hyp.resolved_at = now

            actions.append({
                "variant_key": variant_key,
                "action": "kept",
                "reason": f"fitness {delta_pct*100:+.1f}% vs control",
                "delta_pct": hyp.delta_pct,
                "events": events,
            })
            log.info(
                "Kept variant %s in experiment %d: %+.1f%% fitness vs control",
                variant_key, experiment_id, delta_pct * 100,
            )

    db.commit()
    return actions
```

**Step 2: Commit**

```bash
git add backend/services/ab_reverter.py
git commit -m "feat: add auto-revert service for underperforming variants"
```

---

## Task 4: Compound Experiments (Freeze Winners, Test Next Dimension)

**Files:**
- Create: `backend/services/ab_compounder.py`

**Step 1: Create compound experiment service**

```python
"""Compound experiment logic: freeze winning dimensions, test the next one.

After a hypothesis is KEPT for a dimension (e.g., headline), that value gets
frozen into the experiment's champion config. The agent then moves to the
next dimension in explore_dimensions and generates new variants for it.

This builds up a champion variant one dimension at a time, stacking improvements.
"""
import logging
from sqlalchemy.orm import Session
from .. import models

log = logging.getLogger(__name__)


def get_next_dimension(db: Session, experiment_id: int) -> str | None:
    """Get the next dimension to test, based on what's already been resolved.

    Looks at the strategy's explore_dimensions list and skips dimensions
    that already have a KEPT hypothesis.
    """
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    if not strategy or not strategy.explore_dimensions:
        return None

    # Get dimensions that have been resolved (kept)
    resolved = db.query(models.ABHypothesis.dimension).filter(
        models.ABHypothesis.experiment_id == experiment_id,
        models.ABHypothesis.status == "kept",
        models.ABHypothesis.dimension.isnot(None),
    ).distinct().all()

    resolved_dims = {r[0] for r in resolved}

    for dim in strategy.explore_dimensions:
        if dim not in resolved_dims:
            return dim

    return None  # All dimensions tested


def freeze_winning_dimension(db: Session, experiment_id: int, hypothesis_id: int) -> dict | None:
    """Freeze a winning dimension's value into the experiment's champion config.

    When a hypothesis is KEPT:
    1. Take the winning variant's value for that dimension
    2. Add it to frozen_dimensions in the strategy
    3. Update the control variant's config_overrides with the winning value
    4. Remove that dimension from explore_dimensions

    Returns the frozen dimension info or None.
    """
    hyp = db.query(models.ABHypothesis).filter(
        models.ABHypothesis.id == hypothesis_id
    ).first()

    if not hyp or hyp.status != "kept" or not hyp.dimension:
        return None

    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    if not strategy:
        return None

    # Get the winning variant's value for this dimension
    variant = hyp.variant
    if not variant or not variant.config_overrides:
        return None

    winning_value = variant.config_overrides.get(hyp.dimension)
    if winning_value is None:
        return None

    # Freeze it
    frozen = dict(strategy.frozen_dimensions or {})
    frozen[hyp.dimension] = winning_value
    strategy.frozen_dimensions = frozen

    # Remove from explore list
    explore = list(strategy.explore_dimensions or [])
    if hyp.dimension in explore:
        explore.remove(hyp.dimension)
    strategy.explore_dimensions = explore

    # Update control variant with winning value
    control = db.query(models.ABVariant).filter(
        models.ABVariant.experiment_id == experiment_id,
        models.ABVariant.is_control == True,
    ).first()

    if control:
        overrides = dict(control.config_overrides or {})
        overrides[hyp.dimension] = winning_value
        control.config_overrides = overrides

    db.commit()

    result = {
        "dimension": hyp.dimension,
        "winning_value": winning_value,
        "frozen_dimensions": frozen,
        "remaining_dimensions": explore,
    }

    log.info(
        "Froze dimension '%s' = '%s' in experiment %d. %d dimensions remaining.",
        hyp.dimension, winning_value, experiment_id, len(explore),
    )

    return result


def get_champion_config(db: Session, experiment_id: int) -> dict:
    """Build the current champion config from all frozen dimensions.

    This is the accumulated best config from all resolved hypotheses.
    """
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    return dict(strategy.frozen_dimensions or {}) if strategy else {}
```

**Step 2: Commit**

```bash
git add backend/services/ab_compounder.py
git commit -m "feat: add compound experiment service (freeze winners, test next dimension)"
```

---

## Task 5: Overnight Batch Generation

**Files:**
- Create: `backend/services/ab_batch_generator.py`

**Step 1: Create batch generation service**

```python
"""Overnight batch variant generation.

Karpathy runs ~100 experiments while sleeping. We generate 5-10 variant
hypotheses overnight, pre-filter with a critic prompt, and queue the best
2-3 for live testing the next day.

Flow:
1. Read strategy for each running experiment
2. Determine which dimension to test next (via compounder)
3. Generate N candidate variants with Claude
4. Score each with a critic prompt (persuasiveness, brand fit, clarity)
5. Keep top K candidates
6. Create ABHypothesis records (status=pending)
7. Optionally auto-deploy the best candidate
"""
import json
import logging
import os
from typing import Any

import anthropic

from sqlalchemy.orm import Session
from .. import models
from .ab_compounder import get_next_dimension, get_champion_config

log = logging.getLogger(__name__)

GENERATE_PROMPT = """You are an expert conversion rate optimizer for Mexican e-commerce.

Product: {product_name}
Category: {product_category}
Current champion config: {champion_config}

Strategy:
- Objective: {objective}
- Audience: {audience}
- Constraints: {constraints}

Your task: generate {num_candidates} variant ideas for the dimension "{dimension}".

The champion already uses these frozen values (DO NOT change these):
{frozen_dimensions}

For the "{dimension}" dimension, generate {num_candidates} creative alternatives.
Each should have a different strategic angle.

Return a JSON array of objects:
[
  {{
    "value": "the proposed value for {dimension}",
    "hypothesis": "why this might outperform (1 sentence)",
    "strategy_angle": "emotional|urgency|social_proof|benefit|curiosity|authority"
  }}
]

Return ONLY the JSON array.
"""

CRITIC_PROMPT = """You are a marketing conversion expert reviewing A/B test variant proposals.

Product: {product_name}
Dimension being tested: {dimension}
Target audience: {audience}
Constraints: {constraints}

Score each candidate from 0-100 on these criteria:
- persuasiveness (0-25): How compelling is it?
- clarity (0-25): Is the message immediately clear?
- brand_fit (0-25): Does it match the brand tone?
- differentiation (0-25): Is it meaningfully different from the control?

Candidates:
{candidates_json}

Return a JSON array with the same candidates plus a "score" field (sum of all criteria) and "reasoning" (1 sentence).
Return ONLY the JSON array.
"""


def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(api_key=api_key)


def _parse_json(text: str) -> list[dict]:
    import re
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", cleaned)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Could not parse JSON: {cleaned[:200]}")


def generate_candidates(
    db: Session,
    experiment_id: int,
    num_candidates: int = 6,
) -> list[dict]:
    """Generate candidate variants for the next dimension to test.

    Returns list of candidates with hypothesis and value.
    """
    experiment = db.query(models.ABExperiment).filter(
        models.ABExperiment.id == experiment_id
    ).first()
    if not experiment:
        return []

    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()
    if not strategy:
        return []

    # What dimension to test next?
    dimension = get_next_dimension(db, experiment_id)
    if not dimension:
        log.info("Experiment %d: all dimensions tested", experiment_id)
        return []

    # Get product info
    landing = experiment.landing_page
    product_name = landing.name if landing else "Unknown"
    product_category = "General"

    champion = get_champion_config(db, experiment_id)

    prompt = GENERATE_PROMPT.format(
        product_name=product_name,
        product_category=product_category,
        champion_config=json.dumps(champion, ensure_ascii=False),
        objective=strategy.objective,
        audience=strategy.audience or "General",
        constraints=json.dumps(strategy.constraints or [], ensure_ascii=False),
        dimension=dimension,
        frozen_dimensions=json.dumps(strategy.frozen_dimensions or {}, ensure_ascii=False),
        num_candidates=num_candidates,
    )

    client = _get_client()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    candidates = _parse_json(response.content[0].text)

    # Tag each candidate with dimension
    for c in candidates:
        c["dimension"] = dimension

    return candidates


def score_candidates(
    candidates: list[dict],
    product_name: str,
    audience: str,
    constraints: list[str],
) -> list[dict]:
    """Score candidates using a critic prompt. Returns candidates with score."""
    if not candidates:
        return []

    dimension = candidates[0].get("dimension", "unknown")

    prompt = CRITIC_PROMPT.format(
        product_name=product_name,
        dimension=dimension,
        audience=audience or "General",
        constraints=json.dumps(constraints or [], ensure_ascii=False),
        candidates_json=json.dumps(candidates, ensure_ascii=False, indent=2),
    )

    client = _get_client()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    scored = _parse_json(response.content[0].text)
    scored.sort(key=lambda x: x.get("score", 0), reverse=True)
    return scored


def run_overnight_batch(
    db: Session,
    experiment_id: int,
    num_candidates: int = 6,
    top_k: int = 2,
    auto_deploy: bool = False,
) -> dict:
    """Run the full overnight batch generation pipeline.

    1. Generate candidates
    2. Score with critic
    3. Create ABHypothesis records for top K
    4. Optionally create ABVariant and deploy

    Returns summary dict.
    """
    experiment = db.query(models.ABExperiment).filter(
        models.ABExperiment.id == experiment_id
    ).first()
    if not experiment:
        return {"error": "experiment_not_found"}

    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    # Step 1: Generate
    candidates = generate_candidates(db, experiment_id, num_candidates)
    if not candidates:
        return {
            "experiment_id": experiment_id,
            "candidates_generated": 0,
            "reason": "no_dimension_to_test",
        }

    dimension = candidates[0].get("dimension", "unknown")

    # Step 2: Score
    landing = experiment.landing_page
    scored = score_candidates(
        candidates,
        product_name=landing.name if landing else "Unknown",
        audience=strategy.audience if strategy else None,
        constraints=strategy.constraints if strategy else None,
    )

    # Step 3: Take top K
    winners = scored[:top_k]

    # Step 4: Create hypotheses
    created_hypotheses = []
    for i, candidate in enumerate(winners):
        variant_id = None

        if auto_deploy:
            # Create actual variant
            variant_key = chr(ord("D") + i)  # D, E, F... (A/B/C likely taken)
            # Find next available key
            existing_keys = {v.variant_key for v in experiment.variants}
            for letter in "DEFGHIJKLMNOP":
                if letter not in existing_keys:
                    variant_key = letter
                    break

            champion = get_champion_config(db, experiment_id)
            config = dict(champion)
            config[dimension] = candidate["value"]

            db_variant = models.ABVariant(
                experiment_id=experiment_id,
                variant_key=variant_key,
                config_overrides=config,
                is_control=False,
            )
            db.add(db_variant)
            db.flush()
            variant_id = db_variant.id

            # Allocate wild traffic to this variant
            if strategy and experiment.traffic_split:
                split = dict(experiment.traffic_split)
                wild_per_variant = (strategy.wild_traffic or 0.05) / top_k
                # Take from champion
                champion_key = max(split, key=split.get)
                split[champion_key] = round(split[champion_key] - wild_per_variant, 4)
                split[variant_key] = round(wild_per_variant, 4)
                experiment.traffic_split = split

        hyp = models.ABHypothesis(
            experiment_id=experiment_id,
            variant_id=variant_id,
            hypothesis=candidate.get("hypothesis", ""),
            dimension=dimension,
            change_description=f"{dimension} = '{candidate['value']}'",
            status="testing" if auto_deploy else "pending",
        )
        db.add(hyp)
        created_hypotheses.append({
            "hypothesis": candidate.get("hypothesis", ""),
            "value": candidate["value"],
            "score": candidate.get("score", 0),
            "status": "testing" if auto_deploy else "pending",
        })

    db.commit()

    return {
        "experiment_id": experiment_id,
        "dimension": dimension,
        "candidates_generated": len(candidates),
        "candidates_scored": len(scored),
        "hypotheses_created": len(created_hypotheses),
        "auto_deployed": auto_deploy,
        "hypotheses": created_hypotheses,
    }
```

**Step 2: Commit**

```bash
git add backend/services/ab_batch_generator.py
git commit -m "feat: add overnight batch generation with critic scoring"
```

---

## Task 6: Cross-Product Playbook Learning

**Files:**
- Create: `backend/services/ab_playbook.py`

**Step 1: Create playbook service**

```python
"""Cross-product playbook learning.

When a hypothesis is KEPT, record the winning pattern in the playbook.
When a hypothesis is REVERTED, record the loss.
When a new experiment starts, suggest playbook patterns as starting variants.

Karpathy insight: improvements in small models transfer to larger ones.
Our insight: improvements in one product category transfer to others.
"""
import logging
from sqlalchemy.orm import Session
from sqlalchemy import and_
from .. import models

log = logging.getLogger(__name__)


def record_outcome(
    db: Session,
    hypothesis: models.ABHypothesis,
    product_category: str | None = None,
) -> models.ABPlaybook | None:
    """Record a hypothesis outcome (kept/reverted) in the playbook.

    Updates existing playbook entry or creates a new one.
    """
    if not hypothesis.dimension or hypothesis.status not in ("kept", "reverted"):
        return None

    # Get the value that was tested
    variant = hypothesis.variant
    if not variant or not variant.config_overrides:
        return None

    value = variant.config_overrides.get(hypothesis.dimension)
    if value is None:
        return None

    value_str = str(value)

    # Find or create playbook entry
    entry = db.query(models.ABPlaybook).filter(
        and_(
            models.ABPlaybook.dimension == hypothesis.dimension,
            models.ABPlaybook.pattern_value == value_str,
        )
    ).first()

    if not entry:
        entry = models.ABPlaybook(
            dimension=hypothesis.dimension,
            pattern_value=value_str,
            wins=0,
            losses=0,
            avg_fitness_delta=0.0,
            product_categories=[],
            source_experiment_ids=[],
        )
        db.add(entry)

    # Update stats
    if hypothesis.status == "kept":
        entry.wins += 1
    else:
        entry.losses += 1

    # Update avg fitness delta
    if hypothesis.delta_pct is not None:
        total = entry.wins + entry.losses
        old_avg = entry.avg_fitness_delta or 0
        entry.avg_fitness_delta = round(
            (old_avg * (total - 1) + hypothesis.delta_pct) / total, 2
        )

    # Update confidence: Wilson score lower bound (simplified)
    total = entry.wins + entry.losses
    if total > 0:
        p = entry.wins / total
        z = 1.96  # 95% confidence
        denominator = 1 + z * z / total
        centre = p + z * z / (2 * total)
        spread = z * ((p * (1 - p) + z * z / (4 * total)) / total) ** 0.5
        entry.confidence = round((centre - spread) / denominator, 4)

    # Track categories and experiments
    categories = list(entry.product_categories or [])
    if product_category and product_category not in categories:
        categories.append(product_category)
    entry.product_categories = categories

    exp_ids = list(entry.source_experiment_ids or [])
    if hypothesis.experiment_id not in exp_ids:
        exp_ids.append(hypothesis.experiment_id)
    entry.source_experiment_ids = exp_ids

    db.commit()
    db.refresh(entry)

    log.info(
        "Playbook updated: %s='%s' -> %d wins, %d losses, confidence=%.2f",
        entry.dimension, entry.pattern_value, entry.wins, entry.losses, entry.confidence,
    )

    return entry


def get_suggested_variants(
    db: Session,
    dimensions: list[str] | None = None,
    min_confidence: float = 0.3,
    limit: int = 5,
) -> list[models.ABPlaybook]:
    """Get top playbook patterns to use as starting variants for a new experiment.

    Filters by dimensions if provided, returns highest-confidence patterns.
    """
    query = db.query(models.ABPlaybook).filter(
        models.ABPlaybook.confidence >= min_confidence,
        models.ABPlaybook.wins >= 2,  # At least 2 wins to be credible
    )

    if dimensions:
        query = query.filter(models.ABPlaybook.dimension.in_(dimensions))

    return query.order_by(models.ABPlaybook.confidence.desc()).limit(limit).all()


def build_playbook_variant(
    db: Session,
    experiment_id: int,
    dimensions: list[str] | None = None,
) -> dict | None:
    """Build a variant config from the best playbook patterns.

    For each dimension, picks the highest-confidence winning pattern.
    This becomes the "informed baseline" for new experiments.
    """
    suggestions = get_suggested_variants(db, dimensions)

    if not suggestions:
        return None

    config = {}
    used_patterns = []

    # Group by dimension, take best per dimension
    seen_dims = set()
    for entry in suggestions:
        if entry.dimension not in seen_dims:
            config[entry.dimension] = entry.pattern_value
            seen_dims.add(entry.dimension)
            used_patterns.append({
                "dimension": entry.dimension,
                "value": entry.pattern_value,
                "confidence": entry.confidence,
                "wins": entry.wins,
            })

    log.info(
        "Built playbook variant for experiment %d with %d patterns",
        experiment_id, len(config),
    )

    return {
        "config_overrides": config,
        "patterns_used": used_patterns,
    }
```

**Step 2: Commit**

```bash
git add backend/services/ab_playbook.py
git commit -m "feat: add cross-product playbook learning with Wilson confidence"
```

---

## Task 7: Enhanced Autoresearch Loop Orchestrator

**Files:**
- Modify: `backend/services/ab_loop.py` (rewrite)

**Step 1: Rewrite ab_loop.py with full autoresearch orchestration**

Replace the entire content of `ab_loop.py`:

```python
"""A/B Testing Autoresearch Loop -- Karpathy-style autonomous optimization.

Full cycle per experiment:
1. Auto-revert underperforming variants
2. Freeze winning dimensions (compound)
3. Update playbook with outcomes
4. Compute fitness scores
5. Optimize traffic split
6. Generate new hypotheses (overnight batch)
7. Build report

Designed to be called via cron (e.g., daily at 9am or weekly Monday).
"""
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from .. import models
from .ab_analyzer import compute_experiment_metrics
from .ab_optimizer import optimize_traffic_split
from .ab_reverter import check_and_revert
from .ab_compounder import freeze_winning_dimension, get_next_dimension
from .ab_playbook import record_outcome
from .ab_batch_generator import run_overnight_batch
from .ab_fitness import compute_experiment_fitness

log = logging.getLogger(__name__)


def run_ab_autoresearch(
    db: Session,
    trigger: str = "scheduled",
    generate_new: bool = True,
    auto_deploy: bool = True,
) -> dict:
    """Run the full autoresearch loop for all running experiments.

    Args:
        db: Database session
        trigger: "scheduled" or "manual"
        generate_new: Whether to generate new variant hypotheses
        auto_deploy: Whether to auto-deploy new variants to live traffic

    Returns:
        Full report dict.
    """
    run_date = datetime.now(timezone.utc).isoformat()

    experiments = db.query(models.ABExperiment).filter(
        models.ABExperiment.status == "running"
    ).all()

    if not experiments:
        log.info("No running experiments found")
        return {
            "run_date": run_date,
            "trigger": trigger,
            "experiments_processed": 0,
            "hypotheses_tested": 0,
            "hypotheses_kept": 0,
            "hypotheses_reverted": 0,
            "new_variants_generated": 0,
            "playbook_entries_updated": 0,
            "results": [],
        }

    total_kept = 0
    total_reverted = 0
    total_generated = 0
    total_playbook = 0
    results = []

    for experiment in experiments:
        exp_result = {
            "experiment_id": experiment.id,
            "experiment_name": experiment.name,
            "actions": [],
        }

        # Step 1: Auto-revert underperformers
        revert_actions = check_and_revert(db, experiment.id)
        exp_result["reverts"] = revert_actions
        total_reverted += sum(1 for a in revert_actions if a["action"] == "reverted")
        total_kept += sum(1 for a in revert_actions if a["action"] == "kept")

        # Step 2: Freeze winners and update playbook
        kept_hypotheses = db.query(models.ABHypothesis).filter(
            models.ABHypothesis.experiment_id == experiment.id,
            models.ABHypothesis.status == "kept",
            models.ABHypothesis.dimension.isnot(None),
        ).all()

        for hyp in kept_hypotheses:
            # Freeze the winning dimension
            freeze_result = freeze_winning_dimension(db, experiment.id, hyp.id)
            if freeze_result:
                exp_result["actions"].append({
                    "type": "freeze",
                    "dimension": freeze_result["dimension"],
                    "value": freeze_result["winning_value"],
                })

            # Update playbook
            entry = record_outcome(db, hyp)
            if entry:
                total_playbook += 1

        # Also record reverted hypotheses in playbook
        reverted_hypotheses = db.query(models.ABHypothesis).filter(
            models.ABHypothesis.experiment_id == experiment.id,
            models.ABHypothesis.status == "reverted",
        ).all()
        for hyp in reverted_hypotheses:
            entry = record_outcome(db, hyp)
            if entry:
                total_playbook += 1

        # Step 3: Compute metrics and optimize traffic split
        metrics = compute_experiment_metrics(db, experiment.id)
        if metrics and metrics["total_events"] >= experiment.min_events_for_optimization:
            # Add fitness scores to metrics
            fitness = compute_experiment_fitness(db, experiment.id, metrics["variants"])
            exp_result["fitness"] = fitness

            opt_run = optimize_traffic_split(db, experiment.id, metrics, trigger)
            if opt_run:
                exp_result["optimization"] = {
                    "old_split": opt_run.old_split,
                    "new_split": opt_run.new_split,
                    "winning_variant": opt_run.winning_variant,
                }

        # Step 4: Generate new hypotheses if configured
        if generate_new:
            next_dim = get_next_dimension(db, experiment.id)
            if next_dim:
                batch_result = run_overnight_batch(
                    db, experiment.id,
                    num_candidates=6,
                    top_k=2,
                    auto_deploy=auto_deploy,
                )
                exp_result["batch_generation"] = batch_result
                total_generated += batch_result.get("hypotheses_created", 0)

        results.append(exp_result)

    summary = {
        "run_date": run_date,
        "trigger": trigger,
        "experiments_processed": len(experiments),
        "hypotheses_tested": total_kept + total_reverted,
        "hypotheses_kept": total_kept,
        "hypotheses_reverted": total_reverted,
        "new_variants_generated": total_generated,
        "playbook_entries_updated": total_playbook,
        "results": results,
    }

    log.info(
        "Autoresearch complete: %d experiments, %d kept, %d reverted, %d new variants",
        len(experiments), total_kept, total_reverted, total_generated,
    )

    return summary
```

**Step 2: Commit**

```bash
git add backend/services/ab_loop.py
git commit -m "feat: rewrite autoresearch loop with full Karpathy-style orchestration"
```

---

## Task 8: New API Endpoints

**Files:**
- Modify: `backend/routers/ab_testing.py` (add strategy, hypothesis, playbook, batch endpoints)

**Step 1: Add new endpoints to ab_testing.py**

Append these sections after the existing code:

```python
# ============================================================================
# STRATEGY (program.md equivalent)
# ============================================================================

@router.post("/experiments/{experiment_id}/strategy", response_model=schemas.ABStrategyResponse, status_code=status.HTTP_201_CREATED)
def create_strategy(
    experiment_id: int,
    strategy: schemas.ABStrategyCreate,
    db: Session = Depends(get_db),
):
    """Create or update the strategy for an experiment."""
    existing = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()

    if existing:
        for field, value in strategy.model_dump(exclude={"experiment_id"}, exclude_unset=True).items():
            setattr(existing, field, value)
        db.commit()
        db.refresh(existing)
        return existing

    db_strategy = models.ABStrategy(
        experiment_id=experiment_id,
        **strategy.model_dump(exclude={"experiment_id"}),
    )
    db.add(db_strategy)
    db.commit()
    db.refresh(db_strategy)
    return db_strategy


@router.get("/experiments/{experiment_id}/strategy", response_model=schemas.ABStrategyResponse)
def get_strategy(experiment_id: int, db: Session = Depends(get_db)):
    """Get the strategy for an experiment."""
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="No strategy for this experiment")
    return strategy


@router.patch("/experiments/{experiment_id}/strategy", response_model=schemas.ABStrategyResponse)
def update_strategy(
    experiment_id: int,
    data: schemas.ABStrategyUpdate,
    db: Session = Depends(get_db),
):
    """Update the strategy for an experiment."""
    strategy = db.query(models.ABStrategy).filter(
        models.ABStrategy.experiment_id == experiment_id
    ).first()
    if not strategy:
        raise HTTPException(status_code=404, detail="No strategy for this experiment")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(strategy, field, value)

    db.commit()
    db.refresh(strategy)
    return strategy


# ============================================================================
# HYPOTHESES (experiment journal)
# ============================================================================

@router.get("/experiments/{experiment_id}/hypotheses", response_model=List[schemas.ABHypothesisResponse])
def list_hypotheses(
    experiment_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List hypotheses for an experiment. Optionally filter by status."""
    query = db.query(models.ABHypothesis).filter(
        models.ABHypothesis.experiment_id == experiment_id
    )
    if status_filter:
        query = query.filter(models.ABHypothesis.status == status_filter)
    return query.order_by(models.ABHypothesis.created_at.desc()).all()


# ============================================================================
# PLAYBOOK
# ============================================================================

@router.get("/playbook", response_model=List[schemas.ABPlaybookEntry])
def get_playbook(
    min_confidence: float = 0.0,
    dimension: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get playbook entries. Filter by dimension or min confidence."""
    query = db.query(models.ABPlaybook).filter(
        models.ABPlaybook.confidence >= min_confidence
    )
    if dimension:
        query = query.filter(models.ABPlaybook.dimension == dimension)
    return query.order_by(models.ABPlaybook.confidence.desc()).all()


@router.get("/playbook/suggest/{experiment_id}")
def suggest_from_playbook(experiment_id: int, db: Session = Depends(get_db)):
    """Get playbook-suggested variant config for a new experiment."""
    from ..services.ab_playbook import build_playbook_variant
    result = build_playbook_variant(db, experiment_id)
    if not result:
        return {"suggestion": None, "reason": "no_playbook_patterns_with_sufficient_confidence"}
    return {"suggestion": result}


# ============================================================================
# BATCH GENERATION
# ============================================================================

@router.post("/experiments/{experiment_id}/generate-batch")
def trigger_batch_generation(
    experiment_id: int,
    num_candidates: int = 6,
    top_k: int = 2,
    auto_deploy: bool = False,
    db: Session = Depends(get_db),
):
    """Trigger overnight batch generation for an experiment.

    Generates candidate variants, scores them, and creates hypotheses.
    Set auto_deploy=true to immediately deploy winning candidates.
    """
    from ..services.ab_batch_generator import run_overnight_batch
    return run_overnight_batch(
        db, experiment_id,
        num_candidates=num_candidates,
        top_k=top_k,
        auto_deploy=auto_deploy,
    )
```

**Step 2: Update the run-loop endpoint**

Replace the existing `/run-loop` endpoint:

```python
@router.post("/run-loop")
def trigger_autoresearch_loop(
    trigger: str = "manual",
    generate_new: bool = True,
    auto_deploy: bool = False,
    db: Session = Depends(get_db),
):
    """Trigger the full autoresearch loop.

    1. Auto-revert underperformers
    2. Freeze winners (compound)
    3. Update playbook
    4. Optimize traffic splits
    5. Generate new hypotheses (if generate_new=true)
    """
    return run_ab_autoresearch(
        db, trigger=trigger,
        generate_new=generate_new,
        auto_deploy=auto_deploy,
    )
```

**Step 3: Commit**

```bash
git add backend/routers/ab_testing.py
git commit -m "feat: add strategy, hypothesis, playbook, and batch generation endpoints"
```

---

## Task 9: Cron Setup in ClaudeClaw

After deploying the PIM backend changes, set up the cron job in ClaudeClaw:

```bash
# Daily autoresearch loop at 6am (overnight results ready by morning)
node "C:/Users/salomon.DC0/Documents/Python/claudeclaw3-bueno/dist/schedule-cli.js" create \
  "Run the A/B autoresearch loop: curl -s -X POST http://localhost:5173/api/ab-testing/run-loop?trigger=scheduled&generate_new=true&auto_deploy=true | jq . Then send a Telegram summary of: experiments processed, hypotheses kept/reverted, new variants generated, and any playbook updates." \
  "0 6 * * *"
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `services/ab_fitness.py` | Multi-metric weighted fitness function |
| `services/ab_reverter.py` | Auto-revert underperforming variants |
| `services/ab_compounder.py` | Freeze winners, test next dimension |
| `services/ab_batch_generator.py` | Overnight AI variant generation with critic |
| `services/ab_playbook.py` | Cross-product pattern learning |
| `services/ab_loop.py` | Enhanced orchestrator (rewrite) |
| `migrations/create_autoresearch_tables.sql` | New DB tables |

## Modified Files

| File | Changes |
|------|---------|
| `models.py` | +ABStrategy, +ABHypothesis, +ABPlaybook |
| `schemas.py` | +Strategy, Hypothesis, Playbook, Report schemas |
| `routers/ab_testing.py` | +Strategy CRUD, +Hypotheses, +Playbook, +Batch gen, enhanced run-loop |
