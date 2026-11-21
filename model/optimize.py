"""Find the best set of upgrades for a goal, with the engine as the judge.

A plan picks one option per zone. A zone is one group in one place: "lighting@2" (lighting on floor 2)
or "heating_cooling" (one decision for the building). Every change goes in now. The plan becomes an
engine scenario, so every number in a result comes from engine.simulate.

    import engine, optimize
    d = engine.load()
    optimize.min_cost_for_target(d, "energy_cost_saving_pct", 10)      # cheapest plan for a 10% lower bill
    optimize.max_savings(d, budget=200_000)                             # most running-cost savings for CHF 200k
    optimize.min_total_cost(d, years=10)                                # cheapest over 10 years, all costs in
    optimize.pareto(d)                                                  # cost vs savings trade-off curve

How the search works:
1. Screening: try each zone change on its own and record what it does to every metric.
2. Surrogate: treat those effects as if they add up, and solve that model with a dynamic programme
   that keeps every plan no other plan beats on the objective and on each constraint (exact for small
   problems; for the full building it keeps the best plans per cost bucket). This gives candidates for
   every budget at once.
3. Reality: run the candidates through the engine. Then re-measure the single-zone effects around the
   best plan, solve the surrogate again from there (and try the most promising two-zone changes),
   and repeat. When the best plan stops improving, restart from the best plans not yet explored.
   The search stops when those run out or after a fixed number of plans (SOLVE_PLANS, PARETO_PLANS),
   never on the clock, so the same inputs always give the same answer.
Plans are compared by: smallest shortfall on the constraints first, then the objective, then the tie-break,
then fewer changed zones. Small sub-problems (EXHAUSTIVE_LIMIT plans or fewer, within the budget) are
simply tried in full.

Payback is not additive, so the surrogate adds up the yearly cash flows instead and computes payback
from them the way the engine does; a payback limit P becomes "cumulative cash at year P is not negative".

Plans are evaluated with the engine's own building blocks (see _Ctx), which give exactly the numbers of
engine.simulate (tested); every returned plan is re-run through engine.simulate itself.
"""
import bisect
import math
import time

import engine
import viz

# ------------------------------------------------------------------ metrics
METRICS = {
    "upfront_cost_chf": {"unit": "CHF", "better": "lower",
                         "description": "What the changes cost to buy and install now, after the solar subsidy."},
    "net_upfront_cost_chf": {"unit": "CHF", "better": "lower",
                             "description": "Extra up-front cost over the like-for-like replacements that are due now anyway."},
    "energy_cost_saving_chf_year": {"unit": "CHF/year", "better": "higher",
                                    "description": "Lower electricity bill in year 1 (grid electricity minus solar sold back)."},
    "energy_cost_saving_pct": {"unit": "%", "better": "higher",
                               "description": "Lower electricity bill in year 1, as a share of today's bill."},
    "operating_cost_saving_chf_year": {"unit": "CHF/year", "better": "higher",
                                       "description": "Lower running costs in year 1: electricity bill, maintenance, consumables and extra rent."},
    "operating_cost_saving_pct": {"unit": "%", "better": "higher",
                                  "description": "Lower running costs in year 1, as a share of today's running costs."},
    "energy_saving_kwh_year": {"unit": "kWh/year", "better": "higher",
                               "description": "Less electricity used in year 1."},
    "energy_saving_pct": {"unit": "%", "better": "higher",
                          "description": "Less electricity used in year 1, as a share of today's use."},
    "grid_energy_saving_kwh_year": {"unit": "kWh/year", "better": "higher",
                                    "description": "Less electricity bought from the grid in year 1 (counts on-site solar)."},
    "grid_energy_saving_pct": {"unit": "%", "better": "higher",
                               "description": "Less electricity bought from the grid in year 1, as a share of today's."},
    "total_cost_chf": {"unit": "CHF", "better": "lower",
                       "description": "Everything the building costs over the timeframe: purchases, replacements and running costs, minus what the equipment is still worth at the end."},
    "total_cost_saving_chf": {"unit": "CHF", "better": "higher",
                              "description": "How much less the building costs over the timeframe than doing nothing."},
    "total_energy_kwh": {"unit": "kWh", "better": "lower",
                         "description": "Electricity used over the timeframe."},
    "total_energy_saving_kwh": {"unit": "kWh", "better": "higher",
                                "description": "Electricity saved over the timeframe, compared with doing nothing."},
    "npv_cash_chf": {"unit": "CHF", "better": "higher",
                     "description": "Net present value of the cash flows over the timeframe (engine figure)."},
    "npv_economic_chf": {"unit": "CHF", "better": "higher",
                         "description": "Net present value including people effects: productivity, sick days, time saved."},
    "payback_years": {"unit": "years", "better": "lower",
                      "description": "Years until the plan has paid for itself in cash; None if it never does."},
    "comfort_score": {"unit": "score", "better": "higher",
                      "description": "Comfort score from 0 to 100 in year 1 (air, temperature, light, screens, coffee)."},
    "office_co2_ppm": {"unit": "ppm", "better": "lower",
                       "description": "CO2 in offices at the busiest hour in year 1 (lower is fresher air)."},
    "meeting_co2_ppm": {"unit": "ppm", "better": "lower",
                        "description": "CO2 in meeting rooms at the busiest hour in year 1."},
    "sick_days": {"unit": "days/year", "better": "lower",
                  "description": "Sick days per employee per year in year 1."},
}

# Short names for messages.
_LABEL = {
    "upfront_cost_chf": "up-front cost", "net_upfront_cost_chf": "extra up-front cost",
    "energy_cost_saving_chf_year": "energy bill saving", "energy_cost_saving_pct": "energy bill saving",
    "operating_cost_saving_chf_year": "running-cost saving", "operating_cost_saving_pct": "running-cost saving",
    "energy_saving_kwh_year": "electricity saving", "energy_saving_pct": "electricity saving",
    "grid_energy_saving_kwh_year": "grid electricity saving", "grid_energy_saving_pct": "grid electricity saving",
    "total_cost_chf": "total cost", "total_cost_saving_chf": "total cost saving",
    "total_energy_kwh": "total electricity use", "total_energy_saving_kwh": "total electricity saving",
    "npv_cash_chf": "net present value", "npv_economic_chf": "net present value with people effects",
    "payback_years": "payback time", "comfort_score": "comfort score", "office_co2_ppm": "office CO2",
    "meeting_co2_ppm": "meeting-room CO2", "sick_days": "sick days",
}

# Groups whose choices interact so strongly that they are decided together:
# the lake-water heat pump frees the roof, so the solar system gets bigger (engine.pv_units).
COUPLED_GROUPS = (("heating_cooling", "solar_pv"),)
LAKE = "heating_cooling_premium"

_TOL = 1e-9              # relative tolerance for "constraint met"


def _fmt(metric, v):
    """A metric value in plain words, e.g. 'CHF 31,200/year' or '10.4%'."""
    if v is None or (isinstance(v, float) and math.isinf(v)):
        return "never" if metric == "payback_years" else "n/a"
    unit = METRICS[metric]["unit"]
    if unit.startswith("CHF"):
        return f"CHF {v:,.0f}" + unit[3:]
    if unit == "%":
        return f"{v:.1f}%" if abs(v) >= 1 else f"{v:.2f}%"
    if unit in ("years", "days/year"):
        return f"{v:.1f} {unit}"
    if unit == "score":
        return f"{v:.1f}"
    return f"{v:,.0f} {unit}"


# ------------------------------------------------------------------ zones
def _group_options(data):
    out = {}
    for o in data["options"].values():
        out.setdefault(o["group"], []).append(o["option_id"])
    return out


