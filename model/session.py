"""Play through one future, one pause at a time.

Time: time t is the end of year t, and t = 0 is today. A decision taken at a pause at time t is a swap
with "year": t and "firm": true (so the engine never pulls it into the past). It is installed and paid at the end of year t (so it is part of year t's cash row, like
every install in the engine) and active from year t + 1. Rows for years before t never change.

The plan: decisions can be for now or for later years. The run carries them out on schedule without stopping.
At a pause, the plan has two parts: "done" (years before t: locked, the past) and "planned" (year t or later:
the player can keep, change or drop them with set_plan, or add to them with decide). A newer decision for an
item replaces that item's planned steps from its year on (engine.resolve, firm swaps), never earlier ones.

The engine stays the only source of numbers. A session holds the future, the decisions so far and the
current pause time t; every state is read from engine.simulate runs with those decisions in that future.

A session pauses at the first time T > t where something happens:
  failure          a big system breaks (STOP_GROUPS): an install of kind "failure" at time T. Smaller
                   equipment that wears out is replaced like-for-like without stopping; the next stop lists it
  event_announced  an event with a notice period becomes known, at time start_year - 1 - notice
  event_started    an event starts in the coming year, at time start_year - 1
  new_flag         a warning (desk shortfall, a floor over ventilation capacity, the reserve below its
                   minimum and below where doing nothing would leave it) appears in year T that was not
                   there in year T - 1
  price_jump       the electricity price for year T + 1 is up more than the threshold on year T (unless a
                   price event starting then already explains it)
"""
import random

import engine
import montecarlo
import viz

# What a person might change in response to an event, a warning or a price jump.
EVENT_GROUPS = {"new_lab": ["computers", "ventilation", "coffee"],
                "heatwave_summer": ["blinds", "heating_cooling", "ventilation"],
                "energy_price_spike": ["solar_pv", "lighting", "heating_cooling"]}
FLAG_GROUPS = {"desk_shortfall": ["computers"], "ventilation_over_capacity": ["ventilation"],
               "reserve_below_minimum": []}
PRICE_GROUPS = ["solar_pv", "lighting", "heating_cooling"]
ROW_FIELDS = ("cash_closing", "cash_closing_baseline", "cumulative_cash_cf", "cumulative_economic_cf",
              "operating_cost", "operating_cost_baseline", "kwh", "kwh_baseline", "staff", "desk_capacity",
              "price_chf_kwh")


def _horizon(data, session=None):
    """How many years this game runs: its own length if it has one (5, 10 or 15), else the engine's horizon."""
    return int((session or {}).get("years") or data["params"]["horizon_years"])


def _overrides(data, session):
    """A shorter game runs the engine over its own horizon (equipment still standing at the end counts)."""
    H = _horizon(data, session)
    return {"horizon_years": H} if H != int(data["params"]["horizon_years"]) else None


def new(future, name=None, years=None):
    """A session at t = 0 with no decisions. future: from montecarlo.draw_play_future or load_scripted.
    years: how long the game runs (default: the engine's horizon)."""
    return {"future": future, "future_name": name, "decisions": [], "t": 0, "ended": False, "state": None, "years": years}


def _sim(data, session, decisions=None, detail_years=()):
    return engine.simulate(data, session["decisions"] if decisions is None else decisions,
                           overrides=_overrides(data, session), future=session["future"], detail_years=detail_years)


# ---------------------------------------------------------------- reasons to pause
def _where(floors):
    names = {-1: "in the basement", 0: "on the ground floor", 5: "on the roof"}
    if len(floors) == 1:
        return names.get(floors[0], f"on floor {floors[0]}")
    if floors == list(range(floors[0], floors[-1] + 1)) and -1 not in floors and 5 not in floors:
        return f"on floors {floors[0]}–{floors[-1]}"
    return "on floors " + ", ".join({-1: "basement", 5: "roof"}.get(f, str(f)) for f in floors)


