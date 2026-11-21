"""Tools the chat model can call. They run Oscar's engine (model/engine.py), so every number comes from it.

A scenario is the engine's list of swaps, the same as the app's `Scenario` type:
    [{"group": "lighting", "option": "lighting_mid", "floor": 2}, ...]
"""

import sys
from collections import defaultdict
from pathlib import Path

_MODEL_DIR = str(Path(__file__).resolve().parent.parent / "model")
if _MODEL_DIR not in sys.path:
    sys.path.insert(0, _MODEL_DIR)
import engine  # noqa: E402
import optimize  # noqa: E402

DATA = engine.load()
_OPTIONS = DATA["options"]
_GROUPS = sorted({o["group"] for o in _OPTIONS.values()})
_GROUP_FLOORS = defaultdict(set)
for _i in DATA["items"]:
    _GROUP_FLOORS[_i["group"]].add(engine.served_floor(_i))
_FLOOR_GROUPS = sorted(g for g, fl in _GROUP_FLOORS.items() if len(fl) > 1)
_EVENTS = sorted(DATA["events"])
_PEOPLE = ["comfort_score", "sick_days", "office_co2_ppm", "meeting_co2_ppm", "classroom_co2_ppm",
           "summer_overheating_degc", "lighting_quality", "screen_quality", "eye_strain"]

_SCENARIO = {
    "type": "array",
    "description": "Swaps. One swap per floor; leave out `floor` to change every floor.",
    "items": {
        "type": "object",
        "properties": {
            "group": {"type": "string", "enum": _GROUPS},
            "option": {"type": "string", "enum": sorted(_OPTIONS)},
            "floor": {"type": "integer", "minimum": -1, "maximum": 4,
                      "description": "-1 basement to 4 top floor. Ventilation follows the floor it serves."},
            "timing": {"type": "string", "enum": ["now", "end_of_life"],
                       "description": "now (default), or when the current unit wears out."},
        },
        "required": ["group", "option"],
    },
}
_EVENTS_PARAM = {"type": "array", "items": {"type": "string", "enum": _EVENTS},
                 "description": "Optional what-if events, e.g. an energy price spike or a new lab moving in."}

SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_building_overview",
        "description": "Today's building: energy bill, electricity by use, running costs, what is installed (age, "
                       "lifetime, how many units are worn out), people and air quality, money limits, possible events.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_options",
        "description": "The products for one group: price per unit, lifetime, specs and a short description "
                       "(including comfort and health facts such as flicker-free light or particle filters).",
        "parameters": {"type": "object", "properties": {"group": {"type": "string", "enum": _GROUPS}},
                       "required": ["group"]},
    }},
    {"type": "function", "function": {
        "name": "rank_upgrades",
        "description": "Simulates every single upgrade on its own and ranks them by payback. Use it to find "
                       "candidates. Set by_floor with a group to see each floor separately, to hit a target closely.",
        "parameters": {"type": "object", "properties": {
            "group": {"type": "string", "enum": _GROUPS, "description": "Only this group. Leave out for all."},
            "by_floor": {"type": "boolean", "description": f"Split by floor. Applies to {', '.join(_FLOOR_GROUPS)}."},
        }},
    }},
    {"type": "function", "function": {
        "name": "simulate_scenario",
        "description": "Runs the building model over 15 years with a set of swaps and compares it with doing "
                       "nothing. Savings from several swaps don't simply add up, so always check a combination here.",
        "parameters": {"type": "object", "properties": {"scenario": _SCENARIO, "events": _EVENTS_PARAM},
                       "required": ["scenario"]},
    }},
    {"type": "function", "function": {
        "name": "show_scenario",
        "description": "Sends a scenario to the app so people can see it. Call it once with the package you "
                       "recommend, before your final answer.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "description": "Short name, e.g. 'LED lights on floors 1-3'."},
            "scenario": _SCENARIO, "events": _EVENTS_PARAM,
        }, "required": ["title", "scenario"]},
    }},
]


