"""Chat with the building twin through OpenRouter. Run from the repo root:

    python3 -m chat.agent                         # chat in the terminal
    python3 -m chat.agent "Cut our bill by 5%"    # ask one question

The app calls it through POST /api/chat in model/server.py.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import tools

HERE = Path(__file__).resolve().parent
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_STEPS = 10


def _load_env():
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


_load_env()
MODEL = os.environ.get("CHAT_MODEL", "anthropic/claude-sonnet-5.5")

SYSTEM = """You are the assistant inside a digital twin of EPFL building BC in Lausanne, where LauzHack takes place.
The people asking are the building's energy manager and the finance director who approves the money.
They want to know what to change, what it costs up front, what it saves, and when it pays back.

Rules:
- Every number you give must come from a tool. Never estimate or do your own sums on savings.
- For a goal ("cut the bill by 5%", "save CHF 2,000 a month", "spend at most CHF 100k"):
  1. Call rank_upgrades to find the upgrades with the shortest payback. Use by_floor with a group to fit a target closely.
  2. Pick the cheapest package that meets the goal. Doing an upgrade on only some floors is fine.
  3. Check the package with simulate_scenario. Adjust until it meets the goal.
  4. Call show_scenario with the package you recommend, so the app shows it.
- When the user asks for a specific change, simulate it and show it.
- For what-if questions about the future (price spike, heatwave, new lab), pass the matching events. The single-year figures are for year 1; use what_if.by_year for the years the event hits.
- "Energy bill" means the electricity bill. Running costs also include maintenance and supplies such as coffee capsules. Point out when an upgrade lowers the energy bill but raises running costs.
- Mention comfort and health effects from the product descriptions when they matter (flicker-free light, fresher air, particle filters).

How to read the money numbers. The model compares each plan with doing nothing over 15 years. Doing nothing still means replacing worn-out equipment like-for-like when it dies.
- upfront_cost_chf: what the plan costs to buy and install now. This is the initial cost.
- extra_cost_vs_like_for_like_chf: the cost on top of replacements that are due anyway. If it is much lower than the upfront cost, say why: the old items are worn out. If it is negative, the upgrade is cheaper than replacing like-for-like.
- payback_years: years until the savings cover the extra cost. 0 means it pays off from day one.
- simple_roi_pct_per_year: the yearly saving as a share of the upfront cost. Report this as the ROI.
- npv_chf: the total gain over the horizon in today's money, after all costs. Use it for "is it worth it overall".
- people_effects_chf: the value of better health, comfort and productivity. It is an uncertain estimate. Keep it out of the cost, saving and ROI figures; mention it separately as a possible extra.
- flags: warn if you see over_budget, reserve_below_minimum, ventilation_over_capacity or desk_shortfall.

How to answer:
- Main point first. Plain words for people outside energy and finance. Keep it under 150 words.
- Use a short list for the changes: what, where (floors), cost.
- Then give: upfront cost, saving per month and per year, payback time in years, and ROI.
- Explain once in plain words: payback = years until the savings repay the cost; ROI = what the upgrade earns back each year as a share of its cost.
- Money in CHF with thousands separators, rounded sensibly (CHF 26,100, not CHF 26,145.37).
- If it helps, offer one alternative in a sentence (e.g. cheaper up front, or bigger savings).
- Say once, briefly, that the numbers are model estimates based on our assumptions.
- Answer in the user's language."""


def _post(payload):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set. Put it in chat/.env (see chat/.env.example).")
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "X-Title": "Building twin"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"OpenRouter error {e.code}: {e.read().decode()[:500]}") from None


def chat(messages, scenario=None, on_tool=None):
    """Answer the last user message.

    messages: [{"role": "user" | "assistant", "content": str}, ...]
    scenario: the swaps the app shows right now (optional), e.g. [{"group": "lighting", "option": "lighting_mid", "floor": 2}]
    on_tool:  optional callback(name, args) for logging

    Returns {"reply": str, "scenario": dict | None}. `scenario` is set when the model picked one to show
    (see tools.app_scenario).
    """
    system = SYSTEM
    if scenario:
        system += f"\n\nThe app currently shows this scenario: {json.dumps(scenario)}"
    convo = [{"role": "system", "content": system}] + [
        {"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")
    ]
    shown = None
    for _ in range(MAX_STEPS):
        msg = _post({"model": MODEL, "messages": convo, "tools": tools.SCHEMAS})["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        convo.append({"role": "assistant", "content": msg.get("content") or "", **({"tool_calls": calls} if calls else {})})
        if not calls:
            return {"reply": msg.get("content") or "", "scenario": shown}
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
                if on_tool:
                    on_tool(name, args)
                result = tools.run(name, args)
                if name == "show_scenario":
                    shown = tools.app_scenario(**args)
            except Exception as e:  # the model sees the error and can fix its call
                result = {"error": str(e)}
            convo.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
    return {"reply": "Sorry, I couldn't finish that. Try a simpler question.", "scenario": shown}


def _log(name, args):
    print(f"  · {name} {json.dumps(args) if args else ''}", file=sys.stderr)


def main():
    history = []
    once = " ".join(sys.argv[1:])
    while True:
        q = once or input("\nYou: ").strip()
        if not q:
            break
        history.append({"role": "user", "content": q})
        out = chat(history, on_tool=_log)
        history.append({"role": "assistant", "content": out["reply"]})
        print(f"\nTwin: {out['reply']}")
        if out["scenario"]:
            s = out["scenario"]
            print(f"\n[App shows: {s['title']}, {len(s['item_ids'])} items highlighted]")
        if once:
            break


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        pass
