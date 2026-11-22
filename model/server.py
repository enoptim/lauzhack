"""Minimal JSON API around the engine, for the 3D frontend.

    pip install fastapi uvicorn
    uvicorn server:app --reload --port 8000

All bodies are JSON. A scenario is a list of swaps, e.g.
    [{"group": "lighting", "option": "lighting_mid", "floor": 2}, {"group": "monitors", "option": "monitors_mid", "year": 1}]
Events are a list of event ids, e.g. ["new_lab", "heatwave_summer"].
"""
import json
import os
import queue
import sys
import threading
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import engine
import montecarlo
import optimize
import search
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


class Optimize(BaseModel):
    problem: dict


class Evaluate(BaseModel):
    problem: dict
    scenario: list = []


class Search(BaseModel):
    """See the Search section in README.md. Fields a goal doesn't use are ignored."""
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


class Chat(BaseModel):
    messages: list
    scenario: list = []
    confirm: dict | None = None
    context: str | None = None  # what the user is looking at in the app, in words
    plans: list = []  # the user's plans in the app: [{"id", "name", "changes", "source"}], so the assistant can remove them


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


_POOL = None
_POOL_LOCK = threading.Lock()


def _futures_pool():
    """Worker processes for the futures run, started on first use. None means: run in this process."""
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            try:
                _POOL = montecarlo.make_pool()
            except Exception:  # noqa: BLE001 - no processes available: fall back to one process
                _POOL = False
        return _POOL or None


@app.on_event("shutdown")
def _stop_futures_pool():
    if _POOL:
        _POOL.shutdown(wait=False, cancel_futures=True)


@app.post("/api/futures")
def futures(body: Futures):
    if len(body.scenarios) > 6:
        raise HTTPException(status_code=400, detail="At most 6 plans at once.")
    args = dict(n=min(body.n, 500), seed=body.seed, events=body.events, overrides=body.overrides)
    pool = _futures_pool()
    try:
        res = montecarlo.run(DATA, body.scenarios, pool=pool, **args)
    except Exception:  # noqa: BLE001 - a broken worker pool: answer from this process instead
        res = montecarlo.run(DATA, body.scenarios, **args)
    res.pop("futures")
    return viz.clean(res)


@app.post("/api/chat")
def chat(body: Chat):
    """The assistant (chat/agent.py). Needs OPENROUTER_API_KEY in chat/.env."""
    if not body.messages or body.messages[-1].get("role") != "user":
        raise HTTPException(400, "The last message must be from the user.")
    try:
        return viz.clean(agent.chat(body.messages, body.scenario, body.confirm, context=body.context, plans=body.plans))
    except RuntimeError as e:  # missing key or OpenRouter error
        raise HTTPException(502, str(e))


@app.post("/api/chat/stream")
def chat_stream(body: Chat):
    """The assistant, live. One JSON object per line: "thinking" and "text" pieces, "tool_start" and "tool_end" for
    each job, then "done" with the same answer as /api/chat, or "error"."""
    if not body.messages or body.messages[-1].get("role") != "user":
        raise HTTPException(400, "The last message must be from the user.")
    events = queue.Queue()

    def work():
        try:
            out = agent.chat(body.messages, body.scenario, body.confirm, context=body.context, on_event=events.put,
                             plans=body.plans)
            events.put({"type": "done", "result": out})
        except Exception as e:  # missing key, OpenRouter error, engine error
            events.put({"type": "error", "message": str(e)[:500]})
        events.put(None)

    def lines():
        threading.Thread(target=work, daemon=True).start()
        while True:
            try:
                event = events.get(timeout=10)
            except queue.Empty:
                yield '{"type": "ping"}\n'  # keeps the line open while a slow job runs
                continue
            if event is None:
                return
            yield json.dumps(viz.clean(event)) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/breakeven")
def breakeven(body: Breakeven):
    if body.param not in DATA["params"]:
        raise HTTPException(status_code=400, detail=f"Unknown assumption: {body.param}")
    return viz.clean(engine.breakeven(DATA, body.scenario, body.events, body.overrides, body.param))