def _r(x, nd=0):
    if x is None:
        return None
    return round(x) if nd == 0 else round(x, nd)


def _check(scenario, events):
    for sw in scenario:
        o = _OPTIONS.get(sw.get("option"))
        if not o:
            raise ValueError(f"Unknown option {sw.get('option')!r}")
        if o["group"] != sw.get("group"):
            raise ValueError(f"{o['option_id']} belongs to group {o['group']!r}, not {sw.get('group')!r}")
    for e in events or []:
        if e not in DATA["events"]:
            raise ValueError(f"Unknown event {e!r}")


def _upfront(res):
    """What the swaps made now cost to buy and install, after the solar subsidy."""
    sel = engine.baseline(DATA) | {iid: c[0] for iid, c in res["choices"].items()}
    total = 0.0
    for iid, (oid, timing) in res["choices"].items():
        if timing != "now":
            continue
        item, o = DATA["item_by_id"][iid], _OPTIONS[oid]
        units = engine.units_of(DATA, item, oid, sel)
        total += units * ((o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0))
        if item["group"] == "solar_pv":
            total -= units * DATA["params"]["pv_subsidy_chf_per_kwp"]
    return total


def _bill(costs):
    return costs["energy"] + costs["pv_export"]


def _run(scenario, events=None):
    _check(scenario, events)
    return engine.simulate(DATA, scenario, events or [])


def _event_years(res):
    """Events and the years they hit, plus the saving every year, so the model can talk about the event year."""
    events = [{"event": e, "start_year": DATA["events"][e]["start_year"], "end_year": DATA["events"][e]["end_year"]}
              for e in res["events"]]
    yearly = [{"year": y["year"], "energy_bill_saving_chf": _r(y["savings"]["energy"] + y["savings"]["pv_export"]),
               "running_cost_saving_chf": _r(sum(y["savings"].values())),
               "electricity_price_chf_kwh": _r(y["price_chf_kwh"], 3)} for y in res["years"]]
    return {"events": events, "by_year": yearly}


def summary(res):
    """The numbers the chat model sees for one scenario. Single-year figures are for year 1."""
    y = res["years"][0]
    bill, bill_b = _bill(y["state"]["costs"]), _bill(y["state_baseline"]["costs"])
    running = sum(y["savings"].values())
    upfront = _upfront(res)
    bd = res["npv_breakdown"]
    n = int(DATA["params"]["horizon_years"])
    floors = sorted({engine.served_floor(DATA["item_by_id"][i]) for i in res["choices"]})
    return {
        "energy_bill_chf_month": {"today": _r(bill_b / 12), "scenario": _r(bill / 12)},
        "energy_bill_saving_chf_year": _r(bill_b - bill),
        "energy_bill_saving_pct": _r(100 * (bill_b - bill) / bill_b, 1),
        "electricity_kwh_year": {"today": _r(y["kwh_baseline"]), "scenario": _r(y["kwh"])},
        "electricity_saving_pct": _r(100 * (y["kwh_baseline"] - y["kwh"]) / y["kwh_baseline"], 1),
        "running_cost_saving_chf_year": _r(running),
        "running_cost_saving_by_kind_chf_year": {k: _r(v) for k, v in y["savings"].items() if abs(v) >= 1},
        "upfront_cost_chf": _r(upfront),
        "extra_cost_vs_like_for_like_chf": _r(res["capex_year0"]),
        "payback_years": _r(res["payback_cash"], 1),
        "payback_years_with_people_effects": _r(res["payback_economic"], 1),
        "simple_roi_pct_per_year": _r(100 * running / upfront, 1) if upfront > 0 else None,
        "horizon_years": n,
        "npv_chf": _r(res["npv_cash"]),
        "people_effects_chf": _r(bd["productivity"] + bd["sick_days"] + bd["time_saved"]),
        "people_and_air_year_1": {k: {"today": _r(y["outcomes_baseline"][k], 2), "scenario": _r(y["outcomes"][k], 2)}
                                  for k in _PEOPLE if y["outcomes"][k] != y["outcomes_baseline"][k]},
        # This flag describes doing nothing, not the plan; the overview reports it.
        "flags": [f for f in res["flags"] if f["type"] != "reserve_below_minimum_without_upgrades"],
        "changed_items": len(res["choices"]),
        "changed_floors": floors,
    } | ({"what_if": _event_years(res)} if res["events"] else {})