def zones(data, granularity="floor"):
    """The decisions: one zone per group, or per served floor for groups that serve several floors."""
    return [{k: z[k] for k in ("zone", "group", "floor", "current_option", "options", "units", "item_ids")}
            for z in _zones(data, granularity)]


def _zones(data, granularity):
    if granularity not in ("floor", "building"):
        raise ValueError(f"granularity must be 'floor' or 'building', not {granularity!r}")
    gopts = _group_options(data)
    by_group = {}
    for i in data["items"]:
        by_group.setdefault(i["group"], []).append(i)
    out = []
    for g in gopts:
        items = by_group.get(g)
        if not items:
            continue
        floors = sorted({engine.served_floor(i) for i in items})
        parts = ([(f, [i for i in items if engine.served_floor(i) == f]) for f in floors]
                 if granularity == "floor" and len(floors) > 1 else [(None, items)])
        for f, its in parts:
            cur = {i["option"] for i in its}
            current = cur.pop() if len(cur) == 1 else None
            out.append({"zone": g if f is None else f"{g}@{f}", "group": g, "floor": f,
                        "current_option": current, "options": [o for o in gopts[g] if o != current],
                        "units": sum(i["units"] for i in its), "item_ids": [i["id"] for i in its],
                        "served_floors": sorted({engine.served_floor(i) for i in its})})
    return out


# ------------------------------------------------------------------ scope
def _as_list(x):
    return list(x) if isinstance(x, (list, tuple, set)) else [x]


def _check_selector(data, gopts, sel, granularity, where):
    if not isinstance(sel, dict) or "group" not in sel:
        raise ValueError(f"Each selector in scope[{where!r}] needs a 'group', e.g. {{'group': 'lighting'}}.")
    extra = set(sel) - {"group", "floor", "option"}
    if extra:
        raise ValueError(f"Unknown key(s) {sorted(extra)} in a scope[{where!r}] selector.")
    g = sel["group"]
    if not isinstance(g, str) or g not in gopts:
        raise ValueError(f"Unknown group {g!r}. Groups: {', '.join(gopts)}.")
    floors = None
    if sel.get("floor") is not None:
        if granularity == "building":
            raise ValueError("A selector can't name a floor when granularity is 'building'.")
        floors = _as_list(sel["floor"])
        if not all(isinstance(f, int) and not isinstance(f, bool) for f in floors):
            raise ValueError(f"Floors must be whole numbers, got {sel['floor']!r}.")
        floors = set(floors)
    opts = None
    if sel.get("option") is not None:
        opts = _as_list(sel["option"])
        for o in opts:
            if not isinstance(o, str) or o not in data["options"]:
                raise ValueError(f"Unknown option {o!r}.")
            if data["options"][o]["group"] != g:
                raise ValueError(f"Option {o!r} belongs to group {data['options'][o]['group']!r}, not {g!r}.")
        opts = set(opts)
    return g, floors, opts


class _Space:
    """The zones of one granularity and, after the scope, the choices left in each.

    A choice is an option id, or None for "keep what is installed". Zones of coupled groups
    are joined into one unit, so that up-front cost stays exactly additive over units."""

    def __init__(self, data, granularity, scope):
        self.granularity = granularity
        self.zones = _zones(data, granularity)
        self.choices = self._scope(data, scope or {})
        self.units = self._units()

    def _scope(self, data, scope):
        gopts = _group_options(data)
        known = {"allowed", "locked", "required", "excluded_options"}
        if not isinstance(scope, dict) or set(scope) - known:
            raise ValueError(f"scope keys must be among {sorted(known)}.")
        excluded = _as_list(scope.get("excluded_options") or [])
        for o in excluded:
            if not isinstance(o, str) or o not in data["options"]:
                raise ValueError(f"Unknown option {o!r} in excluded_options.")
        excluded = set(excluded)
        parsed = {k: [_check_selector(data, gopts, s, self.granularity, k) for s in _as_list(scope.get(k) or [])]
                  for k in ("allowed", "locked", "required")}

        def matches(sel, z):
            g, floors, _ = sel
            return z["group"] == g and (floors is None or bool(floors & set(z["served_floors"])))

        for k, sels in parsed.items():
            for s in sels:
                if not any(matches(s, z) for z in self.zones):
                    raise ValueError(f"No zone matches scope[{k!r}] selector for group {s[0]!r}"
                                     + (f" on floor(s) {sorted(s[1])}." if s[1] else "."))
        out = []
        for z in self.zones:
            opts = [o for o in z["options"] if o not in excluded]
            if "allowed" in scope and scope["allowed"] is not None:
                hits = [s for s in parsed["allowed"] if matches(s, z)]
                ok = set()
                for s in hits:
                    ok |= set(opts) if s[2] is None else s[2]
                opts = [o for o in opts if o in ok]
            locked = False
            for s in parsed["locked"]:
                if matches(s, z):
                    if s[2] is None:
                        locked = True
                    else:
                        opts = [o for o in opts if o not in s[2]]
            if locked:
                opts = []
            req = [s for s in parsed["required"] if matches(s, z)]
            if req:
                if locked:
                    raise ValueError(f"Zone {z['zone']} is both required to change and locked.")
                for s in req:
                    if s[2] is not None:
                        opts = [o for o in opts if o in s[2]]
                if not opts:
                    raise ValueError(f"Zone {z['zone']} must change, but no allowed option is left for it "
                                     f"(check the required option, allowed, locked and excluded_options).")
                out.append(opts)
            else:
                out.append([None] + opts)
        return out

    def _units(self):
        """Groups of zone indices decided together, and their joint choices."""
        units, used = [], set()
        for pair in COUPLED_GROUPS:
            idx = [k for k, z in enumerate(self.zones) if z["group"] in pair and len(self.choices[k]) > 1]
            n = math.prod(len(self.choices[k]) for k in idx) if idx else 0
            if len(idx) > 1 and n <= 64:
                units.append(idx)
                used.update(idx)
        for k in range(len(self.zones)):
            if k not in used and len(self.choices[k]) > 1:
                units.append([k])
        units.sort(key=lambda u: u[0])
        out = []
        for u in units:
            combos = [()]
            for k in u:
                combos = [c + (o,) for c in combos for o in self.choices[k]]
            out.append({"zones": u, "choices": combos})
        return out

    def base(self):
        """Doing nothing, or the closest plan to it (required zones take their first option)."""
        return tuple(c[0] for c in self.choices)

    def nothing(self):
        return (None,) * len(self.zones)

    def with_unit(self, cfg, u, choice):
        cfg = list(cfg)
        for k, o in zip(self.units[u]["zones"], choice):
            cfg[k] = o
        return tuple(cfg)

    def scenario(self, cfg):
        out = []
        for z, o in zip(self.zones, cfg):
            if o is not None:
                out.append({"group": z["group"], "option": o} | ({"floor": z["floor"]} if z["floor"] is not None else {}))
        return out


# ------------------------------------------------------------------ evaluation
def _lake(space_zones, cfg):
    """True when the plan ends with the lake-water heat pump (it frees roof space for solar)."""
    for z, o in zip(space_zones, cfg):
        if z["group"] == "heating_cooling":
            if (o or z["current_option"]) == LAKE:
                return True
    return False


def _zone_upfront(data, zone, option, lake):
    """Purchase + install of one zone change, minus the solar subsidy. Same rule as chat/tools.py _upfront()."""
    if option is None:
        return 0.0
    o = data["options"][option]
    price = (o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0)
    sel = {"_": LAKE} if lake else {}
    total = 0.0
    for iid in zone["item_ids"]:
        item = data["item_by_id"][iid]
        if item["option"] == option:
            continue
        u = engine.units_of(data, item, option, sel)
        total += u * price
        if item["group"] == "solar_pv":
            total -= u * data["params"]["pv_subsidy_chf_per_kwp"]
    return total


