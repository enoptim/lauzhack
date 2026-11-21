"""Tests for the search (search.py). Run: python3 test_search.py (or pytest). Takes about a minute.

The brute-force tests try every plan of a small sub-problem and check that the optimizer finds the
true best one. They enumerate with the optimizer's fast evaluator, which test_fast_path_matches_engine
pins to engine.simulate, and re-check each brute-force winner with engine.simulate itself. They switch
off the optimizer's own full enumeration of small spaces (forced_search), so they test the search."""
import functools
import json
import math
import random
import sys
import time
from pathlib import Path

import engine
import search as O
import viz

D = engine.load()
REL = 1e-6
NO_UI = {"include_engine_output": False}

# Small sub-problems: few enough plans to try every one.
SUB_A = {"allowed": [{"group": "lighting", "floor": [1, 2, 3]}, {"group": "ventilation", "floor": 0},
                     {"group": "heating_cooling"}, {"group": "solar_pv"}]}          # 4*4*4*4*(3*2) = 1536 plans
SUB_B = {"allowed": [{"group": "blinds", "floor": [1, 2]}, {"group": "monitors", "floor": [1, 2]},
                     {"group": "coffee", "floor": [0, 1]}]}                                   # 2*2*4*4*4*4 = 1024 plans
SUBS = (SUB_A, SUB_B)
# Payback cases an independent check found (events reshape the yearly cash flows behind payback).
P1 = {"allowed": [{"group": "heating_cooling"}, {"group": "solar_pv"}, {"group": "ventilation", "floor": 1},
                  {"group": "monitors", "floor": 3}, {"group": "lighting", "floor": -1}]}         # 384 plans
P1_EVENTS = ("energy_price_spike", "new_lab", "heatwave_summer")
P2 = {"allowed": [{"group": "heating_cooling"}, {"group": "coffee"}, {"group": "monitors"}, {"group": "ventilation"},
                  {"group": "lighting", "option": ["lighting_mid"]}, {"group": "printers_3d"}]}    # 768 plans, whole building
_PLANS = {}


def forced_search(test):
    """Run a test with the optimizer's full enumeration of small spaces switched off."""
    @functools.wraps(test)
    def run():
        old = O.EXHAUSTIVE_LIMIT
        O.EXHAUSTIVE_LIMIT = 0
        try:
            test()
        finally:
            O.EXHAUSTIVE_LIMIT = old
    return run


def close(a, b, rel=REL):
    return abs(a - b) <= rel * max(1.0, abs(b))


def all_plans(scope, horizon=None, discounted=False, include_residual=True, events=(), granularity="floor"):
    """Every plan of a sub-problem with its metrics: [(scenario, metrics)]."""
    key = (repr(scope), horizon, discounted, include_residual, tuple(events), granularity)
    if key not in _PLANS:
        events, over, H, _ = O._settings(D, events, None, horizon)
        space = O._Space(D, granularity, scope)
        s = O._Search(space, O._ctx(D, events, over, H), ("upfront_cost_chf", "min"), [],
                      ("operating_cost_saving_chf_year", "max"), discounted, include_residual)
        _PLANS[key] = [(space.scenario(c), s.m(c)) for c in s.exhaustive()]
    return _PLANS[key]


def _v(m, k):
    return math.inf if m[k] is None else m[k]


def shortfall(m, cons):
    total = 0.0
    for name, kind, b in cons:
        short = (b - _v(m, name)) if kind == "min" else (_v(m, name) - b)
        if short > 1e-9 * max(abs(b), 1.0):
            total += short / max(abs(b), 1.0)
    return total


def brute(plans, metric, sense, cons, tie):
    sg, tg = (1 if sense == "min" else -1), (1 if tie[1] == "min" else -1)
    return min(plans, key=lambda p: (round(shortfall(p[1], cons), 9), round(sg * _v(p[1], metric), 6),
                                     round(tg * _v(p[1], tie[0]), 6)))