GROUP_NAMES = {"heating_cooling": "Heating and cooling", "printers_3d": "3D printers", "solar_pv": "Solar panels",
               "coffee": "Coffee machines", "water_heater": "Water heater"}


def _label(group):
    return GROUP_NAMES.get(group, group.replace("_", " ").capitalize())


def _count(n, unit):
    return f"{n:g} {unit}" if n == 1 or unit in ("kW", "kWp", "m2") else f"{n:g} {unit}s"


def _failures(data, session):
    """Original units breaking, grouped per (time, group): {T: [reason]}."""
    _, plans, _ = engine.install_plans(data, session["decisions"], session["future"], _horizon(data, session))
    grouped = {}
    for iid, installs in plans.items():
        for T, option, kind in installs:
            if kind == "failure":
                grouped.setdefault((T, data["item_by_id"][iid]["group"]), []).append((data["item_by_id"][iid], option))
    out = {}
    for (T, group), hits in sorted(grouped.items()):
        items = [i for i, _ in hits]
        floors = sorted({engine.served_floor(i) for i in items})
        units = sum(i["units"] for i in items)
        unit = data["options"][items[0]["option"]]["unit"]
        out.setdefault(T, []).append({
            "type": "failure", "time": T, "group": group, "floors": floors, "item_ids": [i["id"] for i in items],
            "title": f"{_label(group)} {_where(floors)} reached end of life ({_count(units, unit)})",
            "details": {"units": units, "unit": unit, "old_options": sorted({i["option"] for i in items}),
                        "replaced_with": sorted({o for _, o in hits}),
                        "emergency_premium_share": data["params"]["failure_premium"]}})
    return out


def _events(data, session):
    """Events being announced or starting: {T: [reason]}."""
    out = {}
    for e in session["future"]["events"]:
        ev = data["events"][e["id"]]
        if ev["kind"] != "annual":
            continue
        start, end = e["start_year"], e.get("end_year")
        details = {"event_id": e["id"], "name": ev["name"], "description": ev["description"], "start_year": start,
                   "end_year": end, "parameter": ev["param"], "change": ev["change"], "value": ev["value"]}
        when = f"in year {start}" if end == start else f"from year {start}"
        announced, starts = montecarlo.announced_at(data, e), max(0, start - 1)
        if announced < starts:
            out.setdefault(announced, []).append({
                "type": "event_announced", "time": announced, "group": None, "floors": [], "item_ids": [],
                "title": f"Announced: {ev['name'].lower()} {when}", "details": details})
        out.setdefault(starts, []).append({
            "type": "event_started", "time": starts, "group": None, "floors": [], "item_ids": [],
            "title": f"{ev['name']} {when}: starts now", "details": details})
    return out


def _warnings(data, session, res):
    """Warnings on the player's path that appear in year T and were not there in year T - 1: {T: [reason]}."""
    H = _horizon(data, session)
    present = {}                                   # (flag, floor) -> set of years
    for f in res["flags"]:
        if f["type"] in ("ventilation_over_capacity", "desk_shortfall"):
            present.setdefault((f["type"], f.get("floor")), {}).setdefault(f["year"], f)
    low = data["params"]["min_reserve_chf"]
    for row in res["years"]:                       # the player's reserve: low, and lower than doing nothing
        if row["cash_closing"] < low and row["cash_closing"] < row["cash_closing_baseline"] - 1e-6:
            present.setdefault(("reserve_below_minimum", None), {})[row["year"]] = {
                "reserve": row["cash_closing"], "minimum": low, "reserve_doing_nothing": row["cash_closing_baseline"]}
    out = {}
    for (flag, floor), years in present.items():
        for Y in sorted(years):
            if Y - 1 in years or Y > H:
                continue
            title = {"desk_shortfall": "Not enough desks for everyone",
                     "ventilation_over_capacity": f"Ventilation {_where([floor]) if floor is not None else ''} can't "
                                                  "supply enough air for the people there",
                     "reserve_below_minimum": "The building reserve fell below its minimum"}[flag]
            out.setdefault(Y, []).append({
                "type": "new_flag", "time": Y, "group": None, "floors": [] if floor is None else [floor],
                "item_ids": [], "title": f"{title} (year {Y})",
                "details": {"flag": flag, "year": Y, **{k: v for k, v in years[Y].items() if k not in ("type", "year")}}})
    return out