def _upfront_of_choices(data, choices):
    """chat/tools.py _upfront() for an engine `choices` dict (only changes made now count)."""
    sel = engine.baseline(data) | {iid: c[0] for iid, c in choices.items()}
    total = 0.0
    for iid, (oid, timing) in choices.items():
        if timing != "now":
            continue
        item, o = data["item_by_id"][iid], data["options"][oid]
        u = engine.units_of(data, item, oid, sel)
        total += u * ((o["purchase_chf_per_unit"] or 0) + (o["install_chf_per_unit"] or 0))
        if item["group"] == "solar_pv":
            total -= u * data["params"]["pv_subsidy_chf_per_kwp"]
    return total


class _Ctx:
    """One engine setting (data, events, overrides, horizon): the do-nothing path, the reference state,
    each year's context, and a cache of evaluated plans.

    `run(space, cfg)` evaluates a plan with the engine's own building blocks (_year_state, item_plan,
    plan_money, people_value, payback), in the same way as engine.simulate but reusing everything that
    does not depend on the plan. test_optimize.py checks it against engine.simulate."""

    def __init__(self, data, events, overrides, horizon):
        self.data = data
        self.events = tuple(events)
        self.overrides = dict(overrides)
        self.over = {**self.overrides, "horizon_years": horizon}
        p = {**data["params"], **self.over}
        self.p, self.H, self.r = p, int(p["horizon_years"]), p["discount_rate_real"]
        H = self.H
        self.base_sel = engine.baseline(data)
        plans_b = {i["id"]: engine.item_plan(data, i, None, H) for i in data["items"]}
        self.capex_b, assets_b = engine.plan_money(data, plans_b, self.base_sel, H, p)
        self.book_b = engine.book_value(assets_b, H)
        ref_ctx = engine.year_context(data, 1, (), self.over)
        self.ref = engine.energy(data, ref_ctx, self.base_sel)
        cool = self.ref["thermal"]["cooling_kwh_th"]
        lpp = engine.office_air_per_person(data, engine.environment(data, ref_ctx, self.base_sel, cool, cool))
        self.ctxs, self.year_kind, kinds = [], [], {}
        for t in range(1, H + 1):
            c = engine.year_context(data, t, self.events, self.over)
            c["office_lpp_today"] = lpp
            sig = (c["staff"], c["cooling_mult"], c["heating_mult"], c["price"])
            if sig not in kinds:
                kinds[sig] = len(self.ctxs)
                self.ctxs.append(c)
            self.year_kind.append(kinds[sig])
        self.ycs = [self.ctxs[k] for k in self.year_kind]
        self.yb = [engine._year_state(data, c, self.base_sel, self.ref) for c in self.ctxs]
        yb = [self.yb[k] for k in self.year_kind]
        self.op_b = [sum(b["costs"].values()) for b in yb]          # do-nothing rows, shared by every plan
        self.kwh_b = [b["energy"]["total_kwh"] for b in yb]
        self.money, self.upfront, self.cache = {}, {}, {}
        self.use_engine = False          # True: evaluate with engine.simulate itself (slower, used as a fallback)

    def zone_money(self, zone, option, lake):
        """Capex per year and book value at the horizon for one zone's items under one choice."""
        key = (zone["zone"], option, lake and zone["group"] == "solar_pv")
        if key not in self.money:
            d = self.data
            plans = {}
            for iid in zone["item_ids"]:
                item = d["item_by_id"][iid]
                ch = (option, "now") if option is not None and option != item["option"] else None
                plans[iid] = engine.item_plan(d, item, ch, self.H)
            capex, assets = engine.plan_money(d, plans, {"_": LAKE} if lake else {}, self.H, self.p)
            self.money[key] = (capex, engine.book_value(assets, self.H))
        return self.money[key]

    def zone_upfront(self, zone, option, lake):
        key = (zone["zone"], option, lake and zone["group"] == "solar_pv")
        if key not in self.upfront:
            self.upfront[key] = _zone_upfront(self.data, zone, option, lake)
        return self.upfront[key]

    def run(self, space, cfg):
        """Raw engine numbers for one plan (memoised)."""
        key = (space.granularity, cfg)
        if key in self.cache:
            return self.cache[key]
        d, H = self.data, self.H
        lake = _lake(space.zones, cfg)
        capex_s, book_s, upfront = list(self.capex_b), self.book_b, 0.0
        sel = dict(self.base_sel)
        for z, o in zip(space.zones, cfg):
            if o is None:                        # unchanged zones add exactly nothing to the do-nothing path
                continue
            (c, b), (c0, b0) = self.zone_money(z, o, lake), self.zone_money(z, None, False)
            for t in range(H + 1):
                capex_s[t] += c[t] - c0[t]
            book_s += b - b0
            upfront += self.zone_upfront(z, o, lake)
            for iid in z["item_ids"]:
                sel[iid] = o
        if self.use_engine:
            raw = _raw_from_sim(self, engine.simulate(d, space.scenario(cfg), list(self.events), self.over), upfront)
        else:
            n0 = len(engine._MEMO)
            ys_k = [engine._year_state(d, c, sel, self.ref) for c in self.ctxs]
            while len(engine._MEMO) > n0:       # plans tried in a search are not reused: keep the engine's memo small
                engine._MEMO.popitem()
            raw = self._finance(capex_s, book_s, [ys_k[k] for k in self.year_kind], [self.yb[k] for k in self.year_kind])
            raw["upfront"] = upfront
        if len(self.cache) > 50000:
            self.cache.clear()
        self.cache[key] = raw
        return raw

    def _finance(self, capex_s, book_s, ys, yb):
        """The money loop of engine.simulate, for plans whose swaps are all made now."""
        H, r, cb = self.H, self.r, self.capex_b
        upfront = capex_s[0] - cb[0]
        npv_c = npv_e = cum_c = cum_e = -upfront
        cums_c, cums_e = [], []
        op, kwh = [], []
        for t in range(1, H + 1):
            s, b, ctx = ys[t - 1], yb[t - 1], self.ycs[t - 1]
            pv = engine.people_value(s["outcomes"], b["outcomes"], ctx)
            saving = {k: b["costs"][k] - s["costs"][k] for k in s["costs"]}
            residual = (book_s - self.book_b) if t == H else 0.0
            cf = sum(saving.values()) + (-(capex_s[t] - cb[t]) + residual)
            cf_e = cf + pv["productivity_chf"] + pv["sick_days_chf"] + pv["time_saved_chf"]
            dd = (1 + r) ** t
            cums_c.append((cum_c, cum_c + cf, cf))
            cums_e.append((cum_e, cum_e + cf_e, cf_e))
            cum_c += cf
            cum_e += cf_e
            npv_c += cf / dd
            npv_e += cf_e / dd
            op.append(sum(s["costs"].values()))
            kwh.append(s["energy"]["total_kwh"])
            if t == 1:
                sav1 = sum(saving.values())
        s, b = ys[0], yb[0]
        raw = _raw(s, b, sav1, capex_s, cb, op, self.op_b, kwh, self.kwh_b, book_s, self.book_b,
                   npv_c, npv_e, engine.payback(cums_c))
        raw["cash"] = [c[2] for c in cums_c]
        return raw


