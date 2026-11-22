"""One repeatable check for judges. No chat, no browser: python3 judge_check.py

Steps: the building today -> upgrade ventilation -> change one assumption -> cash-ledger check -> 200 futures.
Every number is computed when the script runs. Exit code 1 if an identity fails."""
import sys

import engine
import montecarlo

PLAN = [{"group": "ventilation", "option": "ventilation_mid"}]          # the app's demo plan, whole building
FLOOR2 = [{"group": "ventilation", "option": "ventilation_mid", "floor": 2}]
PRICE_KEY = "electricity_price_chf_kwh"
N_FUTURES, SEED = 200, 2026
TOL = 1e-3                                                               # CHF
failures = []


def check(ok, what):
    print(f"  [{'ok' if ok else 'FAIL'}] {what}")
    if not ok:
        failures.append(what)


def chf(x):
    return f"{x:,.0f} CHF"


def ledger(sim, label, baseline):
    """opening + other operating cash - running costs - purchases = closing, every year; closing = next opening."""
    d_params = sim["_params"]
    other = d_params["other_operating_cf_chf_year"]
    key_cost, key_capex, key_close = (("operating_cost_baseline", "capex_baseline", "cash_closing_baseline") if baseline
                                      else ("operating_cost", "capex", "cash_closing"))
    opening = sim["years"][0]["cash_opening"] + (sim["capex_year0"] if baseline else 0.0)
    rows = []
    for y in sim["years"]:
        expected = opening + other - y[key_cost] - y[key_capex]
        rows.append((y["year"], opening, other, y[key_cost], y[key_capex], y[key_close], expected))
        opening = y[key_close]
    ok = all(abs(r[5] - r[6]) < TOL for r in rows)
    check(ok, f"{label}: closing cash equals the formula in all {len(rows)} years")
    return rows[0]


