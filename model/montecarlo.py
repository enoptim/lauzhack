"""Many possible futures for the BC twin.

A future is one sampled version of the world over the horizon:
  - world varies (aleatoric): a yearly electricity price path, which events happen and when
    (heatwave summers, price spikes, the new lab), and when each old unit actually fails;
  - we don't know (epistemic): the strength of the people effects, drawn once per future
    from each coupling parameter's low / central / high range (triangular).
Accounting stays exact in every future: each run is an ordinary simulate() call.

Common random numbers: every scenario, and the 'do nothing' path inside each run, faces the
same futures, so differences between plans come from the decision, not from luck.

Old units fail on a wear-out (Weibull) curve, counted from their age today: a unit that is
still running has a spread of remaining life, and the older it is, the sooner it tends to fail.
Each inventory row (one room, or one floor's ventilation) is replaced as one batch.

Percentiles describe the spread of outcomes under these assumed distributions. They are not
known real-world probabilities.
"""
import json
import math
import os
import random
import threading
import time
from concurrent.futures import ProcessPoolExecutor

import engine


def _tri(rng, lo, mode, hi):
    return mode if lo == hi else rng.triangular(lo, hi, mode)


def weibull_remaining(rng, life, age, shape):
    """Remaining life of a unit that still runs at `age`, on a Weibull curve whose mean is `life`.
    Closed form of the conditional distribution: P(T > age + x | T > age)."""
    scale = life / math.gamma(1 + 1 / shape)
    u = 1.0 - rng.random()                       # in (0, 1], so log(u) is finite
    return scale * ((age / scale) ** shape - math.log(u)) ** (1 / shape) - age


def draw_future(data, rng):
    p = data["params"]
    H = int(p["horizon_years"])

    # electricity price: random walk in log space around today's price, clipped
    path, m = [], 1.0
    for _ in range(H):
        m *= math.exp(rng.gauss(0.0, p["price_volatility_per_year"]))
        m = min(max(m, p["price_path_min"]), p["price_path_max"])
        path.append(m)

    # events with probabilities and their own timing
    events = []
    for y in range(1, H + 1):
        if rng.random() < p["heatwave_prob_per_year"]:
            events.append({"id": "heatwave_summer", "start_year": y, "end_year": y})
        if rng.random() < p["price_spike_prob_per_year"]:
            events.append({"id": "energy_price_spike", "start_year": y, "end_year": y})
    if rng.random() >= p["new_lab_prob_never"]:
        events.append({"id": "new_lab", "start_year": rng.randint(1, int(p["new_lab_latest_year"])), "end_year": None})

    # when each old unit actually fails: Weibull wear-out, given that it still runs at its age today
    remaining = {}
    for i in data["items"]:
        life = data["options"][i["option"]]["lifetime_years"]
        if life:
            remaining[i["id"]] = weibull_remaining(rng, life, i["age"] or 0, p["lifetime_weibull_shape"])

    # strength of people effects: one draw per future
    params = {}
    for k, meta in data["param_meta"].items():
        if meta["category"] == "coupling":
            lo, hi = data["ranges"][k]
            params[k] = _tri(rng, lo, data["params"][k], hi)

    return {"price_path": path, "events": events, "remaining_life": remaining, "params": params}


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


def _pct_or_never(xs, q):
    """Percentile of per-future years where None means "not within the horizon". Those futures sort last and are
    never dropped. Same interpolation as _pct, with one rule for None:
      - the percentile lands exactly on a future: that future's value (None if it never paid back);
      - it lands between two futures and either is None: None. Part of the way there has not paid back,
        so the honest answer is "not within the horizon", never a number pulled towards one."""
    xs = sorted(xs, key=lambda x: math.inf if x is None else x)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f = math.floor(k)
    if k == f:
        return xs[f]
    c = min(f + 1, len(xs) - 1)
    if xs[f] is None or xs[c] is None:
        return None
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def payback_year(values):
    """When a cumulative money line crosses zero for good, in years, interpolated within the year.
    values[0] is today (minus the purchase), values[t] the end of year t. None if the line ends below zero;
    0.0 if it never goes below zero. The Results chart marks payback the same way (PlansChart.paybackYear)."""
    if not values or values[-1] < 0:
        return None
    if all(v >= 0 for v in values):
        return 0.0
    t = len(values) - 1
    while t > 0 and values[t - 1] >= 0:
        t -= 1
    a, b = values[t - 1], values[t]
    return t - 1 + -a / (b - a)


