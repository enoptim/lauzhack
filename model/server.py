"""Minimal JSON API around the engine, for the 3D frontend.

    pip install fastapi uvicorn
    uvicorn server:app --reload --port 8000

All bodies are JSON. A scenario is a list of swaps, e.g.
    [{"group": "lighting", "option": "lighting_mid", "floor": 2}, {"group": "monitors", "option": "monitors_mid", "year": 1}]
Events are a list of event ids, e.g. ["new_lab", "heatwave_summer"].
"""
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import engine
import montecarlo
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


@app.get("/playground", include_in_schema=False)
def playground():
    """A page for trying the engine by hand: http://localhost:8000/playground"""
    return FileResponse(Path(__file__).parent / "playground" / "index.html")
