"""Spending limits: the day-one reserve check, the financing flag and the upgrade budget.
Run: python test_limits.py (or pytest)."""
import random

import engine
import search as S

D = engine.load()
P = D["params"]
VENT = [{"group": "ventilation", "option": "ventilation_mid", "floor": 2}]    # the demo plan
LIGHT = [{"group": "lighting", "option": "lighting_mid"}]                     # replaces worn-out lights too
PLAN_FLAGS = ("over_budget", "reserve_below_minimum", "needs_financing", "ventilation_over_capacity", "desk_shortfall")


def _flags(res, kind):
    return [f for f in res["flags"] if f["type"] == kind]


def _sim(scenario, **overrides):
    return engine.simulate(D, scenario, overrides=overrides)


def test_result_carries_both_day_one_figures():
    s, b = _sim(VENT), _sim([])
    assert s["paid_year0_baseline"] == b["paid_year0"] > 0           # worn-out units replaced like for like anyway
    assert abs(s["capex_year0"] - (s["paid_year0"] - s["paid_year0_baseline"])) < 1e-6
    assert s["purchase_year0"] > 0
    assert abs(s["years"][0]["cash_opening"] - (P["opening_reserve_chf"] - s["paid_year0"])) < 1e-6
    lit = _sim(LIGHT)
    assert lit["purchase_year0"] > lit["capex_year0"] > 0             # the budget figure is smaller than the full price


def test_day_one_purchase_below_minimum_is_flagged_in_year_0():
    s = _sim(VENT)
    opening = P["min_reserve_chf"] + s["paid_year0"] - 1_000            # 1,000 short of the minimum after paying
    res = _sim(VENT, opening_reserve_chf=opening)
    low = _flags(res, "reserve_below_minimum")
    assert low and low[0]["year"] == 0 and low[0]["reserve"] == round(P["min_reserve_chf"] - 1_000), low
    assert not [f for f in _flags(res, "needs_financing") if f["year"] == 0]
    # The same reserve with doing nothing's day-one spending stays above the minimum: no plan flag for it.
    base = _sim([], opening_reserve_chf=opening)
    assert not any(f["type"] in PLAN_FLAGS and f["year"] == 0 for f in base["flags"])


def test_purchase_that_makes_cash_negative_needs_financing():
    s = _sim(VENT)
    res = _sim(VENT, opening_reserve_chf=s["paid_year0"] - 5_000)
    fin = _flags(res, "needs_financing")
    assert fin and fin[0]["year"] == 0 and fin[0]["shortfall"] == 5_000 and fin[0]["reserve"] == -5_000, fin
    assert _flags(res, "reserve_below_minimum")[0]["year"] == 0     # below zero is below the minimum too


def test_financing_flag_says_when_doing_nothing_runs_out_too():
    for res in (_sim(VENT), _sim(VENT, opening_reserve_chf=_sim(VENT)["paid_year0"] - 5_000)):
        for f in _flags(res, "needs_financing"):
            y = f["year_without_upgrades"]
            if y is not None:
                assert y == 0 or res["years"][y - 1]["cash_closing_baseline"] < 0
                assert y == 0 or y == 1 or res["years"][y - 2]["cash_closing_baseline"] >= 0


def test_budget_fires_exactly_when_the_extra_cost_is_above_it():
    for sc in (VENT, LIGHT):
        extra = _sim(sc)["capex_year0"]
        above = _sim(sc, capex_budget_chf=extra - 1)
        below = _sim(sc, capex_budget_chf=extra + 1)
        assert _flags(above, "over_budget") and not _flags(below, "over_budget"), sc
    # Between the extra cost and the full price: not over budget, because the budget covers the extra cost.
    lit = _sim(LIGHT)
    mid = (lit["capex_year0"] + lit["purchase_year0"]) / 2
    assert not _flags(_sim(LIGHT, capex_budget_chf=mid), "over_budget")


def test_budget_flag_carries_both_figures():
    lit = _sim(LIGHT)
    f = _flags(_sim(LIGHT, capex_budget_chf=1_000), "over_budget")[0]
    assert f["year"] == 0 and f["budget"] == 1_000
    assert f["extra_cost"] == round(lit["capex_year0"]) and f["purchase"] == round(lit["purchase_year0"])


def test_doing_nothing_has_no_plan_flags():
    for over in ({}, {"opening_reserve_chf": 0}, {"capex_budget_chf": 0}, {"min_reserve_chf": 10**9}):
        res = _sim([], **over)
        assert res["capex_year0"] == 0 and res["purchase_year0"] == 0
        assert not [f for f in res["flags"] if f["type"] in ("over_budget", "reserve_below_minimum", "needs_financing")], over


def test_search_checks_the_day_one_reserve_like_the_engine():
    """The optimizer's fast path counts the year-0 reserve and financing warnings the same way as engine.simulate,
    and by default does not recommend a plan that breaks them."""
    tight = {"opening_reserve_chf": _sim([])["paid_year0"] + P["min_reserve_chf"] + 20_000}
    ev, over, H, _ = S._settings(D, (), tight, None)
    space, ctx = S._Space(D, "floor", None), S._ctx(D, ev, over, H)
    rng = random.Random(4)
    plans = [tuple(rng.choice(c) for c in space.choices) for _ in range(6)]
    plans += [tuple(c[-1] if k == j else b for k, (b, c) in enumerate(zip(space.base(), space.choices)))
              for j in range(len(space.choices))]                   # one zone at a time, the last option
    flagged = 0
    for cfg in [space.nothing()] + plans:
        fast = S._metrics(ctx.run(space, cfg), ctx.r, False, True)[0]
        slow = S.evaluate(D, space.scenario(cfg), (), tight)["metrics"]
        for k in ("warnings", "new_warnings", "lowest_reserve_chf"):
            assert abs(fast[k] - slow[k]) < 1e-6, (k, fast[k], slow[k])
        flagged += any(f["type"] == "reserve_below_minimum" and f["year"] == 0 for f in S.evaluate(D, space.scenario(cfg), (), tight)["flags"])
    assert flagged, "no plan breaks the day-one reserve: the check above proves nothing"
    # The search allows warnings unless asked; its callers (optimize.py, the assistant) add this limit by default.
    r = S.max_savings(D, constraints=[{"metric": "new_warnings", "max": 0}], overrides=tight, include_engine_output=False)
    assert r["status"] == "ok"
    assert not [f for f in r["flags"] if f["type"] in ("reserve_below_minimum", "needs_financing", "over_budget")], r["flags"]


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError as e:
            failed += 1
            print("FAIL", t.__name__, e)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
