"""Many possible futures for the BC twin.

A future is one sampled version of the world over the horizon:
  - world varies (aleatoric): a yearly electricity price path, which events happen and when
    (heatwave summers, price spikes, the new lab), when each old unit actually fails, and a seed
    for the lives of units installed later (engine.unit_life);
  - we don't know (epistemic): the strength of the people effects, drawn once per future
    from each coupling parameter's low / central / high range (triangular).
Accounting stays exact in every future: each run is an ordinary simulate() call.

Common random numbers: every scenario, and the 'do nothing' path inside each run, faces the
same futures, so differences between plans come from the decision, not from luck.

Percentiles describe the spread of outcomes under these assumed distributions. They are not
known real-world probabilities.
"""
import json
import math
import random

import engine


def _tri(rng, lo, mode, hi):
    return mode if lo == hi else rng.triangular(lo, hi, mode)


# Yearly random events: (event id, probability key in the assumptions).
YEARLY_EVENTS = (("heatwave_summer", "heatwave_prob_per_year"), ("energy_price_spike", "price_spike_prob_per_year"))


def _price_walk(rng, p, start, years):
    """Electricity price multipliers for `years` years: a random walk in log space from `start`, clipped."""
    path, m = [], start
    for _ in range(years):
        m *= math.exp(rng.gauss(0.0, p["price_volatility_per_year"]))
        m = min(max(m, p["price_path_min"]), p["price_path_max"])
        path.append(m)
    return path


def _draw_lab(rng, p):
    """The new lab: comes in a random year up to new_lab_latest_year, or never."""
    if rng.random() >= p["new_lab_prob_never"]:
        return {"id": "new_lab", "start_year": rng.randint(1, int(p["new_lab_latest_year"])), "end_year": None}
    return None


def _draw_remaining(rng, p, item, life, H):
    """Years until the item's current unit actually fails."""
    actual = life * rng.triangular(p["lifetime_spread_low"], p["lifetime_spread_high"], 1.0)
    age = item["age"] or 0
    if actual > age:
        return actual - age
    n = 0                           # already past its life and still running: fails with a yearly hazard
    while rng.random() >= p["overdue_failure_prob_per_year"] and n < H:
        n += 1
    return n


def _draw_params(rng, data):
    """Strength of the people effects: one draw per future from each coupling parameter's range."""
    params = {}
    for k, meta in data["param_meta"].items():
        if meta["category"] == "coupling":
            lo, hi = data["ranges"][k]
            params[k] = _tri(rng, lo, data["params"][k], hi)
    return params


def draw_future(data, rng):
    p = data["params"]
    H = int(p["horizon_years"])
    path = _price_walk(rng, p, 1.0, H)
    events = []
    for y in range(1, H + 1):
        for eid, prob in YEARLY_EVENTS:
            if rng.random() < p[prob]:
                events.append({"id": eid, "start_year": y, "end_year": y})
    lab = _draw_lab(rng, p)
    if lab:
        events.append(lab)
    # when each old unit actually fails (drawn per item, independent of any scenario)
    remaining = {i["id"]: _draw_remaining(rng, p, i, data["options"][i["option"]]["lifetime_years"], H)
                 for i in data["items"] if data["options"][i["option"]]["lifetime_years"]}
    params = _draw_params(rng, data)
    # units installed later get their own random lives too (engine.unit_life), keyed by this seed
    return {"price_path": path, "events": events, "remaining_life": remaining, "params": params,
            "install_lives": {"seed": rng.getrandbits(64)}}


# ---------------------------------------------------------------- what is known at time t
# Time t is the end of year t. An event starting in year Y is announced at time Y - 1 - notice,
# and a unit whose remaining life is r fails at time ceil(r).
def notice_years(data, event_id):
    return int(data["params"].get(f"event_notice_years_{event_id}", 0))


def announced_at(data, event):
    """Time an event of a future becomes known: its start (time Y - 1) minus its notice period, never before 0."""
    return max(0, event["start_year"] - 1 - notice_years(data, event["id"]))


