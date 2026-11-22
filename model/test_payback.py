"""Payback across the futures (montecarlo.py). Run: python3 test_payback.py (or pytest).

The Results chart draws each plan's money line without the value of equipment left at the end
(the "_running" lines). Payback shares and ranges must be worked out per future on exactly that basis:
never read off the band's edges, which are worked out separately for each year."""
import math
import sys
import time

import engine
import montecarlo

D = engine.load()
H = int(D["params"]["horizon_years"])
PLAN = [{"group": "ventilation", "option": "ventilation_mid", "floor": 2}]
LIGHTS = [{"group": "lighting", "option": "lighting_mid"}]
SEED = 7
N = 40
RES = montecarlo.run(D, {"p": PLAN}, n=N, seed=SEED, samples=5)


def runs_of(res, scenario):
    """Each future replayed on its own, the way the chart sees it: today, then each year's cumulative cash."""
    out = []
    for f in res["futures"]:
        r = engine.simulate(D, scenario, future=f, detail_years=())
        out.append({"start": -r["capex_year0"],
                    "cash_running": [y["cumulative_cash_cf"] - y["residual_value"] for y in r["years"]],
                    "residual": r["years"][-1]["residual_value"]})
    return out


RUNS = runs_of(RES, PLAN)


def crossing(line):
    """Independent check: the year the line crosses zero and stays at or above it; None if it ends below zero."""
    if line[-1] < 0:
        return None
    neg = [t for t, v in enumerate(line) if v < 0]
    if not neg:
        return 0.0
    t = neg[-1]
    return t + -line[t] / (line[t + 1] - line[t])


def test_payback_year_basics():
    assert montecarlo.payback_year([-100, -50, 0, 50]) == 2.0
    assert montecarlo.payback_year([-100, -20, 60]) == 1.25
    assert montecarlo.payback_year([-100, -50]) is None
    assert montecarlo.payback_year([0, 10, 20]) == 0.0
    # pays back, dips below zero again (a later purchase), then pays back for good: the last crossing counts
    assert montecarlo.payback_year([-100, 50, -50, 50]) == 2.5


def test_chart_basis_leaves_out_equipment_value():
    # the lines the chart draws (and the samples carry) are cumulative cash minus the end-of-horizon equipment value
    for x in RES["samples"]:
        mine = RUNS[x["id"]]
        assert all(abs(a - b) < 1e-6 for a, b in zip(x["paths"]["p"]["cash_running"], mine["cash_running"]))
        assert abs(x["paths"]["p"]["start"] - mine["start"]) < 1e-6
    assert any(abs(r["residual"]) > 1 for r in RUNS), "the test plan should leave a different equipment value"


def test_per_future_payback_matches_each_line():
    s = RES["summary"]["p"]["payback"]["cash_running"]
    assert [row["year"] for row in s] == list(range(1, H + 1))
    for h in (5, 10, H):
        years = [crossing([r["start"]] + r["cash_running"][:h]) for r in RUNS]
        for r, y in zip(RUNS, years):
            assert y == montecarlo.payback_year([r["start"]] + r["cash_running"][:h])
        row = s[h - 1]
        # the share is the fraction of futures with a payback by year h
        assert row["share"] == sum(y is not None for y in years) / N
        # the percentiles are of the per-future years, with "never" kept (sorted last), not dropped
        ranked = sorted(years, key=lambda y: math.inf if y is None else y)
        for q, v in (("p10", .1), ("p50", .5), ("p90", .9)):
            k = (N - 1) * v
            f, c = math.floor(k), min(math.floor(k) + 1, N - 1)
            lo, hi = ranked[f], ranked[c]
            want = lo if k == f else (None if lo is None or hi is None else lo + (hi - lo) * (k - f))
            assert row[q] == want, (h, q, row[q], want)


