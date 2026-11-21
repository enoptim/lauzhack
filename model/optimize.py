"""Find the best plan for a goal under limits. Every number comes from engine.simulate.

A problem (what the chat assistant writes from the user's words):

    {
      "objective":   {"metric": "running_cost_chf_year", "sense": "min"},     # sense defaults per metric
      "constraints": [{"metric": "upfront_cost_chf", "max": 200000},
                      {"metric": "electricity_kwh_year", "max_change_pct": -20},  # vs doing nothing
                      {"metric": "warnings", "max": 0}],
      "locked":      [{"group": "ventilation"}, {"group": "lighting", "floor": 2}],  # keep as today
      "allowed":     {"coffee": ["coffee_current", "coffee_mid"]},  # only these options for a group
      "per_floor":   false,       # choose per floor, or one option per group for the whole building
      "events":      [],          # what-if events on in the evaluation
      "allow_warnings": false     # by default a plan may not cause warnings (adds warnings <= 0)
    }

Options are bought now (timing "now"). Choosing "when it breaks" is not part of the search yet.

The search is a black box. A solver is any function

    solve(problem, slots, evaluate) -> plan

- slots: the decisions, e.g. {"key": "lighting@2", "group": "lighting", "floor": 2,
  "options": [None, "lighting_budget", "lighting_mid", "lighting_premium"]}. None means keep what is there today.
- plan: {slot key: option id or None}.
- evaluate(plan) -> {"metrics", "violations", "feasible", "objective", "score", "scenario"}.
  `objective` is always "lower is better" (max metrics are negated). `score` is the objective plus a large
  penalty per unit of violated limit, so a solver can minimise one number.

`greedy` below is a simple stand-in. Plug in another with OPTIMIZER=package.module:function in the environment,
or pass solver= to solve().
"""

import importlib
import json
import os
import time

import engine

# ---------------------------------------------------------------- metrics
# name: (unit, default sense, kind, description). kind follows finance.kind: calculated / estimate / index.
METRICS = {
    "upfront_cost_chf": ("CHF", "min", "calculated", "What the plan costs to buy and install now, after the solar subsidy"),
    "extra_cost_vs_like_for_like_chf": ("CHF", "min", "calculated",
                                        "Upfront cost minus the like-for-like replacements that are due now anyway"),
    "running_cost_chf_year": ("CHF/yr", "min", "calculated",
                              "Yearly running cost (energy, maintenance, supplies, rent), average over the horizon"),
    "energy_bill_chf_year": ("CHF/yr", "min", "calculated",
                             "Yearly electricity bill after solar, average over the horizon"),
    "electricity_kwh_year": ("kWh/yr", "min", "calculated", "Electricity used per year, average over the horizon"),
    "npv_cash_chf": ("CHF", "max", "calculated", "Total cash gain vs doing nothing over the horizon, in today's money"),
    "npv_economic_chf": ("CHF", "max", "estimate",
                         "Cash gain plus the value of health, comfort and productivity (uncertain estimate)"),
    "payback_years": ("years", "min", "calculated", "Years until the savings repay the extra cost (none = never)"),
    "lowest_reserve_chf": ("CHF", "max", "calculated", "Lowest the building reserve gets over the horizon"),
    "office_co2_ppm": ("ppm", "min", "calculated", "Typical office CO2 in year 1"),
    "meeting_co2_ppm": ("ppm", "min", "calculated", "Typical meeting-room CO2 in year 1"),
    "classroom_co2_ppm": ("ppm", "min", "calculated", "Typical classroom CO2 in year 1"),
    "summer_overheating_degc": ("degC", "min", "calculated", "Average summer overheating in offices in year 1"),
    "sick_days": ("days/person/yr", "min", "estimate", "Sick days per person in year 1"),
    "comfort_score": ("0-100", "max", "index", "Comfort score in year 1 (a score, not money)"),
    "warnings": ("count", "min", "calculated",
                 "Number of warnings for the plan (over budget, reserve too low, ventilation over capacity, desks short)"),
}
_OUTCOMES = ("office_co2_ppm", "meeting_co2_ppm", "classroom_co2_ppm", "summer_overheating_degc", "sick_days",
             "comfort_score")
_BIG = 1e6  # stands in for "never" (payback) and weighs violated limits in `score`


