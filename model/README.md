# BC twin engine

Runs on the data team's BC dataset (unchanged) plus our own files (`model/data/model/`).

In the repo this folder sits at `model/`, next to the team's `data/`; the engine finds `data/` automatically
(override with `TWIN_TEAM_DATA=/path/to/data`). Standard library only; the API needs `pip install -r requirements.txt`.

```sh
python test_engine.py        # 41 validation tests
python test_search.py        # search: brute-force checks on small problems
python judge_check.py        # judges' one-command check: today, upgrade, one changed assumption, cash ledger, 200 futures
```

```python
import engine
d = engine.load()
s = engine.simulate(d, [
    {"group": "lighting", "option": "lighting_mid", "floor": 2},          # one floor
    {"group": "ventilation", "option": "ventilation_mid", "timing": "end_of_life"},
    {"group": "monitors", "option": "monitors_mid", "year": 1},           # phased: next year
])
s["npv_cash"], s["npv_economic"], s["npv_breakdown"], s["flags"], s["years"]
engine.stress_test(d)        # hackathon weekend, hour by hour
engine.tornado(d, scenario)  # one-at-a-time sensitivity
engine.bands(d, scenario)    # weak / central / strong people effects
```

A swap can be narrowed with `floor`, `room_id` or `item_id`; later swaps win. Ventilation is matched by the floor it serves.

Timing per swap: `"now"` (default), `"end_of_life"`, or `"year": k` to phase it in. With a planned year, the old unit is kept running until then in the deterministic run; in the Monte Carlo futures, if it fails first, the upgrade is pulled forward to that moment and costs the emergency premium.

## Our files in `data/model/`
| File | What |
|---|---|
| `model_assumptions.csv` | Physics and people-effect parameters, plus placeholders for numbers the data team is adding (financial state, solar self-consumption, roof space). A key in the team's `assumptions.csv` always wins. |
| `option_drivers.csv` | People-effect values per option: lighting, screen and glare quality, daylight, CO2 and humidity control, seconds per drink, amenity, enclosed printers, hot-desking. Where the team's `options.csv` has the fact (`seconds_per_drink`, `humidity_control`, `enclosed_filtered`), the team's value wins. |
| `events_timing.csv` | Fallback start/end year and kind. Unused now: the team's `events.csv` has these columns, and they win. |
| `monthly.csv` | Fallback monthly heating, cooling and solar shares. Unused now: the team's `monthly.csv` replaces it. |
| `scripted_futures.json` | Futures we control for demos of play mode, e.g. `ventilation_failure`. See "Play through one future". |

## Flags
Each flag has a `type` and, except `over_budget`, the first `year` it happens:
- `over_budget`: up-front spending is above `capex_budget_chf`.
- `reserve_below_minimum`: the plan leaves less in the reserve than doing nothing would, and below `min_reserve_chf`.
- `reserve_below_minimum_without_upgrades`: even doing nothing, like-for-like replacements run the reserve below its minimum. This is context, not a warning about the plan.
- `desk_shortfall`: more staff than desks (e.g. after the new lab arrives).
- `ventilation_over_capacity`: more people on a floor than its ventilation supports.

Sick days are anchored to today's building: with today's equipment the engine shows the team's `sick_days_per_employee_year`, and upgrades change it from there (Milton 2000).

## Values from the literature
The engine takes these straight from the cited rows in the team's `assumptions.csv` (value, low and high), via `FROM_TEAM` in `engine.py`:
- Sick leave and ventilation: Milton et al. 2000. Going from about 12 to 24 L/s of outdoor air per person cuts short-term sick leave by 35% (18–48%).
- Heat and performance: Seppänen et al. 2006. About 1.4% (1.1–2.0%) of performance is lost per degree of overheating.
- 3D-printer enclosures: Azimi et al. 2017 and others. An enclosure removes 80% (67–99.95%) of the particles.

Not used directly:
- CO2 and performance (Allen et al. 2016) measures test scores, not work output. The engine keeps its own 0.3% per 100 ppm, with low = 0 because Zhang et al. 2017 found no effect of CO2 alone.
- Lighting, screen and glare quality are still our own scores in `option_drivers.csv`. The team's `flicker_free` and `cri`, the flicker study (Wilkins 1989) and the daylight sleep study (Boubekri 2014) aren't wired in yet.

