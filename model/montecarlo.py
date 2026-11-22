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


def _slim(res):
    """What the summary needs from one run. Keeps pickling cheap when runs come from worker processes."""
    return {"npv_cash": res["npv_cash"], "npv_economic": res["npv_economic"], "start": -res["capex_year0"],
            "payback_cash": res["payback_cash"], "payback_economic": res["payback_economic"],
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


def run(data, scenarios, n=300, seed=2026, events=(), overrides=None, pool=None, samples=20):
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
        pb = [r["payback_cash"] for r in runs]
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
        # payback per future; "never within the horizon" sorts last
        pb_sorted = sorted(pb, key=lambda x: math.inf if x is None else x)
        def pb_pct(q):
            v = pb_sorted[min(n - 1, int(round(q * (n - 1))))]
            return v
        breakdown = {}
        for r in runs:
            for k, v in r["npv_breakdown"].items():
                breakdown[k] = breakdown.get(k, 0.0) + v / n
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
            "payback_range": {"p10": pb_pct(0.1), "p50": pb_pct(0.5), "p90": pb_pct(0.9)},
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
    return {"n": n, "seed": seed, "summary": summary, "compare": compare, "stories": stories,
            "samples": sample_list, "futures": futures,
            "method": "Triangular draws for people-effect strengths; log random walk for price; Bernoulli events per year; "
                      "Weibull wear-out failures given each unit's age today. Same futures for every scenario."}