def draw_future_after(data, rng, known, t):
    """A future that agrees with everything `known` revealed by time t, with the rest drawn as in draw_future:
    the price path up to year t, the events announced or started by t, and the units that failed by t.
    The people-effect strengths are drawn afresh: time does not reveal them."""
    p = data["params"]
    H = int(p["horizon_years"])
    path = list(known["price_path"][:t]) + _price_walk(rng, p, known["price_path"][t - 1] if t else 1.0, H - t)
    events = [e for e in known["events"] if announced_at(data, e) <= t]
    for y in range(1, H + 1):
        for eid, prob in YEARLY_EVENTS:
            if y - 1 - notice_years(data, eid) > t and rng.random() < p[prob]:   # still unknown at t
                events.append({"id": eid, "start_year": y, "end_year": y})
    if not any(e["id"] == "new_lab" for e in events):      # not announced yet: it comes later, or never
        for _ in range(200):
            lab = _draw_lab(rng, p)
            if lab is None or announced_at(data, lab) > t:
                break
        if lab and announced_at(data, lab) > t:
            events.append(lab)
    remaining = {}
    for i in data["items"]:
        life = data["options"][i["option"]]["lifetime_years"]
        if not life:
            continue
        r = known["remaining_life"].get(i["id"])
        if r is not None and r != engine.INF and math.ceil(r) <= t:
            remaining[i["id"]] = r                          # it already failed: that is history
            continue
        for _ in range(200):                                # still running at t: draw a life that lasts past t
            r = _draw_remaining(rng, p, i, life, H)
            if r > t:
                break
        else:                                               # rare: continue the yearly failure hazard from t
            r = t + 1
            while rng.random() >= p["overdue_failure_prob_per_year"] and r < H:
                r += 1
        remaining[i["id"]] = r
    # Units installed by now keep their life if their failure is already history; all others are drawn afresh.
    lives = {"seed": (known.get("install_lives") or {}).get("seed"), "known_until": t, "fresh_seed": rng.getrandbits(64)}
    return {"price_path": path, "events": events, "remaining_life": remaining, "params": _draw_params(rng, data),
            "install_lives": lives}


# ---------------------------------------------------------------- scripted futures (for demos)
SCRIPTED = engine.HERE / "data" / "model" / "scripted_futures.json"


def scripted_names():
    return sorted(json.load(open(SCRIPTED))) if SCRIPTED.exists() else []


def load_scripted(data, name):
    """A future we control, in the same shape as draw_future returns, so simulate can't tell the difference.
    - price_path: a number (flat) or a list with one multiplier per year.
    - events: [{id, start_year, end_year}].
    - remaining_life: {item_id: years} for units whose failure the script sets.
    - other_units "nominal" (default): every other unit fails at its nominal time (lifetime - age) if that
      is still ahead; if it is already overdue, it keeps running for the whole horizon.
      "keep_running": every other unit keeps running, so only the script's failures happen (a clean demo).
    - params: people-effect strengths at their central values, plus any the script sets.
    - No install_lives: units installed during the run live exactly their nominal life, so the story stays
      predictable."""
    scripts = json.load(open(SCRIPTED))
    if name not in scripts:
        raise ValueError(f"Unknown scripted future {name!r}; known: {sorted(scripts)}")
    spec = scripts[name]
    H = int(data["params"]["horizon_years"])
    pp = spec.get("price_path", 1.0)
    path = [float(pp)] * H if isinstance(pp, (int, float)) else [float(x) for x in pp]
    if len(path) != H:
        raise ValueError(f"{name}: price_path needs {H} values")
    events = []
    for e in spec.get("events", []):
        if e["id"] not in data["events"]:
            raise ValueError(f"{name}: unknown event {e['id']!r}")
        events.append({"id": e["id"], "start_year": int(e["start_year"]), "end_year": e.get("end_year")})
    others = spec.get("other_units", "nominal")
    if others not in ("nominal", "keep_running"):
        raise ValueError(f"{name}: other_units must be 'nominal' or 'keep_running'")
    remaining = {}
    for i in data["items"]:
        life = data["options"][i["option"]]["lifetime_years"]
        if not life:
            continue
        nominal = life - (i["age"] or 0)
        remaining[i["id"]] = nominal if (nominal > 0 and others == "nominal") else engine.INF
    for iid, r in spec.get("remaining_life", {}).items():
        if iid not in data["item_by_id"]:
            raise ValueError(f"{name}: unknown item {iid!r}")
        remaining[iid] = float(r)
    params = {k: data["params"][k] for k, m in data["param_meta"].items() if m["category"] == "coupling"}
    params.update(spec.get("params", {}))
    return {"price_path": path, "events": events, "remaining_life": remaining, "params": params,
            "install_lives": None}


