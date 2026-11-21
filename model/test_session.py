"""Tests for play mode (session.py), the scripted future and the emergency-upgrade fix.
Run: python test_session.py (or pytest)."""
import random

import engine
import montecarlo
import session as S

D = engine.load()
VENT0 = "BC_991.0:ventilation:floor0"
NAME = "ventilation_failure"


def _future():
    return montecarlo.load_scripted(D, NAME)


def _play_to(t, decide_at=None):
    """Start the scripted future and continue until the pause at time t. decide_at: {time: swaps}."""
    s, st = S.start(D, _future(), NAME)
    while st["t"] < t and not st["ended"]:
        st = S.next_pause(D, s)
        if decide_at and st["t"] in decide_at:
            st = S.decide(D, s, decide_at[st["t"]])
    return s, st


def _types(state):
    return {(r["type"], r["details"].get("event_id") or r["details"].get("flag") or r["group"]) for r in state["reasons"]}


# --- the scripted future
def test_scripted_future_has_the_shape_of_a_drawn_one():
    f, drawn = _future(), montecarlo.draw_future(D, random.Random(1))
    assert set(f) == set(drawn)
    assert len(f["price_path"]) == D["params"]["horizon_years"] and set(f["price_path"]) == {1.0}
    assert {e["id"]: e["start_year"] for e in f["events"]} == {"new_lab": 3, "heatwave_summer": 5, "energy_price_spike": 6}


def test_floor0_ventilation_fails_at_time_2():
    f = _future()
    assert f["remaining_life"][VENT0] == 1.5
    _, plans, _ = engine.install_plans(D, [], f)
    assert plans[VENT0][0] == (2, "ventilation_current", "failure")


def test_overdue_units_keep_running_in_the_script():
    f = _future()
    overdue = [i for i in D["items"] if D["options"][i["option"]]["lifetime_years"]
               and i["age"] >= D["options"][i["option"]]["lifetime_years"] and i["id"] != VENT0]
    assert overdue and all(f["remaining_life"][i["id"]] == engine.INF for i in overdue)
    _, plans, _ = engine.install_plans(D, [], f)
    assert all(plans[i["id"]] == [] for i in overdue)


# --- the engine fix: an upgrade at the failure time is an emergency
def test_upgrade_at_the_failure_time_is_an_emergency():
    item = D["item_by_id"][VENT0]
    for remaining in (1.5, 2.0):                 # breaks during year 2, or exactly at its end
        assert engine.item_plan(D, item, ("ventilation_mid", 2), 15, remaining)[0] == (2, "ventilation_mid", "failure")
    assert engine.item_plan(D, item, ("ventilation_mid", 2), 15, 2.3)[0] == (2, "ventilation_mid", "planned")


def test_upgrade_at_the_failure_time_pays_the_premium():
    f = _future()
    swap = {"group": "ventilation", "option": "ventilation_mid", "item_id": VENT0, "year": 2}
    a = engine.simulate(D, [], future=f, detail_years=())
    b = engine.simulate(D, [swap], future=f, detail_years=())
    item, prem = D["item_by_id"][VENT0], D["params"]["failure_premium"]

    def cost(o):
        o = D["options"][o]
        return item["units"] * (o["purchase_chf_per_unit"] + o["install_chf_per_unit"]) * (1 + prem)
    extra = b["years"][1]["capex"] - a["years"][1]["capex"]
    assert abs(extra - (cost("ventilation_mid") - cost("ventilation_current"))) < 1e-6


# --- playing through
def test_playing_with_no_decisions():
    s, st = S.start(D, _future(), NAME)
    seen, times = {}, []
    while not st["ended"]:
        st = S.next_pause(D, s)
        if not st["ended"]:
            times.append(st["t"])
            seen[st["t"]] = _types(st)
            assert len(st["history"]) == st["t"]                             # nothing after now
            assert all(row["year"] <= st["t"] for row in st["history"])
    assert times == sorted(set(times))
    assert ("event_announced", "new_lab") in seen[1]                          # a year's notice before year 3
    assert ("failure", "ventilation") in seen[2] and ("event_started", "new_lab") in seen[2]
    assert ("new_flag", "desk_shortfall") in seen[3]
    assert ("event_started", "heatwave_summer") in seen[4]
    assert ("event_started", "energy_price_spike") in seen[5] and ("price_jump", None) in seen[5]
    vent = next(r for r in S._failures(D, s)[2] if r["group"] == "ventilation")
    assert vent["floors"] == [0] and vent["item_ids"] == [VENT0]
    ref = engine.simulate(D, [], future=_future(), detail_years=())
    assert st["result"]["npv_cash"] == round(ref["npv_cash"], 4) == 0
    assert st["result"]["npv_economic"] == round(ref["npv_economic"], 4) == 0
    assert len(st["history"]) == D["params"]["horizon_years"]