def _raw(s, b, sav1, capex_s, capex_b, op, op_b, kwh, kwh_b, book_s, book_b, npv_c, npv_e, payback):
    """The numbers every metric is built from, for one plan."""
    out_s, out_b = s["outcomes"], b["outcomes"]
    return {
        "bill": s["costs"]["energy"] + s["costs"]["pv_export"], "bill_b": b["costs"]["energy"] + b["costs"]["pv_export"],
        "sav1": sav1, "grid": s["energy"]["grid_kwh"], "grid_b": b["energy"]["grid_kwh"],
        "capex_s": capex_s, "capex_b": capex_b, "op": op, "op_b": op_b, "kwh": kwh, "kwh_b": kwh_b,
        "book": book_s, "book_b": book_b, "npv_cash": npv_c, "npv_economic": npv_e, "payback": payback,
        "people": {k: out_s[k] for k in ("comfort_score", "office_co2_ppm", "meeting_co2_ppm", "sick_days")},
        "people_b": {k: out_b[k] for k in ("comfort_score", "office_co2_ppm", "meeting_co2_ppm", "sick_days")},
    }


def _raw_from_sim(ctx, res, upfront):
    """The same numbers from an engine.simulate result."""
    Y = res["years"]
    y = Y[0]
    capex_b = [ctx.capex_b[0]] + [r["capex_baseline"] for r in Y]
    capex_s = [res["capex_year0"] + ctx.capex_b[0]] + [r["capex"] for r in Y]
    raw = _raw(y["state"], y["state_baseline"], sum(y["savings"].values()), capex_s, capex_b,
               [r["operating_cost"] for r in Y], [r["operating_cost_baseline"] for r in Y],
               [r["kwh"] for r in Y], [r["kwh_baseline"] for r in Y],
               Y[-1]["book_value"], Y[-1]["book_value"] - Y[-1]["residual_value"],
               res["npv_cash"], res["npv_economic"], res["payback_cash"])
    raw["upfront"] = upfront
    raw["cash"] = [r["cash_cf"] for r in Y]
    return raw


def _pct(x, base):
    return 100 * x / base if base else 0.0


def _metrics(raw, r, discounted, include_residual):
    """Every METRICS value for one plan, plus the do-nothing values for `baseline`."""
    H = len(raw["op"])
    disc = [((1 + r) ** -t if discounted else 1.0) for t in range(1, H + 1)]

    def total(capex, op, book):
        v = capex[0] + sum(dt * (c + o) for dt, c, o in zip(disc, capex[1:], op))
        return v - (disc[-1] * book if include_residual else 0.0)

    tot = total(raw["capex_s"], raw["op"], raw["book"])
    tot_b = total(raw["capex_b"], raw["op_b"], raw["book_b"])
    bill_s = raw["bill_b"] - raw["bill"]
    kwh_s = raw["kwh_b"][0] - raw["kwh"][0]
    grid_s = raw["grid_b"] - raw["grid"]
    m = {
        "upfront_cost_chf": raw["upfront"],
        "net_upfront_cost_chf": raw["capex_s"][0] - raw["capex_b"][0],
        "energy_cost_saving_chf_year": bill_s, "energy_cost_saving_pct": _pct(bill_s, raw["bill_b"]),
        "operating_cost_saving_chf_year": raw["sav1"], "operating_cost_saving_pct": _pct(raw["sav1"], raw["op_b"][0]),
        "energy_saving_kwh_year": kwh_s, "energy_saving_pct": _pct(kwh_s, raw["kwh_b"][0]),
        "grid_energy_saving_kwh_year": grid_s, "grid_energy_saving_pct": _pct(grid_s, raw["grid_b"]),
        "total_cost_chf": tot, "total_cost_saving_chf": tot_b - tot,
        "total_energy_kwh": sum(raw["kwh"]), "total_energy_saving_kwh": sum(a - b for a, b in zip(raw["kwh_b"], raw["kwh"])),
        "npv_cash_chf": raw["npv_cash"], "npv_economic_chf": raw["npv_economic"], "payback_years": raw["payback"],
        **raw["people"],
    }
    base = {"energy_cost_chf_year": raw["bill_b"], "operating_cost_chf_year": raw["op_b"][0],
            "energy_kwh_year": raw["kwh_b"][0], "grid_energy_kwh_year": raw["grid_b"],
            "total_cost_chf": tot_b, "total_energy_kwh": sum(raw["kwh_b"]), **raw["people_b"]}
    return m, base


# ------------------------------------------------------------------ settings and caches
_CTX = {}


def _check_events(data, events):
    if isinstance(events, (str, dict)) or not isinstance(events, (list, tuple, type(None))):
        raise ValueError("events must be a list of event ids, e.g. ['new_lab'].")
    events = tuple(events or ())
    for e in events:
        if not isinstance(e, str) or e not in data["events"]:
            raise ValueError(f"Unknown event {e!r}. Events: {', '.join(data['events'])}.")
    return events


def _horizon(data, overrides, horizon_years):
    h = {**data["params"], **overrides}["horizon_years"] if horizon_years is None else horizon_years
    if not _is_number(h) or h < 1 or int(h) != h:
        raise ValueError(f"horizon_years must be a whole number of years >= 1, not {h!r}.")
    return int(h)


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _ctx(data, events, overrides, horizon):
    key = (id(data), tuple(sorted(data["params"].items())), events, tuple(sorted(overrides.items())), horizon)
    if key not in _CTX:
        if len(_CTX) >= 8:
            _CTX.pop(next(iter(_CTX)), None)
        _CTX[key] = _Ctx(data, events, overrides, horizon)
    return _CTX[key]


def _settings(data, events, overrides, horizon_years):
    events = _check_events(data, events)
    if not isinstance(overrides, (dict, type(None))):
        raise ValueError("overrides must be a dict of {parameter: number}.")
    overrides = dict(overrides or {})
    for k, v in overrides.items():
        if not isinstance(k, str) or k not in data["params"]:
            raise ValueError(f"Unknown parameter {k!r} in overrides.")
        if not _is_number(v):
            raise ValueError(f"The override for {k} must be a number, not {v!r}.")
    H = _horizon(data, overrides, horizon_years)
    used = {**overrides, "horizon_years": horizon_years} if horizon_years is not None else overrides
    return events, overrides, H, used


def _check_scenario(data, scenario):
    """Each swap names a known option of its group and matches at least one piece of equipment."""
    if not isinstance(scenario, (list, tuple, type(None))):
        raise ValueError("scenario must be a list of swaps like {'group': 'lighting', 'option': 'lighting_mid'}.")
    for sw in scenario or []:
        if not isinstance(sw, dict) or not isinstance(sw.get("option"), str) or not isinstance(sw.get("group"), str):
            raise ValueError(f"Each swap needs a 'group' and an 'option' (strings), got {sw!r}.")
        o = data["options"].get(sw["option"])
        if not o:
            raise ValueError(f"Unknown option {sw['option']!r}.")
        if o["group"] != sw["group"]:
            raise ValueError(f"{o['option_id']} belongs to group {o['group']!r}, not {sw['group']!r}.")
        if "floor" in sw and not (isinstance(sw["floor"], int) and not isinstance(sw["floor"], bool)):
            raise ValueError(f"A swap's floor must be a whole number, got {sw['floor']!r}.")
        timing = sw.get("year", sw.get("timing", "now"))
        if timing not in ("now", "end_of_life") and not (_is_number(timing) and timing >= 0 and int(timing) == timing):
            raise ValueError(f"A swap's timing must be 'now', 'end_of_life' or a year, got {timing!r}.")
        if not any(i["group"] == sw["group"] and ("floor" not in sw or engine.served_floor(i) == sw["floor"])
                   and ("room_id" not in sw or i["room"] == sw["room_id"]) and ("item_id" not in sw or i["id"] == sw["item_id"])
                   for i in data["items"]):
            where = ", ".join(f"{k} {sw[k]!r}" for k in ("floor", "room_id", "item_id") if k in sw)
            raise ValueError(f"No {sw['group']} equipment matches {where}.")


