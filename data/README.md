# BC building dataset

A digital twin of EPFL building BC, where LauzHack 2026 takes place.

Room outlines are real (from plan.epfl.ch), and so are the Lausanne weather and solar data (Open-Meteo, PVGIS). Room uses, people, equipment and building systems are made up but realistic.

All CSVs, `geometry.json`, `building_summary.md` and `floorplans.png` are generated:

```sh
python3 data/generate.py           # from data/raw/
python3 data/generate.py --fetch   # re-download EPFL plan data first
```

Change numbers in `generate.py`, not in the outputs.

The `source` column uses four values:
- `EPFL plan`: real data from plan.epfl.ch
- `estimate`: a guess at a real-world number, to firm up later
- `made up`: a design choice for our fictional setup
- `derived`: calculated from other numbers

## The building
- **−1, basement:** car park, plant room (heat pump buffer tanks, pumps, air handling units for floors −1 to 1, water heater) and server room.
- **0, ground floor:** café in the glass-roofed atrium, 4 classrooms, 4 computer rooms, a few offices.
- **1–3:** identical floors of offices around the atrium, with a kitchenette, meeting rooms and lounge zones on each.
- **4, top floor:** set back under the roof, with a lecture room, meeting rooms and a makerspace with 3D printers.
- **Roof:** heat pump outdoor units, air handling units for floors 2–4, and room for solar panels.

Key figures: 377 rooms, about 14,100 m² of net floor area, 268 desks (241 staff) and 407 teaching seats.

Per-floor numbers are in `building_summary.md`, and room types are colour-coded in `floorplans.png`.

## For the 3D model (Casper)
- **`geometry.json`** has every room outline in metres, plus floors (elevation, height), the footprint and the roof height.
  - Origin is the south-west corner of the footprint. x points east, y north, z up. In Three.js use `[x, z, -y]`.
  - `polygons` is a list of `[outer ring, hole, ...]`. The rings around the atrium have holes.
  - Floor height is 4.0 m, an estimate you can change.
- **Size:** the footprint is about 47 × 65 m with 5 levels above ground, roughly 20 m plus the roof.
- **Mesh names:** use `room_id` for rooms (`BC_117`) and `item_id` from `inventory.csv` for equipment (`BC_117:monitors`), so a click maps straight to data.
- **Placement:** `rooms.csv` has room centroids, and `inventory.csv` lists what sits in each room.

## For the model (Oscar)
| File | One row per | Contents |
|---|---|---|
| `rooms.csv` | room | Type, area, seats (desks for offices), heated/cooled, floor |
| `room_types.csv` | room type | Seat density, whether seats count toward the population, schedule profile, lighting hours, fixtures per m² |
| `options.csv` | product option | Per-unit specs: power, hours, efficiency, price, lifetime, maintenance, physical facts, description |
| `inventory.csv` | installed item | Which option is installed where, units, age, what it serves |
| `schedule.csv` | hour of day | Share of seats occupied, by profile (office, meeting, teaching, common, weekend, hackathon) |
| `monthly.csv` | month | Share of annual heating demand, cooling demand and solar generation |
| `assumptions.csv` | parameter | Building, financial, solar and Swiss economic numbers, people-effect values from the literature, all with `low`/`high` |
| `events.csv` | parameter change | Energy price spike, new lab, heatwave (`annual`), hackathon (`stress_test`) |

A scenario is the inventory with some `option_id`s swapped: one item, a whole floor or a whole group. Units stay the same; the per-unit specs change.

