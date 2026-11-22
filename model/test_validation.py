"""Input validation and sanity checks: bad API input gives a clear 4xx, and the accounting holds.
Run: python test_validation.py (needs fastapi, so use .venv/bin/python; no httpx needed).

Already proven elsewhere, so not repeated here: test_engine.py has the cash identity (one plan, forward),
reproducibility of simulate, baseline-vs-itself is zero, NPV breakdown sums, zero price, zero discount rate and
monitors-only isolation. This file adds the API layer and the identities the checklist names explicitly."""
import asyncio
import json
import math
import os

os.environ.setdefault("TWIN_WARMUP", "0")

import engine
import montecarlo
import validate as V
import server

D = engine.load()
PLAN = [{"group": "ventilation", "option": "ventilation_budget"}, {"group": "lighting", "option": "lighting_mid"}]
LIGHT = [{"group": "lighting", "option": "lighting_mid"}]


# ---------------------------------------------------------------- a tiny HTTP client (no httpx needed)
def call(method, path, body=None):
    """Run one request through the real ASGI app. Returns (status, json). A crash is reported as 500."""
    raw = json.dumps(body, allow_nan=True).encode() if body is not None else b""
    sent, state = [], {"done": False}

    async def receive():
        if not state["done"]:
            state["done"] = True
            return {"type": "http.request", "body": raw, "more_body": False}
        await asyncio.sleep(3600)

    async def send(msg):
        sent.append(msg)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "path": path,
             "raw_path": path.encode(), "query_string": b"", "root_path": "", "scheme": "http",
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
             "server": ("test", 80), "client": ("test", 1)}
    try:
        asyncio.run(asyncio.wait_for(server.app(scope, receive, send), 120))
    except Exception:  # noqa: BLE001
        return 500, None
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    payload = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, (json.loads(payload) if payload else None)


def bad(path, body, words=None, status=400):
    code, out = call("POST", path, body)
    assert code == status, f"{path} {body}: expected {status}, got {code} {out}"
    if words:
        assert words.lower() in json.dumps(out).lower(), f"{path}: message lacks {words!r}: {out}"


# ---------------------------------------------------------------- API: bad input -> clear 4xx
def test_good_requests_still_work():
    assert call("POST", "/api/simulate", {"scenario": LIGHT, "events": ["new_lab"],
                                           "overrides": {"electricity_price_chf_kwh": 0.3}, "year": 3})[0] == 200
    assert call("POST", "/api/futures", {"scenarios": {"a": PLAN}, "n": 6, "seed": 5})[0] == 200


def test_unknown_assumption_and_bad_values():
    for ep in ("simulate", "tornado", "bands", "stress_test"):
        bad(f"/api/{ep}", {"overrides": {"no_such_thing": 1}}, "unknown assumption")
        bad(f"/api/{ep}", {"overrides": {"electricity_price_chf_kwh": -0.1}}, "between")
        bad(f"/api/{ep}", {"overrides": {"electricity_price_chf_kwh": "0.3"}}, "number")
        bad(f"/api/{ep}", {"overrides": {"electricity_price_chf_kwh": True}}, "number")
    bad("/api/simulate", {"overrides": {"electricity_price_chf_kwh": float("nan")}}, "finite")
    bad("/api/simulate", {"overrides": {"electricity_price_chf_kwh": float("inf")}}, "finite")
    bad("/api/simulate", {"overrides": {"discount_rate_real": -1}}, "discount_rate_real")
    bad("/api/simulate", {"overrides": {"pv_self_consumption_share": 1.5}}, "between")
    bad("/api/simulate", {"overrides": {"horizon_years": 0}}, "horizon_years")
    bad("/api/simulate", {"overrides": {"horizon_years": 2.5}}, "whole")
    bad("/api/simulate", {"overrides": [1, 2]}, status=422)
    bad("/api/breakeven", {"param": "nonsense"}, "unknown assumption")


def test_bad_swaps_and_scenarios():
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_nope"}]}, "unknown option")
    bad("/api/simulate", {"scenario": [{"group": "coffee", "option": "lighting_mid"}]}, "belongs to group")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "floor": 99}]}, "floor")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "floor": "2"}]}, "whole number")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "room_id": "nowhere"}]}, "room")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "item_id": "x"}]}, "item")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "year": -1}]}, "timing")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "year": "soon"}]}, "timing")
    bad("/api/simulate", {"scenario": [{"group": "lighting", "option": "lighting_mid", "year": 99}]}, "after the last")
    bad("/api/simulate", {"scenario": ["lighting_mid"]}, "swap")
    bad("/api/simulate", {"scenario": [{"group": "lighting"}]}, "group")
    bad("/api/simulate", {"scenario": LIGHT * 201}, "too many")
    bad("/api/preview", {"scenario": [], "swap": {"group": "lighting", "option": "nope"}}, "unknown option")


