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
    f, drawn = _future(), montecarlo.draw_play_future(D, random.Random(1))
    assert set(f) == set(drawn)
    assert len(f["price_path"]) == D["params"]["horizon_years"] and set(f["price_path"]) == {1.0}
    assert {e["id"]: e["start_year"] for e in f["events"]} == {"new_lab": 3, "heatwave_summer": 5, "energy_price_spike": 6}


def test_floor0_ventilation_fails_at_time_2():
    f = _future()
    assert f["remaining_life"][VENT0] == 1.5
    _, plans, _ = engine.install_plans(D, [], f)
    assert plans[VENT0][0] == (2, "ventilation_current", "failure")


def test_only_the_scripted_failure_happens_in_the_demo():
    f = _future()
    others = [i for i in D["items"] if D["options"][i["option"]]["lifetime_years"] and i["id"] != VENT0]
    assert others and all(f["remaining_life"][i["id"]] == engine.INF for i in others)   # other_units: keep_running
    _, plans, _ = engine.install_plans(D, [], f)
    # Only the script's failure. Big systems may still be replaced on plan (replace_on_plan), never as a failure.
    assert {iid for iid, ins in plans.items() if any(kind == "failure" for _, _, kind in ins)} == {VENT0}
    assert all(D["item_by_id"][iid]["group"] in engine.PLANNED_GROUPS for iid, ins in plans.items() if ins and iid != VENT0)


# --- the engine fix: an upgrade at the failure time is an emergency
def test_upgrade_at_the_failure_time_is_an_emergency():
    item = D["item_by_id"][VENT0]
    for remaining in (1.5, 2.0):                 # breaks during year 2, or exactly at its end
        assert engine.item_plan(D, item, ("ventilation_mid", 2), 15, remaining)[0] == (2, "ventilation_mid", "failure")
    assert engine.item_plan(D, item, ("ventilation_mid", 2), 15, 2.3)[0] == (2, "ventilation_mid", "planned")


def test_a_firm_year_is_never_pulled_into_the_past():
    item = D["item_by_id"][VENT0]
    firm = ("ventilation_mid", engine.FirmYear(3, [(3, "ventilation_mid")]))
    assert engine.item_plan(D, item, ("ventilation_mid", 3), 15, 1.5)[0] == (2, "ventilation_mid", "failure")  # planning: pulled
    assert engine.item_plan(D, item, firm, 15, 1.5)[:2] == [(2, "ventilation_current", "failure"),
                                                          (3, "ventilation_mid", "planned")]               # play: exactly then
    assert engine.item_plan(D, item, ("ventilation_mid", engine.FirmYear(2, [(2, "ventilation_mid")])), 15, 1.5)[0] == \
        (2, "ventilation_mid", "failure")


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
    assert times == [1, 2, 3, 4, 5]                                           # the five demo moments
    assert seen[1] == {("event_announced", "new_lab")}                        # a year's notice before year 3
    assert seen[2] == {("failure", "ventilation"), ("event_started", "new_lab")}
    assert seen[3] == {("new_flag", "desk_shortfall")}                        # no reserve warning: not the player's doing
    assert seen[4] == {("event_started", "heatwave_summer")}
    assert seen[5] == {("event_started", "energy_price_spike")}               # the event explains the price jump
    vent = next(r for r in S._failures(D, s)[2] if r["group"] == "ventilation")
    assert vent["floors"] == [0] and vent["item_ids"] == [VENT0]
    ref = engine.simulate(D, [], future=_future(), detail_years=())
    assert st["result"]["npv_cash"] == round(ref["npv_cash"], 4) == 0
    assert st["result"]["npv_economic"] == round(ref["npv_economic"], 4) == 0
    assert len(st["history"]) == D["params"]["horizon_years"]


def test_failures_are_grouped_per_group():
    s, _ = S.start(D, montecarlo.load_scripted(D, NAME) | {"remaining_life": _sampled()["remaining_life"]}, "x")
    reasons = [r for rs in S._failures(D, s).values() for r in rs]
    assert len({(r["time"], r["group"]) for r in reasons}) == len(reasons)    # one reason per group and time
    assert any(len(r["item_ids"]) > 1 and len(r["floors"]) > 1 for r in reasons)


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