@app.get("/api/metrics")
def metrics():
    """Goals and limits an optimization problem can use (model/optimize.py)."""
    return [{"metric": k, "unit": u, "sense": sense, "kind": kind, "description": d}
            for k, (u, sense, kind, d) in optimize.METRICS.items()]


@app.post("/api/optimize")
def optimize_plan(body: Optimize):
    """Best plan for a goal under limits. The problem format is in model/optimize.py."""
    try:
        return viz.clean(optimize.solve(DATA, body.problem))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/evaluate")
def evaluate(body: Evaluate):
    """Score one scenario against a problem: metrics, limits missed, objective. For optimizers outside Python."""
    try:
        res = optimize.evaluate_scenario(DATA, optimize.normalize(DATA, body.problem), body.scenario)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    return viz.clean({k: v for k, v in res.items() if not k.startswith("_")})


def _search(b: Search):
    common = dict(scope=b.scope, events=b.events, overrides=b.overrides, granularity=b.granularity,
                  include_engine_output=b.include_engine_output)
    timeframe = dict(horizon_years=b.horizon_years, discounted=b.discounted, include_residual=b.include_residual)
    if b.goal == "min_cost_for_target":
        if b.metric is None or b.target is None:
            raise ValueError("min_cost_for_target needs a metric and a target.")
        cap = [{"metric": b.cost_metric, "max": b.budget}] if b.budget is not None else []
        return search.min_cost_for_target(DATA, b.metric, b.target, cost_metric=b.cost_metric,
                                            constraints=b.constraints + cap, **common, **timeframe)
    if b.goal == "max_savings":
        return search.max_savings(DATA, metric=b.metric or "operating_cost_saving_chf_year", budget=b.budget,
                                    cost_metric=b.cost_metric, constraints=b.constraints, **common, **timeframe)
    if b.goal == "min_total_cost":  # years is the timeframe here
        if b.years is None:
            raise ValueError("min_total_cost needs years.")
        return search.min_total_cost(DATA, b.years, basis=b.basis, budget=b.budget, constraints=b.constraints,
                                       discounted=b.discounted, include_residual=b.include_residual, **common)
    if not b.objective:
        raise ValueError("custom needs an objective, e.g. {\"metric\": \"upfront_cost_chf\", \"sense\": \"min\"}.")
    return search.solve(DATA, b.objective, constraints=b.constraints, **common, **timeframe)


@app.post("/api/search")
def search_plan(body: Search):
    """Search for the best set of upgrades for a goal. ValueError (bad metric, conflicting scope) → 400."""
    try:
        return viz.clean(_search(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/pareto")
def pareto(body: Pareto):
    """The plans no other plan beats on both axes (e.g. up-front cost vs yearly saving), sorted by x."""
    try:
        return viz.clean(search.pareto(DATA, **body.model_dump()))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/search/options")
def search_options(granularity: Literal["floor", "building"] = "floor"):
    """Metrics and zones (decisions), so a UI can build its menus."""
    return viz.clean({"metrics": search.METRICS, "zones": search.zones(DATA, granularity)})


@app.get("/playground", include_in_schema=False)
def playground():
    """A page for trying the engine by hand: http://localhost:8000/playground"""
    return FileResponse(Path(__file__).parent / "playground" / "index.html")


def _warm_up():
    """Work out the default trade-off curve once, in the background, for the API and for the assistant.
    The optimizer keeps every plan it has tried, so the first "what are my options?" then takes about
    1 second instead of 4. Set TWIN_WARMUP=0 to skip it."""
    try:
        search.pareto(DATA)                      # POST /api/pareto with the default settings
        agent.tools.upgrade_tradeoffs()          # the assistant's upgrade_tradeoffs with the default settings
    except Exception as e:                       # a failed warm-up only means the first request is slower
        print(f"Optimizer warm-up failed: {e!r}", file=sys.stderr)


if os.environ.get("TWIN_WARMUP", "1") != "0":
    threading.Thread(target=_warm_up, daemon=True, name="optimizer-warm-up").start()