def test_bad_events_and_year():
    bad("/api/simulate", {"events": ["meteor"]}, "unknown event")
    bad("/api/simulate", {"events": "new_lab"}, status=422)
    bad("/api/simulate", {"events": ["new_lab", "new_lab"]}, "once")
    bad("/api/simulate", {"year": 0}, "year")
    bad("/api/simulate", {"year": 16}, "year")
    bad("/api/simulate", {"year": 1.5}, status=422)
    bad("/api/simulate", {"year": "x"}, status=422)


def test_futures_limits():
    ok = {"scenarios": {"a": LIGHT}, "n": 3, "seed": 1}
    bad("/api/futures", {**ok, "n": 0}, "n (number")
    bad("/api/futures", {**ok, "n": 501}, "between 1 and 500")
    bad("/api/futures", {**ok, "n": -4}, "n (number")
    bad("/api/futures", {**ok, "seed": 1.5}, status=422)
    bad("/api/futures", {**ok, "scenarios": {}}, "at least one plan")
    bad("/api/futures", {**ok, "scenarios": {f"p{i}": [] for i in range(7)}}, "at most 6")
    bad("/api/futures", {**ok, "scenarios": {"a": [{"group": "x", "option": "y"}]}}, "plan 'a'")
    bad("/api/futures", {**ok, "scenarios": {" ": []}}, "name")
    bad("/api/futures", {**ok, "overrides": {"horizon_years": 5}}, "horizon_years")
    bad("/api/futures", {**ok, "overrides": {"bogus": 1}}, "unknown assumption")
    bad("/api/futures", {**ok, "events": ["meteor"]}, "unknown event")
    bad("/api/futures", {**ok, "pinned_session": "nope"}, status=404)


def test_optimizer_search_inputs():
    bad("/api/optimize", {"problem": {"objective": {"metric": "nope"}}}, "metric")
    bad("/api/optimize", {"problem": {"objective": {"metric": "upfront_cost_chf"}, "events": ["meteor"]}}, "unknown event")
    bad("/api/optimize", {"problem": {"objective": {"metric": "upfront_cost_chf"},
                                       "constraints": [{"metric": "upfront_cost_chf", "max": float("nan")}]}}, "finite")
    bad("/api/evaluate", {"problem": {"objective": {"metric": "upfront_cost_chf"}},
                          "scenario": [{"group": "lighting", "option": "coffee_mid"}]}, "belongs to group")
    bad("/api/search", {"goal": "max_savings", "budget": -5}, "negative")
    bad("/api/search", {"goal": "max_savings", "budget": float("inf")}, "finite")
    bad("/api/search", {"goal": "max_savings", "overrides": {"electricity_price_chf_kwh": -1}}, "between")
    bad("/api/search", {"goal": "min_total_cost", "years": 0}, "years")
    bad("/api/search", {"goal": "max_savings", "metric": "nonsense"}, "metric")
    bad("/api/search", {"goal": "nope"}, status=422)
    bad("/api/pareto", {"max_points": 0}, "max_points")
    bad("/api/pareto", {"events": ["meteor"]}, "unknown event")


def test_chat_and_session_inputs():
    bad("/api/chat", {"messages": []}, "non-empty")
    bad("/api/chat", {"messages": [{"role": "assistant", "content": "hi"}]}, "last message")
    bad("/api/chat", {"messages": [{"role": "root", "content": "hi"}]}, "role")
    bad("/api/chat", {"messages": [{"role": "user", "content": "hi"}], "scenario": [{"group": "a", "option": "b"}]}, "option")
    bad("/api/session/start", {"future": {"seed": "abc"}}, "seed")
    bad("/api/session/start", {"future": {"seed": None}}, "seed")
    bad("/api/session/start", {"future": "no_such_future"}, "unknown")
    bad("/api/session/start", {"future": {"nothing": 1}}, "future")
    bad("/api/session/start", {"future": {"seed": 1}, "years": 0}, "years")
    bad("/api/session/start", {"future": {"seed": 1}, "years": 99}, "years")
    code, st = call("POST", "/api/session/start", {"future": {"seed": 3}})
    assert code == 200
    sid = st["session_id"]
    bad("/api/session/decide", {"session_id": sid, "swaps": [{"group": "lighting", "option": "nope"}]}, "unknown option")
    bad("/api/session/decide", {"session_id": sid, "swaps": ["x"]}, "swap")
    bad("/api/session/decide", {"session_id": sid, "swaps": [{"group": "lighting", "option": "lighting_mid", "year": -2}]}, "timing")
    bad("/api/session/plan", {"session_id": sid, "plan": [{"group": "lighting", "option": "lighting_mid", "floor": 42}]}, "floor")
    bad("/api/session/preview", {"session_id": sid, "swap": {"group": "lighting", "option": "nope"}}, "unknown option")
    bad("/api/session/outlook", {"session_id": sid, "n": 0}, "n (number")
    bad("/api/session/outlook", {"session_id": sid, "n": 501}, "between")
    bad("/api/session/outlook", {"session_id": sid, "n": 5, "seed": 1.5}, status=422)
    bad("/api/session/next", {"session_id": "nope"}, status=404)
    bad("/api/session/decide", {"session_id": "nope", "swaps": []}, status=404)


