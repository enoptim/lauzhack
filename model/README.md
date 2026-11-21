# BC twin engine

Runs on the data team's BC dataset (unchanged) plus our own files (`model/data/model/`).

In the repo this folder sits at `model/`, next to the team's `data/`; the engine finds `data/` automatically
(override with `TWIN_TEAM_DATA=/path/to/data`). Standard library only; the API needs `pip install -r requirements.txt`.

```sh
python test_engine.py        # 41 validation tests
python test_optimize.py      # optimizer: brute-force checks on small problems
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
engine.simulate(d, plan_a, future=res["futures"][42])  # replay any single future
```
What varies between futures (parameters in `model_assumptions.csv`, category `future`):
- **The world (aleatoric):** a yearly electricity price path (log random walk), heatwave summers and price spikes each year with a probability, whether and when the new lab arrives, and when each old unit actually fails (lifetime spread; overdue units fail with a yearly hazard and cost a `failure_premium` as an emergency replacement).
- **What we don't know (epistemic):** the strength of each people effect, drawn once per future from its low / central / high range.

Every future is an ordinary `simulate()` run, so all accounting identities hold in each one. Every plan, and the "do nothing" path inside each run, faces the same futures, so differences come from the decision. Percentiles describe outcomes under these assumed distributions, not known real-world probabilities. A future with no randomness reproduces the deterministic run exactly (tested).

Note: in the deterministic run, overdue units are replaced as planned at year 0. In the futures they keep running until they fail, so upgrading now costs the full price rather than only the premium over a like-for-like replacement.

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
| `POST /api/optimize` | `{goal, metric, target, budget, years, constraints, scope, events, ...}` | the best set of upgrades for a goal: `status`, `message`, `scenario`, `changes`, `metrics`, and the `/api/simulate` output as `engine`; see [Optimizer](#optimizer-optimizepy) |
| `POST /api/pareto` | `{x_metric, y_metric, constraints, scope, events, max_points, ...}` | the plans no other plan beats on both cost and saving, sorted by cost, with a balanced choice `knee_index` |
| `GET /api/optimize/options?granularity=floor` | | metrics (unit, which way is better, description) and zones (the decisions), for menus |
| `POST /api/chat` | `{messages, scenario}` | the assistant's answer, the scenario it recommends and an optional chart; see [chat/README.md](../chat/README.md) |

A snapshot is keyed by the team's ids, which are also the mesh names:
- `items[item_id]`: `option_id`, `kwh_year`, `kw_avg`, `kw_on` (drive wire thickness or glow from these)
- `rooms[room_id]`: `kwh_year`, `kw_hourly` (24 values, approximate typical workday shape), `items`, and for occupied heated rooms `co2_ppm`, `people_peak`, `lps_per_person`, `overheat_degc`
- `floors[floor]`: ventilation `capacity_people`, `population_peak`, `over_capacity`
- `building`: totals, kWh by group, costs, staff outcomes (performance, sick days, comfort, CO2 by room kind), desk capacity

`finance.kind` says how to style each kind of number: `calculated` (data and physics), `estimate` (depends on uncertain people effects), `index` (a score, never money). Plant-room and roof equipment (ventilation, heat pumps, solar) sits in `BC_991.0` / `BC_ROOF`; use `serves_floor` to draw its wires to the floor it serves.

## Optimizer (`optimize.py`)
It searches combinations of upgrades and returns the best plan for a goal. Every number comes from the engine.

A zone is one decision: which option one group has in one place. `lighting@2` is the lighting on floor 2. By default a group gets one zone per floor it serves (`granularity: "floor"`); `"building"` gives one zone per group. All changes happen now.

Goals (`POST /api/optimize`):
- `min_cost_for_target`: the cheapest plan whose `metric` reaches `target`, e.g. 10% off the energy bill. `budget` is optional.
- `max_savings`: the plan with the highest `metric` that costs at most `budget` up front. No budget means no limit. Ties go to the cheaper plan.
- `min_total_cost`: the lowest purchase plus running cost over `years` (`basis: "chf"`), or the least electricity used (`basis: "kwh"`). `budget` is optional.
- `custom`: any `objective` (`{"metric", "sense"}`) with any `constraints` (`[{"metric", "min" | "max"}]`).

The frontier (`POST /api/pareto`) shows what each extra franc buys. It returns the plans that no other plan beats on both axes. By default x is the up-front cost (lower is better) and y the yearly running-cost saving (higher is better). `knee_index` is the balanced choice: past it, savings grow slowly for the money. `max_points` (default 15) thins the curve: it keeps both ends and the knee, and spaces the rest evenly along the curve. The search stops after `time_limit` seconds (default 10).

How good is the answer? The full building has about 10^20 possible plans, too many to try them all. On small problems the search finds the same best plan as trying every combination (checked in `test_optimize.py`). On the full building it matched a much longer random search. A goal takes under 3 seconds.

Metrics. Savings are versus doing nothing, in year 1. Each saving also has a `_pct` version: the share of doing nothing's value. `GET /api/optimize/options` lists them all with units.
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
POST /api/optimize  {"goal": "min_cost_for_target", "metric": "energy_cost_saving_pct", "target": 10,
                     "scope": {"locked": [{"group": "servers"}]}}
POST /api/pareto    {"y_metric": "energy_saving_kwh_year", "constraints": [{"metric": "upfront_cost_chf", "max": 300000}]}
GET  /api/optimize/options?granularity=building
```
