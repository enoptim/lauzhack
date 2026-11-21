"""Sanity and validation tests for the BC twin engine. Run: python test_engine.py (or pytest)."""
import math
import engine

D = engine.load()
TOL = 1e-6
LIGHT_MID = [{"group": "lighting", "option": "lighting_mid"}]
PLAN = [{"group": "ventilation", "option": "ventilation_budget"}, {"group": "lighting", "option": "lighting_mid"}]
COUPLINGS_OFF = {k: 0 for k, m in D["param_meta"].items() if m["category"] == "coupling" and k.startswith(("perf_loss", "sick_leave", "productive"))}


# --- data and baseline
def test_baseline_matches_data_team_check():
    e = engine.simulate(D)["years"][0]["state"]["energy"]
    assert 1.05e6 < e["total_kwh"] < 1.15e6                       # README: about 1.1 GWh
    assert abs(sum(e["by_group"].values()) - e["total_kwh"]) < 1e-3


def test_ground_floor_ventilation_capacity():
    cap = engine.simulate(D)["years"][0]["state"]["environment"]["floor_capacity_people"][0]
    assert abs(cap - 250) < 1                                        # README: about 250 people


# --- finance identities
def test_reproducible():
    a, b = engine.simulate(D, PLAN, ["new_lab"]), engine.simulate(D, PLAN, ["new_lab"])
    assert a["npv_economic"] == b["npv_economic"] and a["years"][-1]["cash_closing"] == b["years"][-1]["cash_closing"]


def test_cash_identity():
    s = engine.simulate(D, PLAN, ["energy_price_spike"])
    p = D["params"]
    for y in s["years"]:
        assert abs(y["cash_opening"] + p["other_operating_cf_chf_year"] - y["operating_cost"] - y["capex"] - y["cash_closing"]) < 1e-3
    for a, b in zip(s["years"], s["years"][1:]):
        assert abs(a["cash_closing"] - b["cash_opening"]) < 1e-3


def test_baseline_vs_itself_is_zero():
    s = engine.simulate(D)
    assert abs(s["npv_economic"]) < TOL and all(abs(y["economic_cf"]) < TOL for y in s["years"])


def test_npv_breakdown_sums():
    s = engine.simulate(D, PLAN, ["new_lab", "heatwave_summer"])
    assert abs(sum(s["npv_breakdown"].values()) - s["npv_economic"]) < 1e-3


def test_purchase_is_asset_not_loss():
    item = next(i for i in D["items"] if i["group"] == "heating_cooling")
    plans = {item["id"]: engine.item_plan(D, item, ("heating_cooling_mid", "now"), 15)}
    capex, assets = engine.plan_money(D, plans, engine.baseline(D), 15)
    assert abs(engine.book_value(assets, 0) - capex[0]) < 1e-3


def _overdue(group):
    """First item of a group that is past its lifetime in the team's inventory."""
    return next(i for i in D["items"] if i["group"] == group
                and i["age"] >= D["options"][i["option"]]["lifetime_years"])


def _price(option_id):
    o = D["options"][option_id]
    return o["purchase_chf_per_unit"] + o["install_chf_per_unit"]


def test_overdue_units_replaced_like_for_like_now():
    item = _overdue("lighting")
    assert engine.item_plan(D, item, None, 15)[0][:2] == (0, item["option"])


def test_upgrade_cost_is_only_the_premium_when_overdue():
    item = _overdue("lighting")
    s = engine.simulate(D, [{"group": "lighting", "option": "lighting_mid", "item_id": item["id"]}])
    assert abs(s["capex_year0"] - item["units"] * (_price("lighting_mid") - _price(item["option"]))) < 1e-3


def test_timing_toggle_waits_for_end_of_life():
    item = next(i for i in D["items"] if i["group"] == "ventilation")           # 4 years left
    assert engine.item_plan(D, item, ("ventilation_mid", "end_of_life"), 15)[0][:2] == (4, "ventilation_mid")


def test_phased_upgrade_in_a_given_year():
    s = engine.simulate(D, [{"group": "lighting", "option": "lighting_mid"},
                            {"group": "monitors", "option": "monitors_mid", "year": 1}])
    mon = next(i for i in D["items"] if i["group"] == "monitors")
    assert s["plans"][mon["id"]][0][:2] == (1, "monitors_mid")          # old monitors kept one more year
    assert s["years"][0]["outcomes"]["screen_quality"] < s["years"][1]["outcomes"]["screen_quality"]


