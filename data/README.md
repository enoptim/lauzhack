# BC building dataset

A digital twin of EPFL building BC, where LauzHack 2026 takes place.

Room outlines are real (from plan.epfl.ch). Room uses, people, equipment and building systems are made up but realistic.

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
| `room_types.csv` | room type | Seat density, schedule profile, lighting hours, light fixtures per m² |
| `options.csv` | product option | Per-unit specs: power, hours, efficiency, price, lifetime, maintenance, description |
| `inventory.csv` | installed item | Which option is installed where, units, age, what it serves |
| `schedule.csv` | hour of day | Share of seats occupied, by profile (office, meeting, teaching, common, weekend, hackathon) |
| `assumptions.csv` | parameter | Building and Swiss economic numbers with `low`/`high` |
| `events.csv` | parameter change | Hackathon weekend, new lab, energy price spike, heatwave |

A scenario is the inventory with some `option_id`s swapped: one item, a whole floor or a whole group. Units stay the same; the per-unit specs change.

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
- **Current rows:** the purchase price is a like-for-like replacement. Compare `age_years` in the inventory with `lifetime_years` to see how soon replacement is due anyway.

```
on_h  = hours_on_per_day × (workdays_per_year or 365)
kWh   = units × (power_on_w × on_h × (1 − control_savings_pct/100) + standby_w × (8760 − on_h)) / 1000
      + energy_per_use_wh × uses_per_person_day × people_present × workdays_per_year / 1000   (once per group)
```

**Rough baseline check** using these formulas:
- About 1.1 GWh of electricity a year (78 kWh/m²), roughly CHF 220k.
- Largest loads: lighting 24%, servers 24%, heating 19%, ventilation 11%.
- Ground-floor ventilation supports about 250 people at once.
