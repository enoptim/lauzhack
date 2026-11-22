"""Input checks shared by the API (server.py) and the assistant's tools.

Every check raises `ValidationError` (a `ValueError`) with a plain-English message that says what is wrong
and what is allowed. The server turns it into HTTP 400. Nothing here changes the engine: a check either
returns the cleaned value or raises.

Main entry points
    check_overrides(data, overrides)      assumption names and values (numbers, finite, in a sensible range)
    check_events(data, events)            event ids
    check_scenario(data, scenario)        a list of swaps: group, option, floor / room / item, timing
    check_swap(data, swap)                one swap
    check_plans(data, plans)              {name: scenario} for the futures run (1 to MAX_PLANS)
    check_run(data, scenario, events, overrides, year=None)   the three together, as the endpoints use them
    check_count(value, name, lo, hi)      whole numbers: n futures, years, ...
    check_seed(seed)                      a whole-number seed (recorded in the output so a run can be repeated)
    check_param(data, name)               one assumption name
    check_item_id(data, id) / check_option_id(data, id) / check_floor(data, floor, group=None)
    check_messages(messages)              chat messages
    override_bounds(data, key)            the (low, high) range an override may take

Ranges: an override may leave the data's low-high band (a what-if is allowed to ask "what if electricity
cost twice as much?") but not leave what is physically meaningful. Shares and probabilities stay in 0..1,
prices and costs are not negative, and everything stays finite and below ABSOLUTE_MAX.
"""
import math

MAX_FUTURES = 500
MAX_PLANS = 6
MAX_SWAPS = 200
MAX_MESSAGES = 200
MAX_TEXT = 20_000
ABSOLUTE_MAX = 1e15
HORIZON_MAX = 40                       # years: the longest run we accept when horizon_years is overridden
SEED_MAX = 2 ** 63 - 1
SWAP_TIMINGS = ("now", "end_of_life")

# Units whose value is a share or a probability and so lives in 0..1.
_UNIT_INTERVAL = {"share", "prob", "prob/yr", "fraction", "fraction/yr", "share of max"}
# Assumptions with their own rule (the rest follow from the units and the data's own low-high band).
_SPECIAL = {
    "discount_rate_real": (-0.5, 1.0),   # -100% would divide by zero in (1 + r) ** t
    "horizon_years": (1, HORIZON_MAX),
}
_WHOLE = {"horizon_years", "replace_on_plan"}


class ValidationError(ValueError):
    """Bad input, explained in plain English. The API answers 400."""


def is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _finite(x, name):
    if not is_number(x):
        raise ValidationError(f"{name} must be a number, not {x!r}.")
    if not math.isfinite(x):
        raise ValidationError(f"{name} must be a finite number, not {x!r}.")
    return x


# ---------------------------------------------------------------- whole numbers and seeds
def check_count(value, name, lo=1, hi=None):
    """A whole number from lo to hi. Not silently capped: too large is an error."""
    if is_number(value) and math.isfinite(value) and int(value) == value:
        value = int(value)
    else:
        raise ValidationError(f"{name} must be a whole number, not {value!r}.")
    if value < lo or (hi is not None and value > hi):
        raise ValidationError(f"{name} must be between {lo} and {hi}, not {value}." if hi is not None
                              else f"{name} must be at least {lo}, not {value}.")
    return value


def check_seed(seed):
    """Seeds make a run repeatable, so they must be exact whole numbers (not 1.5, not text)."""
    if not (isinstance(seed, int) and not isinstance(seed, bool)):
        raise ValidationError(f"seed must be a whole number, not {seed!r}.")
    if abs(seed) > SEED_MAX:
        raise ValidationError(f"seed must be between -{SEED_MAX} and {SEED_MAX}.")
    return seed


def horizon(data, overrides=None):
    return int({**data["params"], **(overrides or {})}["horizon_years"])


def check_year(data, year, overrides=None):
    """A year in the run, 1 to the horizon."""
    return check_count(year, "year", 1, horizon(data, overrides))


# ---------------------------------------------------------------- assumptions
def check_param(data, name):
    if not isinstance(name, str) or name not in data["params"]:
        near = [k for k in data["params"] if isinstance(name, str) and name and (name in k or k in name)][:5]
        hint = f" Did you mean: {', '.join(near)}?" if near else " GET /api/assumptions lists every name."
        raise ValidationError(f"Unknown assumption {name!r}.{hint}")
    return name