def test_phasing_lowers_upfront_cost():
    now = engine.simulate(D, [{"group": "monitors", "option": "monitors_mid"}])["capex_year0"]
    later = engine.simulate(D, [{"group": "monitors", "option": "monitors_mid", "year": 2}])["capex_year0"]
    assert later < now


def test_phased_upgrade_pulled_forward_if_unit_fails_first():
    item = next(i for i in D["items"] if i["group"] == "heating_cooling")
    plan = engine.item_plan(D, item, ("heating_cooling_mid", 4), 15, remaining=1.5)
    assert plan[0] == (2, "heating_cooling_mid", "failure")


# --- scenario handling and isolation
def test_floor_swap_follows_what_ventilation_serves():
    ch = engine.resolve(D, [{"group": "ventilation", "option": "ventilation_mid", "floor": 0}])
    assert set(ch) == {"BC_991.0:ventilation:floor0"}


def test_scenario_isolation():
    a = engine.simulate(D)["years"][0]["state"]["energy"]["by_group"]
    b = engine.simulate(D, [{"group": "monitors", "option": "monitors_mid"}])["years"][0]["state"]["energy"]["by_group"]
    for g in ("lighting", "ventilation", "servers", "coffee"):
        assert abs(a[g] - b[g]) < TOL
    assert a["heating_cooling"] != b["heating_cooling"]                           # documented coupling via heat gains


def test_zero_price_no_energy_savings():
    s = engine.simulate(D, LIGHT_MID, overrides={"electricity_price_chf_kwh": 0})
    assert abs(s["npv_breakdown"]["energy"]) < TOL


def test_higher_price_more_savings():
    lo = engine.simulate(D, LIGHT_MID, overrides={"electricity_price_chf_kwh": 0.15})
    hi = engine.simulate(D, LIGHT_MID, overrides={"electricity_price_chf_kwh": 0.28})
    assert hi["npv_cash"] > lo["npv_cash"]


def test_zero_discount_rate():
    assert math.isfinite(engine.simulate(D, LIGHT_MID, overrides={"discount_rate_real": 0})["npv_cash"])


def test_economic_equals_cash_without_people_effects():
    s = engine.simulate(D, PLAN, overrides=COUPLINGS_OFF)
    assert abs(s["npv_economic"] - s["npv_cash"]) < 1e-3


# --- couplings
def test_demand_control_fixes_meeting_rooms():
    o = engine.simulate(D, [{"group": "ventilation", "option": "ventilation_budget"}])["years"][0]
    assert o["outcomes_baseline"]["meeting_co2_ppm"] > 1200 and o["outcomes"]["meeting_co2_ppm"] <= 1000 + TOL


def test_blinds_help_daylight_dimming():
    def kwh(sc):
        return engine.simulate(D, sc)["years"][0]["state"]["energy"]["by_group"]["lighting"]
    lp = [{"group": "lighting", "option": "lighting_premium"}]
    assert kwh(lp + [{"group": "blinds", "option": "blinds_upgrade"}]) < kwh(lp)


def test_new_lab_needs_desks_unless_laptops():
    a = engine.simulate(D, events_on=["new_lab"])
    b = engine.simulate(D, [{"group": "computers", "option": "computers_upgrade"}], ["new_lab"])
    assert any(f["type"] == "desk_shortfall" for f in a["flags"])
    assert not any(f["type"] == "desk_shortfall" for f in b["flags"])


def test_lake_heat_pump_frees_roof_for_solar():
    pv = engine.simulate(D, [{"group": "solar_pv", "option": "solar_pv_upgrade"}])["npv_cash"]
    hp = engine.simulate(D, [{"group": "heating_cooling", "option": "heating_cooling_premium"}])["npv_cash"]
    both = engine.simulate(D, [{"group": "solar_pv", "option": "solar_pv_upgrade"},
                               {"group": "heating_cooling", "option": "heating_cooling_premium"}])["npv_cash"]
    assert both > pv + hp


def _event_year(event_id):
    """0-based index into years of the event's first year, from the team's events.csv."""
    return D["events"][event_id]["start_year"] - 1


