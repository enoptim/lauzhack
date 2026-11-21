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


def test_overdue_units_replaced_like_for_like_now():
    item = next(i for i in D["items"] if i["group"] == "heating_cooling")       # 21 years old, 20-year life
    assert engine.item_plan(D, item, None, 15)[0][:2] == (0, "heating_cooling_current")


def test_upgrade_cost_is_only_the_premium_when_overdue():
    s = engine.simulate(D, [{"group": "heating_cooling", "option": "heating_cooling_mid"}])
    assert abs(s["capex_year0"] - 440 * ((950 + 450) - (900 + 400))) < 1e-3


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


def test_new_lab_raises_office_co2():
    a = engine.simulate(D)["years"][2]["outcomes"]["office_co2_ppm"]
    b = engine.simulate(D, events_on=["new_lab"])["years"][2]["outcomes"]["office_co2_ppm"]
    assert b > a


def test_heatwave_raises_cooling_and_overheating():
    s = engine.simulate(D, events_on=["heatwave_summer"])
    assert s["years"][2]["kwh"] > s["years"][1]["kwh"]
    assert s["years"][2]["outcomes"]["summer_overheating_degc"] > s["years"][1]["outcomes"]["summer_overheating_degc"]


def test_price_spike_only_in_its_year():
    s = engine.simulate(D, LIGHT_MID, ["energy_price_spike"])
    base = engine.simulate(D, LIGHT_MID)
    assert s["years"][0]["savings"]["energy"] > base["years"][0]["savings"]["energy"]
    assert abs(s["years"][1]["savings"]["energy"] - base["years"][1]["savings"]["energy"]) < TOL


# --- constraints and stress test
def test_over_budget_flag():
    s = engine.simulate(D, [{"group": "ventilation", "option": "ventilation_premium"},
                            {"group": "blinds", "option": "blinds_upgrade"}])
    assert any(f["type"] == "over_budget" for f in s["flags"])


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