def check(res, plans, metric, sense, cons, tie=("upfront_cost_chf", "min"), horizon=None, discounted=False,
          include_residual=True, events=()):
    """The optimizer's plan is as good as the best of all plans (same shortfall, same objective)."""
    sc, m = brute(plans, metric, sense, cons, tie)
    truth = O.evaluate(D, sc, events, horizon_years=horizon, discounted=discounted,
                       include_residual=include_residual)["metrics"]
    assert all(close(truth[k], m[k]) for k in m if m[k] is not None)            # brute force agrees with the engine
    assert abs(shortfall(res["metrics"], cons) - shortfall(m, cons)) < 1e-9, (metric, cons, res["metrics"][metric], m[metric])
    got, best = res["objective"]["value"], m[metric]
    assert (got is None and best is None) or close(got, best), (metric, cons, got, best)
    assert res["status"] == ("ok" if shortfall(m, cons) == 0 else "best_effort")
    if res["status"] == "ok":
        assert all(c["met"] for c in res["constraints"])


def _random_plans(space, n, seed):
    rng = random.Random(seed)
    return [tuple(rng.choice(c) for c in space.choices) for _ in range(n)]


# --- zones and evaluation
def test_zones():
    z = O.zones(D)
    floors = {}
    for i in D["items"]:
        floors.setdefault(i["group"], set()).add(engine.served_floor(i))
    assert len(z) == sum(len(f) if len(f) > 1 else 1 for f in floors.values())    # 37 before the banner was added
    assert len(O.zones(D, "building")) == len(floors)
    keys = {x["zone"] for x in z}
    assert {"lighting@2", "lighting@-1", "ventilation@0", "heating_cooling", "solar_pv", "servers"} <= keys
    ids = [i for x in z for i in x["item_ids"]]
    assert sorted(ids) == sorted(i["id"] for i in D["items"])                    # every item in exactly one zone
    for x in z:
        assert x["current_option"] not in x["options"] and x["options"]
        assert set(x) == {"zone", "group", "floor", "current_option", "options", "units", "item_ids"}
    assert next(x for x in z if x["zone"] == "solar_pv")["current_option"] == "solar_pv_none"


def test_fast_path_matches_engine():
    """The optimizer's evaluator gives exactly engine.simulate's numbers, with events and other horizons."""
    for gran, events, horizon, seed in (("floor", (), None, 1), ("floor", ("new_lab", "energy_price_spike", "heatwave_summer"), 10, 2),
                                        ("building", ("new_lab",), 5, 3)):
        ev, over, H, _ = O._settings(D, events, None, horizon)
        space, ctx = O._Space(D, gran, None), O._ctx(D, ev, over, H)
        for cfg in _random_plans(space, 8, seed) + [space.nothing()]:
            for disc, resid in ((False, True), (True, False)):
                fast = O._metrics(ctx.run(space, cfg), ctx.r, disc, resid)[0]
                slow = O.evaluate(D, space.scenario(cfg), events, None, horizon, disc, resid)["metrics"]
                for k in O.METRICS:
                    assert (fast[k] is None and slow[k] is None) or close(fast[k], slow[k], 1e-9), (k, fast[k], slow[k])


def test_metrics_match_chat_tools():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from chat import tools                                 # loads its own DATA
    space = O._Space(D, "floor", None)
    plans = [[], [{"group": "lighting", "option": "lighting_mid", "floor": 2}],
             [{"group": "solar_pv", "option": "solar_pv_upgrade"}, {"group": "heating_cooling", "option": "heating_cooling_premium"}]]
    plans += [space.scenario(c) for c in _random_plans(space, 3, 4)]
    for sc in plans:
        res = engine.simulate(tools.DATA, sc)
        s = tools.summary(res)
        m = O.evaluate(D, sc)["metrics"]
        assert close(m["upfront_cost_chf"], tools._upfront(res), 1e-9)
        assert abs(m["energy_cost_saving_chf_year"] - s["energy_bill_saving_chf_year"]) <= 0.5
        assert abs(m["operating_cost_saving_chf_year"] - s["running_cost_saving_chf_year"]) <= 0.5
        assert close(m["net_upfront_cost_chf"], res["capex_year0"], 1e-9)