def main():
    d = engine.load()
    p = d["params"]
    today = engine.simulate(d)
    t1 = today["years"][0]
    print("1. The building today (EPFL building BC, fictional finances, real 2026 CHF)")
    print(f"  Savings reserve:         {chf(p['opening_reserve_chf'])} (must stay above {chf(p['min_reserve_chf'])})")
    print(f"  Upgrade budget:          {chf(p['capex_budget_chf'])} (for the extra cost over like-for-like replacements)")
    print(f"  Electricity price:       {p[PRICE_KEY]:.2f} CHF/kWh")
    print(f"  Yearly electricity use:  {t1['kwh_baseline']:,.0f} kWh")
    print(f"  Yearly running cost:     {chf(t1['operating_cost_baseline'])} (energy {chf(t1['state']['costs']['energy'])})")
    print(f"  Meeting-room CO2:        {t1['outcomes']['meeting_co2_ppm']:.0f} ppm")

    s = engine.simulate(d, PLAN)
    s["_params"] = p
    y1 = s["years"][0]
    pb = s["payback_cash"]
    print("\n2. Plan: upgrade ventilation to 'New AHUs with heat recovery + CO2 control' (the app's demo plan)")
    print(f"  Purchase cost:           {chf(s['purchase_year0'])} (extra over like-for-like replacements, counted against the budget: {chf(s['capex_year0'])})")
    print(f"  Year-1 running-cost saving: {chf(y1['operating_cost_baseline'] - y1['operating_cost'])}")
    print(f"  Year-1 electricity use:  {y1['kwh']:,.0f} kWh (today {y1['kwh_baseline']:,.0f} kWh)")
    print(f"  Meeting-room CO2:        {t1['outcomes']['meeting_co2_ppm']:.0f} ppm -> {y1['outcomes']['meeting_co2_ppm']:.0f} ppm")
    print(f"  Net present value (cash only, {int(p['horizon_years'])} years, {p['discount_rate_real']:.0%}/yr real): {chf(s['npv_cash'])}")
    print(f"  Payback (cash only):     {'not within the horizon' if pb is None else f'{pb:.1f} years'}")
    print(f"  Flags:                   {', '.join(sorted({f['type'] for f in s['flags']})) or 'none'}")
    f2 = engine.simulate(d, FLOOR2)
    print(f"  Floor 2 only (engine option 'floor': 2): purchase {chf(f2['capex_year0'])}, "
          f"year-1 saving {chf(f2['years'][0]['operating_cost_baseline'] - f2['years'][0]['operating_cost'])}")

    hi = round(p[PRICE_KEY] * 1.5, 4)
    s2 = engine.simulate(d, PLAN, overrides={PRICE_KEY: hi})
    z1 = s2["years"][0]
    pb2 = s2["payback_cash"]
    print(f"\n3. Change one assumption: electricity price {p[PRICE_KEY]:.2f} -> {hi:.2f} CHF/kWh (+50%)")
    moved = [("Year-1 running-cost saving", y1["operating_cost_baseline"] - y1["operating_cost"],
              z1["operating_cost_baseline"] - z1["operating_cost"], "CHF"),
             ("Net present value", s["npv_cash"], s2["npv_cash"], "CHF")]
    for name, a, b, u in moved:
        print(f"  Moved:     {name}: {a:,.0f} -> {b:,.0f} {u}")
    print(f"  Moved:     Payback: {'never' if pb is None else f'{pb:.1f} y'} -> {'never' if pb2 is None else f'{pb2:.1f} y'}")
    same = [("Purchase cost", s["capex_year0"], s2["capex_year0"]),
            ("Electricity use (kWh)", y1["kwh"], z1["kwh"]),
            ("Meeting-room CO2 (ppm)", y1["outcomes"]["meeting_co2_ppm"], z1["outcomes"]["meeting_co2_ppm"])]
    for name, a, b in same:
        print(f"  Unchanged: {name}: {a:,.1f} -> {b:,.1f}")
        check(abs(a - b) < 1e-6, f"{name} does not depend on the electricity price")
    check(moved[0][2] > moved[0][1], "a higher price makes the saving larger")

    print("\n4. Cash-ledger check")
    yr, op, other, cost, capex, close, exp = ledger(s, "plan", False)
    print(f"  Year {yr} with the plan: opening {op:,.0f} + other operating cash {other:,.0f} "
          f"- running costs {cost:,.0f} - purchases {capex:,.0f} = {exp:,.0f}; model closing cash {close:,.0f}")
    yr, op, other, cost, capex, close, exp = ledger(s, "do nothing", True)
    print(f"  Year {yr} doing nothing: opening {op:,.0f} + {other:,.0f} - {cost:,.0f} - {capex:,.0f} = {exp:,.0f}; model closing cash {close:,.0f}")
    gap = s["years"][-1]["cash_closing"] - s["years"][-1]["cash_closing_baseline"]
    last_row = s["years"][-1]
    check(abs(gap - (last_row["cumulative_cash_cf"] - last_row["residual_value"])) < TOL,
          "year-15 cash gap vs doing nothing equals the plan's cumulative cash flow (less the book value left in the new equipment)")

    H = int(p["horizon_years"])
    print(f"\n5. {N_FUTURES} possible futures (seed {SEED}): one plan, one chain of numbers, year {H}")
    res = montecarlo.run(d, {"Upgrade ventilation": PLAN}, n=N_FUTURES, seed=SEED, samples=1)
    summary = res["summary"]["Upgrade ventilation"]
    run_ = summary["fan"]["cash_running"][-1]
    last = summary["fan"]["cash"][-1]
    m = summary["middle_future"]
    print(f"  The app's headline (chart line, middle of {N_FUTURES} futures): cash saved by year {H} {chf(run_['p50'])}")
    print(f"  The same chain for one middle future (by cash saved), so the steps add up exactly:")
    print(f"    Cash saved by year {H} (no leftover equipment value):  {chf(m['cash_saved'])}")
    print(f"    + difference in equipment value left at year {H}:    {chf(m['leftover_value'])}")
    print(f"    = ahead of doing nothing at year {H}:                 {chf(m['ahead'])}")
    print(f"    In today's money (NPV, {p['discount_rate_real']:.0%}/yr):                      {chf(m['npv_cash'])}")
    print(f"  Across all futures: NPV middle {chf(summary['npv_cash']['p50'])}; "
          f"{summary['prob_cash_positive']:.0%} of futures have a positive NPV (cash only)")
    print(f"  Counting the leftover value, year-{H} median {chf(last['p50'])}; "
          f"10th to 90th percentile {chf(last['p10'])} to {chf(last['p90'])}")
    print(f"  The 10th-90th range holds the middle 8 of 10 futures drawn from our assumed distributions; "
          f"it is not a real-world probability.")
    check(res["n"] == N_FUTURES and last["p10"] <= last["p50"] <= last["p90"], "percentiles are ordered")
    check(abs(m["cash_saved"] + m["leftover_value"] - m["ahead"]) < TOL,
          "middle future: cash saved + leftover equipment value difference = ahead at the end")
    lo, hi_ = sorted([summary["fan"]["cash_running"][-1]["p10"], summary["fan"]["cash_running"][-1]["p90"]])
    check(lo <= m["cash_saved"] <= hi_, "the middle future's cash saved sits inside the chart's 8-in-10 band")

    # Fixed run (no chance): what each side owns at the end, cash plus the book value of its equipment.
    # Doing nothing is its own run (no plan), so its book value is not derived from the plan's figures.
    end, base = s["years"][-1], today["years"][-1]
    plan_nw, base_nw = end["net_worth"], base["net_worth"]
    print(f"  Fixed run, year {H}: cash + equipment book value (net worth)")
    print(f"    With the plan:  {chf(end['cash_closing'])} cash + {chf(end['book_value'])} equipment = {chf(plan_nw)}")
    print(f"    Doing nothing:  {chf(base['cash_closing'])} cash + {chf(base['book_value'])} equipment = {chf(base_nw)}")
    print(f"    Plan ahead by {chf(plan_nw - base_nw)}: cash saved {chf(end['cumulative_cash_cf'] - end['residual_value'])} "
          f"+ leftover-value difference {chf(end['residual_value'])}. In today's money (NPV): {chf(s['npv_cash'])}")
    check(abs(base["cash_closing"] - end["cash_closing_baseline"]) < TOL, "doing nothing ends with the same cash in both runs")
    check(abs(end["residual_value"] - (end["book_value"] - base["book_value"])) < TOL,
          "leftover-value difference (cash line - running cash line at the horizon) = plan's minus doing nothing's equipment book value")
    check(abs((plan_nw - base_nw) - end["cumulative_cash_cf"]) < TOL,
          "net-worth gap at the horizon = cumulative cash vs doing nothing, counting leftover equipment value")

    # Payback is worked out for each future on its own (the chart's basis: without the leftover equipment value),
    # never read off the percentile lines, which are computed separately for each year.
    pb = summary["payback"]["cash_running"][-1]
    years_ = lambda v: "not within the horizon" if v is None else f"{v:.1f} years"
    print(f"  Payback, worked out future by future: {pb['share']:.0%} of futures pay back within "
          f"{int(p['horizon_years'])} years; median {years_(pb['p50'])}, "
          f"10th to 90th percentile {years_(pb['p10'])} to {years_(pb['p90'])}")
    check(0.0 <= pb["share"] <= 1.0 and (pb["p10"] is None or pb["p50"] is None or pb["p10"] <= pb["p50"]),
          "per-future payback share and percentiles are consistent")

    print("\nRESULT:", "all identities hold" if not failures else f"{len(failures)} check(s) failed")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
