"""Minimal JSON API around the engine, for the 3D frontend.

    pip install fastapi uvicorn
    uvicorn server:app --reload --port 8000

All bodies are JSON. A scenario is a list of swaps, e.g.
    [{"group": "lighting", "option": "lighting_mid", "floor": 2}, {"group": "monitors", "option": "monitors_mid", "year": 1}]
Events are a list of event ids, e.g. ["new_lab", "heatwave_summer"].
"""
import os
import sys
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import engine
import montecarlo
import optimize
import viz

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # repo root, for chat/
from chat import agent  # noqa: E402

DATA = engine.load()
app = FastAPI(title="BC twin engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Run(BaseModel):
    scenario: list = []
    events: list = []
    overrides: dict = {}
    year: int = 1


class Preview(BaseModel):
    scenario: list = []
    swap: dict
    events: list = []
    overrides: dict = {}


class Futures(BaseModel):
    scenarios: dict
    n: int = 200
    seed: int = 2026
    events: list = []
    overrides: dict = {}


class Breakeven(BaseModel):
    scenario: list = []
    events: list = []
    overrides: dict = {}
    param: str = "electricity_price_chf_kwh"


class Chat(BaseModel):
    messages: list
    scenario: list = []


class Optimize(BaseModel):
    """See the Optimizer section in README.md. Fields a goal doesn't use are ignored."""
    goal: Literal["min_cost_for_target", "max_savings", "min_total_cost", "custom"]
    metric: str | None = None             # min_cost_for_target, max_savings
    target: float | None = None           # min_cost_for_target
    budget: float | None = None           # the most cost_metric may be (min_total_cost: up-front cost)
    cost_metric: str = "upfront_cost_chf"
    years: int | None = None              # min_total_cost
    basis: Literal["chf", "kwh"] = "chf"  # min_total_cost
    objective: dict | None = None         # custom
    constraints: list = []
    scope: dict | None = None
    events: list = []
    overrides: dict = {}
    granularity: Literal["floor", "building"] = "floor"
    horizon_years: int | None = None
    discounted: bool = False
    include_residual: bool = True
    include_engine_output: bool = True


class Pareto(BaseModel):
    x_metric: str = "upfront_cost_chf"
    y_metric: str = "operating_cost_saving_chf_year"
    constraints: list = []
    scope: dict | None = None
    events: list = []
    overrides: dict = {}
    granularity: Literal["floor", "building"] = "floor"
    horizon_years: int | None = None
    discounted: bool = False
    include_residual: bool = True
    max_points: int | None = 15


@app.get("/api/catalog")
def catalog():
    return viz.catalog(DATA)


@app.get("/api/assumptions")
def assumptions():
    return viz.assumptions(DATA)


@app.post("/api/simulate")
def simulate(body: Run):
    return viz.run(DATA, body.scenario, body.events, body.overrides, body.year)


@app.post("/api/preview")
def preview(body: Preview):
    return viz.preview(DATA, body.scenario, body.swap, body.events, body.overrides)


@app.post("/api/stress_test")
def stress_test(body: Run):
    return viz.clean(engine.stress_test(DATA, body.scenario, overrides=body.overrides))


@app.post("/api/tornado")
def tornado(body: Run):
    return viz.clean(engine.tornado(DATA, body.scenario, body.events, top=10, overrides=body.overrides))


@app.post("/api/bands")
def bands(body: Run):
    return viz.clean(engine.bands(DATA, body.scenario, body.events, overrides=body.overrides))


@app.post("/api/futures")
def futures(body: Futures):
    res = montecarlo.run(DATA, body.scenarios, n=min(body.n, 500), seed=body.seed,
                         events=body.events, overrides=body.overrides)
    res.pop("futures")
    return viz.clean(res)


@app.post("/api/chat")
def chat(body: Chat):
    """The assistant (chat/agent.py). Needs OPENROUTER_API_KEY in chat/.env."""
    if not body.messages or body.messages[-1].get("role") != "user":
        raise HTTPException(400, "The last message must be from the user.")
    try:
        return viz.clean(agent.chat(body.messages, body.scenario))
    except RuntimeError as e:  # missing key or OpenRouter error
        raise HTTPException(502, str(e))


@app.post("/api/breakeven")
def breakeven(body: Breakeven):
    if body.param not in DATA["params"]:
        raise HTTPException(status_code=400, detail=f"Unknown assumption: {body.param}")
    return viz.clean(engine.breakeven(DATA, body.scenario, body.events, body.overrides, body.param))


def _optimize(b: Optimize):
    common = dict(scope=b.scope, events=b.events, overrides=b.overrides, granularity=b.granularity,
                  include_engine_output=b.include_engine_output)
    timeframe = dict(horizon_years=b.horizon_years, discounted=b.discounted, include_residual=b.include_residual)
    if b.goal == "min_cost_for_target":
        if b.metric is None or b.target is None:
            raise ValueError("min_cost_for_target needs a metric and a target.")
        cap = [{"metric": b.cost_metric, "max": b.budget}] if b.budget is not None else []
        return optimize.min_cost_for_target(DATA, b.metric, b.target, cost_metric=b.cost_metric,
                                            constraints=b.constraints + cap, **common, **timeframe)
    if b.goal == "max_savings":
        return optimize.max_savings(DATA, metric=b.metric or "operating_cost_saving_chf_year", budget=b.budget,
                                    cost_metric=b.cost_metric, constraints=b.constraints, **common, **timeframe)
    if b.goal == "min_total_cost":  # years is the timeframe here
        if b.years is None:
            raise ValueError("min_total_cost needs years.")
        return optimize.min_total_cost(DATA, b.years, basis=b.basis, budget=b.budget, constraints=b.constraints,
                                       discounted=b.discounted, include_residual=b.include_residual, **common)
    if not b.objective:
        raise ValueError("custom needs an objective, e.g. {\"metric\": \"upfront_cost_chf\", \"sense\": \"min\"}.")
    return optimize.solve(DATA, b.objective, constraints=b.constraints, **common, **timeframe)


@app.post("/api/optimize")
def optimize_plan(body: Optimize):
    """Search for the best set of upgrades for a goal. ValueError (bad metric, conflicting scope) → 400."""
    try:
        return viz.clean(_optimize(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/pareto")
def pareto(body: Pareto):
    """The plans no other plan beats on both axes (e.g. up-front cost vs yearly saving), sorted by x."""
    try:
        return viz.clean(optimize.pareto(DATA, **body.model_dump()))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/optimize/options")
def optimize_options(granularity: Literal["floor", "building"] = "floor"):
    """Metrics and zones (decisions), so a UI can build its menus."""
    return viz.clean({"metrics": optimize.METRICS, "zones": optimize.zones(DATA, granularity)})


@app.get("/playground", include_in_schema=False)
def playground():
    """A page for trying the engine by hand: http://localhost:8000/playground"""
    return FileResponse(Path(__file__).parent / "playground" / "index.html")


def _warm_up():
    """Work out the default trade-off curve once, in the background, for the API and for the assistant.
    The optimizer keeps every plan it has tried, so the first "what are my options?" then takes about
    1 second instead of 4. Set TWIN_WARMUP=0 to skip it."""
    try:
        optimize.pareto(DATA)                    # POST /api/pareto with the default settings
        agent.tools.upgrade_tradeoffs()          # the assistant's upgrade_tradeoffs with the default settings
    except Exception as e:                       # a failed warm-up only means the first request is slower
        print(f"Optimizer warm-up failed: {e!r}", file=sys.stderr)


if os.environ.get("TWIN_WARMUP", "1") != "0":
    threading.Thread(target=_warm_up, daemon=True, name="optimizer-warm-up").start()
