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
        "description": "Simulates a scenario and sends it to the app so people can see it. Use it for a specific "
                       "change the user asks for, or to show another package than optimize or upgrade_tradeoffs "
                       "already showed.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "description": "Short name, e.g. 'LED lights on floors 1-3'."},
            "scenario": _SCENARIO, "events": _EVENTS_PARAM,
        }, "required": ["title", "scenario"]},
    }},
    {"type": "function", "function": {
        "name": "list_metrics",
        "description": "The goals and limits an optimization problem can use, with today's value of each (doing "
                       "nothing). Call it before propose_problem only if you need units or descriptions.",
        "parameters": {"type": "object", "properties": {}},
    }},
]

# What propose_problem and optimize take: one goal, limits, things to keep, allowed options.
_PROBLEM_PARAMS = {"type": "object", "properties": {
    "objective": {"type": "object", "description": "What to make as small or as large as possible.",
                  "properties": {"metric": {"type": "string", "enum": list(optimize.METRICS)},
                                 "sense": {"type": "string", "enum": ["min", "max"],
                                           "description": "Leave out to use the metric's natural direction."}},
                  "required": ["metric"]},
    "constraints": {"type": "array", "description": "Limits the plan must meet. Use max/min for absolute "
                    "values, max_change_pct/min_change_pct for changes vs today (e.g. -20 = at least 20% lower).",
                    "items": {"type": "object", "properties": {
                        "metric": {"type": "string", "enum": list(optimize.METRICS)},
                        "max": {"type": "number"}, "min": {"type": "number"},
                        "max_change_pct": {"type": "number"}, "min_change_pct": {"type": "number"}},
                        "required": ["metric"]}},
    "locked": {"type": "array", "description": "Things that must stay as they are today. Leave out floor "
               "to lock the whole group.",
               "items": {"type": "object", "properties": {
                   "group": {"type": "string", "enum": _GROUPS},
                   "floor": {"type": "integer", "minimum": -1, "maximum": 4}}, "required": ["group"]}},
    "allowed": {"type": "object", "description": "Per group, the only options the plan may use, e.g. "
                '{"coffee": ["coffee_current", "coffee_mid"]}. List one option to force it. Include the '
                "group's current option to allow keeping it.",
                "additionalProperties": {"type": "array", "items": {"type": "string", "enum": sorted(_OPTIONS)}}},
    "per_floor": {"type": "boolean", "description": "Decide floor by floor (default true, finer and "
                  "cheaper plans). false: one choice per group for the whole building."},
    "allow_warnings": {"type": "boolean", "description": "Allow plans that cause warnings such as over "
                       "budget or a reserve below the minimum. Default false."},
    "events": _EVENTS_PARAM,
}, "required": ["objective"]}

# Offered on every request. The model proposes; it never runs the optimizer itself.
SCHEMAS.append({"type": "function", "function": {
    "name": "propose_problem",
    "description": "Checks an optimization problem written from the user's words (one goal, limits, things to keep, "
                   "allowed options) and returns it with today's values, without running anything. The app shows it "
                   "with a 'Run optimization' button. Call it whenever the user wants the best or cheapest plan under "
                   "conditions, and again with a revised problem when they ask for a change.",
    "parameters": _PROBLEM_PARAMS,
}})

# Only offered once the user has confirmed a problem: the server makes this call itself (see agent.chat).
OPTIMIZE_SCHEMA = {"type": "function", "function": {
    "name": "optimize",
    "description": "Runs the optimizer on the problem the user confirmed. The server calls it; do not call it yourself.",
    "parameters": _PROBLEM_PARAMS,
}}


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
    return optimize.upfront_cost(DATA, res)


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


def list_metrics():
    today = optimize.metrics(DATA, optimize._simulate(DATA, [], []))
    return [{"metric": k, "unit": u, "natural_direction": sense, "kind": kind, "description": desc,
             "today": _r(today[k], 2)} for k, (u, sense, kind, desc) in optimize.METRICS.items()]