def test_total_cost_identities():
    """Total cost saving = engine NPV (discounted, with residual) and = cumulative cash flow (undiscounted)."""
    plans = [[{"group": "ventilation", "option": "ventilation_budget"}, {"group": "lighting", "option": "lighting_mid"}],
             [{"group": "solar_pv", "option": "solar_pv_upgrade"}, {"group": "heating_cooling", "option": "heating_cooling_premium"},
              {"group": "computers", "option": "computers_upgrade", "floor": 1}]]
    for sc in plans:
        for T in (10, 15):
            for events in ((), ("new_lab", "energy_price_spike")):
                res = engine.simulate(D, sc, list(events), {"horizon_years": T})
                a = O.evaluate(D, sc, events, horizon_years=T, discounted=True, include_residual=True)["metrics"]
                b = O.evaluate(D, sc, events, horizon_years=T, discounted=False, include_residual=True)["metrics"]
                assert close(a["total_cost_saving_chf"], res["npv_cash"])
                assert close(b["total_cost_saving_chf"], res["years"][T - 1]["cumulative_cash_cf"])
                assert close(a["npv_cash_chf"], res["npv_cash"])


# --- brute force on small sub-problems
@forced_search
def test_min_cost_for_target_matches_brute_force():
    for scope in SUBS:
        plans = all_plans(scope)
        top = max(m["energy_cost_saving_pct"] for _, m in plans)
        for frac in (0.1, 0.35, 0.7, 0.95, 1.2):                       # 1.2: out of reach
            t = frac * top
            r = O.min_cost_for_target(D, "energy_cost_saving_pct", t, scope=scope, **NO_UI)
            check(r, plans, "upfront_cost_chf", "min", [("energy_cost_saving_pct", "min", t)],
                  ("operating_cost_saving_chf_year", "max"))


@forced_search
def test_unreachable_target_gives_cheapest_max_saving_plan():
    plans = all_plans(SUB_A)
    top = max(m["operating_cost_saving_chf_year"] for _, m in plans)
    r = O.min_cost_for_target(D, "operating_cost_saving_chf_year", 2 * top, scope=SUB_A, **NO_UI)
    assert r["status"] == "best_effort" and not r["constraints"][0]["met"]
    assert close(r["metrics"]["operating_cost_saving_chf_year"], top)
    cheapest = min(m["upfront_cost_chf"] for _, m in plans if close(m["operating_cost_saving_chf_year"], top, 1e-12))
    assert close(r["metrics"]["upfront_cost_chf"], cheapest)
    assert "out of reach" in r["message"] and "save" in r["message"]


@forced_search
def test_energy_targets_match_brute_force():
    for scope in SUBS:
        plans = all_plans(scope)
        for metric in ("energy_saving_kwh_year", "energy_saving_pct", "grid_energy_saving_kwh_year"):
            top = max(m[metric] for _, m in plans)
            for frac in (0.3, 0.8):
                r = O.min_cost_for_target(D, metric, frac * top, scope=scope, **NO_UI)
                check(r, plans, "upfront_cost_chf", "min", [(metric, "min", frac * top)], ("operating_cost_saving_chf_year", "max"))


@forced_search
def test_max_savings_matches_brute_force():
    for scope in SUBS:
        plans = all_plans(scope)
        top = max(m["upfront_cost_chf"] for _, m in plans)
        for budget in (0.03 * top, 0.15 * top, 0.5 * top, None):
            cons = [] if budget is None else [("upfront_cost_chf", "max", budget)]
            r = O.max_savings(D, budget=budget, scope=scope, **NO_UI)
            check(r, plans, "operating_cost_saving_chf_year", "max", cons)
            r = O.max_savings(D, "energy_cost_saving_chf_year", budget=budget, scope=scope, **NO_UI)
            check(r, plans, "energy_cost_saving_chf_year", "max", cons)


@forced_search
def test_min_total_cost_matches_brute_force():
    for scope in SUBS:
        top = max(m["upfront_cost_chf"] for _, m in all_plans(scope))
        for years in (5, 15):
            plans = all_plans(scope, horizon=years)
            for basis, metric in (("chf", "total_cost_chf"), ("kwh", "total_energy_kwh")):
                for budget in (None, 0.1 * top):
                    cons = [] if budget is None else [("upfront_cost_chf", "max", budget)]
                    r = O.min_total_cost(D, years, basis=basis, budget=budget, scope=scope, **NO_UI)
                    check(r, plans, metric, "min", cons, horizon=years)
    plans = all_plans(SUB_A, horizon=12, discounted=True)
    r = O.min_total_cost(D, 12, discounted=True, scope=SUB_A, **NO_UI)
    check(r, plans, "total_cost_chf", "min", [], horizon=12, discounted=True)