def test_summary_fields_share_the_basis():
    s = RES["summary"]["p"]
    full = s["payback"]["cash_running"][-1]
    assert s["payback_range"] == {q: full[q] for q in ("p10", "p50", "p90")}
    assert s["payback_cash_p50"] == full["p50"]
    assert abs(s["prob_no_cash_payback"] - (1 - full["share"])) < 1e-12
    shares = [y["share"] for y in s["prob_paid_back_by_year"]]
    assert shares == sorted(shares) and abs(shares[-1] - full["share"]) < 1e-12
    # the middle future's payback is between the 10th and 90th percentile futures
    if full["p10"] is not None and full["p50"] is not None:
        assert full["p10"] <= full["p50"] and (full["p90"] is None or full["p50"] <= full["p90"])


def test_middle_future_chain_adds_up():
    """The Results headline's chain is one real future: cash saved + leftover equipment value = ahead; NPV is its own."""
    s = RES["summary"]["p"]
    m = s["middle_future"]
    assert m["year"] == H
    assert abs(m["cash_saved"] + m["leftover_value"] - m["ahead"]) < 1e-6
    # it is the future at the middle of the chart's line at the end (lower median), so it sits inside the fan
    ends = sorted(r["cash_running"][-1] for r in RUNS)
    assert abs(m["cash_saved"] - ends[(N - 1) // 2]) < 1e-6
    k = next(i for i, r in enumerate(RUNS) if abs(r["cash_running"][-1] - m["cash_saved"]) < 1e-6)
    assert abs(m["leftover_value"] - RUNS[k]["residual"]) < 1e-6
    replay = engine.simulate(D, PLAN, future=RES["futures"][k], detail_years=())
    assert abs(m["npv_cash"] - replay["npv_cash"]) < 1e-6


def test_economic_view_too():
    s = RES["summary"]["p"]["payback"]["economic_running"]
    assert len(s) == H and all(0 <= row["share"] <= 1 for row in s)


def test_never_paid_back_is_kept():
    pct = montecarlo._pct_or_never
    assert pct([1.0, 2.0, 3.0, 4.0, 5.0], 0.5) == 3.0
    assert pct([None, None, 1.0], 0.0) == 1.0
    assert pct([1.0, None, None], 0.5) is None              # the middle future never pays back
    assert pct([1.0, 2.0, None], 0.75) is None              # between a payback and "never": not within the horizon
    assert pct([1.0, 2.0, 3.0, 4.0, None], 0.75) == 4.0     # n = 5: lands exactly on a future, the next one is None
    assert pct([1.0, 2.0, 3.0, None, None], 0.5) == 3.0
    assert pct([1.0, 2.0, 3.0, None, None], 0.9) is None
    assert pct([], 0.5) is None
    xs = [0.3, 5.1, 2.2, 9.9, 4.0, 7.5]                      # without "never", the same as the fan's percentiles
    assert all(abs(pct(xs, q) - montecarlo._pct(xs, q)) < 1e-12 for q in (.1, .5, .9))


def test_small_run_with_futures_that_never_pay_back():
    # n = 5: the 10th / 50th / 90th percentiles land on or near whole positions; some futures don't pay back
    res = montecarlo.run(D, {"a": LIGHTS}, n=5, seed=1, samples=2)
    for view in ("cash_running", "economic_running"):
        for row in res["summary"]["a"]["payback"][view]:
            assert 0 <= row["share"] <= 1
            for q in ("p10", "p50", "p90"):
                assert row[q] is None or 0 <= row[q] <= row["year"]
    assert any(row[q] is None for row in res["summary"]["a"]["payback"]["cash_running"] for q in ("p10", "p50", "p90"))


def test_reproducible_with_a_fixed_seed():
    again = montecarlo.run(D, {"p": PLAN}, n=N, seed=SEED, samples=5)
    assert again["summary"]["p"]["payback"] == RES["summary"]["p"]["payback"]
    other = montecarlo.run(D, {"p": PLAN}, n=N, seed=SEED + 1, samples=5)
    assert other["summary"]["p"]["payback"] != RES["summary"]["p"]["payback"]


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