## Modelling choices
- Old units are replaced like-for-like when they die (overdue ones at year 0). Upgrades are compared against that "do nothing" path, so an overdue upgrade only costs its premium.
- Ventilation air is shared over a floor's heated rooms by area. CO2 is computed per room at the busiest hour. Demand control holds rooms at ~1000 ppm if the floor has spare capacity.
- Staff outcomes are desk-weighted over offices and the makerspace, with meeting rooms weighted by `meeting_time_share`.
- `daily_attendance_share` already includes sick days, so only the change in sick days is valued.
- Couplings: appliance and body heat → heating and cooling; blinds → solar gains, glare, overheating and daylight dimming; laptops → hot-desking → desk capacity → rent for the new lab; lake-water heat pump → roof space → more solar; staff count → office and meeting-room CO2.
- The hackathon is a stress test, not a money event: constant-volume units are on a workday timer, so they are off on a weekend unless overridden; demand-controlled units react to people.

## Many possible futures (`montecarlo.py`)
```python
import montecarlo
res = montecarlo.run(d, {"Energy plan": plan_a, "Wait for failures": plan_b}, n=300, seed=2026)
res["summary"]["Energy plan"]      # P10/P50/P90 NPV, probability of paying off, flag probabilities, fan chart per year
res["compare"]["Energy plan vs Wait for failures"]   # share of futures where A beats B
res["stories"]                     # a bad, typical and good future, in words
res["samples"]                     # 20 example futures from bad to good: paths per plan, events, old-unit failures
res["summary"]["Energy plan"]["fan"]["cash_running"]   # fan without the value of equipment left at the end
pool = montecarlo.make_pool()      # worker processes: about 4x faster; the API uses one (same results as serial, tested)
montecarlo.run(d, plans, pool=pool)
engine.simulate(d, plan_a, future=res["futures"][42])  # replay any single future
```
What varies between futures (parameters in `model_assumptions.csv`, category `future`):
- **The world (aleatoric):** a yearly electricity price path (log random walk), heatwave summers and price spikes each year with a probability, whether and when the new lab arrives, and when each old unit actually fails. Failures follow a wear-out (Weibull) curve with shape `lifetime_weibull_shape` and a mean equal to the nominal `lifetime_years`, counted from the unit's age today: a unit that still runs has a spread of remaining life (a 21-year-old ventilation unit with a 25-year life has about 9 years left on average, 2 to 18 years in most futures). Each inventory row (one room, or one floor's ventilation) fails and is replaced as one batch. A surprise failure costs a `failure_premium` as an emergency replacement.
- **In play mode only:** units installed during the game wear out on the same curve, starting new (`engine.unit_life`, seeded per item and install so replaying never changes the past). The many-futures runs don't use this, so their results are unchanged.
- **What we don't know (epistemic):** the strength of each people effect, drawn once per future from its low / central / high range.

Every future is an ordinary `simulate()` run, so all accounting identities hold in each one. Every plan, and the "do nothing" path inside each run, faces the same futures, so differences come from the decision. Percentiles describe outcomes under these assumed distributions, not known real-world probabilities. A future with no randomness reproduces the deterministic run exactly (tested).