def get_building_overview():
    res = engine.simulate(DATA, [])
    y = res["years"][0]
    st = y["state_baseline"]
    installed = defaultdict(lambda: {"units": 0, "ages": [], "worn_out_units": 0, "floors": set()})
    for it in DATA["items"]:
        o = _OPTIONS[it["option"]]
        d = installed[it["option"]]
        d["units"] += it["units"]
        d["floors"].add(engine.served_floor(it))
        if it["age"] is not None:
            d["ages"].append(it["age"])
            if o["lifetime_years"] and it["age"] >= o["lifetime_years"]:
                d["worn_out_units"] += it["units"]
    today = [{"group": _OPTIONS[oid]["group"], "option": oid, "name": _OPTIONS[oid]["name"], "units": d["units"],
              "unit": _OPTIONS[oid]["unit"], "floors": sorted(d["floors"]),
              "age_years": f"{min(d['ages']):g}-{max(d['ages']):g}" if d["ages"] else None,
              "lifetime_years": _OPTIONS[oid]["lifetime_years"], "worn_out_units": d["worn_out_units"]}
             for oid, d in sorted(installed.items())]
    p = DATA["params"]
    return {
        "energy_bill_chf_month": _r(_bill(st["costs"]) / 12),
        "running_costs_chf_year": {k: _r(v) for k, v in st["costs"].items()},
        "electricity_kwh_year": _r(st["energy"]["total_kwh"]),
        "electricity_kwh_by_use": {k: _r(v) for k, v in sorted(st["energy"]["by_group"].items(), key=lambda kv: -kv[1])},
        "people_and_air": {k: _r(y["outcomes_baseline"][k], 2) for k in _PEOPLE},
        "installed": today,
        "money": {k: p[k] for k in ("electricity_price_chf_kwh", "capex_budget_chf", "opening_reserve_chf",
                                    "min_reserve_chf", "horizon_years", "discount_rate_real")},
        "flags_if_we_do_nothing": res["flags"],
        "events": [{"id": e["id"], "name": e["name"], "description": e["description"]} for e in DATA["events"].values()],
        "note": "Floors: -1 basement (car park, plant room, servers), 0 ground (cafe, classrooms), 1-3 offices, "
                "4 top floor (lecture room, makerspace). All numbers are model estimates from our assumptions.",
    }


def list_options(group):
    keys = ["option_id", "tier", "name", "unit", "power_on_w", "standby_w", "control_savings_pct",
            "purchase_chf_per_unit", "install_chf_per_unit", "lifetime_years", "maintenance_chf_per_unit_year",
            "consumable_chf_per_use", "heat_recovery_pct", "airflow_m3h", "heating_efficiency", "cooling_efficiency",
            "generation_kwh_per_unit_year", "flicker_free", "cri", "filter_pm1_removal_pct", "humidity_control",
            "enclosed_filtered", "seconds_per_drink", "description"]
    return [{k: o[k] for k in keys if o.get(k) not in ("", None)} for o in _OPTIONS.values() if o["group"] == group]