@forced_search
def test_two_constraints_match_brute_force():
    for scope in SUBS:
        plans = all_plans(scope)
        kwh = max(m["energy_saving_pct"] for _, m in plans)
        lo, hi = min(m["comfort_score"] for _, m in plans), max(m["comfort_score"] for _, m in plans)
        top = max(m["upfront_cost_chf"] for _, m in plans)
        for frac in (0.2, 0.5, 0.8):
            cons = [("energy_saving_pct", "min", frac * kwh), ("comfort_score", "min", lo + frac * (hi - lo))]
            r = O.solve(D, {"metric": "upfront_cost_chf"}, [{"metric": n, k: b} for n, k, b in cons], scope=scope, **NO_UI)
            check(r, plans, "upfront_cost_chf", "min", cons, ("operating_cost_saving_chf_year", "max"))
            cons = [("upfront_cost_chf", "max", frac * top), ("payback_years", "max", 8)]
            r = O.solve(D, {"metric": "operating_cost_saving_chf_year"}, [{"metric": n, k: b} for n, k, b in cons],
                        scope=scope, **NO_UI)
            check(r, plans, "operating_cost_saving_chf_year", "max", cons)


@forced_search
def test_pareto_covers_brute_force():
    for scope in SUBS:
        plans = all_plans(scope)
        for x, y in (("upfront_cost_chf", "operating_cost_saving_chf_year"), ("upfront_cost_chf", "comfort_score")):
            r = O.pareto(D, x, y, scope=scope, max_points=None)
            pts = [(p["x"], p["y"]) for p in r["points"]]
            assert r["total_non_dominated"] == len(pts)
            best = -math.inf
            for bx, by in sorted(((m[x], m[y]) for _, m in plans), key=lambda p: (p[0], -p[1])):
                if by > best + 1e-9 * (1 + abs(best)):                  # a brute-force non-dominated point
                    best = by
                    assert any(px <= bx + 1e-6 * max(1, abs(bx)) and py >= by - 1e-6 * max(1, abs(by)) for px, py in pts), (x, y, bx, by)


@forced_search
def test_payback_constraints_match_brute_force():
    plans = all_plans(P1, events=P1_EVENTS)
    r = O.solve(D, {"metric": "comfort_score", "sense": "max"}, [{"metric": "payback_years", "max": 3.9}], scope=P1,
                events=list(P1_EVENTS), **NO_UI)
    check(r, plans, "comfort_score", "max", [("payback_years", "max", 3.9)], events=P1_EVENTS)
    for cons in ([("energy_cost_saving_pct", "min", 20), ("payback_years", "max", 2)],      # out of reach: best effort
                 [("energy_cost_saving_pct", "min", 35), ("payback_years", "max", 3)],
                 [("comfort_score", "min", 53.5), ("payback_years", "max", 3)]):
        r = O.solve(D, {"metric": "upfront_cost_chf"}, [{"metric": n, k: b} for n, k, b in cons], scope=P1,
                    events=list(P1_EVENTS), **NO_UI)
        assert r["status"] == "best_effort"
        check(r, plans, "upfront_cost_chf", "min", cons, ("operating_cost_saving_chf_year", "max"), events=P1_EVENTS)
    plans = all_plans(P2, discounted=True, events=("energy_price_spike",), granularity="building")
    cons = [("energy_cost_saving_pct", "min", 21.55), ("payback_years", "max", 3.546)]
    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 21.55, constraints=[{"metric": "payback_years", "max": 3.546}],
                              granularity="building", events=["energy_price_spike"], discounted=True, scope=P2, **NO_UI)
    check(r, plans, "upfront_cost_chf", "min", cons, ("operating_cost_saving_chf_year", "max"), discounted=True,
          events=("energy_price_spike",))


def test_full_building_regressions():
    """Plans an independent 30-restart local search found; the optimizer must do at least as well."""
    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 15, constraints=[{"metric": "payback_years", "max": 4}], **NO_UI)
    assert r["status"] == "ok" and r["objective"]["value"] <= 194_810 + 1e-6
    r = O.solve(D, {"metric": "upfront_cost_chf", "sense": "min"},
                [{"metric": "energy_cost_saving_pct", "min": 25}, {"metric": "office_co2_ppm", "max": 700}], **NO_UI)
    assert r["status"] == "ok" and r["objective"]["value"] <= 216_705 + 1e-6
    r = O.solve(D, {"metric": "npv_economic_chf", "sense": "max"}, [{"metric": "payback_years", "max": 5}], **NO_UI)
    assert r["status"] == "ok" and r["objective"]["value"] >= 3_333_907


