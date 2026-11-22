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
- For a goal or limits ("cheapest way to cut electricity by 20%", "lowest running costs for at most CHF 200k",
  "we can't touch the ventilation", "only mid-range coffee machines"), set up an optimization and let the user
  confirm it before anything runs:
  1. Turn the user's words into one objective and a list of limits. Today's value of every metric is in the
     propose_problem description; call list_metrics only if you need units or descriptions. Use
     max_change_pct / min_change_pct for targets relative to today; never work out the absolute number yourself.
  2. "Can't change X" or "keep X" goes in locked (with floor if they name one). "Only consider X" goes in allowed;
     to force an option, allow only that option. Plans are decided floor by floor by default; set per_floor false
     only if the user wants one choice for the whole building.
  3. If the user names limits but no goal, maximise npv_cash_chf (value over 15 years).
     If the goal is truly unclear, ask one short question instead of proposing.
  4. Call propose_problem. The app shows the problem with a "Run optimization" button.
  5. Reply in at most 60 words. The app shows the goal and limits right below your reply, so don't list them again.
     Say only which choices you made that the user did not state (e.g. the default goal, no warnings allowed),
     then ask them to press "Run optimization" or say what to change.
     Give no plan or savings yet: nothing has run.
  6. If the user asks for a change, call propose_problem again with the revised problem.
- When the user confirms, the server runs optimize on exactly that problem and you see the result. The app already
  shows the plan, so don't call show_scenario for it; just explain it. If all_limits_met is false, say which limit
  could not be met and how close the plan gets, and offer a revised problem. Never call optimize yourself.
- For "what are my options" or "how does cost trade against savings", call upgrade_tradeoffs. The app plots every
  package and shows the balanced one (knee_index) as a card with its figures. In at most 3 short sentences: the
  cheapest useful package and the biggest saving, each with its upfront cost and yearly saving copied exactly from
  the tool result, and why the balanced one is the sweet spot. Call show_scenario only if the user wants another.
- For a quick question about single upgrades ("what pays back fastest?"), use rank_upgrades.
- When the user asks for a specific change, call show_scenario with it. It simulates too.
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
- When the app shows a plan (after a confirmed optimization, upgrade_tradeoffs or show_scenario), a card under your
  reply already lists the changes per floor, the upfront cost, the yearly energy bill, the payback time and the
  15-year value, and says they are model estimates. Then reply in at most 4 short sentences, with no headings and no
  bold labels: what changes and why it pays (saving per year and ROI), and one thing to watch. Don't repeat the card,
  define terms or add the estimates disclaimer.
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


def chat(messages, scenario=None, confirm=None, on_tool=None, context=None):
    """Answer the last user message.

    messages: [{"role": "user" | "assistant", "content": str}, ...]
    scenario: the swaps the app shows right now (optional), e.g. [{"group": "lighting", "option": "lighting_mid", "floor": 2}]
    confirm:  a problem the user confirmed (from an earlier `proposal`). The optimizer runs on exactly this problem
              before the model answers, so the model can't change it.
    on_tool:  optional callback(name, args) for logging
    context:  optional words from the app about what the user is looking at, e.g. "Building view, floor 2, lighting"

    Returns {"reply", "scenario", "proposal", "optimization", "chart"}:
    - scenario: the plan the model showed (see tools.app_scenario), or None.
    - proposal: the problem the model proposed this turn, with today's values, for the user to confirm; or None.
    - optimization: after a confirmed run, the problem and whether all limits were met; or None.
    - chart: the cost-vs-savings curve if the model called upgrade_tradeoffs (see tools.tradeoff_chart); or None.
    """
    system = SYSTEM
    if scenario:
        system += f"\n\nThe app currently shows this scenario: {json.dumps(scenario)}"
    if context:
        system += (f"\n\nWhere the user is in the app right now: {context[:600]}\n"
                   "Use it to resolve words like \"this\", \"here\" or \"this plan\". Don't repeat it back.")
    convo = [{"role": "system", "content": system}] + [
        {"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")
    ]
    schemas = tools.SCHEMAS
    shown = proposal = optimization = chart = None

    def out(reply):
        return {"reply": reply, "scenario": shown, "proposal": proposal, "optimization": optimization,
                "chart": chart}

    if confirm:
        # Run the confirmed problem ourselves and hand the model the result as if it had called optimize.
        keys = ("objective", "constraints", "locked", "allowed", "per_floor", "allow_warnings", "events")
        args = {k: confirm[k] for k in keys if k in confirm}
        if on_tool:
            on_tool("optimize (confirmed)", args)
        result = tools.run("optimize", args)
        optimization = {"problem": result["problem"], "all_limits_met": result["all_limits_met"],
                        "limits_missed": result["limits_missed"]}
        shown = tools.app_scenario("Optimized plan", result["scenario"], args.get("events"))
        schemas = tools.SCHEMAS + [tools.OPTIMIZE_SCHEMA]  # the call below must name a known tool
        call = {"id": "confirmed_optimize", "type": "function",
                "function": {"name": "optimize", "arguments": json.dumps(args)}}
        convo += [{"role": "assistant", "content": "", "tool_calls": [call]},
                  {"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)}]

    for _ in range(MAX_STEPS):
        msg = _post({"model": MODEL, "messages": convo, "tools": schemas})["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        convo.append({"role": "assistant", "content": msg.get("content") or "", **({"tool_calls": calls} if calls else {})})
        if not calls:
            return out(msg.get("content") or "")
        for call in calls:
            name = call["function"]["name"]
            try:
                if name == "optimize":
                    raise ValueError("Don't run optimize yourself: call propose_problem and let the user confirm.")
                args = json.loads(call["function"].get("arguments") or "{}")
                if on_tool:
                    on_tool(name, args)
                result = tools.run(name, args)
                if name == "show_scenario":
                    shown = tools.app_scenario(**args)
                if name == "propose_problem":
                    proposal = {"problem": result["problem"], "today": result["today"]}
                if name == "upgrade_tradeoffs":  # shows its balanced package itself
                    chart = tools.tradeoff_chart(result)
                    shown = tools.knee_scenario(result, args.get("events")) or shown
            except Exception as e:  # the model sees the error and can fix its call
                result = {"error": str(e)}
            convo.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
    return out("Sorry, I couldn't finish that. Try a simpler question.")


def _log(name, args):
    print(f"  · {name} {json.dumps(args) if args else ''}", file=sys.stderr)


def main():
    history = []
    pending = None  # a proposed problem waiting for confirmation
    once = " ".join(sys.argv[1:])
    while True:
        q = once or input("\nYou (y = run the proposed optimization): ").strip()
        if not q:
            break
        confirm = pending if q.lower() in ("y", "yes", "run") else None
        history.append({"role": "user", "content": "Looks good, run the optimization." if confirm else q})
        out = chat(history, confirm=confirm, on_tool=_log)
        pending = out["proposal"]["problem"] if out["proposal"] else None
        history.append({"role": "assistant", "content": out["reply"]})
        print(f"\nTwin: {out['reply']}")
        if out["scenario"]:
            s = out["scenario"]
            print(f"\n[App shows: {s['title']}, {len(s['item_ids'])} items highlighted]")
        if pending:
            print(f"\n[Proposed optimization: {json.dumps(pending)}. Type y to run it.]")
        if once:
            break


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        pass