def evaluate(data, scenario, events=(), overrides=None, horizon_years=None, discounted=False, include_residual=True):
    """Every metric for one scenario (engine swaps), from engine.simulate."""
    events, overrides, H, used = _settings(data, events, overrides, horizon_years)
    _check_scenario(data, scenario)
    ctx = _ctx(data, events, overrides, H)
    res = engine.simulate(data, list(scenario or []), list(events), ctx.over)
    raw = _raw_from_sim(ctx, res, _upfront_of_choices(data, res["choices"]))
    m, base = _metrics(raw, ctx.r, discounted, include_residual)
    return {"metrics": m, "baseline": base, "flags": res["flags"]}


# ------------------------------------------------------------------ goals
_INF = float("inf")


def _metric(name):
    if not isinstance(name, str) or name not in METRICS:
        raise ValueError(f"Unknown metric {name!r}. Metrics: {', '.join(METRICS)}.")
    return name


def _parse_objective(objective):
    if isinstance(objective, str):
        objective = {"metric": objective}
    if not isinstance(objective, dict):
        raise ValueError("objective must look like {'metric': 'upfront_cost_chf', 'sense': 'min'}.")
    m = _metric(objective.get("metric"))
    sense = objective.get("sense") or ("min" if METRICS[m]["better"] == "lower" else "max")
    if not isinstance(sense, str) or sense not in ("min", "max"):
        raise ValueError(f"sense must be 'min' or 'max', not {sense!r}.")
    return m, sense


def _parse_constraints(constraints):
    if not isinstance(constraints, (list, tuple, type(None))):
        raise ValueError("constraints must be a list like [{'metric': 'energy_cost_saving_pct', 'min': 10}].")
    out = []
    for c in constraints or ():
        if not isinstance(c, dict) or "metric" not in c:
            raise ValueError("Each constraint must look like {'metric': 'energy_cost_saving_pct', 'min': 10}.")
        m = _metric(c["metric"])
        extra = set(c) - {"metric", "min", "max"}
        if extra:
            raise ValueError(f"Unknown key(s) {sorted(extra)} in the constraint on {m}.")
        kinds = [k for k in ("min", "max") if c.get(k) is not None]
        if not kinds:
            raise ValueError(f"The constraint on {m} needs a 'min' or a 'max'.")
        for k in kinds:
            if not _is_number(c[k]):
                raise ValueError(f"The {k} of the constraint on {m} must be a number.")
            out.append((m, k, float(c[k])))
    return out


def _parse_tie_break(tie_break, objective):
    if tie_break is None:
        if objective[0] == "upfront_cost_chf":
            return "operating_cost_saving_chf_year", "max"
        return "upfront_cost_chf", "min"
    return _parse_objective(tie_break)


def _val(m, name):
    v = m[name]
    return _INF if v is None else v


def _dot(spec, idx, row):
    return sum(w * row[idx[n]] for n, w in spec.items())


def _frontier(units, cap=1500):
    """Pareto frontier of sums: pick one vector (x, y1, y2, ...) per unit; minimise x, maximise every y.

    Exact while the frontier stays under `cap` points; above that it keeps the best points in each
    x bucket (see _thin). Returns picks (one choice index per unit), sorted by x."""
    dims = len(units[0][0]) - 1
    spread = [sum(max(c[j] for c in ch) - min(c[j] for c in ch) for ch in units) or 1.0 for j in range(dims + 1)]
    front, levels = [((0.0,) * (dims + 1), -1, -1)], []
    for ch in units:
        cand = [(tuple(a + b for a, b in zip(p, c)), i, k) for i, (p, _, _) in enumerate(front) for k, c in enumerate(ch)]
        cand.sort(key=lambda t: (t[0][0],) + tuple(-v for v in t[0][1:]))
        new = _nondominated(cand, dims)
        if len(new) > cap:
            new = _thin(new, cap, spread)
        levels.append(new)
        front = new
    out = []
    for j in range(len(front)):
        picks, idx = [0] * len(units), j
        for lvl in range(len(units) - 1, -1, -1):
            _, idx, picks[lvl] = levels[lvl][idx]
        out.append(tuple(picks))
    return out


def _nondominated(cand, dims):
    """Points not dominated by an earlier one (cand is sorted by x, then by falling y)."""
    out = []
    if dims == 1:
        best = -_INF
        for p in cand:
            y = p[0][1]
            if y > best:
                out.append(p)
                best = y
        return out
    if dims == 2:                            # staircase over (y1, y2): y1 falling, y2 rising
        neg1, ys2 = [], []
        for p in cand:
            _, y1, y2 = p[0]
            j = bisect.bisect_right(neg1, -y1)
            if j and ys2[j - 1] >= y2:
                continue
            out.append(p)
            k = j
            while k < len(neg1) and ys2[k] <= y2:
                k += 1
            neg1[j:k] = [-y1]
            ys2[j:k] = [y2]
        return out
    for p in cand:
        v = p[0]
        if not any(all(q[0][j] >= v[j] for j in range(1, dims + 1)) for q in out):
            out.append(p)
    return out


