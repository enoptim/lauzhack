"""Turn engine results into JSON for the 3D view and side panels.

Everything is keyed by the data team's ids: room_id (BC_117) and item_id (BC_117:monitors),
which are also the mesh names in the 3D model, so a click maps straight to data.

Each number carries a kind in KIND, so the UI can style it consistently:
  calculated  follows from the data and physics (energy, CHF of energy, capex)
  estimate    depends on uncertain people-effect assumptions (productivity, sick days, time)
  index       a 0-100 or 0-1 score, never money (comfort, quality scores)
"""
import math
import re

import engine

KIND = {
    "kwh": "calculated", "kw": "calculated", "co2_ppm": "calculated", "capacity": "calculated",
    "energy_chf": "calculated", "capex_chf": "calculated", "npv_cash": "calculated",
    "productivity_chf": "estimate", "sick_days_chf": "estimate", "time_saved_chf": "estimate",
    "npv_economic": "estimate", "perf_change": "estimate", "sick_days": "estimate",
    "comfort_score": "index", "lighting_quality": "index", "screen_quality": "index", "glare_control": "index",
}


def clean(x):
    """JSON-safe: inf/nan -> None, tuples -> lists, rounded floats."""
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, float):
        return None if (math.isinf(x) or math.isnan(x)) else round(x, 4)
    return x


# ------------------------------------------------------------------ static catalog
def equipment_value(data):
    """What today's equipment is worth: replacement price, less the share of its life already used."""
    total = 0.0
    for i in data["items"]:
        o = data["options"][i["option"]]
        life = engine._life(o)
        if life == engine.INF or i["age"] is None:
            continue
        price = (o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0)
        total += i["units"] * price * max(0.0, 1 - i["age"] / life)
    return total


def catalog(data):
    """Everything the UI needs to build menus and place things."""
    groups = {}
    for o in data["options"].values():
        groups.setdefault(o["group"], []).append({
            "option_id": o["option_id"], "name": o["name"], "tier": o["tier"], "unit": o["unit"],
            "price_chf_per_unit": (o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0),
            "lifetime_years": o["lifetime_years"], "power_on_w": o["power_on_w"],
            "description": o["description"], "source": o["source"]})
    return clean({
        "groups": groups,
        "rooms": [{"room_id": r["id"], "floor": r["floor"], "type": r["type"], "area_m2": r["area"], "seats": r["seats"]}
                  for r in data["rooms"].values()],
        "items": [{"item_id": i["id"], "room_id": i["room"], "group": i["group"], "option_id": i["option"],
                   "units": i["units"], "age_years": i["age"], "serves": i["serves"],
                   "serves_floor": engine.served_floor(i)} for i in data["items"]],
        "events": [{"event_id": e["id"], "name": e["name"], "description": e["description"], "kind": e["kind"],
                    "start_year": e["start_year"], "end_year": e["end_year"]} for e in data["events"].values()],
        "horizon_years": data["params"]["horizon_years"],
        "equipment_value_chf": equipment_value(data),
        "limits": {k: data["params"][k] for k in ("capex_budget_chf", "opening_reserve_chf", "min_reserve_chf")},
    })


def _label(source):
    """Plain honesty label for an assumption: fact (measured or from EPFL plans), research (a cited study),
    result (derived from other numbers) or guess (our estimate or design choice)."""
    s = (source or "").lower()
    if "epfl plan" in s and not s.startswith("derived"):
        return "fact"
    if s.startswith("derived"):
        return "result"
    if re.search(r"(19|20)\d\d", s) and "to verify" not in s:
        return "research"
    return "guess"


def assumptions(data):
    """Every assumption the engine uses: value, range, unit, source and a plain honesty label."""
    return clean([{"key": k, "value": data["params"][k], "low": data["ranges"][k][0], "high": data["ranges"][k][1],
                   "unit": m["unit"], "category": m["category"], "source": m["source"],
                   "description": m["description"], "label": _label(m["source"])}
                  for k, m in data["param_meta"].items()])


# ------------------------------------------------------------------ per-item / per-room snapshot
def _item_hourly(data, item, option_id, kwh_year):
    """Approximate typical-workday 24 h load (kW): standby all day, the rest spread over the room's busy hours."""
    o = data["options"][option_id]
    room = data["rooms"].get(item["room"])
    standby_kw = item["units"] * (o["standby_w"] or 0) / 1000
    shape = data["schedule"][room["profile"]] if room and room["profile"] else None
    if not shape or sum(shape) == 0 or item["group"] in ("servers", "heating_cooling", "solar_pv"):
        return [kwh_year / 8760] * 24
    wd = data["params"]["workdays_per_year"]
    active_day = max(0.0, kwh_year - standby_kw * 8760) / wd
    tot = sum(shape)
    return [standby_kw + active_day * v / tot for v in shape]