def _price_jumps(data, res):
    """The price for year Y up more than the threshold on year Y - 1: a reason at time Y - 1."""
    p = data["params"]
    out, prev = {}, p["electricity_price_chf_kwh"]
    for row in res["years"]:
        cur = row["price_chf_kwh"]
        if cur / prev - 1 > p["price_jump_pause_threshold"]:
            T = row["year"] - 1
            out.setdefault(T, []).append({
                "type": "price_jump", "time": T, "group": None, "floors": [], "item_ids": [],
                "title": f"Electricity price up {100 * (cur / prev - 1):.0f}% for year {row['year']}",
                "details": {"year": row["year"], "price_from_chf_kwh": prev, "price_to_chf_kwh": cur}})
        prev = cur
    return out


# Breakdowns of these stop the game; smaller equipment (lights, monitors, computers, blinds, coffee machines,
# printers) wears out somewhere every year, so it is replaced like-for-like without stopping and listed instead.
STOP_GROUPS = engine.PLANNED_GROUPS


def routine_by_time(data, session):
    """Small equipment wearing out, which doesn't stop the game: {T: [reason]} (same shape as a failure)."""
    return {T: small for T, rs in _failures(data, session).items()
            if (small := [r for r in rs if r["group"] not in STOP_GROUPS])}


def reasons_by_time(data, session, res=None):
    """Every reason to pause in the whole run, keyed by time: {T: [reason]}. Only the ones at or before the
    current pause are ever shown."""
    res = res or _sim(data, session)
    out = {}
    big = {T: stop for T, rs in _failures(data, session).items() if (stop := [r for r in rs if r["group"] in STOP_GROUPS])}
    for part in (big, _events(data, session), _warnings(data, session, res), _price_jumps(data, res)):
        for T, rs in part.items():
            out.setdefault(T, []).extend(rs)
    for T, rs in out.items():                      # a price event starting now already explains a price jump
        if any(r["type"] == "event_started" and r["details"]["parameter"] == "electricity_price_chf_kwh" for r in rs):
            out[T] = [r for r in rs if r["type"] != "price_jump"]
    return out


# ---------------------------------------------------------------- decisions and previews
def _check_swap(data, session, swap):
    """A swap for this session with an explicit year >= t. "year": "now" (or no year) means t."""
    t, H = session["t"], _horizon(data, session)
    sw = {k: v for k, v in swap.items() if k != "timing"}
    year = sw.get("year", "now")
    year = t if year == "now" else year
    if not isinstance(year, int) or isinstance(year, bool):
        raise ValueError(f"Swap year must be a whole year or 'now', got {year!r}.")
    if year < t:
        raise ValueError(f"A swap in year {year} is in the past: it is now time {t} (end of year {t}). "
                         "Decisions can only start now or later.")
    if year >= H:
        raise ValueError(f"A swap in year {year} would come after the last year of the run ({H}).")
    option = data["options"].get(sw.get("option"))
    if not option or option["group"] != sw.get("group"):
        raise ValueError(f"{sw.get('option')!r} is not an option of group {sw.get('group')!r}.")
    sw["year"], sw["firm"] = year, True       # exactly then: never pulled into the past (engine.FirmYear)
    return sw