def override_bounds(data, key):
    """The (low, high) an override of this assumption may take."""
    if key in _SPECIAL:
        return _SPECIAL[key]
    v = data["params"][key]
    lo, hi = data["ranges"].get(key, (v, v))
    lo, hi = min(x for x in (lo, hi, v) if x is not None), max(x for x in (lo, hi, v) if x is not None)
    unit = data["param_meta"].get(key, {}).get("unit", "")
    if unit == "0/1":
        return 0, 1
    if unit in _UNIT_INTERVAL:
        return 0, 1
    if unit.startswith("%") and "per" not in unit:        # a percentage
        return (0 if lo >= 0 else -100), 100
    if unit.startswith("%"):                               # % per something: can be a negative effect
        return (0 if lo >= 0 else -100), 100
    low = 0 if lo >= 0 else -ABSOLUTE_MAX                 # prices, costs, powers, areas: never negative
    if lo < 0:
        low = min(lo * 10, -1.0) if hi <= 0 else -ABSOLUTE_MAX
    return low, ABSOLUTE_MAX


def check_overrides(data, overrides, allow_horizon=True):
    """{assumption: number}. Unknown names, text, booleans, NaN/inf, negative prices and out-of-range
    shares are errors. allow_horizon=False for runs that draw futures (their length is fixed)."""
    if overrides is None:
        return {}
    if not isinstance(overrides, dict):
        raise ValidationError("overrides must be an object like {\"electricity_price_chf_kwh\": 0.3}.")
    out = {}
    for key, v in overrides.items():
        check_param(data, key)
        _finite(v, f"The override for {key}")
        lo, hi = override_bounds(data, key)
        if key == "horizon_years" and not allow_horizon:
            raise ValidationError("horizon_years cannot be changed here: futures are drawn for the standard "
                                  f"horizon ({horizon(data)} years). Use the simulate endpoint for other horizons.")
        if key in _WHOLE and int(v) != v:
            raise ValidationError(f"{key} must be a whole number, not {v}.")
        if v < lo or v > hi:
            unit = data["param_meta"].get(key, {}).get("unit", "")
            band = data["ranges"].get(key)
            typical = f" Typical range: {band[0]} to {band[1]} {unit}." if band and band[0] is not None and band[0] != band[1] else ""
            raise ValidationError(f"The override for {key} must be between {lo:g} and {hi:g} {unit}, not {v:g}.{typical}")
        out[key] = v
    return out


# ---------------------------------------------------------------- events
def check_events(data, events):
    if events is None:
        return []
    if isinstance(events, (str, dict)) or not isinstance(events, (list, tuple)):
        raise ValidationError("events must be a list of event ids, e.g. [\"new_lab\"].")
    if len(events) > len(data["events"]):
        raise ValidationError(f"Too many events ({len(events)}); there are only {len(data['events'])}.")
    for e in events:
        if not isinstance(e, str) or e not in data["events"]:
            raise ValidationError(f"Unknown event {e!r}. Events: {', '.join(data['events'])}.")
    if len(set(events)) != len(events):
        raise ValidationError("Each event may be listed once.")
    return list(events)


# ---------------------------------------------------------------- ids
def check_option_id(data, option_id):
    if not isinstance(option_id, str) or option_id not in data["options"]:
        raise ValidationError(f"Unknown option {option_id!r}. GET /api/catalog lists the options of each group.")
    return option_id


def check_item_id(data, item_id):
    if not isinstance(item_id, str) or item_id not in data["item_by_id"]:
        raise ValidationError(f"Unknown item {item_id!r}. GET /api/catalog lists the items.")
    return item_id


def check_floor(data, floor, group=None):
    if not (isinstance(floor, int) and not isinstance(floor, bool)):
        raise ValidationError(f"floor must be a whole number, not {floor!r}.")
    floors = sorted({_served(i) for i in data["items"] if group is None or i["group"] == group})
    if floor not in floors:
        what = f"{group} equipment" if group else "equipment"
        raise ValidationError(f"There is no {what} on floor {floor}. Floors with {what}: {', '.join(map(str, floors))}.")
    return floor


def _served(item):
    s = item["serves"]
    return int(s.split()[-1]) if s.startswith("floor") else item["floor"]