def snapshot(data, result, year=1, which="state"):
    """State of the building in one year: per item, per room, per floor, building totals.
    which = "state" (scenario) or "state_baseline" (do nothing). Requires simulate(..., detail_years=(year,))."""
    row = result["years"][year - 1]
    st = row[which]
    sel = row["selection"] if which == "state" else row["selection_baseline"]
    e, env, out = st["energy"], st["environment"], st["outcomes"]
    items, rooms = {}, {}
    for i in data["items"]:
        kwh = e["by_item"].get(i["id"], 0.0)
        opt = sel[i["id"]]
        o = data["options"][opt]
        hourly = _item_hourly(data, i, opt, kwh)
        items[i["id"]] = {"room_id": i["room"], "group": i["group"], "option_id": opt, "units": i["units"],
                          "kwh_year": kwh, "kw_avg": kwh / 8760,
                          "kw_on": i["units"] * (o["power_on_w"] or 0) / 1000}
        r = rooms.setdefault(i["room"], {"kwh_year": 0.0, "kw_hourly": [0.0] * 24, "items": []})
        r["kwh_year"] += kwh
        r["kw_hourly"] = [a + b for a, b in zip(r["kw_hourly"], hourly)]
        r["items"].append(i["id"])
    for rid, v in env["rooms"].items():
        rooms.setdefault(rid, {"kwh_year": 0.0, "kw_hourly": [0.0] * 24, "items": []}).update(v)
    floors = {f: {"capacity_people": c, "population_peak": env["floor_population_peak"].get(f, 0.0),
                  "over_capacity": env["floor_population_peak"].get(f, 0.0) > c}
              for f, c in env["floor_capacity_people"].items()}
    building = {"kwh_year": e["total_kwh"], "grid_kwh_year": e["grid_kwh"], "pv_kwh_year": e["pv_kwh"],
                "kwh_by_group": e["by_group"], "costs_chf": st["costs"], "outcomes": out,
                "desk_capacity": st["desk_capacity"], "desk_shortfall": st["desk_shortfall"], "staff": row["staff"]}
    return clean({"year": year, "items": items, "rooms": rooms, "floors": floors, "building": building})


# ------------------------------------------------------------------ money over time
def finance(result):
    years = [{k: y[k] for k in ("year", "cash_cf", "economic_cf", "cumulative_cash_cf", "cumulative_economic_cf",
                                  "cash_closing", "cash_closing_baseline", "capex", "capex_baseline",
                                  "operating_cost", "operating_cost_baseline", "kwh", "kwh_baseline",
                                  "price_chf_kwh", "staff", "desk_capacity", "residual_value", "book_value", "net_worth")}
             | {"people_value": y["people_value"], "savings": y["savings"],
                "comfort_score": y["outcomes"]["comfort_score"], "comfort_score_baseline": y["outcomes_baseline"]["comfort_score"],
                "meeting_co2_ppm": y["outcomes"]["meeting_co2_ppm"], "meeting_co2_ppm_baseline": y["outcomes_baseline"]["meeting_co2_ppm"]}
             for y in result["years"]]
    return clean({"npv_cash": result["npv_cash"], "npv_economic": result["npv_economic"],
                  "payback_cash": result["payback_cash"], "payback_economic": result["payback_economic"],
                  "capex_year0": result["capex_year0"], "purchase_year0": result["purchase_year0"],
                  "paid_year0": result["paid_year0"], "npv_breakdown": result["npv_breakdown"],
                  "flags": result["flags"], "years": years, "kind": KIND})


def run(data, scenario=None, events=(), overrides=None, year=1):
    """One call for the UI: finance over time plus the scenario and do-nothing snapshots for one year."""
    res = engine.simulate(data, scenario, events, overrides, detail_years=(year,))
    return {"finance": finance(res), "snapshot": snapshot(data, res, year, "state"),
            "snapshot_baseline": snapshot(data, res, year, "state_baseline")}


def preview(data, scenario, swap, events=(), overrides=None):
    """What adding one swap to the current scenario would change, before the user clicks it."""
    a = engine.simulate(data, scenario, events, overrides)
    b = engine.simulate(data, list(scenario or []) + [swap], events, overrides)
    ya, yb = a["years"][0], b["years"][0]
    return clean({
        "swap": swap,
        "extra_capex_year0": b["capex_year0"] - a["capex_year0"],
        "delta_npv_cash": b["npv_cash"] - a["npv_cash"],
        "delta_npv_economic": b["npv_economic"] - a["npv_economic"],
        "delta_kwh_year1": yb["kwh"] - ya["kwh"],
        "delta_perf_change": yb["people_value"]["perf_change"] - ya["people_value"]["perf_change"],
        "delta_comfort": yb["outcomes"]["comfort_score"] - ya["outcomes"]["comfort_score"],
        "delta_meeting_co2_ppm": yb["outcomes"]["meeting_co2_ppm"] - ya["outcomes"]["meeting_co2_ppm"],
        "new_flags": [f for f in b["flags"] if f not in a["flags"]],
    })