### People, money and time
- **Population:** count people only in room types with `counts_toward_population = 1` (office, makerspace, seminar, computer_lab). Staff also use meeting rooms, kitchens, lounges and the café, so seats there would count them twice.
- **Offices:** `office_weekday` is the share of desks occupied. Its peak (0.63) = `daily_attendance_share` (0.7) × staff per desk (0.9).
- **Attendance:** `daily_attendance_share` already includes today's sick days.
- **Financial state:** EPFL is the owner-occupier. It pays the energy bill and the salaries, and pays no rent (`rent_chf_m2_year` is only an opportunity cost). All prices are real 2026 CHF.
  - Reserve ledger per year: `reserve += other_operating_cf_chf_year − energy − maintenance − consumables − capex + subsidies + solar sales`.
  - Starts at `opening_reserve_chf` and must stay above `min_reserve_chf`. Up-front spending is capped by `capex_budget_chf`.
  - My rough check: a normal year adds about +65k CHF to the reserve. The price-spike year takes about −110k. Spending the full capex budget leaves the reserve exactly at its floor.
- **Events:** `start_year`/`end_year` count from year 1; an empty `end_year` means until the end of the horizon. `months` (e.g. `6;7;8`) limits an event to those months, using the shares in `monthly.csv`. The `stress_test` (hackathon) is an hour-by-hour check, not a money event.
- **Solar:**
  - `pv_self_consumption_share` of the output is worth the electricity price; the rest is sold at the feed-in price.
  - The roof fits `pv_max_kwp_with_roof_heat_pumps` (today, the inventory's 250 kWp), or `pv_max_kwp_without_roof_heat_pumps` if the lake-water heat pump is chosen.
- **People effects:** the literature rows in `assumptions.csv` have the paper in `source`. Keep your mapping from product facts to effects in a separate file; `generate.py` doesn't touch it.

### Reading options.csv
- **Units:** `unit` says what one unit is: monitor, fixture, window, AHU module (the size of 1000 m³/h of today's capacity), kW of heating capacity, rack, machine, system or kWp. Power, prices and maintenance are per unit; multiply by `units` from `inventory.csv`.
- **Hours:** `hours_on_per_day` applies on `operating_days`, which is `workdays` (workdays_per_year) or `all` (365). Standby covers the rest of the 8,760 hours.
- **Lighting hours:** these come from `room_types.csv` (`lighting_hours_per_workday`, `lighting_days`).
- **Controls:** `control_savings_pct` cuts on-time for lighting sensors, or average airflow for ventilation CO₂ control.
- **Coffee and hot water:** `energy_per_use_wh × uses_per_person_day` counts per person present and is shared by all machines in the group.
- **Heating and cooling:** electricity = demand from `assumptions.csv` × heated (or cooled) area ÷ `heating_efficiency` (or `cooling_efficiency`).
  - The heating demand assumes today's 50% ventilation heat recovery; `heat_recovery_pct` on ventilation options changes it.
- **Servers:** IT power runs 24/7, plus cooling = IT energy ÷ `cooling_efficiency`.
- **Solar:** generation is `generation_kwh_per_unit_year` per kWp. The current option (`solar_pv_none`) generates nothing.
- **Ventilation capacity in people:** units × `airflow_m3h` ÷ `fresh_air_m3h_per_person`. New AHUs are sized larger, so they raise capacity.
- **Current rows:** the purchase price is a like-for-like replacement. Compare `age_years` in the inventory with `lifetime_years` to see how soon replacement is due anyway. Ages vary by floor: some items are past their lifetime, others have 2–11 years left.
- **Physical facts** (numbers for the people effects):
  - `flicker_free` (0/1, lighting and monitors) and `cri` (lighting)
  - `filter_pm1_removal_pct` and `humidity_control` (0/1, ventilation)
  - `seconds_per_drink` (coffee)
  - `enclosed_filtered` (0/1, 3D printers)

```
on_h  = hours_on_per_day × (workdays_per_year or 365)
kWh   = units × (power_on_w × on_h × (1 − control_savings_pct/100) + standby_w × (8760 − on_h)) / 1000
      + energy_per_use_wh × uses_per_person_day × people_present × workdays_per_year / 1000   (once per group)
```

**Rough baseline check** using these formulas:
- About 1.1 GWh of electricity a year (78 kWh/m²), roughly CHF 220k.
- Largest loads: lighting 24%, servers 24%, heating 19%, ventilation 11%.
- Ground-floor ventilation supports about 250 people at once.