def upfront_cost(data, res):
    """What the swaps made now cost to buy and install, after the solar subsidy."""
    sel = engine.baseline(data) | {iid: c[0] for iid, c in res["choices"].items()}
    total = 0.0
    for iid, (oid, timing) in res["choices"].items():
        if timing != "now":
            continue
        item, o = data["item_by_id"][iid], data["options"][oid]
        units = engine.units_of(data, item, oid, sel)
        total += units * ((o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0))
        if item["group"] == "solar_pv":
            total -= units * data["params"]["pv_subsidy_chf_per_kwp"]
    return total


def metrics(data, res):
    """All METRICS for one engine.simulate result. Needs every year in detail (see _simulate)."""
    ys = res["years"]
    n = len(ys)
    avg = lambda f: sum(f(y) for y in ys) / n  # noqa: E731
    out = {
        "upfront_cost_chf": upfront_cost(data, res),
        "extra_cost_vs_like_for_like_chf": res["capex_year0"],
        "running_cost_chf_year": avg(lambda y: y["operating_cost"]),
        "energy_bill_chf_year": avg(lambda y: y["state"]["costs"]["energy"] + y["state"]["costs"]["pv_export"]),
        "electricity_kwh_year": avg(lambda y: y["kwh"]),
        "npv_cash_chf": res["npv_cash"],
        "npv_economic_chf": res["npv_economic"],
        "payback_years": res["payback_cash"],
        "lowest_reserve_chf": min([ys[0]["cash_opening"]] + [y["cash_closing"] for y in ys]),
        "warnings": len([f for f in res["flags"] if f["type"] != "reserve_below_minimum_without_upgrades"]),
    }
    out |= {k: ys[0]["outcomes"][k] for k in _OUTCOMES}
    return out


# ---------------------------------------------------------------- problem
def _groups(data):
    g = {}
    for i in data["items"]:
        g.setdefault(i["group"], set()).add(engine.served_floor(i))
    return g


def normalize(data, problem):
    """Check a problem and fill in defaults. Relative limits (max_change_pct) become absolute ones."""
    p = json.loads(json.dumps(problem or {}))
    obj = p.get("objective") or {}
    if obj.get("metric") not in METRICS:
        raise ValueError(f"objective.metric must be one of {sorted(METRICS)}")
    obj.setdefault("sense", METRICS[obj["metric"]][1])
    if obj["sense"] not in ("min", "max"):
        raise ValueError("objective.sense must be 'min' or 'max'")
    p["objective"] = obj
    groups = _groups(data)
    for lk in p.setdefault("locked", []):
        if lk.get("group") not in groups:
            raise ValueError(f"Unknown group in locked: {lk.get('group')!r}")
        if "floor" in lk and lk["floor"] not in groups[lk["group"]]:
            raise ValueError(f"{lk['group']} has no floor {lk['floor']}; floors: {sorted(groups[lk['group']])}")
    for g, opts in (p.setdefault("allowed", {}) or {}).items():
        if g not in groups:
            raise ValueError(f"Unknown group in allowed: {g!r}")
        for o in opts:
            if data["options"].get(o, {}).get("group") != g:
                raise ValueError(f"{o!r} is not an option of {g!r}")
    for e in p.setdefault("events", []):
        if e not in data["events"]:
            raise ValueError(f"Unknown event {e!r}")
    p["per_floor"] = bool(p.get("per_floor", False))
    today = None
    for c in p.setdefault("constraints", []):
        if c.get("metric") not in METRICS:
            raise ValueError(f"constraint metric must be one of {sorted(METRICS)}")
        for bound, rel in (("max", "max_change_pct"), ("min", "min_change_pct")):
            if rel in c:
                today = today or metrics(data, _simulate(data, [], p["events"]))
                c[bound] = today[c["metric"]] * (1 + c.pop(rel) / 100)
        if "max" not in c and "min" not in c:
            raise ValueError(f"constraint on {c['metric']} needs max, min, max_change_pct or min_change_pct")
    # By default a plan may not cause warnings (over budget, reserve too low, ...).
    if not p.get("allow_warnings") and not any(c["metric"] == "warnings" for c in p["constraints"]):
        p["constraints"].append({"metric": "warnings", "max": 0})
    return p