def rank_upgrades(group=None, by_floor=False):
    rows = []
    for o in _OPTIONS.values():
        g = o["group"]
        if o["tier"] == "current" or (group and g != group):
            continue
        floors = sorted(_GROUP_FLOORS[g]) if by_floor and g in _FLOOR_GROUPS else [None]
        for fl in floors:
            swap = {"group": g, "option": o["option_id"]} | ({"floor": fl} if fl is not None else {})
            res = _run([swap])
            if not res["choices"]:
                continue
            s = summary(res)
            rows.append({"swap": swap, "name": o["name"],
                         **{k: s[k] for k in ("energy_bill_saving_pct", "upfront_cost_chf",
                                              "extra_cost_vs_like_for_like_chf", "payback_years", "npv_chf",
                                              "people_effects_chf")},
                         "energy_bill_saving_chf_month": _r(s["energy_bill_saving_chf_year"] / 12)})
    rows.sort(key=lambda x: (x["payback_years"] is None, x["payback_years"] or 0, -(x["npv_chf"] or 0)))
    return {"upgrades": rows,
            "note": "payback_years is null when the swap never pays back in cash. npv_chf and people_effects_chf "
                    "are totals over the horizon in today's money."}


def simulate_scenario(scenario, events=None):
    return summary(_run(scenario, events))


def show_scenario(title, scenario, events=None):
    return summary(_run(scenario, events)) | {"shown_in_app": True}


def app_scenario(title, scenario, events=None):
    """What the app gets: the swaps (ready for /api/simulate), the item ids to highlight, and the summary."""
    res = _run(scenario, events)
    return {"title": title, "scenario": scenario, "events": events or [],
            "item_ids": sorted(res["choices"]), "summary": summary(res)}


HANDLERS = {f.__name__: f for f in (get_building_overview, list_options, rank_upgrades, simulate_scenario, show_scenario)}


def run(name, args):
    if name not in HANDLERS:
        raise ValueError(f"Unknown tool {name!r}")
    return HANDLERS[name](**args)


# ------------------------------------------------------------------ optimizer tools (model/optimize.py)
# What counts as a saving: (yearly metric, % metric, unit) in optimize.METRICS.
_SAVINGS = {
    "running_costs": ("operating_cost_saving_chf_year", "operating_cost_saving_pct", "chf"),
    "energy_bill": ("energy_cost_saving_chf_year", "energy_cost_saving_pct", "chf"),
    "electricity_kwh": ("energy_saving_kwh_year", "energy_saving_pct", "kwh"),
    "grid_electricity_kwh": ("grid_energy_saving_kwh_year", "grid_energy_saving_pct", "kwh"),
}
_SAVINGS_LABEL = {"running_costs": "Running-cost saving", "energy_bill": "Energy bill saving",
                  "electricity_kwh": "Electricity saved", "grid_electricity_kwh": "Grid electricity saved"}
_TARGET_UNITS = {"chf_per_year": ("chf", 1), "chf_per_month": ("chf", 12), "kwh_per_year": ("kwh", 1)}


def _selectors(with_option, description):
    props = {"group": {"type": "string", "enum": _GROUPS},
             "floor": {"type": "integer", "minimum": -1, "maximum": 4, "description": "Leave out for every floor."}}
    if with_option:
        props["option"] = {"type": "string", "enum": sorted(_OPTIONS), "description": "Leave out for any option."}
    return {"type": "array", "description": description,
            "items": {"type": "object", "properties": props, "required": ["group"]}}


_SAVINGS_PARAM = {"type": "string", "enum": list(_SAVINGS), "description":
                  "What counts as a saving. running_costs (default): everything saved per year: energy bill, "
                  "maintenance and supplies. energy_bill: the electricity bill only. electricity_kwh: electricity "
                  "used. grid_electricity_kwh: electricity bought from the grid (counts our own solar)."}
_LIMIT_PARAMS = {
    "keep": _selectors(False, "Don't touch these, e.g. [{\"group\": \"servers\"}]."),
    "only": _selectors(True, "Change only these (and only to the given option, if set). Everything else stays."),
    "must_change": _selectors(True, "These must change (to the given option, if set)."),
    "avoid_options": {"type": "array", "items": {"type": "string", "enum": sorted(_OPTIONS)},
                      "description": "Never install these options."},
    "events": _EVENTS_PARAM,
    "allow_higher_running_costs": {"type": "boolean", "description":
        "Only for energy_bill or kWh savings. By default a package may not raise total running costs (e.g. "
        "capsule coffee machines cut electricity but cost more in capsules). Set true only if the user cares "
        "about energy alone, not money."},
}