def propose_problem(objective, constraints=None, locked=None, allowed=None, per_floor=True, allow_warnings=False,
                    events=None):
    problem = optimize.normalize(DATA, {"objective": objective, "constraints": constraints or [], "locked": locked or [],
                                        "allowed": allowed or {}, "per_floor": per_floor,
                                        "allow_warnings": allow_warnings, "events": events or []})
    today = optimize.metrics(DATA, optimize._simulate(DATA, [], problem["events"]))
    used = [problem["objective"]["metric"]] + [c["metric"] for c in problem["constraints"]]
    return {"problem": problem,
            "today": {k: _r(today[k], 2) for k in dict.fromkeys(used)},
            "decisions": len(optimize.slots(DATA, problem)),
            "note": "Not run yet. The app shows this with a 'Run optimization' button. Relative limits are already "
                    "turned into absolute ones (from_change_pct keeps the percentage). A 'new_warnings' limit of 0 "
                    "(no warnings that doing nothing doesn't already have) is added unless allow_warnings is true."}


def optimize_plan(objective, constraints=None, locked=None, allowed=None, per_floor=True, allow_warnings=False,
                  events=None):
    problem = {"objective": objective, "constraints": constraints or [], "locked": locked or [],
               "allowed": allowed or {}, "per_floor": per_floor, "allow_warnings": allow_warnings,
               "events": events or []}
    out = optimize.solve(DATA, problem)
    best, today = out["best"], out["today"]
    return {
        "problem": out["problem"],
        "all_limits_met": best["feasible"],
        "limits_missed": best["violations"],
        "scenario": best["scenario"],
        "today_vs_plan": {k: {"today": _r(today["metrics"][k], 2), "plan": _r(best["metrics"][k], 2)}
                          for k in optimize.METRICS},
        "summary": summary(_run(best["scenario"], events)),
        "note": "today_vs_plan money and energy figures are yearly averages over the horizon; summary is year 1. "
                f"The search tried {out['evaluations']} plans. If all_limits_met is false, the plan is the "
                "closest it found: say which limit could not be met.",
    }


def simulate_scenario(scenario, events=None):
    return summary(_run(scenario, events))


def show_scenario(title, scenario, events=None):
    return summary(_run(scenario, events)) | {"shown_in_app": True}


def app_scenario(title, scenario, events=None):
    """What the app gets: the swaps (ready for /api/simulate), the item ids to highlight, and the summary."""
    res = _run(scenario, events)
    return {"title": title, "scenario": scenario, "events": events or [],
            "item_ids": sorted(res["choices"]), "summary": summary(res)}


HANDLERS = {f.__name__: f for f in (get_building_overview, list_options, rank_upgrades, simulate_scenario, show_scenario,
                                     list_metrics, propose_problem)} | {"optimize": optimize_plan}


def run(name, args):
    if name not in HANDLERS:
        raise ValueError(f"Unknown tool {name!r}")
    return HANDLERS[name](**args)


# ------------------------------------------------------------------ trade-off curve (model/search.py)
import search  # noqa: E402

_SAVINGS = {"running_costs": ("operating_cost_saving_chf_year", "operating_cost_saving_pct", "CHF/year",
                              "Running-cost saving"),
            "energy_bill": ("energy_cost_saving_chf_year", "energy_cost_saving_pct", "CHF/year", "Energy bill saving"),
            "electricity_kwh": ("energy_saving_kwh_year", "energy_saving_pct", "kWh/year", "Electricity saved")}

SCHEMAS.append({"type": "function", "function": {
    "name": "upgrade_tradeoffs",
    "description": "How up-front cost trades against yearly savings. Returns the best packages from cheapest to "
                   "biggest saving; each saves the most possible for its cost. Use it for 'what are my options' or "
                   "'how much does more saving cost'. The app plots them and shows the balanced one (knee_index).",
    "parameters": {"type": "object", "properties": {
        "savings": {"type": "string", "enum": list(_SAVINGS), "description":
                    "What counts as a saving. running_costs (default): energy bill, maintenance and supplies. "
                    "energy_bill: the electricity bill only. electricity_kwh: electricity used."},
        "budget_chf": {"type": "number", "description": "Largest up-front cost to consider, in CHF."},
        "locked": {"type": "array", "description": "Things that must stay as they are today.",
                   "items": {"type": "object", "properties": {
                       "group": {"type": "string", "enum": _GROUPS},
                       "floor": {"type": "integer", "minimum": -1, "maximum": 4}}, "required": ["group"]}},
        "allow_warnings": {"type": "boolean", "description": "Allow packages that cause warnings (over budget, "
                           "reserve below the minimum, ...). Default false, as in propose_problem."},
        "events": _EVENTS_PARAM,
        "max_points": {"type": "integer", "minimum": 3, "maximum": 15, "description": "How many packages (default 8)."},
    }},
}})


