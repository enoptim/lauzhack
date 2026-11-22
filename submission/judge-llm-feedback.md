## UBS rubric assessment: 79/100

The What-If Building meets all five proposed minimum demo criteria. It has a fictional financial starting point, a meaningful upgrade decision, a reproducible comparison, explicit assumptions, and a way to inspect outcomes. The strongest idea is that **doing nothing still costs money**: old equipment eventually needs replacing, so the app compares an upgrade with a realistic alternative rather than a zero-cost baseline.

This is my estimate against the draft rubric, not an official score. I reviewed `chat/`, `frontend/`, `model/`, and the relevant data and submission docs. **All 87 tests passed**, the frontend production build passed, and I verified `/api/simulate` and `/api/futures` against a running API. I did not verify browser interactions or live OpenRouter responses.

| Rubric category | Score | Assessment |
|---|---:|---|
| Financial modelling | 3/4 · 18.75/25 | The reserve ledger, replacement costs, remaining equipment value, and discounted cash flows are backed by reconciliation tests. Payback and reserve warnings need tightening. |
| Scenario exploration | 3/4 · 15/20 | Compare up to six plans under the same sampled futures. Change electricity price, replacement timing, or events, then replay one future. The results are useful, but some headlines overstate what the chart proves. |
| Technical execution | 3/4 · 11.25/15 | Strong engine tests, including seeded replay and search checked against every possible plan on small problems. The live API works. Input validation is uneven, and the chat tests replace the LLM with a script. |
| User experience | 3/4 · 11.25/15 | “The building today” makes the fictional balance sheet concrete. The 3D view connects spending to equipment, and Results separates cash from estimated staff benefits. The payback labels can still mislead. |
| Innovation | 4/4 · 15/15 | Using the building the judges are sitting in gives the twin a purpose beyond the 3D view: it links spending, air quality, and the risk of waiting. |
| Responsible design | 3/4 · 7.5/10 | The app says the building is real and the numbers are assumptions. Data sources and sampling methods are documented. Chat cards use engine figures, but free-text claims are not checked against tool output. |

### Best demo I verified: upgrade ventilation on floor 2

At CHF 0.20/kWh, the fixed run shows **CHF 4,106 lower first-year running costs** and building-wide meeting-room CO₂ falling from **1,346 to 1,288 ppm**. Across 200 futures with seed `2026` and planned replacement, the middle 80% of year-15 cumulative cash outcomes runs from **CHF 33k to CHF 81k ahead**. Yet the median **discounted** cash result, including what the equipment is still worth at the end, is **CHF 29k behind**.

That contrast is a stronger pitch than “this upgrade saves money”: **it improves the air and cuts running costs, but that alone doesn’t make it a good investment.**

### What I’d fix before judging

1. **Fix the payback claim.** `frontend/src/routes/results/useResultsModel.ts` takes the zero crossings of the chart’s low and high lines, then `Overview.tsx` calls that an “8 in 10” payback range. Those lines are percentiles calculated separately each year, not individual futures. The separate payback share also uses a calculation that includes remaining equipment value, which the chart excludes. Calculate payback for each future on the same cash basis as the chart, or drop the range claim.
2. **Make the spending limits unambiguous.** `model/engine.py` checks reserve shortfalls from year 1 onward and checks the upgrade budget against the *extra* cost versus scheduled replacements. The app also shows the full purchase price. Label which figure the budget applies to, and test whether the purchase leaves enough cash on day one.
3. **Give judges one repeatable path that doesn’t depend on chat.** Start at “The building today,” upgrade floor 2, change one assumption, then show one cash-ledger check. Put the exact inputs and expected output in the README. Separately, resolve the public source-link blocker already noted in `submission/submission.md` and verify the links while signed out.

No source files changed.