def test_pareto_is_deterministic():
    old = O.PARETO_PLANS
    O.PARETO_PLANS = 600                                   # small budget: the stopping rule, not the curve, is tested
    try:
        O._CTX.clear()
        a = O.pareto(D, max_points=None)
        O._CTX.clear()
        b = O.pareto(D, max_points=None)
    finally:
        O.PARETO_PLANS = old
    assert a["search"]["evaluations"] == b["search"]["evaluations"]
    assert [(p["x"], p["y"], len(p["changes"])) for p in a["points"]] == [(p["x"], p["y"], len(p["changes"])) for p in b["points"]]


# --- scope
def test_scope_is_respected():
    r = O.max_savings(D, budget=300_000, scope={"locked": [{"group": "solar_pv"}, {"group": "lighting", "floor": [0, 1]}]}, **NO_UI)
    cfg = r["configuration"]
    assert cfg["solar_pv"] == "solar_pv_none" and cfg["lighting@0"] == cfg["lighting@1"] == "lighting_current"
    assert r["metrics"]["upfront_cost_chf"] <= 300_000

    req = {"required": [{"group": "ventilation", "floor": 2, "option": "ventilation_mid"}, {"group": "monitors", "floor": 1}]}
    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 10, scope=req, **NO_UI)
    assert r["status"] == "ok" and r["configuration"]["ventilation@2"] == "ventilation_mid"
    assert r["configuration"]["monitors@1"] != "monitors_current"

    free = O.min_cost_for_target(D, "energy_cost_saving_pct", 10, **NO_UI)
    banned = {"lighting_budget", "coffee_budget"}
    assert any(c["to_option"] in banned for c in free["changes"])
    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 10, scope={"excluded_options": sorted(banned)}, **NO_UI)
    assert r["status"] == "ok" and not any(c["to_option"] in banned for c in r["changes"])

    allowed = {"allowed": [{"group": "lighting", "option": ["lighting_mid", "lighting_premium"]}, {"group": "blinds"}]}
    r = O.max_savings(D, "energy_cost_saving_chf_year", scope=allowed, **NO_UI)
    assert r["changes"] and all(c["group"] == "blinds" or c["to_option"] in ("lighting_mid", "lighting_premium")
                                for c in r["changes"])

    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 95, scope={"locked": [{"group": "lighting"}]}, **NO_UI)
    assert r["status"] == "best_effort" and not any(c["group"] == "lighting" for c in r["changes"])
    assert "these changes" in r["message"]


def test_scope_errors():
    bad = [
        {"required": [{"group": "lighting", "floor": 2}], "locked": [{"group": "lighting"}]},
        {"required": [{"group": "coffee", "floor": 0, "option": "coffee_budget"}], "excluded_options": ["coffee_budget"]},
        {"allowed": [{"group": "lighting"}], "required": [{"group": "blinds", "floor": 1}]},
        {"allowed": [{"group": "lamps"}]},
        {"locked": [{"group": "lighting", "option": "lighting_superb"}]},
        {"locked": [{"group": "lighting", "option": "coffee_mid"}]},
        {"required": [{"group": "monitors", "floor": -1}]},                  # no monitors in the basement
        {"excluded_options": ["nope"]},
        {"forbidden": []},
    ]
    for scope in bad:
        try:
            O.solve(D, {"metric": "upfront_cost_chf"}, scope=scope, **NO_UI)
        except ValueError:
            continue
        raise AssertionError(f"no ValueError for {scope}")
    for call in (lambda: O.solve(D, {"metric": "upfront_cost_chf"}, scope={"locked": [{"group": "lighting", "floor": 1}]},
                                 granularity="building", **NO_UI),
                 lambda: O.solve(D, {"metric": "happiness"}, **NO_UI),
                 lambda: O.solve(D, {"metric": "upfront_cost_chf", "sense": "up"}, **NO_UI),
                 lambda: O.max_savings(D, constraints=[{"metric": "comfort", "min": 1}], **NO_UI),
                 lambda: O.max_savings(D, events=["meteor"], **NO_UI),
                 lambda: O.min_total_cost(D, 10, basis="co2", **NO_UI),
                 lambda: O.evaluate(D, [{"group": "lighting", "option": "coffee_mid"}]),
                 lambda: O.pareto(D, "upfront_cost_chf", "nonsense")):
        try:
            call()
        except ValueError:
            continue
        raise AssertionError("expected ValueError")