def describe(future):
    """One line a person can read: what happened in this future."""
    ev = sorted(future["events"], key=lambda e: e["start_year"])
    parts = []
    for e in ev:
        name = {"heatwave_summer": "heatwave", "energy_price_spike": "price spike", "new_lab": "new lab"}.get(e["id"], e["id"])
        parts.append(f"{name} in year {e['start_year']}")
    parts.append(f"price ends at {future['price_path'][-1]:.2f}x today")
    return ", ".join(parts) if parts else "a quiet future"


def _pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f = math.floor(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def run(data, scenarios, n=300, seed=2026, events=(), overrides=None):
    """scenarios: {name: scenario list}. Returns per-scenario summaries, pairwise comparisons,
    and the futures themselves (so any run can be replayed with engine.simulate(..., future=...)).
    events: event ids switched on in every future, on top of the random ones (with their fixed timing).
    overrides: assumptions fixed in every future; they win over the drawn people-effect strengths."""
    rng = random.Random(seed)
    futures = [draw_future(data, rng) for _ in range(n)]
    if events or overrides:
        fixed = [{"id": e, "start_year": data["events"][e]["start_year"], "end_year": data["events"][e]["end_year"]}
                 for e in events if data["events"][e]["kind"] == "annual"]
        futures = [{**f, "events": f["events"] + fixed, "params": {**f["params"], **(overrides or {})}}
                   for f in futures]
    H = int(data["params"]["horizon_years"])
    results = {}
    for name, sc in scenarios.items():
        runs = [engine.simulate(data, sc, future=f, detail_years=()) for f in futures]
        results[name] = runs

    summary = {}
    for name, runs in results.items():
        cash = [r["npv_cash"] for r in runs]
        econ = [r["npv_economic"] for r in runs]
        pb = [r["payback_cash"] for r in runs]
        flags = {}
        for r in runs:
            for t in {f["type"] for f in r["flags"]}:
                flags[t] = flags.get(t, 0) + 1
        fan = {}
        for view in ("cash", "economic"):
            key = f"cumulative_{view}_cf"
            fan[view] = [{"year": t + 1,
                          "p10": _pct([r["years"][t][key] for r in runs], 0.1),
                          "p50": _pct([r["years"][t][key] for r in runs], 0.5),
                          "p90": _pct([r["years"][t][key] for r in runs], 0.9)} for t in range(H)]
        paid = [x for x in pb if x is not None]
        summary[name] = {
            "npv_cash": {q: _pct(cash, v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
            "npv_economic": {q: _pct(econ, v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
            "prob_cash_positive": sum(x > 0 for x in cash) / n,
            "prob_economic_positive": sum(x > 0 for x in econ) / n,
            "payback_cash_p50": _pct(paid, 0.5) if paid else None,
            "prob_no_cash_payback": sum(x is None for x in pb) / n,
            "flag_probability": {k: v / n for k, v in sorted(flags.items())},
            "fan": fan,
        }

    names = list(scenarios)
    compare = {}
    for a in names:
        for b in names:
            if a != b:
                ra, rb = results[a], results[b]
                compare[f"{a} vs {b}"] = {
                    "prob_better_cash": sum(x["npv_cash"] > y["npv_cash"] for x, y in zip(ra, rb)) / n,
                    "prob_better_economic": sum(x["npv_economic"] > y["npv_economic"] for x, y in zip(ra, rb)) / n,
                }

    # three example futures to tell as stories: worst, median and best for the first scenario
    first = results[names[0]]
    order = sorted(range(n), key=lambda k: first[k]["npv_economic"])
    stories = {lab: {"run": k, "what_happened": describe(futures[k]), "npv_economic": first[k]["npv_economic"]}
               for lab, k in (("bad", order[int(0.1 * (n - 1))]), ("typical", order[n // 2]), ("good", order[int(0.9 * (n - 1))]))}
    return {"n": n, "seed": seed, "summary": summary, "compare": compare, "stories": stories,
            "futures": futures,
            "method": "Triangular draws for people-effect strengths; log random walk for price; Bernoulli events per year; "
                      "triangular lifetime spread, geometric failure for overdue units. Same futures for every scenario."}