def test_new_lab_raises_office_co2():
    t = _event_year("new_lab")
    a = engine.simulate(D)["years"][t]["outcomes"]["office_co2_ppm"]
    b = engine.simulate(D, events_on=["new_lab"])["years"][t]["outcomes"]["office_co2_ppm"]
    assert b > a


def test_heatwave_raises_cooling_and_overheating():
    t = _event_year("heatwave_summer")
    a = engine.simulate(D)["years"][t]
    b = engine.simulate(D, events_on=["heatwave_summer"])["years"][t]
    assert b["kwh"] > a["kwh"]
    assert b["outcomes"]["summer_overheating_degc"] > a["outcomes"]["summer_overheating_degc"]


def test_price_spike_only_in_its_year():
    t = _event_year("energy_price_spike")
    assert D["events"]["energy_price_spike"]["end_year"] == t + 1          # a one-year event
    s = engine.simulate(D, LIGHT_MID, ["energy_price_spike"])
    base = engine.simulate(D, LIGHT_MID)
    assert s["years"][t]["savings"]["energy"] > base["years"][t]["savings"]["energy"]
    assert abs(s["years"][t + 1]["savings"]["energy"] - base["years"][t + 1]["savings"]["energy"]) < TOL


# --- constraints and stress test
def test_over_budget_flag():
    s = engine.simulate(D, [{"group": "ventilation", "option": "ventilation_premium"},
                            {"group": "blinds", "option": "blinds_upgrade"}])
    assert any(f["type"] == "over_budget" for f in s["flags"])


def test_reserve_flag_only_when_plan_is_worse_than_doing_nothing():
    types = {f["type"] for f in engine.simulate(D)["flags"]}
    assert "reserve_below_minimum" not in types                       # doing nothing is never flagged against itself
    big = engine.simulate(D, [{"group": "ventilation", "option": "ventilation_premium"},
                              {"group": "blinds", "option": "blinds_upgrade"}])
    first = next(f for f in big["flags"] if f["type"] == "reserve_below_minimum")
    y = big["years"][first["year"] - 1]
    assert y["cash_closing"] < D["params"]["min_reserve_chf"] and y["cash_closing"] < y["cash_closing_baseline"]


def test_sick_days_today_match_the_data():
    out = engine.simulate(D)["years"][0]["outcomes"]
    assert abs(out["sick_days"] - D["params"]["sick_days_per_employee_year"]) < 1e-9


def test_roof_space_from_team_data():
    assert D["params"]["pv_max_kwp_without_rooftop_hp"] == D["params"]["pv_max_kwp_without_roof_heat_pumps"]


def test_hackathon_timer_off_vs_demand_control():
    off = engine.stress_test(D)
    dcv = engine.stress_test(D, [{"group": "ventilation", "option": "ventilation_budget", "floor": 0}])
    assert not off["ventilation_running"] and off["hours_over_capacity_per_day"] > 0
    assert dcv["ventilation_running"] and dcv["peak_co2_ppm"] < off["peak_co2_ppm"]


def test_performance_cap():
    s = engine.simulate(D, PLAN, overrides={"max_total_perf_gain": 0.001})
    assert all(y["people_value"]["perf_change"] <= 0.001 + TOL for y in s["years"])


def test_bands_ordered():
    b = engine.bands(D, PLAN)
    assert b["weak"] <= b["central"] <= b["strong"]


# --- Monte Carlo futures
import random
import montecarlo


def _quiet_future():
    """A future with no randomness: should reproduce the deterministic run exactly."""
    H = int(D["params"]["horizon_years"])
    rem = {i["id"]: max(0.0, D["options"][i["option"]]["lifetime_years"] - (i["age"] or 0))
           for i in D["items"] if D["options"][i["option"]]["lifetime_years"]}
    return {"price_path": [1.0] * H, "events": [], "remaining_life": rem, "params": {"failure_premium": 0.0}}


def test_quiet_future_equals_deterministic():
    a = engine.simulate(D, PLAN)
    b = engine.simulate(D, PLAN, future=_quiet_future())
    assert abs(a["npv_economic"] - b["npv_economic"]) < 1e-3 and abs(a["npv_cash"] - b["npv_cash"]) < 1e-3


