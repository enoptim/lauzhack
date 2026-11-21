# BC twin engine

Runs on the data team's BC dataset (unchanged) plus our own files (`model/data/model/`).

In the repo this folder sits at `model/`, next to the team's `data/`; the engine finds `data/` automatically
(override with `TWIN_TEAM_DATA=/path/to/data`). Standard library only; the API needs `pip install -r requirements.txt`.

```sh
python test_engine.py        # 41 validation tests
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
engine.simulate(d, plan_a, future=res["futures"][42])  # replay any single future
```
What varies between futures (parameters in `model_assumptions.csv`, category `future`):
- **The world (aleatoric):** a yearly electricity price path (log random walk), heatwave summers and price spikes each year with a probability, whether and when the new lab arrives, and when each old unit actually fails (lifetime spread; overdue units fail with a yearly hazard and cost a `failure_premium` as an emergency replacement).
- **What we don't know (epistemic):** the strength of each people effect, drawn once per future from its low / central / high range.

Every future is an ordinary `simulate()` run, so all accounting identities hold in each one. Every plan, and the "do nothing" path inside each run, faces the same futures, so differences come from the decision. Percentiles describe outcomes under these assumed distributions, not known real-world probabilities. A future with no randomness reproduces the deterministic run exactly (tested).

Note: in the deterministic run, overdue units are replaced as planned at year 0. In the futures they keep running until they fail, so upgrading now costs the full price rather than only the premium over a like-for-like replacement.

## Play through one future (`session.py`)
Instead of running 15 years at once, the player lives through one future. The run pauses whenever something happens, the player can react, and the past never changes. At the end the player's path is compared with doing nothing in the same future.

Time: time t is the end of year t, and t = 0 is today. A decision at a pause at time t has `"year": t`. It is installed and paid at the end of year t, so it is part of year t's cash row, and it is active from year t + 1. Rows for earlier years never change.

A session holds the future, the decisions so far and the current pause time. Every state comes from `engine.simulate` with those decisions in that future; the session only decides when to pause and what to show.

It pauses at the first time after now when:
- a unit breaks (an install of kind "failure"). Failures at the same time are grouped per group: "Blinds on floors 0–3 reached end of life (470 windows)";
- an event is announced. An event starting in year Y with a notice period of n years (`event_notice_years_<event>` in `model_assumptions.csv`; the new lab has 1) is announced at time Y − 1 − n, so a player can buy laptops before the lab arrives;
- an event starts (time Y − 1);
- a warning appears in year T that was not there in year T − 1: not enough desks, a floor over its ventilation capacity, or the player's reserve below its minimum;
- the electricity price for the next year rises more than `price_jump_pause_threshold` (20%).

Each state has `t`, `reasons`, `history` (finance rows for years 1 to t only, for the player and doing nothing: never later years), `snapshot` (the building in year t; at t = 0, today's building), `reactions` (for a failure: every option for the broken items, previewed at this time; for other reasons: groups worth looking at) and `situation` (structured facts for an LLM to narrate, all from the engine).

Futures:
- `montecarlo.load_scripted(data, name)` builds a scripted future from `scripted_futures.json` in the same shape as `draw_future`. Units the script doesn't mention fail at their nominal age if that is still ahead; units already past their life keep running, so the story isn't drowned in failures at time 0. People effects are at their central values.
- `montecarlo.draw_future_after(data, rng, future, t)` draws a future that keeps everything revealed by time t (price path, announced or started events, failures) and draws the rest as usual. The outlook uses it.

An upgrade planned for the year its old unit breaks goes in as an emergency, with the failure premium, just like a like-for-like replacement at that moment.

Try it:
```sh
A=localhost:8000/api/session; J='content-type: application/json'
SID=$(curl -s -X POST $A/start -H "$J" -d '{"future":"ventilation_failure"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')
curl -s -X POST $A/next -H "$J" -d "{\"session_id\":\"$SID\"}"         # t=1: computers fail, the new lab is announced
curl -s -X POST $A/decide -H "$J" -d "{\"session_id\":\"$SID\",\"swaps\":[{\"group\":\"computers\",\"option\":\"computers_upgrade\",\"year\":\"now\"}]}"
curl -s -X POST $A/next -H "$J" -d "{\"session_id\":\"$SID\"}"         # t=2: floor 0's ventilation breaks
curl -s -X POST $A/outlook -H "$J" -d "{\"session_id\":\"$SID\",\"n\":100}"
```

Tests: `python3 test_session.py` (also run by `make test`).

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
| `POST /api/session/decide` | `{session_id, swaps}` | the updated state at the same pause; 400 if a swap's year is before now. `"year": "now"` means the current pause |
| `POST /api/session/preview` | `{session_id, swap}` | what a swap (or a list) would change in this future with the decisions so far |
| `POST /api/session/outlook` | `{session_id, n, seed}` | a fresh forecast from now: fan of the gain vs doing nothing from year t+1, P10/P50/P90 NPVs, chance of beating doing nothing |
| `GET /api/session/{id}` | | the current state |

A snapshot is keyed by the team's ids, which are also the mesh names:
- `items[item_id]`: `option_id`, `kwh_year`, `kw_avg`, `kw_on` (drive wire thickness or glow from these)
- `rooms[room_id]`: `kwh_year`, `kw_hourly` (24 values, approximate typical workday shape), `items`, and for occupied heated rooms `co2_ppm`, `people_peak`, `lps_per_person`, `overheat_degc`
- `floors[floor]`: ventilation `capacity_people`, `population_peak`, `over_capacity`
- `building`: totals, kWh by group, costs, staff outcomes (performance, sick days, comfort, CO2 by room kind), desk capacity

`finance.kind` says how to style each kind of number: `calculated` (data and physics), `estimate` (depends on uncertain people effects), `index` (a score, never money). Plant-room and roof equipment (ventilation, heat pumps, solar) sits in `BC_991.0` / `BC_ROOF`; use `serves_floor` to draw its wires to the floor it serves.