# --- the plan: scheduled, done and planned
def test_a_scheduled_change_runs_without_stopping():
    plan = [{"group": "lighting", "option": "lighting_mid", "year": 3}]
    s, st = S.start(D, _future(), NAME)
    st = S.decide(D, s, plan)
    assert st["plan"] == {"done": [], "planned": [plan[0] | {"firm": True}]}
    times = []
    while not st["ended"]:
        st = S.next_pause(D, s)
        times.append(st["t"])
    assert times == [1, 2, 3, 4, 5, 15]                                       # no extra stop for the planned change
    plain = engine.simulate(D, [], future=_future(), detail_years=())
    assert st["history"][2]["capex"] > plain["years"][2]["capex"]             # bought in year 3, as planned
    assert st["plan"]["done"] == [plan[0] | {"firm": True}]


def test_set_plan_replaces_only_what_is_not_done():
    s, st = S.start(D, _future(), NAME)
    S.decide(D, s, [{"group": "lighting", "option": "lighting_mid", "year": "now"},
                    {"group": "blinds", "option": "blinds_upgrade", "year": 4}])
    st = S.next_pause(D, s)
    st = S.next_pause(D, s)                                                   # t = 2
    st = S.set_plan(D, s, [{"group": "solar_pv", "option": "solar_pv_upgrade", "year": 3}])
    assert [d["group"] for d in st["plan"]["done"]] == ["lighting"]           # locked
    assert [d["group"] for d in st["plan"]["planned"]] == ["solar_pv"]        # the blinds plan is gone
    try:
        S.set_plan(D, s, [{"group": "blinds", "option": "blinds_upgrade", "year": 1}])
    except ValueError:
        pass
    else:
        raise AssertionError("a plan step in the past was accepted")


def test_choosing_an_upgrade_for_a_broken_unit_cancels_its_later_plan():
    later = {"group": "ventilation", "option": "ventilation_mid", "item_id": VENT0, "year": 4}
    s, st = S.start(D, _future(), NAME)
    S.decide(D, s, [later])
    st = S.next_pause(D, s)
    st = S.next_pause(D, s)                                                   # t = 2: it broke before year 4
    k = next(i for i, r in enumerate(st["reasons"]) if r["type"] == "failure")
    reaction = next(r for r in st["reactions"] if r["reason"] == k)
    assert reaction["planned_later"] == [later | {"firm": True}]
    st = S.decide(D, s, [{"group": "ventilation", "option": "ventilation_premium", "item_id": VENT0, "year": "now"}])
    assert st["plan"]["planned"] == [{"group": "ventilation", "option": "ventilation_premium", "item_id": VENT0,
                                      "year": 2, "firm": True}]
    _, plans, _ = engine.install_plans(D, s["decisions"], s["future"])
    assert plans[VENT0] == [(2, "ventilation_premium", "failure")]


def test_a_second_change_to_the_same_item_keeps_the_first():
    s, st = S.start(D, _future(), NAME)
    st = S.next_pause(D, s)                                                   # t = 1
    st = S.decide(D, s, [{"group": "lighting", "option": "lighting_mid", "year": "now"}])
    year1 = st["history"][0]
    while st["t"] < 5:
        st = S.next_pause(D, s)
    st = S.decide(D, s, [{"group": "lighting", "option": "lighting_premium", "year": "now"}])
    assert st["history"][0] == year1                                          # the year-1 purchase is still there
    _, plans, _ = engine.install_plans(D, s["decisions"], s["future"])
    assert plans["BC_990.0:lighting"] == [(1, "lighting_mid", "planned"), (5, "lighting_premium", "planned")]


def test_overspending_is_flagged_but_doing_nothing_is_not():
    s, st = S.start(D, _future(), NAME)
    big = [{"group": g, "option": f"{g}_premium", "year": "now"} for g in ("lighting", "ventilation", "heating_cooling", "monitors")]
    S.decide(D, s, big)
    flags = []
    while not st["ended"]:
        st = S.next_pause(D, s)
        flags += [r["details"].get("flag") for r in st["reasons"] if r["type"] == "new_flag"]
    assert "reserve_below_minimum" in flags


# --- random lives for units installed later
def _sampled(seed=42):
    return montecarlo.draw_play_future(D, random.Random(seed))


def _later_installs(plans):
    """(item, time, kind) for every install after an item's first one: units that were themselves new."""
    return [(iid, t, kind) for iid, ins in plans.items() for t, _, kind in ins[1:]]


def test_new_units_get_random_lives_in_a_sampled_future():
    f = _sampled()
    _, plans, _ = engine.install_plans(D, [], f)
    later = _later_installs(plans)
    assert later and all(kind == "failure" for _, _, kind in later)     # a new unit's death is a surprise too
    nominal = {k: v for k, v in f.items() if k != "install_lives"}
    _, plans_nominal, _ = engine.install_plans(D, [], nominal)
    assert plans != plans_nominal                                        # the drawn lives differ from nominal