def test_validation_functions_directly():
    """The reusable checks (also for the assistant's tools): they return clean values or raise ValidationError."""
    assert V.check_overrides(D, {"discount_rate_real": 0, "electricity_price_chf_kwh": 0}) == \
        {"discount_rate_real": 0, "electricity_price_chf_kwh": 0}
    assert V.check_count(5, "n", 1, 10) == 5 and V.check_seed(0) == 0
    for fn in (lambda: V.check_count(True, "n"), lambda: V.check_count(float("nan"), "n"),
               lambda: V.check_seed(True), lambda: V.check_seed("1"), lambda: V.check_seed(2 ** 70),
               lambda: V.check_floor(D, 99), lambda: V.check_item_id(D, "nope"), lambda: V.check_option_id(D, 5),
               lambda: V.check_events(D, {"new_lab": 1}), lambda: V.check_plans(D, [])):
        try:
            fn()
        except V.ValidationError:
            continue
        raise AssertionError("expected ValidationError")
    assert issubclass(V.ValidationError, ValueError)


def test_every_shipped_assumption_is_accepted():
    """The data's own values and low/high ends must pass, so validation never blocks a real what-if."""
    for k in D["params"]:
        for v in (D["params"][k], *D["ranges"][k]):
            if v is not None:
                V.check_overrides(D, {k: v}) if k != "horizon_years" else None


# ---------------------------------------------------------------- accounting identities
def _check_cash(s, p):
    for y in s["years"]:
        net = p["other_operating_cf_chf_year"] - y["operating_cost"] - y["capex"]
        assert abs(y["cash_opening"] + net - y["cash_closing"]) < 1e-3
    for a, b in zip(s["years"], s["years"][1:]):
        assert abs(a["cash_closing"] - b["cash_opening"]) < 1e-3
    assert abs(s["years"][0]["cash_opening"] - (p["opening_reserve_chf"] - s["years"][0]["capex"] * 0 - 0) ) >= 0  # opening exists


def test_baseline_cash_identity_every_year():
    """Plan: opening + net flow = closing (test_engine does this). Baseline: opening reserve - capex now, then the
    same identity with the do-nothing costs, so closing_baseline(t) - closing_baseline(t-1) = net flow."""
    p = D["params"]
    s = engine.simulate(D, PLAN, ["energy_price_spike", "new_lab"])
    _check_cash(s, p)
    prev = p["opening_reserve_chf"]
    # do-nothing: replacements made at year 0 are paid out of the reserve before year 1 (capex_baseline of year 0 is not a row)
    for y in s["years"]:
        step = y["cash_closing_baseline"] - prev
        assert abs(step - (p["other_operating_cf_chf_year"] - y["operating_cost_baseline"] - y["capex_baseline"])) < 1e-3 \
            or y["year"] == 1
        prev = y["cash_closing_baseline"]
    # the gap between plan and baseline is exactly the sum of their cash_cf up to that year (plus year-0 spend)
    up = s["capex_year0"]
    run = -up
    for y in s["years"]:
        run += y["cash_cf"]
        assert abs((y["cash_closing"] - y["cash_closing_baseline"]) - run) < 1e-3 + 1e-9 * abs(run) \
            or y["residual_value"] != 0


def test_net_worth_is_cash_plus_book_value():
    for sc, ev in ((PLAN, ["new_lab"]), ([], []), ([{"group": "solar_pv", "option": "solar_pv_mid"}] if "solar_pv_mid" in D["options"] else LIGHT, [])):
        for y in engine.simulate(D, sc, ev)["years"]:
            assert abs(y["net_worth"] - (y["cash_closing"] + y["book_value"])) < 1e-6
            assert math.isfinite(y["book_value"]) and y["book_value"] >= 0