How to read the results:
- **Draws:** `montecarlo.run` defaults to `n=300` futures and seed 2026. The same seed gives the same futures, so results repeat exactly. `judge_check.py` uses 200 futures.
- **Distributions:** people-effect strengths are triangular draws between the `low` and `high` of `assumptions.csv`, around the central value. The price path is a log random walk (`price_volatility_per_year`, kept between 0.5x and 3x today's price). Heatwaves, price spikes and the new lab are yes/no draws with the yearly probabilities in `model_assumptions.csv`. Failures follow the Weibull curve above.
- **P10, P50, P90:** sort the futures from worst to best. P50 is the middle one. P10 is the value that 1 future in 10 falls below. P90 is the value that 1 in 10 beats. The band from P10 to P90 holds the middle 8 of 10 futures.
- **Not real-world odds:** "chance" and "share of futures" mean a share of our 200 or 300 simulated futures. They come from our assumed distributions, which are estimates. They are not measured probabilities of anything happening in the real building.

Note: in the deterministic run, overdue units are replaced as planned at year 0. In the futures they keep running until they fail, so upgrading now costs the full price rather than only the premium over a like-for-like replacement.

## Play through one future (`session.py`)
Instead of running 15 years at once, the player lives through one future: **your plan runs until something happens; then you can change the parts that haven't happened yet.** The past never changes. At the end the player's path is compared with doing nothing in the same future.

Time: time t is the end of year t, and t = 0 is today. A decision for year k is installed and paid at the end of year k (part of year k's cash row) and active from year k + 1.

The plan:
- Decisions can be for now or for later years. The run carries them out on schedule without stopping.
- At a pause at time t the plan has two parts: `done` (years before t, locked) and `planned` (year t or later). `decide` adds to the plan; `set_plan` replaces everything planned.
- A newer decision for an item replaces that item's planned steps from its year on, never earlier ones. So choosing an upgrade for a broken unit now cancels the upgrade you had planned for it later, and buying mid lights in year 1 then premium lights in year 5 keeps both purchases.
- Play-mode swaps are "firm" (`"firm": true`, `engine.FirmYear`): each goes in exactly in its year. Outside play mode a planned year is pulled forward when the old unit breaks first; in play mode that would rewrite the past.

It pauses at the first time after now when:
- a big system breaks (`session.STOP_GROUPS`: ventilation, heating and cooling, water heater, servers; an install of kind "failure"). Smaller equipment that wears out (lights, monitors, computers, blinds, coffee machines, printers) is replaced like-for-like without stopping, and the next stop lists it in `routine`. The pause comes before anything is bought: the reactions offer every option for the broken items (like-for-like is the default if the player just continues), each previewed, plus any change still planned for them. Failures at the same time are grouped per group: "Blinds on floors 0–3 reached end of life (470 windows)". A replacement for a broken unit goes in as an emergency, with the failure premium;
- an event is announced. An event starting in year Y with a notice period of n years (`event_notice_years_<event>` in `model_assumptions.csv`; the new lab has 1) is announced at time Y − 1 − n, so a player can buy laptops before the lab arrives;
- an event starts (time Y − 1);
- a warning appears in year T that was not there in year T − 1: not enough desks, a floor over its ventilation capacity, or the player's reserve below its minimum *and* below where doing nothing would leave it (so the player is only warned about their own spending);
- the electricity price for the next year rises more than `price_jump_pause_threshold` (20%), unless a price event starting then already explains it.

Each state has `t`, `reasons`, `plan` (`done` and `planned`), `history` (finance rows for years 1 to t only, for the player and doing nothing: never later years), `snapshot` (the building in year t; at t = 0, today's building), `reactions` and `situation` (structured facts for an LLM to narrate, all from the engine).

Futures:
- `montecarlo.load_scripted(data, name)` builds a scripted future from `scripted_futures.json` in the same shape as `draw_future`. With `"other_units": "keep_running"` only the script's failures happen; with `"nominal"` (default) other units fail at their nominal age if that is still ahead. People effects are at their central values, and new units keep their nominal lives, so the story is the same every time.
- `ventilation_failure`, the demo, stops five times: the new lab is announced (t=1), floor 0's ventilation breaks and the lab starts (t=2), not enough desks (t=3, unless the player bought laptops), a heatwave (t=4) and an energy price spike (t=5).
- A sampled future (`{"seed": 42}`) is one Monte Carlo draw: everything wears out at random, units installed during the game too, so the ventilation you bought in year 2 can break early.
- `montecarlo.draw_future_after(data, rng, future, t)` draws a future that keeps everything revealed by time t (price path, announced or started events, failures, lives of units already broken) and draws the rest as usual. The outlook uses it.

Try it:
```sh
A=localhost:8000/api/session; J='content-type: application/json'
SID=$(curl -s -X POST $A/start -H "$J" -d '{"future":"ventilation_failure"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')
curl -s -X POST $A/decide -H "$J" -d "{\"session_id\":\"$SID\",\"swaps\":[{\"group\":\"lighting\",\"option\":\"lighting_mid\",\"year\":\"now\"},{\"group\":\"ventilation\",\"option\":\"ventilation_mid\",\"floor\":0,\"year\":4}]}"
curl -s -X POST $A/next -H "$J" -d "{\"session_id\":\"$SID\"}"         # t=1: the new lab is announced
curl -s -X POST $A/decide -H "$J" -d "{\"session_id\":\"$SID\",\"swaps\":[{\"group\":\"computers\",\"option\":\"computers_upgrade\",\"year\":\"now\"}]}"
curl -s -X POST $A/next -H "$J" -d "{\"session_id\":\"$SID\"}"         # t=2: floor 0's ventilation breaks before its planned upgrade
curl -s -X POST $A/outlook -H "$J" -d "{\"session_id\":\"$SID\",\"n\":100}"
```

Tests: `python3 test_session.py` (also run by `make test`).

## Optimizer (`optimize.py`)

Finds the best plan for one goal under limits. The chat assistant writes the problem from the user's words; the search itself is a black box we can swap.

A problem:
```json
{
  "objective":   {"metric": "running_cost_chf_year"},
  "constraints": [{"metric": "upfront_cost_chf", "max": 200000},
                  {"metric": "electricity_kwh_year", "max_change_pct": -20}],
  "locked":      [{"group": "ventilation"}, {"group": "lighting", "floor": 2}],
  "allowed":     {"coffee": ["coffee_current", "coffee_mid"]},
  "per_floor":   false
}
```
- `objective`: one metric to make as small or large as possible. Each metric has a natural direction; `sense` overrides it.
- `constraints`: limits. `max_change_pct` and `min_change_pct` are relative to doing nothing (-20 = at least 20% lower).
- `locked`: things that stay as they are. `allowed`: the only options a group may use; one option forces it.
- `per_floor`: choose floor by floor instead of once per group for the whole building.
- By default a plan may not cause new warnings (over budget, reserve too low, and so on). Warnings doing nothing already has, such as too few desks once the new lab arrives, do not count against a plan. `allow_warnings: true` turns this off.
- The metrics are listed in `METRICS` and at `GET /api/metrics`. Money and energy are yearly averages over the horizon; air quality and comfort are year 1. Every metric comes from `engine.simulate`.
- Upgrades are bought now. "When it breaks" is not part of the search yet.

To plug in another search, write a function `solve(problem, slots, evaluate) -> plan`:
- `slots`: the decisions, e.g. `{"key": "lighting@2", "group": "lighting", "floor": 2, "options": [null, "lighting_budget", ...]}`. `null` means keep what is there.
- `plan`: `{slot key: option id or null}`.
- `evaluate(plan)` runs the engine and returns the metrics, the limits missed, `feasible`, `objective` (lower is better) and `score` (objective plus a large penalty for missed limits, for solvers that want one number).
- Then start the API with `OPTIMIZER=package.module:function`. Without it, the full search in `search.py` runs (see Search below); `OPTIMIZER=greedy` runs the simple greedy search instead, which changes one decision at a time while that helps.
- An optimizer outside Python can call `POST /api/evaluate` instead.

Tests: `python3 test_optimize.py` (also run by `make test`).

## API for the 3D frontend (`server.py`, `viz.py`)
```sh
cd model && uvicorn server:app --reload --port 8000
```
Try it by hand at http://localhost:8000/playground (`playground/index.html`, plain HTML with no build step). It only displays API responses and calculates nothing. Every endpoint is also listed and callable at http://localhost:8000/docs.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/assumptions` | | every assumption: value, low, high, unit, source, and a label (`fact`, `research`, `guess`, `result`) |
| `GET /api/catalog` | | rooms, items (with `serves_floor`), options per group (price, lifetime, description), events |
| `POST /api/simulate` | `{scenario, events, overrides, year}` | `finance` (NPVs, payback, waterfall breakdown, flags, per-year series) and `snapshot` / `snapshot_baseline` for that year |
| `POST /api/preview` | `{scenario, swap, events, overrides}` | what adding one swap would change: extra capex, NPV deltas, kWh, performance, comfort, meeting-room CO2, new flags |
| `POST /api/stress_test` | `{scenario}` | hackathon weekend hour by hour on the ground floor |
| `POST /api/tornado` | `{scenario, events, overrides}` | top 10 assumptions by swing in economic NPV |
| `POST /api/bands` | `{scenario, events, overrides}` | economic NPV with weak / central / strong people effects |
| `POST /api/futures` | `{scenarios: {name: scenario}, n, seed, events, overrides}` | Monte Carlo: P10/P50/P90, probabilities, fan chart per year, A-vs-B, three futures in words. `events` are on in every future; `overrides` are fixed in every future |
| `POST /api/breakeven` | `{scenario, events, overrides, param}` | the value of `param` (default electricity price) where cash and economic NPV are zero, and whether the plan pays off above or below it |
| `GET /api/session/futures` | | the scripted futures you can play |
| `POST /api/session/start` | `{future}`: a scripted name, or `{"seed": 42}` for a sampled one | `session_id` and the opening state (see "Play through one future") |
| `POST /api/session/next` | `{session_id}` | the state at the next pause, or the end summary (`ended: true`, `result`) |
| `POST /api/session/decide` | `{session_id, swaps}` | adds to the plan (now or later years) and returns the updated state at the same pause; 400 if a swap's year is before now. `"year": "now"` means the current pause |
| `POST /api/session/plan` | `{session_id, plan}` | replaces everything not done yet with `plan`; done decisions stay |
| `POST /api/session/preview` | `{session_id, swap}` | what a swap (or a list) would change in this future with the decisions so far |
| `POST /api/session/outlook` | `{session_id, n, seed}` | a fresh forecast from now: fan of the gain vs doing nothing from year t+1, P10/P50/P90 NPVs, chance of beating doing nothing |
| `GET /api/session/{id}` | | the current state |

| `POST /api/search` | `{goal, metric, target, budget, years, constraints, scope, events, ...}` | the search's best set of upgrades for a goal: `status`, `message`, `scenario`, `changes`, `metrics`, and the `/api/simulate` output as `engine`; see [Search](#search-searchpy) |
| `POST /api/pareto` | `{x_metric, y_metric, constraints, scope, events, max_points, ...}` | the plans no other plan beats on both cost and saving, sorted by cost, with a balanced choice `knee_index` |
| `GET /api/search/options?granularity=floor` | | metrics (unit, which way is better, description) and zones (the decisions), for menus |
| `POST /api/chat` | `{messages, scenario, confirm}` | the assistant's answer, the scenario it recommends, a proposed optimization to confirm (`proposal`), and after a confirmed run the result (`optimization`); see [chat/README.md](../chat/README.md) |
| `GET /api/metrics` | | goals and limits an optimization problem can use |
| `POST /api/optimize` | `{problem}` | the best plan for a goal under limits, next to doing nothing; see Optimizer below |
| `POST /api/evaluate` | `{problem, scenario}` | one scenario scored against a problem: metrics, limits missed, objective, score |

A snapshot is keyed by the team's ids, which are also the mesh names:
- `items[item_id]`: `option_id`, `kwh_year`, `kw_avg`, `kw_on` (drive wire thickness or glow from these)
- `rooms[room_id]`: `kwh_year`, `kw_hourly` (24 values, approximate typical workday shape), `items`, and for occupied heated rooms `co2_ppm`, `people_peak`, `lps_per_person`, `overheat_degc`
- `floors[floor]`: ventilation `capacity_people`, `population_peak`, `over_capacity`
- `building`: totals, kWh by group, costs, staff outcomes (performance, sick days, comfort, CO2 by room kind), desk capacity

`finance.kind` says how to style each kind of number: `calculated` (data and physics), `estimate` (depends on uncertain people effects), `index` (a score, never money). Plant-room and roof equipment (ventilation, heat pumps, solar) sits in `BC_991.0` / `BC_ROOF`; use `serves_floor` to draw its wires to the floor it serves.

## Search (`search.py`)
A full search over combinations of upgrades, with goal presets and the cost-vs-savings frontier. Every number comes from the engine.

A zone is one decision: which option one group has in one place. `lighting@2` is the lighting on floor 2. By default a group gets one zone per floor it serves (`granularity: "floor"`); `"building"` gives one zone per group. All changes happen now.

Goals (`POST /api/search`):
- `min_cost_for_target`: the cheapest plan whose `metric` reaches `target`, e.g. 10% off the energy bill. `budget` is optional.
- `max_savings`: the plan with the highest `metric` that costs at most `budget` up front. No budget means no limit. Ties go to the cheaper plan.
- `min_total_cost`: the lowest purchase plus running cost over `years` (`basis: "chf"`), or the least electricity used (`basis: "kwh"`). `budget` is optional.
- `custom`: any `objective` (`{"metric", "sense"}`) with any `constraints` (`[{"metric", "min" | "max"}]`).

The frontier (`POST /api/pareto`) shows what each extra franc buys. It returns the plans that no other plan beats on both axes. By default x is the up-front cost (lower is better) and y the yearly running-cost saving (higher is better). `knee_index` is the balanced choice: past it, savings grow slowly for the money. `max_points` (default 15) thins the curve: it keeps both ends and the knee, and spaces the rest evenly along the curve. The search tries a fixed number of plans, so the same request always gives the same answer. It takes about 4 seconds, and under 1 second when the same settings were used before. `time_limit` is only a safety stop. When the server starts, it works out the default curve in the background, so the first request takes about 1 second (set `TWIN_WARMUP=0` to skip this).

How good is the answer? The full building has about 10^20 possible plans, too many to try them all. On small problems the search finds the same best plan as trying every combination (checked in `test_search.py`). On the full building it matched or beat a much longer random search. A goal takes 1 to 3 seconds.

Metrics. Savings are versus doing nothing, in year 1. Each saving also has a `_pct` version: the share of doing nothing's value. `GET /api/search/options` lists them all with units.
- `upfront_cost_chf`: what the changes cost to buy and install now, after the solar subsidy.
- `net_upfront_cost_chf`: the extra cost over like-for-like replacements that are due now anyway.
- `operating_cost_saving_chf_year`: all running costs saved: energy bill, maintenance, supplies and extra rent.
- `energy_cost_saving_chf_year`: the electricity bill saved.
- `energy_saving_kwh_year`: less electricity used.
- `grid_energy_saving_kwh_year`: less electricity bought from the grid (counts our own solar).
- `total_cost_chf`, `total_cost_saving_chf`, `total_energy_kwh`, `total_energy_saving_kwh`: totals over `horizon_years` (default 15). `discounted` counts future francs in today's money. `include_residual` subtracts what the equipment is still worth at the end.
- `npv_cash_chf`, `npv_economic_chf`, `payback_years`, and people and air in year 1: `comfort_score`, `office_co2_ppm`, `meeting_co2_ppm`, `sick_days`.

Scope sets hard limits on what may change. Every result respects it, even a best-effort one. A selector picks zones: `{"group", "floor", "option"}`, where `floor` and `option` are optional and may be lists.
- `allowed`: only these may change (and only to the given options, if any).
- `locked`: these stay as they are.
- `required`: these must change (to the given option, if any).
- `excluded_options`: never install these.

Unknown names, a scope that contradicts itself, or a `floor` with `granularity: "building"` give HTTP 400 with a plain message.

Status:
- `ok`: the plan meets every constraint.
- `best_effort`: no plan meets them all, e.g. the target is out of reach. The result is the closest plan, and `message` says what is reachable.

The result also has `scenario` (swaps ready for `/api/simulate`), `changes` (per zone: from, to, units, cost, item ids), `metrics` and `baseline` (doing nothing). `engine` is the `/api/simulate` output for the plan; send `include_engine_output: false` to skip it.

Examples:
```
POST /api/search  {"goal": "min_cost_for_target", "metric": "energy_cost_saving_pct", "target": 10,
                     "scope": {"locked": [{"group": "servers"}]}}
POST /api/pareto    {"y_metric": "energy_saving_kwh_year", "constraints": [{"metric": "upfront_cost_chf", "max": 300000}]}
GET  /api/search/options?granularity=building
```
