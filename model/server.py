"""Minimal JSON API around the engine, for the 3D frontend.

    pip install fastapi uvicorn
    uvicorn server:app --reload --port 8000

All bodies are JSON. A scenario is a list of swaps, e.g.
    [{"group": "lighting", "option": "lighting_mid", "floor": 2}, {"group": "monitors", "option": "monitors_mid", "year": 1}]
Events are a list of event ids, e.g. ["new_lab", "heatwave_summer"].
"""
import json
import random
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import engine
import montecarlo
import session as play
import viz

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


@app.post("/api/breakeven")
def breakeven(body: Breakeven):
    if body.param not in DATA["params"]:
        raise HTTPException(status_code=400, detail=f"Unknown assumption: {body.param}")
    return viz.clean(engine.breakeven(DATA, body.scenario, body.events, body.overrides, body.param))


# ---------------------------------------------------------------- play through one future (session.py)
# Sessions live in memory: a restart forgets them. Fine for the hackathon.
SESSIONS = {}


class SessionStart(BaseModel):
    future: str | dict = "ventilation_failure"


class SessionId(BaseModel):
    session_id: str


class SessionDecide(BaseModel):
    session_id: str
    swaps: list


class SessionPlan(BaseModel):
    session_id: str
    plan: list


class SessionPreview(BaseModel):
    session_id: str
    swap: dict | list


class SessionOutlook(BaseModel):
    session_id: str
    n: int = 100
    seed: int = 2026


def _session(session_id):
    if session_id not in SESSIONS:
        raise HTTPException(404, f"No session {session_id!r}. Sessions are lost when the server restarts.")
    return SESSIONS[session_id]


@app.get("/api/session/futures")
def session_futures():
    """The scripted futures you can play, with a one-line description each."""
    scripts = json.load(open(montecarlo.SCRIPTED))
    return [{"name": k, "description": v.get("description", "")} for k, v in sorted(scripts.items())]


@app.post("/api/session/start")
def session_start(body: SessionStart):
    """Start playing a scripted future by name, or a sampled one with {"seed": 42}."""
    try:
        if isinstance(body.future, str):
            future, name = montecarlo.load_scripted(DATA, body.future), body.future
        elif "seed" in body.future:
            seed = int(body.future["seed"])
            future, name = montecarlo.draw_future(DATA, random.Random(seed)), f"sampled future (seed {seed})"
        else:
            raise ValueError('future must be a scripted future\'s name or {"seed": <number>}')
    except ValueError as e:
        raise HTTPException(400, str(e))
    session, state = play.start(DATA, future, name)
    session_id = uuid.uuid4().hex
    SESSIONS[session_id] = session
    return {"session_id": session_id, **state}


@app.post("/api/session/next")
def session_next(body: SessionId):
    return {"session_id": body.session_id, **play.next_pause(DATA, _session(body.session_id))}


@app.post("/api/session/decide")
def session_decide(body: SessionDecide):
    try:
        return {"session_id": body.session_id, **play.decide(DATA, _session(body.session_id), body.swaps)}
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/session/plan")
def session_plan(body: SessionPlan):
    """Replace everything not done yet with this plan; done decisions stay."""
    try:
        return {"session_id": body.session_id, **play.set_plan(DATA, _session(body.session_id), body.plan)}
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/session/preview")
def session_preview(body: SessionPreview):
    try:
        return play.preview(DATA, _session(body.session_id), body.swap)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/session/outlook")
def session_outlook(body: SessionOutlook):
    if not 1 <= body.n <= 500:
        raise HTTPException(400, "n must be between 1 and 500.")
    return play.outlook(DATA, _session(body.session_id), body.n, body.seed)


@app.get("/api/session/{session_id}")
def session_get(session_id: str):
    return {"session_id": session_id, **_session(session_id)["state"]}


@app.get("/playground", include_in_schema=False)
def playground():
    """A page for trying the engine by hand: http://localhost:8000/playground"""
    return FileResponse(Path(__file__).parent / "playground" / "index.html")
