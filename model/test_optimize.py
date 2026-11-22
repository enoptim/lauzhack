"""Tests for the optimizer wrapper (optimize.py). Run: python test_optimize.py (or pytest)."""
import engine
import optimize as O

D = engine.load()
CHEAP = {"objective": {"metric": "running_cost_chf_year"}, "constraints": [{"metric": "upfront_cost_chf", "max": 200000}]}


def _groups(scenario):
    return {(s["group"], s.get("floor")) for s in scenario}


def test_metrics_match_the_engine():
    sc = [{"group": "lighting", "option": "lighting_mid"}]
    res = O._simulate(D, sc, [])
    m = O.metrics(D, res)
    assert m["npv_cash_chf"] == res["npv_cash"]
    assert m["electricity_kwh_year"] == sum(y["kwh"] for y in res["years"]) / len(res["years"])
    assert m["upfront_cost_chf"] > 0 and set(m) == set(O.METRICS)


def test_doing_nothing_is_best_for_lowest_upfront_cost():
    r = O.solve(D, {"objective": {"metric": "upfront_cost_chf"}})
    assert r["best"]["scenario"] == [] and r["best"]["feasible"]


def test_budget_is_respected_and_running_cost_falls():
    r = O.solve(D, CHEAP)
    b, t = r["best"]["metrics"], r["today"]["metrics"]
    assert r["best"]["feasible"]
    assert b["upfront_cost_chf"] <= 200000
    assert b["running_cost_chf_year"] < t["running_cost_chf_year"]
    assert b["warnings"] == 0                                      # added by default


def test_locked_group_and_floor_stay_as_today():
    r = O.solve(D, CHEAP | {"locked": [{"group": "lighting", "floor": 3}, {"group": "monitors"}]})
    sc = r["best"]["scenario"]
    assert ("lighting", 3) not in _groups(sc)
    assert not any(s["group"] == "monitors" for s in sc)
    assert not engine.resolve(D, sc).keys() & {i["id"] for i in D["items"]
                                                 if i["group"] == "lighting" and engine.served_floor(i) == 3}


def test_allowed_with_one_option_forces_it():
    r = O.solve(D, CHEAP | {"allowed": {"coffee": ["coffee_mid"]}})
    assert {"group": "coffee", "option": "coffee_mid"} in r["best"]["scenario"]


def test_relative_limit_becomes_absolute():
    p = O.normalize(D, {"objective": {"metric": "upfront_cost_chf"},
                        "constraints": [{"metric": "electricity_kwh_year", "max_change_pct": -10}]})
    today = O.metrics(D, O._simulate(D, [], []))["electricity_kwh_year"]
    assert abs(p["constraints"][0]["max"] - 0.9 * today) < 1e-6
    r = O.solve(D, p)
    assert r["best"]["feasible"] and r["best"]["metrics"]["electricity_kwh_year"] <= 0.9 * today + 1e-6


def test_impossible_limit_is_reported_not_hidden():
    r = O.solve(D, {"objective": {"metric": "upfront_cost_chf"},
                    "constraints": [{"metric": "electricity_kwh_year", "max": 1000}]})
    assert not r["best"]["feasible"]
    assert r["best"]["violations"][0]["metric"] == "electricity_kwh_year"


def test_bad_problems_are_rejected():
    for bad in ({"objective": {"metric": "nope"}},
                {"objective": {"metric": "upfront_cost_chf"}, "locked": [{"group": "nope"}]},
                {"objective": {"metric": "upfront_cost_chf"}, "allowed": {"coffee": ["lighting_mid"]}},
                {"objective": {"metric": "upfront_cost_chf"}, "constraints": [{"metric": "warnings"}]}):
        try:
            O.normalize(D, bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")


def test_a_custom_solver_plugs_in():
    seen = {}

    def first_option_everywhere(problem, slots, evaluate):
        plan = {s["key"]: next(o for o in s["options"] if o) for s in slots if any(s["options"])}
        seen["score"] = evaluate(plan)["score"]
        return plan

    r = O.solve(D, {"objective": {"metric": "npv_cash_chf"}, "allow_warnings": True}, solver=first_option_everywhere)
    assert r["solver"] == "first_option_everywhere" and r["best"]["scenario"] and "score" in seen


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError:
            failed += 1
            print("FAIL", t.__name__)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