def _preview(data, session, swaps, base=None):
    """What adding these swaps would change, in this future and with the decisions so far."""
    H = _horizon(data, session)
    swaps = [_check_swap(data, session, s) for s in swaps]
    a = base or _sim(data, session)
    b = _sim(data, session, session["decisions"] + swaps)
    Y = min(s["year"] for s in swaps)
    capex = (b["capex_year0"] - a["capex_year0"]) if Y == 0 else (b["years"][Y - 1]["capex"] - a["years"][Y - 1]["capex"])
    out = {"swaps": swaps, "year": Y, "extra_capex_chf": capex,
           "delta_npv_cash": b["npv_cash"] - a["npv_cash"],
           "delta_npv_economic": b["npv_economic"] - a["npv_economic"],
           "new_flags": [f for f in b["flags"] if f not in a["flags"]]}
    if Y < H:                                      # first year the swaps are active
        ya, yb = a["years"][Y], b["years"][Y]
        out["first_active_year"] = Y + 1
        out |= {"delta_kwh": yb["kwh"] - ya["kwh"], "delta_operating_cost": yb["operating_cost"] - ya["operating_cost"],
                "delta_comfort": yb["outcomes"]["comfort_score"] - ya["outcomes"]["comfort_score"],
                "delta_meeting_co2_ppm": yb["outcomes"]["meeting_co2_ppm"] - ya["outcomes"]["meeting_co2_ppm"],
                "delta_perf_change": yb["people_value"]["perf_change"] - ya["people_value"]["perf_change"]}
    return out


def _reactions(data, session, reasons, res):
    """For a failure: every option for the failed items, previewed at this time. Otherwise: groups to look at."""
    out = []
    for k, r in enumerate(reasons):
        if r["type"] == "failure":
            old = set(r["details"]["old_options"])
            options = []
            for o in (o for o in data["options"].values() if o["group"] == r["group"]):
                swaps = [{"group": r["group"], "option": o["option_id"], "item_id": iid, "year": r["time"]}
                         for iid in r["item_ids"]]
                options.append({"option_id": o["option_id"], "name": o["name"], "tier": o["tier"],
                                "like_for_like": o["option_id"] in old, "swaps": swaps,
                                "preview": _preview(data, session, swaps, base=res)})
            items = set(r["item_ids"])
            planned_later = [d for d in session["decisions"] if d["year"] > r["time"]
                             and items & {i["id"] for i in engine.swap_items(data, d)}]
            out.append({"reason": k, "type": "failure", "group": r["group"], "options": options,
                        "planned_later": planned_later})
            continue
        if r["type"] in ("event_announced", "event_started"):
            groups = EVENT_GROUPS.get(r["details"]["event_id"], [])
        elif r["type"] == "new_flag":
            groups = FLAG_GROUPS.get(r["details"]["flag"], [])
        else:
            groups = PRICE_GROUPS
        floors = r["floors"] or [None]
        out.append({"reason": k, "type": r["type"], "groups": [
            {"group": g, "floor": f, "options": [o["option_id"] for o in data["options"].values()
                                                 if o["group"] == g and o["tier"] != "current"]}
            for g in groups for f in floors]})
    return out


# ---------------------------------------------------------------- states
def _row(row):
    return {k: row[k] for k in ROW_FIELDS} | {"comfort_score": row["outcomes"]["comfort_score"],
                                              "meeting_co2_ppm": row["outcomes"]["meeting_co2_ppm"]}


def _situation(data, session, T, reasons, reactions, res):
    """Structured facts for an LLM to narrate. Numbers only from the engine runs above."""
    H = _horizon(data, session)
    options = []
    for r in reactions:
        if r["type"] == "failure":
            options.append({"about": reasons[r["reason"]]["title"], "options": [
                {"option_id": o["option_id"], "name": o["name"], "like_for_like": o["like_for_like"],
                 **{k: o["preview"].get(k) for k in ("extra_capex_chf", "delta_npv_cash", "delta_npv_economic",
                                                     "delta_kwh", "delta_comfort")}} for o in r["options"]]})
        else:
            options.append({"about": reasons[r["reason"]]["title"], "groups_to_consider": r["groups"]})
    return {
        "time": T, "horizon": H, "future": session["future_name"],
        "what_happened": [{"type": r["type"], "title": r["title"], "details": r["details"]} for r in reasons],
        "now": _row(res["years"][T - 1]) if T >= 1 else None,
        "next_year_if_nothing_else_changes": _row(res["years"][T]) if T < H else None,
        "decisions_so_far": session["decisions"],
        "options": options,
    }