def _thin(points, cap, spread):
    """Keep the best points per x bucket: best in each y and in their (scaled) sum.

    The surrogate is built around the current plan, which sits at x = 0 at every level. So buckets are
    narrow near 0 and widen geometrically away from it: fine detail where the search is looking."""
    dims = len(points[0][0]) - 1
    per = dims + 1 if dims > 1 else 1
    w0 = spread[0] / 20000
    step = 2 * math.log1p(20000) / max(1, cap // per)          # about cap // per buckets over the whole range
    buckets = {}
    for p in points:
        x = p[0][0]
        buckets.setdefault(int(math.copysign(math.log1p(abs(x) / w0) / step, x)), []).append(p)
    out = []
    for ps in buckets.values():
        best = [max(ps, key=lambda p, j=j: p[0][j]) for j in range(1, dims + 1)]
        if dims > 1:
            best.append(max(ps, key=lambda p: sum(p[0][j] / spread[j] for j in range(1, dims + 1))))
        out.extend({id(p): p for p in best}.values())
    out.sort(key=lambda t: (t[0][0],) + tuple(-v for v in t[0][1:]))
    return out


class _Search:
    """Best plan for one objective under constraints, judged on engine values.

    Plans are compared by key(): total relative shortfall on the constraints, then the objective,
    then the tie-break, then the number of changed zones."""

    def __init__(self, space, ctx, objective, constraints, tie_break, discounted, include_residual):
        self.space, self.ctx = space, ctx
        self.obj, self.sense = objective
        self.cons = constraints
        self.tb, self.tb_sense = tie_break
        self.disc, self.resid = discounted, include_residual
        self.true = {}
        names = [self.obj] + [c[0] for c in self.cons] + [self.tb]
        self.payback = "payback_years" in names
        # Payback is not additive, but the yearly cash flows behind it nearly are: the surrogate adds up the
        # cumulative cash at each year ("cum@t") and computes payback from them the way the engine does.
        extra = ["net_upfront_cost_chf", "operating_cost_saving_chf_year"] + [f"cum@{t}" for t in range(ctx.H + 1)]
        lin = []
        for n in names + (extra if self.payback else []):
            if n != "payback_years" and n not in lin:
                lin.append(n)
        self.lin = lin
        self.li = {n: k for k, n in enumerate(lin)}
        self.t0 = time.time()

    # --- true values
    def m(self, cfg):
        if cfg not in self.true:
            raw = self.ctx.run(self.space, cfg)
            m = _metrics(raw, self.ctx.r, self.disc, self.resid)[0]
            if self.payback:                      # cumulative cash flow by year, as in engine.simulate
                c = m["cum@0"] = -m["net_upfront_cost_chf"]
                for t, cf in enumerate(raw["cash"], 1):
                    c = m[f"cum@{t}"] = c + cf
            self.true[cfg] = m
        return self.true[cfg]

    def shortfalls(self, m, slack=None):
        out = []
        for j, (name, kind, b) in enumerate(self.cons):
            v = _val(m, name)
            s = slack[j] if slack else 0.0
            short = (b - s - v) if kind == "min" else (v - b - s)
            scale = max(abs(b), 1.0)
            out.append(short / scale if short > _TOL * scale else 0.0)
        return out

    def key(self, cfg, m=None, slack=None):
        m = self.m(cfg) if m is None else m
        o, t = _val(m, self.obj), _val(m, self.tb)
        return (round(sum(self.shortfalls(m, slack)), 9), round(o if self.sense == "min" else -o, 6),
                round(t if self.tb_sense == "min" else -t, 6), sum(x is not None for x in cfg))

    def best(self, cfgs):
        return min(cfgs, key=self.key)

    # --- surrogate
    def linearize(self, center):
        """Effect of each single unit change around a plan (evaluates the whole neighbourhood)."""
        mc = self.m(center)
        base = [mc[n] for n in self.lin]
        D = []
        for u, unit in enumerate(self.space.units):
            row = []
            for ch in unit["choices"]:
                mm = self.m(self.space.with_unit(center, u, ch))
                row.append([mm[n] - b for n, b in zip(self.lin, base)])
            D.append(row)
        return base, D

    def surrogate(self, base, D, picks):
        vals = [b + sum(col) for b, col in zip(base, zip(*(D[u][k] for u, k in enumerate(picks))))] if picks else list(base)
        m = dict(zip(self.lin, vals))
        if self.payback:
            cum = [m[f"cum@{t}"] for t in range(self.ctx.H + 1)]
            m["payback_years"] = engine.payback([(a, b, b - a) for a, b in zip(cum, cum[1:])])
        return m

    def cfg_of(self, picks):
        cfg = list(self.space.base())
        for u, k in enumerate(picks):
            for z, o in zip(self.space.units[u]["zones"], self.space.units[u]["choices"][k]):
                cfg[z] = o
        return tuple(cfg)

    def spec(self, name, sense):
        """A metric as an additive DP axis to maximise ({metric: weight})."""
        if name == "payback_years":
            return {"operating_cost_saving_chf_year": 1.0} if sense == "min" else {"net_upfront_cost_chf": 1.0}
        return {name: 1.0 if sense == "max" else -1.0}

    def cons_spec(self, j):
        name, kind, b = self.cons[j]
        if name == "payback_years":          # payback <= b  ~  cumulative cash at time b >= 0 (linear within a year)
            sgn = 1.0 if kind == "max" else -1.0
            a = min(max(int(math.floor(b)), 0), self.ctx.H)
            frac = b - a if 0 <= b and a < self.ctx.H else 0.0
            spec = {f"cum@{a}": sgn * (1.0 - frac)}
            if frac:
                spec[f"cum@{a + 1}"] = sgn * frac
            return spec
        return {name: 1.0 if kind == "min" else -1.0}

    def axes(self):
        """DP axes: x to minimise, then one axis to maximise per constraint (or the tie-break)."""
        if self.obj == "payback_years":
            x = {"net_upfront_cost_chf": 1.0}
            ys = [{"operating_cost_saving_chf_year": 1.0}]
        else:
            x = {self.obj: 1.0 if self.sense == "min" else -1.0}
            ys = []
        for j, c in enumerate(self.cons):
            s = self.cons_spec(j)
            if c[0] != self.obj and s not in ys:
                ys.append(s)
        return x, ys or [self.spec(self.tb, self.tb_sense)]

    def generate(self, base, D, slack, per=6):
        """Candidate plans: the best points of the surrogate's Pareto frontier, by the plan key
        and by the key with constraints loosened by the surrogate's typical error."""
        xs, ys = self.axes()
        units = [[(_dot(xs, self.li, r),) + tuple(_dot(y, self.li, r) for y in ys) for r in row] for row in D]
        scored = []
        for picks in _frontier(units, 1500 if len(ys) == 1 else 600):
            cfg = self.cfg_of(picks)
            sm = self.surrogate(base, D, picks)
            scored.append((self.key(cfg, sm), self.key(cfg, sm, slack), cfg, sm))
        chosen = sorted(scored, key=lambda s: s[0])[:per] + sorted(scored, key=lambda s: s[1])[:per]
        seen, out = set(), []
        for s in chosen:
            if s[2] not in seen:
                seen.add(s[2])
                out.append((s[2], s[3]))
        return out

    def pairs(self, center, base, D, slack, per=12):
        """Two-unit changes around a plan, ranked by the surrogate (its one-unit effects there are exact)."""
        units = self.space.units
        cur = [u["choices"].index(tuple(center[k] for k in u["zones"])) for u in units]
        moves = [(u, k) for u in range(len(units)) for k in range(len(units[u]["choices"])) if k != cur[u]]
        scored = []
        for i, (u, a) in enumerate(moves):
            for v, b in moves[i + 1:]:
                if v == u:
                    continue
                picks = list(cur)
                picks[u], picks[v] = a, b
                sm = dict(zip(self.lin, [x + p + q for x, p, q in zip(base, D[u][a], D[v][b])]))
                if self.payback:
                    sm = self.surrogate(base, D, picks)
                cfg = self.cfg_of(picks)
                scored.append((self.key(cfg, sm), self.key(cfg, sm, slack), cfg))
        chosen = sorted(scored, key=lambda s: s[0])[:per] + sorted(scored, key=lambda s: s[1])[:per]
        return list(dict.fromkeys(s[2] for s in chosen))

    # --- the search
    def exhaustive(self):
        cfgs = [self.space.base()]
        for u in range(len(self.space.units)):
            cfgs = [self.space.with_unit(c, u, ch) for c in cfgs for ch in self.space.units[u]["choices"]]
        return cfgs

    def size(self):
        return math.prod(len(u["choices"]) for u in self.space.units)

    def run(self, budget, time_limit=60.0):
        """Search until nothing better turns up around the best few plans, or `budget` plans have been tried.

        The budget makes the answer deterministic; time_limit is only a safety stop for a slow machine."""
        if self.size() <= min(EXHAUSTIVE_LIMIT, budget):
            return self.best(self.exhaustive()), "exhaustive"
        scale = [max(abs(b), 1.0) for (_, _, b) in self.cons]
        slack = [0.02 * s for s in scale]
        center, used = self.space.base(), set()
        while center is not None and len(self.true) < budget and time.time() - self.t0 < time_limit:
            used.add(center)
            base, D = self.linearize(center)
            cands = self.generate(base, D, slack)
            err = [0.0] * len(self.cons)
            for cfg, sm in cands:
                m = self.m(cfg)
                for j, (name, _, _) in enumerate(self.cons):
                    if math.isfinite(_val(m, name)) and math.isfinite(_val(sm, name)):
                        err[j] = max(err[j], abs(m[name] - sm[name]))
            slack = [max(1.5 * e, 1e-6 * s) for e, s in zip(err, scale)]
            if self.best(self.true) == center:          # nothing better yet: try two-zone changes
                for cfg in self.pairs(center, base, D, slack):
                    self.m(cfg)
            ranked = sorted(self.true, key=self.key)
            # Move to the best plan found; when it was already a centre, restart from the best one that wasn't.
            center = next((c for c in ranked[:ELITE] if c not in used), None)
        return self.best(self.true), "screening + surrogate DP + local search"


EXHAUSTIVE_LIMIT = 1024    # plans; a space this small (and within the budget) is simply tried in full
ELITE = 5                  # restart the search from the best plans found that were not yet a centre
SOLVE_PLANS = 1500         # plans solve() may try (fewer when events add year states); about 1-3 s
PARETO_PLANS = 2200        # plans pareto() may try (fewer with events); about 4 s


def _budget(ctx, plans, power=0.5):
    """Plan budget: fewer plans when events make each plan slower to evaluate (each distinct year state
    costs about as much as a whole plan without events). power 1 keeps the run time about constant."""
    states = len({(c["staff"], c["cooling_mult"], c["heating_mult"]) for c in ctx.ctxs})
    return int(plans / states ** power)


# ------------------------------------------------------------------ results
def _changes(data, space, cfg):
    """One line per changed zone: from what, to what, how many units, what it costs now."""
    lake = _lake(space.zones, cfg)
    sel = {"_": LAKE} if lake else {}
    out = []
    for z, o in zip(space.zones, cfg):
        if o is None:
            continue
        cur = z["current_option"]
        out.append({"zone": z["zone"], "group": z["group"], "floor": z["floor"],
                    "from_option": cur, "to_option": o,
                    "from_name": data["options"][cur]["name"] if cur else "mixed",
                    "to_name": data["options"][o]["name"],
                    "units": sum(engine.units_of(data, data["item_by_id"][i], o, sel) for i in z["item_ids"]),
                    "upfront_cost_chf": _zone_upfront(data, z, o, lake), "item_ids": list(z["item_ids"])})
    return out


def _configuration(space, cfg):
    return {z["zone"]: (o if o is not None else z["current_option"]) for z, o in zip(space.zones, cfg)}


def _settings_out(space, H, discounted, include_residual, events, overrides):
    return {"granularity": space.granularity, "horizon_years": H, "discounted": discounted,
            "include_residual": include_residual, "events": list(events), "overrides": dict(overrides)}


def _message(search, status, m, constraints_out, scoped):
    """One plain sentence (or two) for people."""
    name, sense = search.obj, search.sense
    if status == "ok":
        word = "lowest" if sense == "min" else "highest"
        if name == "upfront_cost_chf" and sense == "min":
            msg = f"The cheapest plan that meets every constraint costs {_fmt(name, m[name])} up front." if constraints_out \
                else f"The cheapest plan costs {_fmt(name, m[name])} up front."
        else:
            over = f" over {search.ctx.H} years" if name.startswith("total_") else ""
            msg = (f"The {word} {_LABEL[name]}{over} {'that meets every constraint ' if constraints_out else ''}"
                   f"is {_fmt(name, m[name])}.")
            if name != "upfront_cost_chf":
                msg += f" It costs {_fmt('upfront_cost_chf', m['upfront_cost_chf'])} up front."
        return msg
    missed = [c for c in constraints_out if not c["met"]]
    where = "these changes" if scoped else "this building"
    if len(missed) == 1:
        c = missed[0]
        n = c["metric"]
        if "min" in c:
            best = (f"The most {where} can save is {_fmt(n, c['value'])}." if "saving" in n
                    else f"The best {where} can reach is {_fmt(n, c['value'])}.")
            return f"The target of {_fmt(n, c['min'])} {_LABEL[n]} is out of reach. {best}"
        return f"The limit of {_fmt(n, c['max'])} on {_LABEL[n]} can't be met. The closest plan reaches {_fmt(n, c['value'])}."
    parts = [f"{_LABEL[c['metric']]} {_fmt(c['metric'], c['value'])} (asked {'at least' if 'min' in c else 'at most'} "
             f"{_fmt(c['metric'], c.get('min', c.get('max')))})" for c in missed]
    return "No plan meets every constraint. The closest plan reaches " + ", ".join(parts) + "."


def _agrees(a, b, names):
    for n in names:
        x, y = a[n], b[n]
        if (x is None) != (y is None) or (x is not None and abs(x - y) > 1e-6 * max(1.0, abs(y))):
            return False
    return True


def solve(data, objective, constraints=(), scope=None, events=(), overrides=None, granularity="floor",
          horizon_years=None, discounted=False, include_residual=True, tie_break=None,
          include_engine_output=True):
    """Best plan for one objective under constraints. Returns the plan, its engine numbers and a message.

    status "ok": every constraint is met. "best_effort": none can be; this is the closest plan
    (smallest total relative shortfall, then the best objective).

    scope (all optional): "allowed" (only matching zones may change, to the listed options if given),
    "locked" (matching zones stay; with "option", those options may not be installed there),
    "required" (matching zones must change, to the listed option(s) if given), "excluded_options".
    A selector is {"group": ..., "floor": int or list (optional), "option": str or list (optional)}."""
    t0 = time.time()
    obj = _parse_objective(objective)
    cons = _parse_constraints(constraints)
    tb = _parse_tie_break(tie_break, obj)
    events, overrides, H, used = _settings(data, events, overrides, horizon_years)
    space = _Space(data, granularity, scope)
    ctx = _ctx(data, events, overrides, H)
    search = _Search(space, ctx, obj, cons, tb, discounted, include_residual)
    cfg, method = search.run(_budget(ctx, SOLVE_PLANS))
    scenario = space.scenario(cfg)
    ev = evaluate(data, scenario, events, overrides, horizon_years, discounted, include_residual)
    names = [obj[0], tb[0]] + [c[0] for c in cons]
    if not _agrees(search.m(cfg), ev["metrics"], names):
        # The fast path disagrees with engine.simulate (the engine changed?): search again on the engine itself.
        ctx.use_engine = True
        ctx.cache.clear()
        search = _Search(space, ctx, obj, cons, tb, discounted, include_residual)
        cfg, method = search.run(_budget(ctx, SOLVE_PLANS), time_limit=300.0)
        method += " (engine.simulate)"
        scenario = space.scenario(cfg)
        ev = evaluate(data, scenario, events, overrides, horizon_years, discounted, include_residual)
    m = ev["metrics"]
    short = search.shortfalls(m)
    cons_out = [{"metric": n, k: b, "value": m[n], "met": s == 0} for (n, k, b), s in zip(cons, short)]
    status = "ok" if all(c["met"] for c in cons_out) else "best_effort"
    return {
        "status": status,
        "message": _message(search, status, m, cons_out, bool(scope)),
        "objective": {"metric": obj[0], "sense": obj[1], "value": m[obj[0]]},
        "constraints": cons_out,
        "scenario": scenario,
        "changes": _changes(data, space, cfg),
        "configuration": _configuration(space, cfg),
        "metrics": m,
        "baseline": ev["baseline"],
        "flags": ev["flags"],
        "settings": _settings_out(space, H, discounted, include_residual, events, overrides),
        "engine": viz.run(data, scenario, list(events), used) if include_engine_output else None,
        "search": {"evaluations": len(search.true), "seconds": round(time.time() - t0, 3),
                   "zones": sum(len(c) > 1 for c in space.choices), "method": method},
    }


def min_cost_for_target(data, metric, target, cost_metric="upfront_cost_chf", constraints=(), **common):
    """Cheapest plan (by cost_metric) that reaches the target: metric >= target
    (or <= target for a metric where lower is better, like CO2 or payback)."""
    kind = "min" if METRICS[_metric(metric)]["better"] == "higher" else "max"
    return solve(data, {"metric": _metric(cost_metric), "sense": "min"},
                 [{"metric": metric, kind: target}] + list(constraints), **common)


def max_savings(data, metric="operating_cost_saving_chf_year", budget=None, cost_metric="upfront_cost_chf",
                constraints=(), **common):
    """Most savings (metric) within a budget on cost_metric (None = no budget). Ties go to the cheaper plan."""
    sense = "max" if METRICS[_metric(metric)]["better"] == "higher" else "min"
    cons = ([{"metric": _metric(cost_metric), "max": budget}] if budget is not None else []) + list(constraints)
    common.setdefault("tie_break", {"metric": cost_metric, "sense": "min"})
    return solve(data, {"metric": metric, "sense": sense}, cons, **common)


def min_total_cost(data, years, basis="chf", budget=None, constraints=(), discounted=False, include_residual=True,
                   **common):
    """Plan with the lowest total cost (basis "chf") or electricity use (basis "kwh") over `years`,
    with an optional up-front budget."""
    if basis not in ("chf", "kwh"):
        raise ValueError(f"basis must be 'chf' or 'kwh', not {basis!r}.")
    metric = "total_cost_chf" if basis == "chf" else "total_energy_kwh"
    cons = ([{"metric": "upfront_cost_chf", "max": budget}] if budget is not None else []) + list(constraints)
    return solve(data, {"metric": metric, "sense": "min"}, cons, horizon_years=years, discounted=discounted,
                 include_residual=include_residual, **common)


# ------------------------------------------------------------------ trade-off curve
def _nd_sorted(items):
    """Non-dominated (x, y, ...) items, x minimised and y maximised, sorted by x."""
    out, best = [], -_INF
    for it in sorted(items, key=lambda t: (t[0], -t[1], t[2])):
        if not out or it[1] > best + 1e-9 * (1.0 + abs(best)):
            out.append(it)
            best = it[1]
    return out


def _knee(points):
    """Index of the point farthest from the straight line joining the end points (both axes scaled to 0-1)."""
    if len(points) < 3:
        return 0
    (x0, y0), (x1, y1) = (points[0]["x"], points[0]["y"]), (points[-1]["x"], points[-1]["y"])
    dx, dy = (x1 - x0) or 1.0, (y1 - y0) or 1.0
    dist = [abs((p["y"] - y0) / dy - (p["x"] - x0) / dx) for p in points]
    return max(range(len(points)), key=lambda i: (dist[i], -i))


def _spread(points, max_points, knee):
    """Keep both end points and the knee, and spread the rest evenly along the curve (both axes scaled to 0-1).

    Spacing along the curve, not along x, gives the steep cheap end (where most single upgrades sit) as many
    points as the long flat expensive end."""
    n = len(points)
    if max_points is None or n <= max_points:
        return list(range(n))
    keep = {0, n - 1, knee} if max_points >= 3 else {0, n - 1}
    slots = max_points - len(keep)
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    if all(math.isfinite(v) for v in xs + ys):
        dx, dy = (xs[-1] - xs[0]) or 1.0, (ys[-1] - ys[0]) or 1.0
        pos = [0.0]
        for i in range(1, n):
            pos.append(pos[-1] + math.hypot((xs[i] - xs[i - 1]) / dx, (ys[i] - ys[i - 1]) / dy))
    else:                                   # a missing payback on an axis: fall back to even spacing by rank
        pos = [float(i) for i in range(n)]
    for s in range(slots):
        t = pos[-1] * (s + 1) / (slots + 1)
        free = [i for i in range(n) if i not in keep]
        if not free:
            break
        keep.add(min(free, key=lambda i: (abs(pos[i] - t), i)))
    return sorted(keep)


_PARETO_FIRST, _PARETO_LOCAL = 800, 60      # plans tried from the first surrogate frontier, and around each refined plan


def pareto(data, x_metric="upfront_cost_chf", y_metric="operating_cost_saving_chf_year", constraints=(),
           scope=None, events=(), overrides=None, granularity="floor", horizon_years=None, discounted=False,
           include_residual=True, max_points=15, time_limit=30.0):
    """The trade-off curve: plans where x (minimised) can't get lower without y (maximised) getting lower too.

    Values are true engine values. `constraints` decide which plans may appear. The search stops after a
    fixed number of plans (PARETO_PLANS, fewer with events), so the same inputs give the same curve.
    time_limit is only a safety stop: if it is ever what stops the search, results can vary between runs."""
    t0 = time.time()
    x, y = _metric(x_metric), _metric(y_metric)
    if x == y:
        raise ValueError("x_metric and y_metric must be different.")
    if max_points is not None and (not isinstance(max_points, int) or max_points < 2):
        raise ValueError("max_points must be a whole number >= 2, or None to keep every point.")
    cons = _parse_constraints(constraints)
    events, overrides, H, _ = _settings(data, events, overrides, horizon_years)
    space = _Space(data, granularity, scope)
    ctx = _ctx(data, events, overrides, H)
    s = _Search(space, ctx, (x, "min"), cons, (y, "max"), discounted, include_residual)

    def xy(cfg):
        m = s.m(cfg)
        vx, vy = m[x], m[y]                 # a missing payback counts as the worst value on either axis
        return (_INF if vx is None else vx), (-_INF if vy is None else vy)

    def front():
        ok = [(*xy(c), sum(o is not None for o in c), c) for c in list(s.true) if sum(s.shortfalls(s.m(c))) == 0]
        return _nd_sorted(ok)

    if s.size() <= EXHAUSTIVE_LIMIT:
        for cfg in s.exhaustive():
            s.m(cfg)
        method = "exhaustive"
    else:
        method = "screening + surrogate DP + local refinement"
        xs = {x: 1.0} if x != "payback_years" else {"net_upfront_cost_chf": 1.0}
        ys = [s.spec(y, "max")] + [s.cons_spec(j) for j, c in enumerate(s.cons) if c[0] not in (x, y)]
        if x == "payback_years":
            ys.append({"operating_cost_saving_chf_year": 1.0})

        def local(center, window, limit):
            """Re-solve the surrogate around a plan and evaluate its frontier near that plan."""
            base, D = s.linearize(center)
            units = [[(_dot(xs, s.li, r),) + tuple(_dot(v, s.li, r) for v in ys) for r in row] for row in D]
            picks = _frontier(units, 1500 if len(ys) == 1 else 600)
            near = []
            for p in picks:
                px = sum(_dot(xs, s.li, D[u][k]) for u, k in enumerate(p))
                if window is None or abs(px) <= window:
                    near.append(p)
            step = max(1, len(near) // limit) if limit else 1
            for p in near[::step]:
                s.m(s.cfg_of(p))

        budget = _budget(ctx, PARETO_PLANS, power=1.0)

        def more():
            return len(s.true) < budget and time.time() - t0 < time_limit

        local(space.base(), None, min(_PARETO_FIRST, int(0.4 * budget)))
        visited = set()
        while more():
            nd = front()
            todo = [it[3] for it in nd if it[3] not in visited]
            if not todo:
                break
            n_new = max(4, min(len(todo), 12))
            pick = [todo[round(i * (len(todo) - 1) / max(1, n_new - 1))] for i in range(min(n_new, len(todo)))]
            span = (nd[-1][0] - nd[0][0]) or 1.0
            for c in dict.fromkeys(pick):
                if not more():
                    break
                visited.add(c)
                local(c, span / max(4, len(nd) ** 0.5), _PARETO_LOCAL)
    nd = front()
    pts = [{"x": it[0], "y": it[1], "scenario": space.scenario(it[3]), "changes": _changes(data, space, it[3]),
            "metrics": s.m(it[3])} for it in nd]
    knee = _knee(pts)
    idx = _spread(pts, max_points, knee)
    out = [pts[i] for i in idx]
    base = evaluate(data, [], events, overrides, horizon_years, discounted, include_residual)["baseline"]
    return {"x_metric": x, "y_metric": y, "points": out,
            "knee_index": (idx.index(knee) if knee in idx else _knee(out)) if out else None,
            "total_non_dominated": len(pts), "baseline": base,
            "settings": _settings_out(space, H, discounted, include_residual, events, overrides),
            "search": {"evaluations": len(s.true), "seconds": round(time.time() - t0, 3),
                       "zones": sum(len(c) > 1 for c in space.choices), "method": method}}