def upgrade_tradeoffs(savings="running_costs", budget_chf=None, locked=None, allow_warnings=False, events=None,
                      max_points=8):
    if savings not in _SAVINGS:
        raise ValueError(f"Unknown savings {savings!r}. Use one of {', '.join(_SAVINGS)}.")
    events = [events] if isinstance(events, str) else list(events or [])
    _check([], events)
    metric, pct, unit, _ = _SAVINGS[savings]
    cons = [] if allow_warnings else [{"metric": "new_warnings", "max": 0}]
    cons += [{"metric": "upfront_cost_chf", "max": budget_chf}] if budget_chf is not None else []
    res = search.pareto(DATA, x_metric="upfront_cost_chf", y_metric=metric, constraints=cons,
                        scope={"locked": locked} if locked else None, events=events,
                        max_points=min(15, max(3, int(max_points or 8))), time_limit=8.0)
    points = [{"upfront_cost_chf": _r(p["x"]),
               "extra_cost_vs_like_for_like_chf": _r(p["metrics"]["net_upfront_cost_chf"]),
               "saving_per_year": _r(p["y"]), "saving_pct": _r(p["metrics"][pct], 1),
               "payback_years": _r(p["metrics"]["payback_years"], 1) if p["changes"] else None,
               "npv_chf": _r(p["metrics"]["npv_cash_chf"]),
               "changes": [{"group": c["group"], "floor": c["floor"], "option": c["to_option"], "name": c["to_name"],
                            "upfront_cost_chf": _r(c["upfront_cost_chf"])} for c in p["changes"]],
               "scenario": p["scenario"]} for p in res["points"]]
    return {"savings": savings, "saving_unit": unit, "points": points, "knee_index": res["knee_index"],
            "note": "Sorted by up-front cost; the first is doing nothing. No other package saves more for the same "
                    "cost. knee_index is the balanced choice: past it, each extra franc buys less saving. "
                    "payback_years counts only extra_cost_vs_like_for_like_chf (worn-out units are replaced anyway), "
                    "so it can be 0 for a costly package; null means it never pays back. By default no package "
                    "causes new warnings (ones doing nothing doesn't already have)."}


def tradeoff_chart(result):
    """The upgrade_tradeoffs result as a chart for the app: up-front cost (x) against yearly saving (y)."""
    def label(p):
        byname = {}
        for c in p["changes"]:
            byname.setdefault(c["name"], []).append(c["floor"])
        return ", ".join(n + (f" (floors {', '.join(str(f) for f in fl)})" if fl[0] is not None else "")
                         for n, fl in byname.items()) or "Do nothing"
    metric, _, unit, title = _SAVINGS[result["savings"]]
    return {"type": "pareto", "x_metric": "upfront_cost_chf", "y_metric": metric, "x_label": "Up-front cost (CHF)",
            "y_label": f"{title} ({unit})",
            "points": [{"x": p["upfront_cost_chf"], "y": p["saving_per_year"], "label": label(p),
                        "scenario": p["scenario"]} for p in result["points"]],
            "knee_index": result["knee_index"]}


def knee_scenario(result, events=None):
    """The balanced point of the trade-off curve, as the app scenario to show."""
    if not result["points"] or result["knee_index"] is None:
        return None
    knee = result["points"][result["knee_index"]]
    return app_scenario("Balanced choice from the trade-off curve", knee["scenario"], events) if knee["scenario"] else None


HANDLERS["upgrade_tradeoffs"] = upgrade_tradeoffs

# Today's value of every metric in the propose_problem description, so the model rarely needs list_metrics.
_today = optimize.metrics(DATA, optimize._simulate(DATA, [], []))
for _s in SCHEMAS:
    if _s["function"]["name"] == "propose_problem":
        _s["function"]["description"] += " Today's values: " + ", ".join(
            f"{k} {_r(v, 2)}" for k, v in _today.items() if v is not None) + "."