def test_failures_are_grouped_per_group():
    s, st = _play_to(4)
    blinds = [r for r in st["reasons"] if r["type"] == "failure" and r["group"] == "blinds"]
    assert len(blinds) == 1 and len(blinds[0]["item_ids"]) > 1 and len(blinds[0]["floors"]) > 1


def test_failure_reactions_preview_every_option():
    s, st = _play_to(2)
    k = next(i for i, r in enumerate(st["reasons"]) if r["group"] == "ventilation")
    reaction = next(r for r in st["reactions"] if r["reason"] == k)
    names = {o["option_id"] for o in reaction["options"]}
    assert names == {o["option_id"] for o in D["options"].values() if o["group"] == "ventilation"}
    like = next(o for o in reaction["options"] if o["like_for_like"])
    assert like["preview"]["extra_capex_chf"] == 0 and like["preview"]["delta_npv_cash"] == 0
    assert all(sw["year"] == 2 and sw["item_id"] == VENT0 for o in reaction["options"] for sw in o["swaps"])


def test_deciding_never_changes_the_past():
    s, before = _play_to(2)
    after = S.decide(D, s, [{"group": "ventilation", "option": "ventilation_mid", "item_id": VENT0, "year": "now"}])
    assert after["t"] == before["t"] == 2
    assert before["history"][:1] == after["history"][:1]                  # earlier years: identical
    money_now = {"capex", "cash_cf", "economic_cf", "cumulative_cash_cf", "cumulative_economic_cf", "cash_closing"}
    b, a = before["history"][1], after["history"][1]                       # this year: only the purchase made now
    assert {k: v for k, v in b.items() if k not in money_now} == {k: v for k, v in a.items() if k not in money_now}
    assert a["capex"] > b["capex"]


def test_a_swap_in_the_past_is_rejected():
    s, _ = _play_to(2)
    try:
        S.decide(D, s, [{"group": "lighting", "option": "lighting_mid", "year": 1}])
    except ValueError as e:
        assert "past" in str(e)
    else:
        raise AssertionError("a swap before now was accepted")
    assert s["decisions"] == []


def test_laptops_at_the_lab_announcement_avoid_the_desk_shortfall():
    laptops = [{"group": "computers", "option": "computers_upgrade", "year": "now"}]
    plain = engine.simulate(D, [], future=_future(), detail_years=())
    assert any(f["type"] == "desk_shortfall" and f["year"] == 3 for f in plain["flags"])
    s, st = _play_to(1)
    assert ("event_announced", "new_lab") in _types(st)
    S.decide(D, s, laptops)
    res = engine.simulate(D, s["decisions"], future=s["future"], detail_years=())
    assert not any(f["type"] == "desk_shortfall" for f in res["flags"])
    while not st["ended"]:
        st = S.next_pause(D, s)
        assert ("new_flag", "desk_shortfall") not in _types(st)


def test_outlook_keeps_the_revealed_past():
    s, st = _play_to(2)
    t, known = s["t"], s["future"]
    revealed = sorted((e["id"], e["start_year"]) for e in known["events"] if montecarlo.announced_at(D, e) <= t)
    failed = {k: r for k, r in known["remaining_life"].items() if r != engine.INF and r <= t}
    reserve = [round(r["cash_closing"], 6) for r in engine.simulate(D, [], future=known, detail_years=())["years"][:t]]
    for f in S.outlook_futures(D, s, n=25, seed=3):
        assert f["price_path"][:t] == known["price_path"][:t]
        assert sorted((e["id"], e["start_year"]) for e in f["events"] if montecarlo.announced_at(D, e) <= t) == revealed
        assert all(f["remaining_life"][k] == r for k, r in failed.items())
        assert all(r > t for k, r in f["remaining_life"].items() if k not in failed)
        run = engine.simulate(D, [], future=f, detail_years=())
        assert [round(r["cash_closing"], 6) for r in run["years"][:t]] == reserve
    out = S.outlook(D, s, n=20, seed=3)
    assert [p["year"] for p in out["fan"]["cash"]] == list(range(t + 1, int(D["params"]["horizon_years"]) + 1))
    assert 0 <= out["prob_beats_doing_nothing_cash"] <= 1


def test_same_decisions_give_the_same_game():
    plan = {1: [{"group": "computers", "option": "computers_upgrade", "year": "now"}],
            2: [{"group": "ventilation", "option": "ventilation_mid", "item_id": VENT0, "year": "now"}]}
    _, a = _play_to(99, plan)
    _, b = _play_to(99, plan)
    assert a == b and a["ended"]


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
