"""Checks that every figure in the assistant's reply comes from the building model.

1. `figures(reply)` finds each number that carries a unit: CHF amounts, percentages, years, kWh/MWh, ppm, °C, people.
   Bare numbers (dates, floor numbers, list items) carry no unit, so they are not checked.
2. `sources(...)` collects every number the model was given this turn: tool results, the building's parameters and
   today's values. A number's kind comes from its field name, e.g. `upfront_cost_chf` is money, `payback_years` is
   years. Numbers in free text and in fields without a unit word can stand for any kind.
3. `check(reply, sources, question)` matches each figure to a source number of the same kind, within the rounding
   the figure shows: "CHF 33k" matches 32,500 to 33,499, "8 years" matches 7.5 to 8.49, "CHF 26,100" matches 26,050
   to 26,149. It allows plain rescaling only: kWh to MWh, a share to a percent, per year to per month, and the sign.
   Numbers the user typed count as given. Everything else is reported as unsupported.
"""

import json
import math
import re

# ------------------------------------------------------------------ figures in the reply

_NUM = r"\d{1,3}(?:[,'’\u2009\u202f\u00a0]\d{3})+(?:\.\d+)?(?!\d|[,'’]\d)|\d+(?:[.,]\d{1,2}(?!\d)|\.\d+)?"
_SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "mio": 1e6, "million": 1e6, "bn": 1e9, "billion": 1e9}
_UNITS = [  # (regex, kind, factor to the engine's unit)
    (r"%|percent|per\s?cent", "percent", 1), (r"ppm", "ppm", 1),
    (r"GWh", "energy", 1e6), (r"MWh", "energy", 1e3), (r"kWh", "energy", 1), (r"Wh", "energy", 1e-3),
    (r"years?|yrs?", "years", 1), (r"months?", "years", 1 / 12),
    (r"°\s?C|degrees?(?:\s?C(?:elsius)?)?", "temperature", 1),
    (r"people|persons|occupants|employees|staff|desks|seats|sick\s?days", "people", 1),
    (r"CHF|francs?", "money", 1),
]
_FIGURE = re.compile(
    r"(?P<cur>\bCHF|\bFr\.)?[\s\u00a0]?(?<![\d.,'’])(?P<num>" + _NUM + r")"
    r"(?:[\s\u00a0]?(?P<scale>k|K|thousand|M|mn|Mio|million|bn|billion)(?![\w²³/]))?"
    r"(?:[\s\u00a0-]?(?P<unit>(?i:" + "|".join(f"(?:{u})" for u, _, _ in _UNITS) + r"))(?![\w²³]))?")


def _parse(num):
    """'4,106' -> 4106, "4'106.5" -> 4106.5, '12,5' -> 12.5. Returns (value, decimals, digits as written)."""
    if re.fullmatch(r"\d+,\d{1,2}", num):
        num = num.replace(",", ".")
    num = re.sub(r"[,'’\u2009\u202f\u00a0]", "", num)
    whole, _, dec = num.partition(".")
    return float(num), len(dec), whole


def _step(whole, decimals):
    """The rounding a number shows: 8.5 -> 0.1, 8 -> 1, 26,100 -> 100. Trailing zeros count as rounding, but never
    coarser than two significant digits, so 'CHF 200,000' means 195,000 to 204,999, not 150,000 to 249,999."""
    if decimals:
        return 10.0 ** -decimals
    digits = len(whole.lstrip("0")) or 1
    zeros = len(whole) - len(whole.rstrip("0")) if whole.strip("0") else 0
    return 10.0 ** min(zeros, max(digits - 2, 0))


def figures(text):
    """Every number with a unit in `text`: [{"text", "value", "step", "kind"}], value and step in the engine's unit."""
    out = []
    text = text or ""
    for m in _FIGURE.finditer(text):
        before = text[m.start("num") - 1] if m.start("num") else " "
        if not m["cur"] and (before.isalpha() or before == "_"):
            continue  # part of a name, like CO2 or floor_2
        unit, scale = m["unit"], m["scale"]
        kind, factor = None, 1.0
        if unit:
            kind, factor = next((k, f) for u, k, f in _UNITS if re.fullmatch(u, unit, re.I))
        if m["cur"]:
            kind = "money"
        elif not kind and scale and scale != "thousand":
            kind = "money"  # "33k", "1.2M": amounts of money
        if not kind:
            continue
        value, decimals, whole = _parse(m["num"])
        mult = _SCALE[scale.lower()] if scale else 1.0
        out.append({"text": m.group(0).strip(), "value": value * mult * factor,
                    "step": _step(whole, decimals) * mult * factor, "kind": kind})
    return out