def test_random_future_keeps_identities():
    f = montecarlo.draw_future(D, random.Random(7))
    s = engine.simulate(D, PLAN, future=f)
    assert abs(engine.simulate(D, future=f)["npv_economic"]) < TOL           # do nothing vs itself
    assert abs(sum(s["npv_breakdown"].values()) - s["npv_economic"]) < 1e-3
    p = {**D["params"], **f["params"]}
    for y in s["years"]:
        assert abs(y["cash_opening"] + p["other_operating_cf_chf_year"] - y["operating_cost"] - y["capex"] - y["cash_closing"]) < 1e-3


def test_emergency_replacement_costs_more():
    item = next(i for i in D["items"] if i["group"] == "heating_cooling")
    plan = engine.item_plan(D, item, None, 15, remaining=2)
    assert plan[0] == (2, "heating_cooling_current", "failure")
    capex, _ = engine.plan_money(D, {item["id"]: plan}, engine.baseline(D), 15, {**D["params"], "failure_premium": 0.15})
    assert abs(capex[2] - 440 * 1300 * 1.15) < 1e-3


def test_monte_carlo_reproducible_and_sane():
    sc = {"plan": PLAN, "nothing": []}
    a = montecarlo.run(D, sc, n=6, seed=1)
    b = montecarlo.run(D, sc, n=6, seed=1)
    assert a["summary"]["plan"]["npv_economic"] == b["summary"]["plan"]["npv_economic"]
    s = a["summary"]["plan"]["npv_economic"]
    assert s["p10"] <= s["p50"] <= s["p90"]
    assert all(abs(x) < TOL for x in a["summary"]["nothing"]["npv_economic"].values())   # same futures for both paths
    assert 0 <= a["compare"]["plan vs nothing"]["prob_better_economic"] <= 1

# --- additions for the results view: break-even, overrides everywhere, assumptions list
def test_breakeven_gives_zero_npv():
    import engine as e
    sc = [{"group": "ventilation", "option": "ventilation_mid"}]
    be = e.breakeven(D, sc)["npv_cash"]
    assert be["value"] is not None and be["pays_off"] == "above"
    npv = e.simulate(D, sc, overrides={"electricity_price_chf_kwh": be["value"]})["npv_cash"]
    assert abs(npv) < 500                                            # within CHF 500 of zero


def test_overrides_reach_bands_and_tornado():
    base = engine.bands(D, LIGHT_MID)["central"]
    pricey = engine.bands(D, LIGHT_MID, overrides={"electricity_price_chf_kwh": 0.4})["central"]
    assert pricey > base
    t = engine.tornado(D, LIGHT_MID, overrides={"electricity_price_chf_kwh": 0.4})
    assert abs(t["central"] - pricey) < TOL
    assert all(r["parameter"] != "electricity_price_chf_kwh" for r in t["rows"])


def test_futures_accept_events_and_overrides():
    import montecarlo
    a = montecarlo.run(D, {"p": LIGHT_MID}, n=20, seed=1)["summary"]["p"]["npv_cash"]["p50"]
    b = montecarlo.run(D, {"p": LIGHT_MID}, n=20, seed=1, overrides={"electricity_price_chf_kwh": 0.4})["summary"]["p"]["npv_cash"]["p50"]
    assert b > a
    res = montecarlo.run(D, {"p": LIGHT_MID}, n=10, seed=1, events=["new_lab", "hackathon_weekend"])
    assert "new lab in year" in res["stories"]["typical"]["what_happened"]


def test_assumptions_list_is_complete():
    import viz
    rows = viz.assumptions(D)
    assert {r["key"] for r in rows} == set(D["params"])
    assert all(r["label"] in ("fact", "research", "guess", "result") for r in rows)


# --- wear-out failures, worker processes and example futures
def test_weibull_remaining_life():
    rng = random.Random(3)
    mean = lambda life, age: sum(montecarlo.weibull_remaining(rng, life, age, 3) for _ in range(20000)) / 20000
    assert abs(mean(25, 0) - 25) < 0.75                     # a new unit lives its nominal life on average
    old = mean(25, 21)
    assert 4 < old < 25 - 21 + 8                            # a survivor has more than "exactly 4 years" left, but not a new life
    overdue = mean(20, 25)
    assert 0 < overdue < 10                                 # past its nominal life: fails soon, but not at once
    assert all(montecarlo.weibull_remaining(rng, 20, 30, 3) > 0 for _ in range(1000))