# ---------------------------------------------------------------- swaps and scenarios
def check_swap(data, swap, max_year=None):
    """One swap: {"group", "option", optional "floor" / "room_id" / "item_id", optional "year" or "timing"}.
    The option must belong to the group and the narrowing must match some equipment."""
    if not isinstance(swap, dict):
        raise ValidationError(f"A swap must be an object like {{\"group\": \"lighting\", \"option\": \"lighting_mid\"}}, got {swap!r}.")
    group, option = swap.get("group"), swap.get("option")
    if not isinstance(group, str) or not isinstance(option, str):
        raise ValidationError(f"A swap needs a \"group\" and an \"option\" (text), got {swap!r}.")
    o = data["options"].get(option)
    if o is None:
        raise ValidationError(f"Unknown option {option!r}. GET /api/catalog lists the options of each group.")
    if o["group"] != group:
        raise ValidationError(f"{option} belongs to group {o['group']!r}, not {group!r}.")
    if "floor" in swap:
        check_floor(data, swap["floor"], group)
    if "room_id" in swap and not any(i["room"] == swap["room_id"] and i["group"] == group for i in data["items"]):
        raise ValidationError(f"No {group} equipment in room {swap['room_id']!r}.")
    if "item_id" in swap:
        item = data["item_by_id"].get(swap["item_id"]) if isinstance(swap["item_id"], str) else None
        if item is None or item["group"] != group:
            raise ValidationError(f"{swap['item_id']!r} is not a {group} item.")
    if not any(i["group"] == group and ("floor" not in swap or _served(i) == swap["floor"])
               and ("room_id" not in swap or i["room"] == swap["room_id"])
               and ("item_id" not in swap or i["id"] == swap["item_id"]) for i in data["items"]):
        raise ValidationError(f"No {group} equipment matches {swap!r}.")
    timing = swap.get("year", swap.get("timing", "now"))
    if not (timing in SWAP_TIMINGS if isinstance(timing, str) else
            is_number(timing) and math.isfinite(timing) and int(timing) == timing and timing >= 0):
        raise ValidationError(f"A swap's timing must be \"now\", \"end_of_life\" or a whole year, got {timing!r}.")
    if max_year is not None and not isinstance(timing, str) and timing > max_year:
        raise ValidationError(f"A swap in year {int(timing)} comes after the last year of the run ({max_year}).")
    return swap


def check_scenario(data, scenario, overrides=None):
    """A list of swaps (at most MAX_SWAPS). An empty list is fine: it means doing nothing."""
    if scenario is None:
        return []
    if not isinstance(scenario, (list, tuple)):
        raise ValidationError("A scenario must be a list of swaps.")
    if len(scenario) > MAX_SWAPS:
        raise ValidationError(f"Too many swaps in one scenario ({len(scenario)}); the limit is {MAX_SWAPS}.")
    H = horizon(data, overrides)
    for sw in scenario:
        check_swap(data, sw, max_year=H)
    return list(scenario)


def check_plans(data, plans, overrides=None):
    """{name: scenario} for the futures run: 1 to MAX_PLANS plans with non-empty names."""
    if not isinstance(plans, dict):
        raise ValidationError("scenarios must be an object {plan name: list of swaps}.")
    if not plans:
        raise ValidationError("Give at least one plan to compare.")
    if len(plans) > MAX_PLANS:
        raise ValidationError(f"At most {MAX_PLANS} plans at once, got {len(plans)}.")
    for name, sc in plans.items():
        if not isinstance(name, str) or not name.strip():
            raise ValidationError("Every plan needs a non-empty name.")
        try:
            check_scenario(data, sc, overrides)
        except ValidationError as e:
            raise ValidationError(f"Plan {name!r}: {e}") from None
    return plans


def check_run(data, scenario=None, events=None, overrides=None, year=None, allow_horizon=True):
    """Everything a simulation takes. Returns (scenario, events, overrides). year, if given, must be in the run."""
    overrides = check_overrides(data, overrides, allow_horizon)
    scenario = check_scenario(data, scenario, overrides)
    events = check_events(data, events)
    if year is not None:
        check_year(data, year, overrides)
    return scenario, events, overrides


# ---------------------------------------------------------------- chat
def check_messages(messages):
    """Chat history: a list of {"role": "user" | "assistant", "content": text}, ending with the user."""
    if not isinstance(messages, list) or not messages:
        raise ValidationError("messages must be a non-empty list.")
    if len(messages) > MAX_MESSAGES:
        raise ValidationError(f"Too many messages ({len(messages)}); the limit is {MAX_MESSAGES}.")
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            raise ValidationError("Each message needs a role of \"user\" or \"assistant\".")
        c = m.get("content")
        if c is not None and not isinstance(c, (str, list)):
            raise ValidationError("A message's content must be text.")
        if isinstance(c, str) and len(c) > MAX_TEXT:
            raise ValidationError(f"A message is too long ({len(c)} characters; the limit is {MAX_TEXT}).")
    if messages[-1]["role"] != "user":
        raise ValidationError("The last message must be from the user.")
    return messages