SCHEMAS += [
    {"type": "function", "function": {
        "name": "find_best_upgrades",
        "description": "Searches every combination of upgrades in the building model and returns the best package "
                       "for a goal. Use it for any goal or target: 'save CHF 10,000 a year', 'cut energy use by 10%', "
                       "'the best we can do with CHF 200k', 'cheapest over 10 years'. Its numbers match "
                       "simulate_scenario. Pass the returned scenario to show_scenario. For a specific change "
                       "('what if we do X'), use simulate_scenario instead.",
        "parameters": {"type": "object", "properties": {
            "goal": {"type": "string", "enum": ["cheapest_for_target", "max_savings", "min_total_cost"],
                     "description": "cheapest_for_target: the cheapest package that reaches the target. "
                                    "max_savings: the most savings within budget_chf, or with no budget. "
                                    "min_total_cost: the lowest purchase plus running cost over `years`."},
            "savings": _SAVINGS_PARAM,
            "target": {"type": "number", "description": "The savings target, in target_unit."},
            "target_unit": {"type": "string", "enum": ["chf_per_year", "chf_per_month", "percent", "kwh_per_year"],
                            "description": "CHF units need a CHF savings basis, kwh_per_year a kWh one. "
                                           "percent is versus doing nothing."},
            "budget_chf": {"type": "number", "description": "The most it may cost up front, in CHF."},
            "years": {"type": "integer", "minimum": 1, "description": "Timeframe for min_total_cost."},
            **_LIMIT_PARAMS,
        }, "required": ["goal"]},
    }},
    {"type": "function", "function": {
        "name": "upgrade_tradeoffs",
        "description": "How up-front cost trades against yearly savings. Returns the best packages from cheapest "
                       "to biggest saving; each saves the most possible for its cost. Use it for 'what are my "
                       "options' or 'how much does more saving cost'. The app plots them as a chart.",
        "parameters": {"type": "object", "properties": {
            "savings": _SAVINGS_PARAM,
            "budget_chf": {"type": "number", "description": "Largest up-front cost to consider, in CHF."},
            **_LIMIT_PARAMS,
            "max_points": {"type": "integer", "minimum": 3, "maximum": 15,
                           "description": "How many packages to return (default 8)."},
        }},
    }},
]


def _savings(savings):
    if savings not in _SAVINGS:
        raise ValueError(f"Unknown savings {savings!r}. Use one of {', '.join(_SAVINGS)}.")
    return _SAVINGS[savings]


def _target(savings, target, target_unit):
    """The target as (metric, value) for the optimizer."""
    metric, pct, kind = _savings(savings)
    if target_unit == "percent":
        return pct, target
    if target_unit not in _TARGET_UNITS:
        raise ValueError("Give target_unit with target: chf_per_year, chf_per_month, percent or kwh_per_year.")
    need, factor = _TARGET_UNITS[target_unit]
    if need != kind:
        fits = " or ".join(s for s, v in _SAVINGS.items() if v[2] == need)
        raise ValueError(f"A target in {target_unit} needs savings set to {fits}, not {savings}.")
    return metric, target * factor


def _guard(savings, allow_higher_running_costs):
    """Saving on the bill or on kWh must not raise total running costs, unless the user only cares about energy."""
    if savings == "running_costs" or allow_higher_running_costs:
        return []
    return [{"metric": "operating_cost_saving_chf_year", "min": 0}]


def _events(events):
    """Events as a checked list; a model sometimes sends one event as a plain string."""
    events = [events] if isinstance(events, str) else list(events or [])
    _check([], events)
    return events