def test_malformed_input_raises_value_error():
    """The API turns ValueError into a 400; anything else would be a 500."""
    sel = lambda **kw: O.solve(D, {"metric": "upfront_cost_chf"}, scope=kw, **NO_UI)          # noqa: E731
    calls = [
        lambda: O.max_savings(D, overrides={"electricity_price_chf_kwh": "0.3"}, **NO_UI),
        lambda: O.max_savings(D, overrides={"horizon_years": 0}, **NO_UI),
        lambda: O.evaluate(D, [], overrides={"horizon_years": -3}),
        lambda: O.evaluate(D, [], horizon_years=0),
        lambda: sel(allowed=[{"group": ["lighting"]}]),
        lambda: sel(locked=[{"group": {"a": 1}}]),
        lambda: sel(allowed=[{"group": "lighting", "option": [["lighting_mid"]]}]),
        lambda: sel(allowed=[{"group": "lighting", "floor": [[1]]}]),
        lambda: sel(excluded_options=[["coffee_budget"]]),
        lambda: O.max_savings(D, events=[["new_lab"]], **NO_UI),
        lambda: O.max_savings(D, events=[{"id": "new_lab"}], **NO_UI),
        lambda: O.solve(D, {"metric": ["upfront_cost_chf"]}, **NO_UI),
        lambda: O.solve(D, {"metric": "upfront_cost_chf"}, [{"metric": {"x": 1}, "min": 1}], **NO_UI),
        lambda: O.solve(D, {"metric": "upfront_cost_chf"}, tie_break={"metric": [1]}, **NO_UI),
        lambda: O.evaluate(D, [{"group": "lighting", "option": "lighting_mid", "floor": 9}]),
        lambda: O.evaluate(D, [{"group": "lighting", "option": ["lighting_mid"]}]),
        lambda: O.pareto(D, x_metric=["upfront_cost_chf"]),
        lambda: O.min_cost_for_target(D, "energy_cost_saving_pct", "10", **NO_UI),
    ]
    for k, call in enumerate(calls):
        try:
            call()
        except ValueError:
            continue
        raise AssertionError(f"call {k}: no ValueError")


# --- full building
def test_budgets_respected_on_full_building():
    for budget in (50_000, 150_000, 400_000):
        r = O.max_savings(D, budget=budget, **NO_UI)
        assert r["status"] == "ok" and r["metrics"]["upfront_cost_chf"] <= budget
        assert close(sum(c["upfront_cost_chf"] for c in r["changes"]), r["metrics"]["upfront_cost_chf"])
    r = O.min_total_cost(D, 10, budget=300_000, **NO_UI)
    assert r["status"] == "ok" and r["metrics"]["upfront_cost_chf"] <= 300_000


def test_full_building_runtime_and_pareto():
    O._CTX.clear()
    runs = {
        "min_cost_for_target": lambda: O.min_cost_for_target(D, "energy_cost_saving_pct", 10),
        "max_savings": lambda: O.max_savings(D, budget=200_000),
        "min_total_cost": lambda: O.min_total_cost(D, 10),
        "solve (2 constraints)": lambda: O.solve(D, {"metric": "upfront_cost_chf"},
                                                 [{"metric": "energy_saving_pct", "min": 15}, {"metric": "comfort_score", "min": 60}]),
    }
    for name, f in runs.items():
        t = time.time()
        r = f()
        dt = time.time() - t
        print(f"  {name}: {dt:.2f} s, {r['search']['evaluations']} plans, {r['status']}")
        assert dt < 10 and r["status"] == "ok" and r["engine"] is not None
    t = time.time()
    p = O.pareto(D)
    dt = time.time() - t
    print(f"  pareto: {dt:.2f} s, {p['search']['evaluations']} plans, {p['total_non_dominated']} non-dominated")
    assert dt < 10 and p["search"]["evaluations"] >= O.PARETO_PLANS          # stopped by its plan budget, not the clock
    pts = p["points"]
    assert 2 < len(pts) <= 15 and 0 <= p["knee_index"] < len(pts)
    assert pts[0]["scenario"] == [] and pts[0]["x"] == 0 and abs(pts[0]["y"]) < 1e-9
    assert all(a["x"] < b["x"] and a["y"] < b["y"] for a, b in zip(pts, pts[1:]))         # sorted, non-dominated