def payback_by_horizon(runs, view, horizon):
    """Payback of each future on the chart's basis, for every number of years shown (1 to horizon).
    view: "cash_running" or "economic_running", the lines the Results chart draws: cumulative money
    without the value of equipment still standing at the end. A future's line is [start, view[0], ..., view[h-1]].
    Per h: the share of futures that have paid back by year h (their line is at or above zero there), and the
    10th, 50th and 90th percentile of the per-future payback year (None = that future has not paid back by h)."""
    rows = []
    for h in range(1, horizon + 1):
        years = [payback_year([r["start"]] + r[view][:h]) for r in runs]
        rows.append({"year": h, "share": sum(x is not None for x in years) / len(runs),
                     **{q: _pct_or_never(years, v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}})
    return rows


def _slim(res):
    """What the summary needs from one run. Keeps pickling cheap when runs come from worker processes."""
    return {"npv_cash": res["npv_cash"], "npv_economic": res["npv_economic"], "start": -res["capex_year0"],
            "flag_types": sorted({f["type"] for f in res["flags"]}), "npv_breakdown": res["npv_breakdown"], "risk": res["risk"],
            "cash": [y["cumulative_cash_cf"] for y in res["years"]],
            "economic": [y["cumulative_economic_cf"] for y in res["years"]],
            # the same without the value of equipment still standing at the end (counted in the last year)
            "cash_running": [y["cumulative_cash_cf"] - y["residual_value"] for y in res["years"]],
            "economic_running": [y["cumulative_economic_cf"] - y["residual_value"] for y in res["years"]]}


_WORKER_DATA = None


def _worker_init():
    global _WORKER_DATA
    _WORKER_DATA = engine.load()
    # Stop when the engine that started this worker stops, so no orphan processes keep using memory.
    parent = os.getppid()

    def watch():
        while os.getppid() == parent:
            time.sleep(2)
        os._exit(0)
    threading.Thread(target=watch, daemon=True).start()


def _worker_run(job):
    scenario, chunk = job
    return [_slim(engine.simulate(_WORKER_DATA, scenario, future=f, detail_years=())) for f in chunk]


def make_pool(workers=None):
    """Worker processes that each load the data once. Use one pool for many run() calls."""
    # 3 workers: about 3x faster than one process, for about 250 MB more memory. More workers gain little and
    # can push a laptop into swapping when the app, the browser and the engine all run at once.
    return ProcessPoolExecutor(max_workers=workers or min(3, max(1, (os.cpu_count() or 2) - 1)), initializer=_worker_init)


def _failures(data, future, horizon):
    """Old units that fail within the horizon in this future, grouped by year and equipment group."""
    p = {**data["params"], **future["params"]}
    out = {}
    for i in data["items"]:
        rem = future["remaining_life"].get(i["id"])
        if rem is None or rem >= horizon or engine.planned_swap(data, i, rem, p.get("replace_on_plan")):
            continue
        year = int(math.ceil(rem))
        o = data["options"][i["option"]]
        cost = i["units"] * ((o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0)) * (1 + p.get("failure_premium", 0))
        e = out.setdefault((year, i["group"]), {"year": year, "group": i["group"], "rows": 0, "units": 0, "cost": 0.0, "floors": set()})
        e["rows"] += 1
        e["units"] += i["units"]
        e["cost"] += cost
        e["floors"].add(engine.served_floor(i))
    return [{**e, "floors": sorted(f for f in e["floors"] if f is not None)} for _, e in sorted(out.items())]


def run(data, scenarios, n=300, seed=2026, events=(), overrides=None, pool=None, samples=20, pinned=None):
    """scenarios: {name: scenario list}. Returns per-scenario summaries, pairwise comparisons,
    and the futures themselves (so any run can be replayed with engine.simulate(..., future=...)).
    events: event ids switched on in every future, on top of the random ones (with their fixed timing).
    overrides: assumptions fixed in every future; they win over the drawn people-effect strengths.
    pinned: one more future (e.g. the one a player just played) shown first among the example futures,
    marked "pinned". It is not counted in the summaries, which stay the n drawn futures."""
    rng = random.Random(seed)
    futures = [draw_future(data, rng) for _ in range(n)]
    if events or overrides:
        fixed = [{"id": e, "start_year": data["events"][e]["start_year"], "end_year": data["events"][e]["end_year"]}
                 for e in events if data["events"][e]["kind"] == "annual"]
        futures = [{**f, "events": f["events"] + fixed, "params": {**f["params"], **(overrides or {})}}
                   for f in futures]
    H = int(data["params"]["horizon_years"])
    results = {}
    if pool is None:
        for name, sc in scenarios.items():
            results[name] = [_slim(engine.simulate(data, sc, future=f, detail_years=())) for f in futures]
    else:
        size = max(1, math.ceil(n / 12))
        chunks = [futures[k:k + size] for k in range(0, n, size)]
        jobs = [(sc, c) for sc in scenarios.values() for c in chunks]
        out = list(pool.map(_worker_run, jobs))
        for k, name in enumerate(scenarios):
            results[name] = [r for part in out[k * len(chunks):(k + 1) * len(chunks)] for r in part]

    summary = {}
    for name, runs in results.items():
        cash = [r["npv_cash"] for r in runs]
        econ = [r["npv_economic"] for r in runs]
        # Payback per future, counted exactly as the chart counts (see payback_by_horizon).
        payback = {view: payback_by_horizon(runs, view, H) for view in ("cash_running", "economic_running")}
        full = payback["cash_running"][-1]
        # Over the whole horizon: when each future's cash line crosses zero for good (None = it ends below zero).
        pb = [payback_year([r["start"]] + r["cash_running"]) for r in runs]
        flags = {}
        for r in runs:
            for t in r["flag_types"]:
                flags[t] = flags.get(t, 0) + 1
        fan = {}
        for view in ("cash", "economic", "cash_running", "economic_running"):
            fan[view] = [{"year": t + 1,
                          "p10": _pct([r[view][t] for r in runs], 0.1),
                          "p50": _pct([r[view][t] for r in runs], 0.5),
                          "p90": _pct([r[view][t] for r in runs], 0.9)} for t in range(H)]
        breakdown = {}
        for r in runs:
            for k, v in r["npv_breakdown"].items():
                breakdown[k] = breakdown.get(k, 0.0) + v / n
        # One real future in the middle (by cash saved at the end, the chart's line), so its figures add up exactly:
        # cash saved + difference in equipment value left at the end = ahead at the end; npv_cash = the same in today's money.
        mid = runs[sorted(range(n), key=lambda k: runs[k]["cash_running"][-1])[(n - 1) // 2]]
        summary[name] = {
            "middle_future": {"year": H, "cash_saved": mid["cash_running"][-1],
                              "leftover_value": mid["cash"][-1] - mid["cash_running"][-1],
                              "ahead": mid["cash"][-1], "npv_cash": mid["npv_cash"]},
            "npv_cash": {q: _pct(cash, v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
            "npv_economic": {q: _pct(econ, v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
            "prob_cash_positive": sum(x > 0 for x in cash) / n,
            "prob_economic_positive": sum(x > 0 for x in econ) / n,
            # All payback figures below use the chart's cash basis (no value of equipment left at the end),
            # are worked out per future, and count futures that never pay back (None) instead of dropping them.
            "payback_cash_p50": full["p50"],
            "prob_no_cash_payback": 1 - full["share"],
            "flag_probability": {k: v / n for k, v in sorted(flags.items())},
            "fan": fan,
            "payback": payback,
            "payback_range": {q: full[q] for q in ("p10", "p50", "p90")},
            # paid back by year y and still paid back at the end of the horizon (so the share only grows with y)
            "prob_paid_back_by_year": [{"year": y, "share": sum(x is not None and x <= y for x in pb) / n}
                                       for y in range(1, H + 1)],
            "npv_breakdown_mean": breakdown,
            # chance of at least one emergency breakdown of the equipment this plan touches, by year
            "risk": {
                "emergency_by_year": [{"year": y,
                                       "plan": sum(r["risk"]["emergency_year"] is not None and r["risk"]["emergency_year"] <= y for r in runs) / n,
                                       "nothing": sum(r["risk"]["emergency_year_baseline"] is not None and r["risk"]["emergency_year_baseline"] <= y for r in runs) / n}
                                      for y in range(1, H + 1)],
                "emergency_chf_mean": sum(r["risk"]["emergency_chf"] for r in runs) / n,
                "emergency_chf_mean_baseline": sum(r["risk"]["emergency_chf_baseline"] for r in runs) / n,
            },
            "start": _pct([r["start"] for r in runs], 0.5),     # money vs doing nothing today: minus the purchase
            "npv_cash_mean": sum(cash) / n,
            "npv_economic_mean": sum(econ) / n,
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
    # example futures to explore one at a time: spread evenly from bad to good for the first scenario,
    # then shuffled in a fixed order so each click shows a different kind of future
    by_end = sorted(range(n), key=lambda k: first[k]["cash"][-1])
    picks = sorted({by_end[min(n - 1, int((j + 0.5) / samples * n))] for j in range(min(samples, n))})
    random.Random(seed + 1).shuffle(picks)
    sample_list = [{"id": k, "what_happened": describe(futures[k]), "failures": _failures(data, futures[k], H),
                    "events": sorted(futures[k]["events"], key=lambda e: e["start_year"]),
                    "paths": {name: {"start": results[name][k]["start"],
                              **{v: results[name][k][v] for v in ("cash", "economic", "cash_running", "economic_running")}}
                              for name in names}} for k in picks]
    if pinned is not None:
        fixed = [{"id": e, "start_year": data["events"][e]["start_year"], "end_year": data["events"][e]["end_year"]}
                 for e in events if data["events"][e]["kind"] == "annual"]
        f = {**pinned, "events": pinned["events"] + fixed, "params": {**pinned["params"], **(overrides or {})}}
        mine = {name: _slim(engine.simulate(data, sc, future=f, detail_years=())) for name, sc in scenarios.items()}
        sample_list = [{"id": "pinned", "pinned": True, "what_happened": describe(f), "failures": _failures(data, f, H),
                        "events": sorted(f["events"], key=lambda e: e["start_year"]),
                        "paths": {name: {"start": mine[name]["start"],
                                  **{v: mine[name][v] for v in ("cash", "economic", "cash_running", "economic_running")}}
                                  for name in names}}] + sample_list[:samples - 1]
    return {"n": n, "seed": seed, "summary": summary, "compare": compare, "stories": stories,
            "samples": sample_list, "futures": futures,
            "method": "Triangular draws for people-effect strengths; log random walk for price; Bernoulli events per year; "
                      "Weibull wear-out failures given each unit's age today. Same futures for every scenario."}


# ---------------------------------------------------------------- play mode (session.py)
# Time t is the end of year t. An event starting in year Y is announced at time Y - 1 - notice,
# and a unit whose remaining life is r fails at time ceil(r).
YEARLY_EVENTS = (("heatwave_summer", "heatwave_prob_per_year"), ("energy_price_spike", "price_spike_prob_per_year"))


def notice_years(data, event_id):
    return int(data["params"].get(f"event_notice_years_{event_id}", 0))


def announced_at(data, event):
    """Time an event of a future becomes known: its start (time Y - 1) minus its notice period, never before 0."""
    return max(0, event["start_year"] - 1 - notice_years(data, event["id"]))


def draw_play_future(data, rng):
    """A future to play: one draw_future, plus a seed for the lives of units installed during the game
    (engine.unit_life), so equipment bought in the game can wear out early too. The many-futures runs
    don't use this, so their results are unchanged."""
    future = draw_future(data, rng)
    return {**future, "install_lives": {"seed": rng.getrandbits(64)}}


def draw_future_after(data, rng, known, t):
    """A future that agrees with everything `known` revealed by time t, with the rest drawn as in draw_future:
    the price path up to year t, the events announced or started by t, and the units that failed by t.
    A unit still running at t gets t plus a fresh wear-out draw at its age then (exact for the Weibull curve).
    The people-effect strengths are drawn afresh: time does not reveal them."""
    p = data["params"]
    H = int(p["horizon_years"])
    path, m = list(known["price_path"][:t]), (known["price_path"][t - 1] if t else 1.0)
    for _ in range(H - t):
        m *= math.exp(rng.gauss(0.0, p["price_volatility_per_year"]))
        m = min(max(m, p["price_path_min"]), p["price_path_max"])
        path.append(m)
    events = [e for e in known["events"] if announced_at(data, e) <= t]
    for y in range(1, H + 1):
        for eid, prob in YEARLY_EVENTS:
            if y - 1 - notice_years(data, eid) > t and rng.random() < p[prob]:   # still unknown at t
                events.append({"id": eid, "start_year": y, "end_year": y})
    if not any(e["id"] == "new_lab" for e in events):      # not announced yet: it comes later, or never
        for _ in range(200):
            lab = ({"id": "new_lab", "start_year": rng.randint(1, int(p["new_lab_latest_year"])), "end_year": None}
                   if rng.random() >= p["new_lab_prob_never"] else None)
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
        else:
            remaining[i["id"]] = t + weibull_remaining(rng, life, (i["age"] or 0) + t, p["lifetime_weibull_shape"])
    params = {}
    for k, meta in data["param_meta"].items():
        if meta["category"] == "coupling":
            lo, hi = data["ranges"][k]
            params[k] = _tri(rng, lo, data["params"][k], hi)
    # Units installed by now keep their life if their failure is already history; all others are drawn afresh.
    lives = {"seed": (known.get("install_lives") or {}).get("seed"), "known_until": t, "fresh_seed": rng.getrandbits(64)}
    return {"price_path": path, "events": events, "remaining_life": remaining, "params": params, "install_lives": lives}


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
      With the replace_on_plan policy, big systems that keep running are still replaced at the end of their
      normal life, as planned work (engine.planned_swap).
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