def _scope(keep, only, must_change, avoid_options):
    scope = {k: v for k, v in (("locked", keep), ("allowed", only), ("required", must_change),
                                ("excluded_options", avoid_options)) if v}
    return scope or None


def _short(scenario):
    """The same swaps, with one swap instead of one per floor when an option goes on every floor of its group."""
    floors = defaultdict(set)
    for sw in scenario:
        if "floor" in sw:
            floors[sw["group"], sw["option"], sw.get("timing")].add(sw["floor"])
    out, merged = [], set()
    for sw in scenario:
        key = sw["group"], sw["option"], sw.get("timing")
        if "floor" not in sw or floors[key] != _GROUP_FLOORS[sw["group"]]:
            out.append(sw)
        elif key not in merged:
            merged.add(key)
            out.append({k: v for k, v in sw.items() if k != "floor"})
    return out


def _changes(changes, full=True):
    """The optimizer's changes, one entry per (group, new option). Floors only for groups that differ per floor."""
    out = {}
    for c in changes:
        d = out.setdefault((c["group"], c["to_option"]), {
            "group": c["group"], "option": c["to_option"], "name": c["to_name"], "replaces": set(),
            "floors": set(), "units": 0, "unit": _OPTIONS[c["to_option"]]["unit"], "upfront_cost_chf": 0.0})
        d["replaces"].add(c["from_name"])
        d["floors"] |= {engine.served_floor(DATA["item_by_id"][i]) for i in c["item_ids"]}
        d["units"] += c["units"]
        d["upfront_cost_chf"] += c["upfront_cost_chf"]
    keys = ("group", "option", "name", "replaces", "floors", "units", "unit", "upfront_cost_chf") if full \
        else ("group", "name", "floors", "upfront_cost_chf")
    return [{k: sorted(d[k]) if isinstance(d[k], set) else _r(d[k]) if k == "upfront_cost_chf" else d[k]
             for k in keys if k != "floors" or d["group"] in _FLOOR_GROUPS} for d in out.values()]


def find_best_upgrades(goal, savings="running_costs", target=None, target_unit=None, budget_chf=None, years=None,
                       keep=None, only=None, must_change=None, avoid_options=None, events=None,
                       allow_higher_running_costs=False):
    events = _events(events)
    metric = _savings(savings)[0]
    common = dict(scope=_scope(keep, only, must_change, avoid_options), events=events,
                  include_engine_output=False)
    cons = _guard(savings, allow_higher_running_costs)
    tgt = _target(savings, target, target_unit) if target is not None else None
    if goal == "cheapest_for_target":
        if tgt is None:
            raise ValueError("cheapest_for_target needs a target and a target_unit.")
        if budget_chf is not None:
            cons.append({"metric": "upfront_cost_chf", "max": budget_chf})
        res = optimize.min_cost_for_target(DATA, *tgt, constraints=cons, **common)
    elif goal == "max_savings":
        cons += [{"metric": tgt[0], "min": tgt[1]}] if tgt else []
        res = optimize.max_savings(DATA, metric=metric, budget=budget_chf, constraints=cons, **common)
    elif goal == "min_total_cost":
        if not years:
            raise ValueError("min_total_cost needs years.")
        if savings == "grid_electricity_kwh":
            raise ValueError("min_total_cost can't count grid electricity. Use savings running_costs for the lowest "
                             "total cost, or electricity_kwh for the least electricity used.")
        cons += [{"metric": tgt[0], "min": tgt[1]}] if tgt else []
        res = optimize.min_total_cost(DATA, years, basis="kwh" if savings == "electricity_kwh" else "chf",
                                      budget=budget_chf, constraints=cons, **common)
    else:
        raise ValueError(f"Unknown goal {goal!r}. Use cheapest_for_target, max_savings or min_total_cost.")
    out = {"status": res["status"], "message": res["message"],
           "constraints": [{"metric": c["metric"], **{k: _r(c[k], nd) for k in ("min", "max") if k in c},
                            "achieved": _r(c["value"], nd), "met": c["met"]}
                           for c in res["constraints"] for nd in [1 if c["metric"].endswith("_pct") else 0]],
           "changes": _changes(res["changes"]),
           "plan": summary(_run(_short(res["scenario"]), events))}
    if goal == "min_total_cost":
        m, b = res["metrics"], res["baseline"]
        out |= {"years": years, "total_cost_chf": _r(m["total_cost_chf"]),
                "total_cost_do_nothing_chf": _r(b["total_cost_chf"]),
                "total_cost_saving_chf": _r(m["total_cost_saving_chf"])}
        if savings == "electricity_kwh":
            out |= {"total_electricity_kwh": _r(m["total_energy_kwh"]),
                    "total_electricity_saving_kwh": _r(m["total_energy_saving_kwh"])}
    return out | {"scenario": _short(res["scenario"])}