def _plan(session, T):
    """The decisions split at time T: done (before T, locked) and planned (T or later, can still change)."""
    return {"done": [d for d in session["decisions"] if d["year"] < T],
            "planned": [d for d in session["decisions"] if d["year"] >= T]}


def _state(data, session, T):
    """Everything the player sees at a pause at time T. Rows after year T are never included."""
    res = _sim(data, session, detail_years=(max(T, 1),))
    reasons = reasons_by_time(data, session, res).get(T, [])
    reactions = _reactions(data, session, reasons, res)
    snapshot = (viz.snapshot(data, res, T, "state") if T >= 1
                else viz.snapshot(data, res, 1, "state_baseline"))        # today: the building as it is
    since = session.get("previous_t", -1)          # small wear-outs since the last stop, replaced like-for-like
    routine = [{k: r[k] for k in ("time", "group", "floors", "title")}
               for t, rs in sorted(routine_by_time(data, session).items()) if since < t <= T for r in rs]
    state = {"t": T, "horizon": _horizon(data, session), "ended": False, "future": session["future_name"],
             "reasons": reasons, "routine": routine, "decisions": session["decisions"], "plan": _plan(session, T),
             "history": viz.finance(res)["years"][:T], "snapshot": snapshot, "reactions": reactions,
             "situation": _situation(data, session, T, reasons, reactions, res)}
    session["state"] = viz.clean(state)
    return session["state"]


def _end(data, session):
    """The run is over: the player's path against doing nothing in the same future."""
    H = _horizon(data, session)
    session["t"], session["ended"] = H, True
    res = _sim(data, session, detail_years=(H,))
    last = res["years"][-1]
    state = {"t": H, "horizon": H, "ended": True, "future": session["future_name"], "reasons": [],
             "decisions": session["decisions"], "plan": _plan(session, H), "history": viz.finance(res)["years"],
             "snapshot": viz.snapshot(data, res, H, "state"), "reactions": [],
             "result": {"npv_cash": res["npv_cash"], "npv_economic": res["npv_economic"],
                        "payback_cash": res["payback_cash"], "payback_economic": res["payback_economic"],
                        "npv_breakdown": res["npv_breakdown"], "flags": res["flags"],
                        "reserve_at_end": last["cash_closing"], "reserve_at_end_doing_nothing": last["cash_closing_baseline"],
                        "decisions": len(session["decisions"])},
             "situation": {"time": H, "horizon": H, "future": session["future_name"], "ended": True,
                           "npv_cash_vs_doing_nothing": res["npv_cash"],
                           "npv_economic_vs_doing_nothing": res["npv_economic"],
                           "end": _row(last), "decisions_so_far": session["decisions"]}}
    session["state"] = viz.clean(state)
    return session["state"]


# ---------------------------------------------------------------- the API of a session
def start(data, future, name=None, years=None):
    """A new session at t = 0. Returns (session, opening state): the building today and anything at time 0.
    years: how long the game runs, 1 to the engine's horizon (default: the whole horizon)."""
    full = int(data["params"]["horizon_years"])
    if years is not None and not (isinstance(years, int) and 1 <= years <= full):
        raise ValueError(f"A game runs 1 to {full} years.")
    session = new(future, name, years)
    return session, _state(data, session, 0)