def test_futures_same_in_worker_processes():
    sc = {"p": LIGHT_MID, "v": PLAN}
    pool = montecarlo.make_pool(2)
    try:
        a = montecarlo.run(D, sc, n=12, seed=4)
        b = montecarlo.run(D, sc, n=12, seed=4, pool=pool)
    finally:
        pool.shutdown()
    assert a["summary"] == b["summary"] and a["compare"] == b["compare"]


def test_futures_breakdown_and_samples_add_up():
    res = montecarlo.run(D, {"p": PLAN}, n=30, seed=2, samples=10)
    s = res["summary"]["p"]
    assert abs(sum(s["npv_breakdown_mean"].values()) - s["npv_economic_mean"]) < 1e-3
    assert len(res["samples"]) == 10 and len({x["id"] for x in res["samples"]}) == 10
    H = int(D["params"]["horizon_years"])
    for x in res["samples"][:3]:                            # each example is a real future: replaying it gives the same path
        replay = engine.simulate(D, PLAN, future=res["futures"][x["id"]], detail_years=())
        assert all(abs(a - y["cumulative_cash_cf"]) < 1e-6 for a, y in zip(x["paths"]["p"]["cash"], replay["years"]))
        assert len(x["paths"]["p"]["cash"]) == H
        assert all(1 <= f["year"] <= H and f["cost"] > 0 for f in x["failures"])
    run = s["fan"]["cash_running"][-1]["p50"]
    assert run is not None
    shares = [y["share"] for y in s["prob_paid_back_by_year"]]
    assert shares == sorted(shares) and 0 <= shares[-1] <= 1


# --- manager policy: big systems replaced on a plan, or run until they fail
def test_on_plan_big_system():
    it = next(i for i in D["items"] if i["group"] == "heating_cooling")          # age 17, life 20: planned in year 3
    assert engine.item_plan(D, it, None, 15, remaining=8, on_plan=True)[0] == (3, "heating_cooling_current", "planned")
    assert engine.item_plan(D, it, None, 15, remaining=1.5, on_plan=True)[0] == (2, "heating_cooling_current", "failure")
    assert engine.item_plan(D, it, None, 15, remaining=2.4, on_plan=True)[0] == (3, "heating_cooling_current", "planned")
    assert engine.item_plan(D, it, None, 15, remaining=8, on_plan=False)[0] == (8, "heating_cooling_current", "failure")


def test_on_plan_small_items_still_fail():
    it = next(i for i in D["items"] if i["group"] == "lighting")
    assert engine.item_plan(D, it, None, 15, remaining=5, on_plan=True)[0][2] == "failure"


def test_on_plan_phased_unchanged():
    it = next(i for i in D["items"] if i["group"] == "ventilation")
    choice = ("ventilation_mid", 8)
    for rem in (1.5, 6.0, 30.0):
        assert engine.item_plan(D, it, choice, 15, rem, True) == engine.item_plan(D, it, choice, 15, rem, False)


def test_policy_leaves_fixed_run_alone():
    for policy in (0, 1):
        a, b = engine.simulate(D, PLAN), engine.simulate(D, PLAN, overrides={"replace_on_plan": policy})
        assert a["npv_cash"] == b["npv_cash"] and a["npv_economic"] == b["npv_economic"]
        f = _quiet_future()
        f["params"]["replace_on_plan"] = policy
        assert abs(engine.simulate(D, PLAN, future=f)["npv_cash"] - a["npv_cash"]) < 1e-3


def test_futures_policy():
    vent = {"p": [{"group": "ventilation", "option": "ventilation_mid"}]}
    y15 = lambda res: res["summary"]["p"]["fan"]["cash_running"][-1]["p50"]
    planned = montecarlo.run(D, vent, n=40, seed=2026, overrides={"replace_on_plan": 1})
    broken = montecarlo.run(D, vent, n=40, seed=2026, overrides={"replace_on_plan": 0})
    assert y15(planned) > y15(broken)
    for x in planned["samples"]:                   # on a plan, a big system only "fails" before its planned year
        for f in x["failures"]:
            if f["group"] == "ventilation":
                assert f["year"] <= 10


if __name__ == "__main__":
    tests =[v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError:
            failed += 1
            print("FAIL", t.__name__)
    print(f"{len(tests) - failed}/{len(tests)} passed")