def upgrade_tradeoffs(savings="running_costs", budget_chf=None, keep=None, only=None, must_change=None,
                      avoid_options=None, events=None, max_points=8, allow_higher_running_costs=False):
    events = _events(events)
    metric, pct, kind = _savings(savings)
    cons = _guard(savings, allow_higher_running_costs)
    cons += [{"metric": "upfront_cost_chf", "max": budget_chf}] if budget_chf is not None else []
    res = optimize.pareto(DATA, x_metric="upfront_cost_chf", y_metric=metric, constraints=cons,
                          scope=_scope(keep, only, must_change, avoid_options), events=events,
                          max_points=min(15, max(3, int(max_points or 8))), time_limit=5.0)   # 5 s is as good as 10 s here
    points = [{"upfront_cost_chf": _r(p["x"]),
               "extra_cost_vs_like_for_like_chf": _r(p["metrics"]["net_upfront_cost_chf"]),
               "saving_per_year": _r(p["y"]), "saving_pct": _r(p["metrics"][pct], 1),
               "payback_years": _r(p["metrics"]["payback_years"], 1) if p["changes"] else None,
               "npv_chf": _r(p["metrics"]["npv_cash_chf"]),
               "changes": _changes(p["changes"], full=False), "scenario": _short(p["scenario"])} for p in res["points"]]
    return {"savings": savings, "saving_unit": "CHF/year" if kind == "chf" else "kWh/year", "points": points,
            "knee_index": res["knee_index"],
            "note": "Sorted by up-front cost; the first is the cheapest, usually doing nothing. No other package "
                    "saves more for the same cost. knee_index is the balanced choice: past it, each extra franc buys "
                    "less saving. payback_years counts only extra_cost_vs_like_for_like_chf (worn-out units are replaced anyway), so it can be 0 for a costly package; it is null if it never pays back. npv_chf is the gain over the horizon "
                    "in today's money."}


def tradeoff_chart(result):
    """The upgrade_tradeoffs result as a chart for the app: up-front cost (x) against yearly saving (y)."""
    def label(p):  # "LED panels (floors 1, 2), Heat pump", or "Do nothing"
        parts = []
        for c in p["changes"]:
            fl = c.get("floors", [])
            parts.append(c["name"] + (f" (floor{'s' if len(fl) > 1 else ''} {', '.join(map(str, fl))})" if fl else ""))
        return ", ".join(parts) or "Do nothing"
    s = result["savings"]
    return {"type": "pareto", "x_metric": "upfront_cost_chf", "y_metric": _SAVINGS[s][0],
            "x_label": "Up-front cost (CHF)", "y_label": f"{_SAVINGS_LABEL[s]} ({result['saving_unit']})",
            "points": [{"x": p["upfront_cost_chf"], "y": p["saving_per_year"], "label": label(p),
                        "scenario": p["scenario"]} for p in result["points"]],
            "knee_index": result["knee_index"]}


HANDLERS.update({f.__name__: f for f in (find_best_upgrades, upgrade_tradeoffs)})
