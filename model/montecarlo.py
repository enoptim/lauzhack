"""Many possible futures for the BC twin.

A future is one sampled version of the world over the horizon:
  - world varies (aleatoric): a yearly electricity price path, which events happen and when
    (heatwave summers, price spikes, the new lab), and when each old unit actually fails;
  - we don't know (epistemic): the strength of the people effects, drawn once per future
    from each coupling parameter's low / central / high range (triangular).
Accounting stays exact in every future: each run is an ordinary simulate() call.

Common random numbers: every scenario, and the 'do nothing' path inside each run, faces the
same futures, so differences between plans come from the decision, not from luck.

Percentiles describe the spread of outcomes under these assumed distributions. They are not
known real-world probabilities.
"""
import math
import random

import engine


def _tri(rng, lo, mode, hi):
    return mode if lo == hi else rng.triangular(lo, hi, mode)


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

    # when each old unit actually fails (drawn per item, independent of any scenario)
    remaining = {}
    for i in data["items"]:
        o = data["options"][i["option"]]
        life = o["lifetime_years"]
        if not life:
            continue
        actual = life * rng.triangular(p["lifetime_spread_low"], p["lifetime_spread_high"], 1.0)
        age = i["age"] or 0
        if actual > age:
            remaining[i["id"]] = actual - age
        else:                       # already past its life and still running: fails with a yearly hazard
            n = 0
            while rng.random() >= p["overdue_failure_prob_per_year"] and n < H:
                n += 1
            remaining[i["id"]] = n

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
        name = {"heatwave_summer": "heatwave", "energy_price_spike": "price spike", "new_lab": "new lab"}[e["id"]]
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
        futures = [{**f, "events": f["events"] + list(events), "params": {**f["params"], **(overrides or {})}}
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