def next_pause(data, session):
    """Run on to the next time T > t where something happens and return the state there,
    or the end-of-run summary if nothing happens before the horizon."""
    if session["ended"]:
        return session["state"]
    times = [T for T in reasons_by_time(data, session) if session["t"] < T < _horizon(data, session)]
    session["previous_t"] = session["t"]
    if not times:
        return _end(data, session)
    session["t"] = min(times)
    return _state(data, session, session["t"])


def _drop_overridden(data, decisions, t):
    """Drop planned decisions (year >= t) that newer decisions fully override for every item they cover."""
    keep = []
    for k, d in enumerate(decisions):
        if d["year"] >= t:
            items = {i["id"] for i in engine.swap_items(data, d)}
            later = set()
            for e in decisions[k + 1:]:
                if e["year"] <= d["year"]:
                    later |= {i["id"] for i in engine.swap_items(data, e)}
            if items <= later:
                continue
        keep.append(d)
    return keep


def decide(data, session, swaps):
    """Add to the plan, now or for later years. Every swap needs a year >= t ("now" means t); otherwise
    nothing is added and a ValueError explains why. A new decision replaces the planned steps of the items
    it covers from its year on (e.g. choosing an upgrade for a broken unit now cancels the upgrade you had
    planned for it later). Returns the updated state at the same pause."""
    if session["ended"]:
        raise ValueError("This run has ended.")
    checked = [_check_swap(data, session, s) for s in swaps]
    session["decisions"] = _drop_overridden(data, session["decisions"] + checked, session["t"])
    return _state(data, session, session["t"])


def set_plan(data, session, plan):
    """Replace everything not done yet (decisions for year t or later) with `plan`. Done decisions stay."""
    if session["ended"]:
        raise ValueError("This run has ended.")
    checked = [_check_swap(data, session, s) for s in plan]
    done = [d for d in session["decisions"] if d["year"] < session["t"]]
    session["decisions"] = _drop_overridden(data, done + checked, session["t"])
    return _state(data, session, session["t"])


def preview(data, session, swap):
    """What a swap (or a list of swaps) would change, in this future with the decisions so far."""
    return viz.clean(_preview(data, session, swap if isinstance(swap, list) else [swap]))


def outlook_futures(data, session, n=100, seed=2026):
    """n futures that agree with everything revealed by now (see montecarlo.draw_future_after)."""
    rng = random.Random(seed)
    return [montecarlo.draw_future_after(data, rng, session["future"], session["t"]) for _ in range(n)]


def outlook(data, session, n=100, seed=2026):
    """An updated forecast from now: the decisions so far run over n futures that keep the revealed past.
    Returns a P10/P50/P90 fan of the cumulative gain vs doing nothing from year t + 1, and how often the
    player's path beats doing nothing."""
    t, H = session["t"], _horizon(data, session)
    runs = [engine.simulate(data, session["decisions"], overrides=_overrides(data, session), future=f, detail_years=())
            for f in outlook_futures(data, session, n, seed)]
    pct = montecarlo._pct
    fan = {view: [{"year": y, **{q: pct([r["years"][y - 1][f"cumulative_{view}_cf"] for r in runs], v)
                                 for q, v in (("p10", .1), ("p50", .5), ("p90", .9))}}
                  for y in range(t + 1, H + 1)] for view in ("cash", "economic")}
    return viz.clean({
        "t": t, "n": n, "seed": seed, "fan": fan,
        "npv_cash": {q: pct([r["npv_cash"] for r in runs], v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
        "npv_economic": {q: pct([r["npv_economic"] for r in runs], v) for q, v in (("p10", .1), ("p50", .5), ("p90", .9))},
        "prob_beats_doing_nothing_cash": sum(r["npv_cash"] > 0 for r in runs) / n,
        "prob_beats_doing_nothing_economic": sum(r["npv_economic"] > 0 for r in runs) / n,
        "method": "Futures that keep the price path, events and failures revealed so far; the rest is drawn as in "
                  "the Monte Carlo (price walk, yearly events, lab, unit lifetimes, people-effect strengths).",
    })