def test_result_shape_and_json():
    r = O.max_savings(D, budget=100_000, events=["new_lab"], horizon_years=10)
    assert set(r) == {"status", "message", "objective", "constraints", "scenario", "changes", "configuration", "metrics",
                      "baseline", "flags", "settings", "engine", "search"}
    assert set(r["metrics"]) == set(O.METRICS) and len(r["configuration"]) == len(O.zones(D))
    assert r["settings"]["horizon_years"] == 10 and r["settings"]["events"] == ["new_lab"]
    assert set(r["engine"]) == {"finance", "snapshot", "snapshot_baseline"}
    same = viz.run(D, r["scenario"], ["new_lab"], {"horizon_years": 10})
    assert same["finance"]["npv_cash"] == r["engine"]["finance"]["npv_cash"]
    json.dumps(viz.clean(r))
    json.dumps(viz.clean(O.pareto(D, scope=SUB_B, max_points=5)))


def test_deterministic_and_building_granularity():
    O._CTX.clear()
    a = O.min_cost_for_target(D, "energy_cost_saving_pct", 20, **NO_UI)
    O._CTX.clear()
    b = O.min_cost_for_target(D, "energy_cost_saving_pct", 20, **NO_UI)
    assert a["scenario"] == b["scenario"]
    r = O.min_cost_for_target(D, "energy_cost_saving_pct", 20, granularity="building", **NO_UI)
    assert r["status"] == "ok" and all("floor" not in sw for sw in r["scenario"])
    assert r["metrics"]["upfront_cost_chf"] >= a["metrics"]["upfront_cost_chf"] - 1e-6      # coarser can't be cheaper


def test_small_scope_is_exhaustive():
    scope = {"allowed": [{"group": "lighting", "floor": [2, 3]}, {"group": "coffee", "floor": [1, 2]}]}  # 256 plans
    plans = all_plans(scope)
    r = O.max_savings(D, budget=20_000, scope=scope, **NO_UI)
    assert r["search"]["method"] == "exhaustive"
    check(r, plans, "operating_cost_saving_chf_year", "max", [("upfront_cost_chf", "max", 20_000)])
    r = O.solve(D, {"metric": "comfort_score", "sense": "max"}, [{"metric": "payback_years", "max": 3.9}], scope=P1,
                events=list(P1_EVENTS), **NO_UI)                       # 384 plans: within the budget, so tried in full
    assert r["search"]["method"] == "exhaustive"
    check(r, all_plans(P1, events=P1_EVENTS), "comfort_score", "max", [("payback_years", "max", 3.9)], events=P1_EVENTS)


# --- the solver behind optimize.solve (the chat assistant's interface)
def _oscar_sets():
    import optimize as OZ
    groups = sorted(OZ._groups(D))
    lock = lambda keep: [{"group": g} for g in groups if g not in keep]          # noqa: E731
    # mixed: lighting is split by its locked floor 3, monitors stay one building-wide decision; with the new lab
    mixed = {"locked": lock({"lighting", "monitors", "solar_pv"}) + [{"group": "lighting", "floor": 3}],
             "allowed": {"lighting": ["lighting_current", "lighting_budget"], "monitors": ["monitors_current", "monitors_budget"]},
             "events": ["new_lab"]}                                                                       # 32*2*2 = 128 plans
    floors = {"per_floor": True, "allowed": {"ventilation": ["ventilation_current", "ventilation_budget", "ventilation_mid"],
                                             "coffee": ["coffee_current", "coffee_budget"]},
              "locked": lock({"ventilation", "coffee"}) + [{"group": "ventilation", "floor": f} for f in (-1, 3, 4)]
              + [{"group": "coffee", "floor": f} for f in (3, 4)]}                                       # 8*27 = 216 plans
    return OZ, (mixed, floors)


def _oscar_score(OZ, prob, m):
    """optimize.evaluate_scenario's ranking, from metrics: (summed relative violation, objective)."""
    total = 0.0
    for c in prob["constraints"]:
        v = OZ._BIG if m[c["metric"]] is None else m[c["metric"]]
        for bound, over in (("max", v - c.get("max", 0)), ("min", c.get("min", 0) - v)):
            if bound in c and over > 1e-9:
                total += over / max(abs(c[bound]), 1.0)
    o = OZ._BIG if m[prob["objective"]["metric"]] is None else m[prob["objective"]["metric"]]
    return round(total, 9), (o if prob["objective"]["sense"] == "min" else -o)


