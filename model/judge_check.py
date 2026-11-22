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

    print(f"\n5. {N_FUTURES} possible futures (seed {SEED}): cumulative cash gain vs doing nothing, year {int(p['horizon_years'])}")
    res = montecarlo.run(d, {"Upgrade ventilation": PLAN}, n=N_FUTURES, seed=SEED, samples=1)
    last = res["summary"]["Upgrade ventilation"]["fan"]["cash"][-1]
    print(f"  Median {chf(last['p50'])}; 10th to 90th percentile {chf(last['p10'])} to {chf(last['p90'])}")
    print(f"  The 10th-90th range holds the middle 8 of 10 futures drawn from our assumed distributions; "
          f"it is not a real-world probability.")
    check(res["n"] == N_FUTURES and last["p10"] <= last["p50"] <= last["p90"], "percentiles are ordered")

    print("\nRESULT:", "all identities hold" if not failures else f"{len(failures)} check(s) failed")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
