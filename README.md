# Building twin · LauzHack 2026

A digital copy of the building we're sitting in. Change the heating, the ventilation or the lights, and see what it does to the energy bill, the indoor air and the money, before you spend anything.

Built in 24 hours for the UBS challenge "AI Financial Twin" at [LauzHack 2026](https://lauzhack.com) by Enoptim: Casper, Oscar, Theodor and Linus.

> Don't predict the future. Make it explorable.

## Check it yourself

One repeatable path that needs no chat. Follow it in the app, or run one command with no browser. It starts at "The building today", upgrades the ventilation, changes one assumption and checks the cash ledger.

In the app:
1. Run `make dev` and open http://localhost:5173.
2. In the right panel, keep the floor picker on **All**. The block **The building today** shows the running costs, savings reserve and upgrade budget.
3. Open **Ventilation** and tick **New AHUs with heat recovery + CO2 control**. The app changes ventilation for the whole building. The command below also prints a floor-2-only run.
4. Click **See what it changes**. The overview shows **Cost** (or **Paid today**), **Costs saved, year 1**, **Pays for itself in**, **Energy use, year 1** and **Meeting room CO₂**.
5. In **Assumptions** on the right, click the **Electricity price** slider and press the right arrow key ten times (0.20 to 0.30 CHF/kWh). Watch which numbers move.
6. The cash ledger check is in the command below, not in the app.

By command (Python 3 only, about 4 seconds, no network):

```sh
cd model && python3 judge_check.py        # or: make check
```

Inputs: the plan is `[{"group": "ventilation", "option": "ventilation_mid"}]`, the price change is `electricity_price_chf_kwh` 0.20 to 0.30, and the futures use 200 draws with seed 2026. Data comes from `data/` and `model/data/model/`. Every number is computed when the script runs. The exit code is 1 if a check fails. Output on 22 Nov 2026:

```text
1. The building today (EPFL building BC, fictional finances, real 2026 CHF)
  Savings reserve:         2,500,000 CHF (must stay above 1,000,000 CHF)
  Upgrade budget:          1,500,000 CHF
  Electricity price:       0.20 CHF/kWh
  Yearly electricity use:  1,103,217 kWh
  Yearly running cost:     306,115 CHF (energy 220,643 CHF)
  Meeting-room CO2:        1346 ppm

2. Plan: upgrade ventilation to 'New AHUs with heat recovery + CO2 control' (the app's demo plan)
  Purchase cost:           760,500 CHF
  Year-1 running-cost saving: 19,709 CHF
  Year-1 electricity use:  998,824 kWh (today 1,103,217 kWh)
  Meeting-room CO2:        1346 ppm -> 1000 ppm
  Net present value (cash only, 15 years, 3%/yr real): -102,656 CHF
  Payback (cash only):     10.7 years
  Flags:                   reserve_below_minimum, reserve_below_minimum_without_upgrades
  Floor 2 only (engine option 'floor': 2): purchase 156,000 CHF, year-1 saving 4,106 CHF

3. Change one assumption: electricity price 0.20 -> 0.30 CHF/kWh (+50%)
  Moved:     Year-1 running-cost saving: 19,709 -> 30,148 CHF
  Moved:     Net present value: -102,656 -> 21,967 CHF
  Moved:     Payback: 10.7 y -> 10.4 y
  Unchanged: Purchase cost: 760,500.0 -> 760,500.0
  [ok] Purchase cost does not depend on the electricity price
  Unchanged: Electricity use (kWh): 998,824.4 -> 998,824.4
  [ok] Electricity use (kWh) does not depend on the electricity price
  Unchanged: Meeting-room CO2 (ppm): 1,000.0 -> 1,000.0
  [ok] Meeting-room CO2 (ppm) does not depend on the electricity price
  [ok] a higher price makes the saving larger

4. Cash-ledger check
  [ok] plan: closing cash equals the formula in all 15 years
  Year 1 with the plan: opening 1,354,540 + other operating cash 350,000 - running costs 286,407 - purchases 72,000 = 1,346,133; model closing cash 1,346,133
  [ok] do nothing: closing cash equals the formula in all 15 years
  Year 1 doing nothing: opening 2,115,040 + 350,000 - 306,115 - 72,000 = 2,086,925; model closing cash 2,086,925
  [ok] year-15 cash gap vs doing nothing equals the plan's cumulative cash flow (less the book value left in the new equipment)

5. 200 possible futures (seed 2026): cumulative cash gain vs doing nothing, year 15
  Median 97,152 CHF; 10th to 90th percentile 226 CHF to 211,348 CHF
  The 10th-90th range holds the middle 8 of 10 futures drawn from our assumed distributions; it is not a real-world probability.
  [ok] percentiles are ordered

RESULT: all identities hold
```

The numbers may shift a little if we tune the model. The checks must still pass.

### How we checked the numbers

Run all of them with `make test`.
- `model/test_judge_check.py`: the command above runs, and every identity in it holds.
- `model/test_engine.py`: the cash ledger adds up in every year, the baseline matches the data team's hand check, a plan compared with itself is zero, higher prices raise savings, and random futures keep every identity.
- `model/test_session.py`: play mode never changes the past, and the same choices give the same game.
- `model/test_optimize.py`: the optimizer's costs add up and match the engine.
- `model/test_search.py`: the plan search matches brute force on small problems.
- `chat/test_agent.py`: the assistant's tool calls and answers behave as expected.

### Assumptions, data and limitations

- Assumptions with units, low and high values and sources: `data/assumptions.csv` and `model/data/model/model_assumptions.csv`. Method and modelling choices: [model/README.md](model/README.md).
- Public data: room outlines (plan.epfl.ch), Lausanne weather (Open-Meteo) and solar yield (PVGIS). Fictional data: room uses, people, equipment, prices of upgrades and the building's finances (reserve, budget, yearly cash).
- Results are explorations, not forecasts and not financial, legal or engineering advice. Percentiles come from our assumed distributions, not from the real world.
- Limits: one building, one electricity price path model, equipment and people effects are simplified, and the literature values are averages from other buildings.

### Licenses and sources

Data sources with dates and the main libraries with their licenses are listed in [data/README.md](data/README.md#sources-and-licenses). Our own code is covered by [LICENSE](LICENSE).

## Where to look

- [AGENTS.md](AGENTS.md): what we're building, who does what, and how we write.
- [wiki/index.md](wiki/index.md): research, decisions and pitch notes.
- [wiki/decisions.md](wiki/decisions.md): what the team has decided. Read this before you change direction.

## Run it

You need Python 3 and Node.js. Run this once:

```sh
make setup
```

It installs the simulation's web server in `model/.venv` and the 3D app's packages in `frontend/node_modules`.

Then start both parts with one command:

```sh
make dev
```

- 3D app: http://localhost:5173
- Simulation API: http://localhost:8000 (the 3D app reaches it through `/api`)
- Ctrl+C stops both.

Other commands:
- `make api` or `make frontend` starts only one part.
- `make test` runs the simulation's checks.
- `make check` runs the judges' one-command check (see "Check it yourself").
- Open http://localhost:8000/playground (needs `make api` or `make dev`) to try the simulation by hand, with charts: build a plan, run it once or across many possible futures, see which assumptions matter most, and run the hackathon stress test.
- http://localhost:8000/docs lists every API endpoint and lets you call each one from the browser.
- Press the ` key in the app (or open http://localhost:5173/?debug) to see the raw simulation result. It shows that the app and the simulation are connected.

How the simulation works and what the API returns: [model/README.md](model/README.md).

The assistant needs an OpenRouter key in `chat/.env`. Ask Theodor for it. See [chat/README.md](chat/README.md).