def test_fast_path_matches_optimize_metrics():
    """Every metric of optimize.py, with its definitions (horizon averages, warning entries), from the fast path."""
    import optimize as OZ
    for gran, events, seed in (("floor", ("new_lab",), 7), ("building", ("new_lab", "energy_price_spike", "heatwave_summer"), 8)):
        space, ctx = O._Space(D, gran, None), O._ctx(D, events, {}, int(D["params"]["horizon_years"]))
        for cfg in _random_plans(space, 4, seed) + [space.nothing()]:
            fast = O._metrics(ctx.run(space, cfg), ctx.r, False, True)[0]
            ref = OZ.metrics(D, OZ._simulate(D, space.scenario(cfg), list(events)))
            for k in OZ.METRICS:
                assert (fast[k] is None and ref[k] is None) or close(fast[k], ref[k], 1e-9), (k, fast[k], ref[k])


@forced_search
def test_optimize_solve_matches_brute_force_with_its_own_evaluate():
    import itertools
    OZ, sets = _oscar_sets()
    for base in sets:
        prob0 = OZ.normalize(D, {"objective": {"metric": "upfront_cost_chf"}, **base})
        slot_list = OZ.slots(D, prob0)
        plans = [dict(zip([s["key"] for s in slot_list], combo)) for combo in itertools.product(*[s["options"] for s in slot_list])]
        allm = [OZ.metrics(D, OZ._simulate(D, OZ.to_scenario(slot_list, p), prob0["events"])) for p in plans]
        top_up = max(m["upfront_cost_chf"] for m in allm)
        problems = [{"objective": {"metric": "running_cost_chf_year"}, "constraints": [{"metric": "upfront_cost_chf", "max": 0.3 * top_up}]},
                    {"objective": {"metric": "running_cost_chf_year"}},
                    {"objective": {"metric": "npv_cash_chf"}, "allow_warnings": True},
                    {"objective": {"metric": "upfront_cost_chf"}, "constraints": [{"metric": "electricity_kwh_year", "max_change_pct": -1}],
                     "allow_warnings": True},
                    {"objective": {"metric": "upfront_cost_chf"}, "constraints": [{"metric": "electricity_kwh_year", "max": 1000}]}]
        for p in problems:
            r = OZ.solve(D, {**base, **p})
            assert r["solver"] == "search"
            prob = r["problem"]
            best = min(_oscar_score(OZ, prob, m) for m in allm)
            got = OZ.evaluate_scenario(D, prob, r["best"]["scenario"])
            assert abs(got["_total"] - best[0]) < 1e-9 and close(got["objective"], best[1]), (p, got["_total"], got["objective"], best)
        assert not OZ.solve(D, {**base, **problems[-1]})["best"]["feasible"]           # the unreachable limit is reported


def test_optimize_solve_beats_greedy_on_the_full_building():
    import optimize as OZ
    problems = [{"objective": {"metric": "running_cost_chf_year"}, "constraints": [{"metric": "upfront_cost_chf", "max": 200000}]},
                {"objective": {"metric": "upfront_cost_chf"}, "constraints": [{"metric": "electricity_kwh_year", "max_change_pct": -20}]}]
    for p in problems:
        for per_floor in (False, True):
            q = {**p, "per_floor": per_floor}
            t = time.time()
            s = OZ.solve(D, q)
            dt = time.time() - t
            g = OZ.solve(D, q, solver="greedy")["best"]
            print(f"  optimize.solve per_floor={per_floor}: {dt:.2f} s, search {s['best']['objective']:.0f} vs greedy {g['objective']:.0f}")
            assert dt < (6 if per_floor else 3)
            sb = s["best"]
            assert (sb["feasible"] and not g["feasible"]) or (sb["feasible"] == g["feasible"] and sb["objective"] <= g["objective"] + 1e-6)


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    t0 = time.time()
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError as e:
            failed += 1
            print("FAIL", t.__name__, e)
    print(f"{len(tests) - failed}/{len(tests)} passed in {time.time() - t0:.0f} s")
    sys.exit(1 if failed else 0)