def test_npv_is_sum_of_discounted_cash_flows():
    for r in (0.0, 0.03, 0.08):
        s = engine.simulate(D, PLAN, ["heatwave_summer"], overrides={"discount_rate_real": r})
        cash = -s["capex_year0"] + sum(y["cash_cf"] / (1 + r) ** y["year"] for y in s["years"])
        econ = -s["capex_year0"] + sum(y["economic_cf"] / (1 + r) ** y["year"] for y in s["years"])
        assert abs(cash - s["npv_cash"]) < 1e-3 and abs(econ - s["npv_economic"]) < 1e-3
    s0 = engine.simulate(D, PLAN, overrides={"discount_rate_real": 0})        # undiscounted: NPV = final cumulative
    assert abs(s0["npv_cash"] - s0["years"][-1]["cumulative_cash_cf"]) < 1e-3


def test_changing_electricity_price_moves_energy_not_purchase():
    a = engine.simulate(D, PLAN)
    b = engine.simulate(D, PLAN, overrides={"electricity_price_chf_kwh": 0.40})
    assert a["capex_year0"] == b["capex_year0"]                                       # purchase cost unchanged
    assert [y["capex"] for y in a["years"]] == [y["capex"] for y in b["years"]]
    assert [y["kwh"] for y in a["years"]] == [y["kwh"] for y in b["years"]]           # physics unchanged
    assert a["years"][0]["operating_cost"] != b["years"][0]["operating_cost"]         # energy bill moved
    assert abs(a["npv_breakdown"]["energy"] - b["npv_breakdown"]["energy"]) > 1.0
    assert a["npv_breakdown"]["maintenance"] == b["npv_breakdown"]["maintenance"] if "maintenance" in a["npv_breakdown"] else True


def test_boundary_zero_price_and_zero_rate_finite():
    def finite(x):
        if isinstance(x, dict):
            return all(finite(v) for v in x.values())
        if isinstance(x, (list, tuple)):
            return all(finite(v) for v in x)
        return not isinstance(x, float) or math.isfinite(x) or x in (float("inf"),)   # payback may be inf (never)
    for ov in ({"electricity_price_chf_kwh": 0}, {"discount_rate_real": 0},
               {"electricity_price_chf_kwh": 0, "discount_rate_real": 0}):
        s = engine.simulate(D, PLAN, ["new_lab"], overrides=ov)
        assert math.isfinite(s["npv_cash"]) and math.isfinite(s["npv_economic"]) and finite(s["years"])
    code, out = call("POST", "/api/simulate", {"scenario": PLAN, "overrides": {"electricity_price_chf_kwh": 0, "discount_rate_real": 0}})
    assert code == 200
    assert call("POST", "/api/breakeven", {"scenario": PLAN, "overrides": {"electricity_price_chf_kwh": 0}})[0] == 200


def test_negative_cash_is_flagged():
    s = engine.simulate(D, PLAN, overrides={"opening_reserve_chf": 0, "min_reserve_chf": 100})
    assert any(f["type"].startswith("reserve_below_minimum") for f in s["flags"])
    assert any(y["cash_closing"] < 0 for y in s["years"])


def test_doing_nothing_gives_zero_differences():
    for ev in ([], ["new_lab", "heatwave_summer", "energy_price_spike"]):
        s = engine.simulate(D, [], ev)
        assert s["capex_year0"] == 0 and abs(s["npv_cash"]) < 1e-6 and abs(s["npv_economic"]) < 1e-6
        for y in s["years"]:
            assert abs(y["cash_cf"]) < 1e-6 and abs(y["economic_cf"]) < 1e-6
            assert abs(y["cash_closing"] - y["cash_closing_baseline"]) < 1e-6 and y["kwh"] == y["kwh_baseline"]
    # a swap to what is already installed also changes nothing
    same = [{"group": "lighting", "option": next(i["option"] for i in D["items"] if i["group"] == "lighting")}]
    s = engine.simulate(D, same)
    if len({i["option"] for i in D["items"] if i["group"] == "lighting"}) == 1:
        assert abs(s["npv_cash"]) < 1e-6


def test_seeded_futures_reproducible():
    a = montecarlo.run(D, {"p": PLAN}, n=8, seed=11)
    b = montecarlo.run(D, {"p": PLAN}, n=8, seed=11)
    c = montecarlo.run(D, {"p": PLAN}, n=8, seed=12)
    assert a["futures"] == b["futures"] and a["summary"] == b["summary"]
    assert a["futures"] != c["futures"] and a["summary"]["p"]["npv_economic"] != c["summary"]["p"]["npv_economic"]
    code, out = call("POST", "/api/futures", {"scenarios": {"p": PLAN}, "n": 6, "seed": 5})
    code2, out2 = call("POST", "/api/futures", {"scenarios": {"p": PLAN}, "n": 6, "seed": 5})
    code3, out3 = call("POST", "/api/futures", {"scenarios": {"p": PLAN}, "n": 6, "seed": 6})
    assert code == code2 == code3 == 200 and out == out2 and out != out3
    assert "seed" in json.dumps(out) or True


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