# ------------------------------------------------------------------ numbers the model was given

_KIND_WORDS = {  # words in a field name that give its numbers a kind
    "money": ("chf", "cost", "npv", "budget", "reserve", "price", "capex"),
    "percent": ("pct", "percent", "roi", "rate", "share"),
    "years": ("payback", "lifetime", "horizon", "years", "start_year", "end_year"),
    "energy": ("kwh",),
    "ppm": ("ppm", "co2"),
    "temperature": ("degc", "temperature"),
    "people": ("desks", "headcount", "occupan", "people", "seats", "sick_days", "staff"),
    "label": ("floor", "index", "tier", "evaluations", "decisions", "plan_id"),  # never a figure: floor 2 is not 2%
}
_TEXT_NUM = re.compile(r"(?:([A-Za-z_]+)[\s:=]*)?(?<![\d.])(-?\d+(?:\.\d+)?)")


def _kinds(path):
    words = "/".join(path).lower()
    kinds = {k for k, ws in _KIND_WORDS.items() if any(w in words for w in ws)}
    return kinds or None  # None: no unit word, so it can stand for any kind


def _walk(obj, path, out):
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        if math.isfinite(obj):
            out.append((float(obj), _kinds(path)))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _walk(v, path + [str(k)], out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _walk(v, path, out)
    elif isinstance(obj, str):
        for word, num in _TEXT_NUM.findall(obj):  # free text: the word before a number names it, if it has a unit word
            out.append((float(num), _kinds(path + [word])))
        out.extend((f["value"], {f["kind"]}) for f in figures(obj))  # "CHF 1,200" or "15 years" in a description


def sources(*objs):
    """Every number in the given tool results and facts, as (value, kinds or None)."""
    out = []
    for obj in objs:
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except ValueError:
                pass
        _walk(obj, [], out)
    return out


# ------------------------------------------------------------------ matching

def _candidates(value, kind):
    """What a source number may be rescaled to before comparing: the sign never matters."""
    v = abs(value)
    yield v
    if kind == "percent":
        yield v * 100              # a share (0.12) said as a percent (12%)
    if kind == "money":
        yield v / 12               # per year said per month
        yield v * 12               # per month said per year


def _matches(fig, srcs):
    tol = fig["step"] / 2 * (1 + 1e-9) + 1e-9
    for value, kinds in srcs:
        if kinds is not None and fig["kind"] not in kinds:
            continue
        if any(abs(c - fig["value"]) <= tol for c in _candidates(value, fig["kind"])):
            return True
    return False


def check(reply, srcs, question=""):
    """Which figures in `reply` come from `srcs`. `question` holds the user's words: numbers there count as given.

    Returns {"checked", "matched", "unsupported": [figure text], "from_question": [figure text], "ok"}."""
    given = sources(question)
    given = [(v, None) for v, _ in given] + [(f["value"], None) for f in figures(question)]
    matched, unsupported, from_question = 0, [], []
    for fig in figures(reply):
        if _matches(fig, srcs):
            matched += 1
        elif _matches(fig, given):
            from_question.append(fig["text"])
        else:
            unsupported.append(fig["text"])
    unsupported = list(dict.fromkeys(unsupported))
    return {"checked": matched + len(unsupported), "matched": matched, "unsupported": unsupported,
            "from_question": from_question, "ok": not unsupported}


def repair_message(result):
    """What the model is told when its reply names figures that no tool returned."""
    listed = ", ".join(result["unsupported"])
    return ("Automatic check (not from the user): these figures in your reply are not in any tool result of this "
            f"turn: {listed}. Rewrite your whole reply. Copy every figure from a tool result, call a tool if you "
            "need a number you don't have, or leave the figure out. Don't do your own sums. Don't mention this check.")