def slots(data, problem):
    """The decisions the solver makes. A group is decided per floor if per_floor is on or one floor is locked."""
    groups = _groups(data)
    locked = problem.get("locked", [])
    out = []
    for g in sorted(groups):
        if any(lk["group"] == g and "floor" not in lk for lk in locked):
            continue
        floors = sorted(groups[g])
        split = len(floors) > 1 and (problem.get("per_floor") or any(lk["group"] == g for lk in locked))
        current = {i["option"] for i in data["items"] if i["group"] == g}
        allowed = problem.get("allowed", {}).get(g)
        opts = [o for o, od in data["options"].items() if od["group"] == g and (allowed is None or o in allowed)]
        keep = allowed is None or bool(current & set(allowed))
        choices = ([None] if keep else []) + [o for o in opts if o not in current]
        for fl in (floors if split else [None]):
            if fl is not None and any(lk["group"] == g and lk.get("floor") == fl for lk in locked):
                continue
            if len(choices) > 1 or (choices and choices[0] is not None):
                out.append({"key": g if fl is None else f"{g}@{fl}", "group": g, "floor": fl, "options": choices})
    return out


def to_scenario(slot_list, plan):
    """A plan ({slot key: option or None}) as engine swaps."""
    out = []
    for s in slot_list:
        o = plan.get(s["key"])
        if o:
            out.append({"group": s["group"], "option": o} | ({"floor": s["floor"]} if s["floor"] is not None else {}))
    return out


# ---------------------------------------------------------------- evaluation
def _simulate(data, scenario, events):
    return engine.simulate(data, scenario, events, detail_years=tuple(range(1, int(data["params"]["horizon_years"]) + 1)))


def evaluate_scenario(data, problem, scenario):
    """Score one scenario against a normalized problem."""
    res = _simulate(data, scenario, problem["events"])
    m = metrics(data, res)
    violations = []
    total = 0.0
    for c in problem["constraints"]:
        v = m[c["metric"]]
        v = _BIG if v is None else v
        for bound, over in (("max", lambda v, lim: v - lim), ("min", lambda v, lim: lim - v)):
            if bound in c and over(v, c[bound]) > 1e-9:
                total += over(v, c[bound]) / max(abs(c[bound]), 1.0)
                violations.append({"metric": c["metric"], bound: c[bound], "value": m[c["metric"]]})
    o = m[problem["objective"]["metric"]]
    o = _BIG if o is None else o
    objective = o if problem["objective"]["sense"] == "min" else -o
    return {"scenario": scenario, "metrics": m, "violations": violations, "feasible": not violations,
            "objective": objective, "score": objective + _BIG * total, "flags": res["flags"], "_total": total}


# ---------------------------------------------------------------- solvers
def greedy(problem, slot_list, evaluate, max_passes=4):
    """Stand-in solver. Start from today; change one decision at a time while it helps.
    Fewer violated limits always wins over a better objective."""
    plan = {s["key"]: (None if None in s["options"] else s["options"][0]) for s in slot_list}
    best = evaluate(plan)
    key = lambda r: (round(r["_total"], 9), r["objective"])  # noqa: E731
    for _ in range(max_passes):
        improved = False
        for s in slot_list:
            for o in s["options"]:
                if o == plan[s["key"]]:
                    continue
                cand = {**plan, s["key"]: o}
                r = evaluate(cand)
                if key(r) < key(best):
                    plan, best, improved = cand, r, True
        if not improved:
            break
    return plan


def _load_solver(solver):
    if callable(solver):
        return solver, getattr(solver, "__name__", "custom")
    spec = solver or os.environ.get("OPTIMIZER")
    if spec == "greedy":
        return greedy, "greedy"
    if not spec:
        # The real optimizer plugs in here: search.py's solver, with greedy as the fallback.
        try:
            import search
            return search.solve_problem, "search"
        except ImportError:
            return greedy, "greedy"
    mod, _, fn = spec.partition(":")
    return getattr(importlib.import_module(mod), fn or "solve"), spec


def solve(data, problem, solver=None):
    """Normalize the problem, run the solver, and report the best plan next to doing nothing."""
    t0 = time.time()
    prob = normalize(data, problem)
    slot_list = slots(data, prob)
    cache = {}

    def evaluate(plan):
        sc = to_scenario(slot_list, plan)
        k = json.dumps(sc, sort_keys=True)
        if k not in cache:
            cache[k] = evaluate_scenario(data, prob, sc)
        return cache[k]

    evaluate.data = data  # lets a solver use its own fast evaluator (search.py does)
    fn, name = _load_solver(solver)
    best = evaluate(fn(prob, slot_list, evaluate))
    today = evaluate({})
    strip = lambda r: {k: v for k, v in r.items() if not k.startswith("_")}  # noqa: E731
    return {"problem": prob, "best": strip(best), "today": strip(today), "solver": name,
            "evaluations": len(cache), "decisions": len(slot_list), "seconds": round(time.time() - t0, 1)}