def test_the_scripted_future_keeps_nominal_lives_for_new_units():
    _, plans, _ = engine.install_plans(D, [], _future())
    assert all(kind == "planned" for _, _, kind in _later_installs(plans))


def test_drawn_lives_are_the_same_on_every_rerun():
    f = _sampled()
    a = engine.simulate(D, [{"group": "computers", "option": "computers_upgrade", "year": 2}], future=f, detail_years=())
    b = engine.simulate(D, [{"group": "computers", "option": "computers_upgrade", "year": 2}], future=f, detail_years=())
    assert a["npv_cash"] == b["npv_cash"] and a["plans"] == b["plans"]


def _play_sampled_until(t_min, seed=42):
    s, st = S.start(D, _sampled(seed), f"seed {seed}")
    while st["t"] < t_min and not st["ended"]:
        st = S.next_pause(D, s)
    return s, st


def test_deciding_in_a_sampled_future_never_changes_the_past():
    s, before = _play_sampled_until(3)
    t = s["t"]
    _, plans_before, _ = engine.install_plans(D, s["decisions"], s["future"])
    after = S.decide(D, s, [{"group": "lighting", "option": "lighting_mid", "year": "now"},
                            {"group": "computers", "option": "computers_upgrade", "year": "now"}])
    _, plans_after, _ = engine.install_plans(D, s["decisions"], s["future"])
    assert before["history"][:t - 1] == after["history"][:t - 1]
    for iid in plans_before:                                             # every install before now is unchanged
        assert [x for x in plans_before[iid] if x[0] < t] == [x for x in plans_after[iid] if x[0] < t]


def test_the_outlook_keeps_new_units_that_already_failed():
    s, st = _play_sampled_until(9)
    t = s["t"]
    _, mine, _ = engine.install_plans(D, s["decisions"], s["future"])
    assert any(time <= t for _, time, _ in _later_installs(mine))          # a new unit has already failed by now
    for f in S.outlook_futures(D, s, n=15, seed=5):
        _, theirs, _ = engine.install_plans(D, s["decisions"], f)
        for iid in mine:
            assert [x for x in mine[iid] if x[0] <= t] == [x for x in theirs[iid] if x[0] <= t]


# --- game length, and showing a played game in Results
def test_a_shorter_game_stops_at_its_own_end():
    s, st = S.start(D, _future(), NAME, years=10)
    times = []
    while not st["ended"]:
        st = S.next_pause(D, s)
        times.append(st["t"])
    assert times == [1, 2, 3, 4, 5, 10] and len(st["history"]) == 10
    try:
        S.start(D, _future(), NAME, years=40)
    except ValueError:
        pass
    else:
        raise AssertionError("a 40-year game was accepted")


def test_the_played_future_is_the_first_example_in_results():
    import optimize
    plan = [{"group": "lighting", "option": "lighting_budget", "year": 0, "firm": True}]
    r = montecarlo.run(D, {"p0": plan}, n=20, seed=1, samples=5, pinned=_future())
    first = r["samples"][0]
    assert first["pinned"] and len(r["samples"]) == 5
    assert {e["id"] for e in first["events"]} == {"new_lab", "heatwave_summer", "energy_price_spike"}
    mine = engine.simulate(D, plan, future=_future(), detail_years=())
    assert abs(first["paths"]["p0"]["cash"][-1] - mine["years"][-1]["cumulative_cash_cf"]) < 1e-6
    plain = montecarlo.run(D, {"p0": plan}, n=20, seed=1, samples=5)
    assert r["summary"] == plain["summary"]                                   # the 20 futures' statistics are unchanged
    assert optimize.upfront_cost(D, engine.simulate(D, plan)) > 0             # bought today in a game: paid today


def test_only_big_systems_stop_the_game_small_wear_outs_are_listed():
    s, st = S.start(D, _sampled(1), "x", years=10)
    seen_routine = set()
    while not st["ended"]:
        st = S.next_pause(D, s)
        if st["ended"]:
            break
        assert all(r["group"] in S.STOP_GROUPS for r in st["reasons"] if r["type"] == "failure")
        seen_routine |= {r["group"] for r in st["routine"]}
        assert all(r["time"] <= st["t"] for r in st["routine"])
    assert {"lighting", "monitors"} <= seen_routine and not seen_routine & S.STOP_GROUPS


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
