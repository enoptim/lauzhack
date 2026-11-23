"""Chat with the building twin through Nebius Token Factory. Run from the repo root:

    python3 -m chat.agent                         # chat in the terminal
    python3 -m chat.agent "Cut our bill by 5%"    # ask one question

The app calls it through POST /api/chat in model/server.py.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import grounding, tools

ROOT = Path(__file__).resolve().parents[1]
MAX_STEPS = 10


def _load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


_load_env()
BASE_URL = os.environ.get("ASSISTANT_MODEL_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
API_URL = f"{BASE_URL.rstrip('/')}/chat/completions"
MODEL = os.environ.get("ASSISTANT_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507")
REASONING = os.environ.get("CHAT_REASONING", "off")
REASONING_FIELDS = ("reasoning_content", "reasoning")

SYSTEM = """You are the assistant inside a digital twin of EPFL building BC in Lausanne, where LauzHack takes place.
The people asking are the building's energy manager and the finance director who approves the money.
They want to know what to change, what it costs up front, what it saves, and when it pays back.

Rules:
- Every number you give must come from a tool. Never estimate or do your own sums on savings. A program checks
  every figure in your reply against this turn's tool results and sends back any it can't find.
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
  package and shows the balanced one (knee_index) as a card with its figures. In at most 3 short sentences, no lists:
  the cheapest useful package and the biggest saving, each with its upfront cost and yearly saving copied exactly from
  the tool result, and why the balanced one is the sweet spot. Call show_scenario only if the user wants another.
- For a quick question about single upgrades ("what pays back fastest?"), use rank_upgrades.
- To remove or clear plans, call remove_plans with their ids, then say in one sentence which plans you removed.
  The app shows an undo button. Never remove plans the user didn't ask to remove.
- When the user asks for a specific change, call show_scenario with it. It simulates too.
- To make several plans at once ("make 3 plans", "compare A, B and C"), call show_scenario once per plan, each with
  its own short title. The app shows a card for every plan you show in one reply, and the user can keep them all.
  Then compare them in prose; don't repeat each card's figures.
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
- flags: warn if you see over_budget (the extra cost over like-for-like replacements, not the full price, is above the upgrade budget), reserve_below_minimum (year 0 means paying on day one), needs_financing (the reserve runs out, a loan is needed), ventilation_over_capacity or desk_shortfall.

How to answer:
- Never use Markdown tables, even when asked for one: use a short list instead, without saying why.
- Main point first. Plain words for people outside energy and finance.
- Name floors in words: basement, ground floor, floor 1 to floor 4. Never write floor -1 or floor 0.
- Money in CHF with thousands separators, rounded sensibly (CHF 26,100, not CHF 26,145.37).

When the app shows a plan (after a confirmed optimization, upgrade_tradeoffs or show_scenario), a card under your
reply already lists the changes per floor, the upfront cost, the yearly energy bill and the yearly saving, and says
they are model estimates. The Results page shows payback and long-term value across 200 possible futures. Then:
- Reply in 2 or 3 short sentences, with no headings, no lists and no bold labels: why this plan is worth it, and one
  thing to watch.
- Don't list the changes. Give no figures except the ROI, copied exactly from the tool result.
- Don't define terms and don't add the estimates disclaimer: the card and the app do both.
- Avoid finance jargon such as "negative extra cost": say "it costs no more than replacing the worn-out units like
  for like".

Otherwise (no plan card):
- Keep it under 150 words.
- Use a short list for the changes: what, where (floors), cost.
- Then give: upfront cost, saving per month and per year, payback time in years, and ROI.
- Explain once in plain words: payback = years until the savings repay the cost; ROI = what the upgrade earns back each year as a share of its cost.
- If it helps, offer one alternative in a sentence (e.g. cheaper up front, or bigger savings).
- Say once, briefly, that the numbers are model estimates based on our assumptions.
- Answer in the user's language."""


def _request(payload):
    key = os.environ.get("ASSISTANT_MODEL_API_KEY")
    if not key:
        raise RuntimeError("ASSISTANT_MODEL_API_KEY is not set. Put it in the root .env (see .env.example).")
    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        return urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Nebius Token Factory error {e.code}: {e.read().decode()[:500]}") from None


def _post(payload, on_delta=None):
    """One model call, streamed. on_delta(kind, text) gets "thinking" and "text" pieces as they arrive.
    Returns the whole message: content, tool calls and any reasoning text."""
    payload = {**payload, "stream": True}
    if REASONING and REASONING != "off":
        payload["reasoning_effort"] = REASONING
    content, calls, reasoning = [], {}, {}
    with _request(payload) as stream:
        for raw in stream:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue  # blank lines and keep-alives
            data = line[5:].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            if chunk.get("error"):
                raise RuntimeError(f"Nebius Token Factory error: {json.dumps(chunk['error'])[:500]}")
            if not chunk.get("choices"):
                continue
            delta = chunk["choices"][0].get("delta") or {}
            for field in REASONING_FIELDS:
                if delta.get(field):
                    reasoning.setdefault(field, []).append(delta[field])
            thought = delta.get("reasoning_content") or delta.get("reasoning")
            if thought and on_delta:
                on_delta("thinking", thought)
            if delta.get("content"):
                content.append(delta["content"])
                if on_delta:
                    on_delta("text", delta["content"])
            for tc in delta.get("tool_calls") or []:
                call = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function",
                                                              "function": {"name": "", "arguments": ""}})
                call["id"] = tc.get("id") or call["id"]
                fn = tc.get("function") or {}
                call["function"]["name"] += fn.get("name") or ""
                call["function"]["arguments"] += fn.get("arguments") or ""
    msg = {"content": "".join(content), **{k: "".join(parts) for k, parts in reasoning.items()}}
    if calls:
        msg["tool_calls"] = [calls[i] for i in sorted(calls)]
    return {"choices": [{"message": msg}]}


REMOVE_PLANS_SCHEMA = {"type": "function", "function": {
    "name": "remove_plans",
    "description": "Removes plans from the user's plan list in the app. Only when the user asks to remove, delete or "
                   "clear plans. Use the ids from the plan list in your instructions. Removing every plan leaves one "
                   "empty plan (today's building). The app offers an undo.",
    "parameters": {"type": "object", "properties": {
        "plan_ids": {"type": "array", "items": {"type": "integer"}, "description": "Ids of the plans to remove."}},
        "required": ["plan_ids"]}}}


def chat(messages, scenario=None, confirm=None, on_tool=None, context=None, on_event=None, plans=None):
    """Answer the last user message.

    messages: [{"role": "user" | "assistant", "content": str}, ...]
    scenario: the swaps the app shows right now (optional), e.g. [{"group": "lighting", "option": "lighting_mid", "floor": 2}]
    confirm:  a problem the user confirmed (from an earlier `proposal`). The optimizer runs on exactly this problem
              before the model answers, so the model can't change it.
    on_tool:  optional callback(name, args) for logging
    on_event: optional callback(event) for showing progress live. Events are dicts with a "type":
              "thinking" and "text" (with "text": the next piece), "tool_start" (id, name, args) and
              "tool_end" (id, name, ok, seconds), and "check" (see `verification` below).
    context:  optional words from the app about what the user is looking at, e.g. "Building view, floor 2, lighting"
    plans:    optional list of the user's plans in the app: [{"id", "name", "changes", "source"}, ...]. With it the
              model can remove plans (remove_plans); the ids it removed come back in `removed_plan_ids`.

    Returns {"reply", "scenario", "scenarios", "proposal", "optimization", "chart", "removed_plan_ids", "verification"}:
    - scenario: the last plan the model showed (see tools.app_scenario), or None.
    - scenarios: every plan the model showed this turn, in order (the last one is `scenario`).
    - proposal: the problem the model proposed this turn, with today's values, for the user to confirm; or None.
    - optimization: after a confirmed run, the problem and whether all limits were met; or None.
    - chart: the cost-vs-savings curve if the model called upgrade_tradeoffs (see tools.tradeoff_chart); or None.
    - verification: whether every figure in the reply is in this turn's tool results (see grounding.check), plus
      `repaired`: the first draft had figures that weren't, and the model rewrote it once. Also sent as a "check" event.
    """
    system = SYSTEM
    if scenario:
        system += f"\n\nThe app currently shows this scenario: {json.dumps(scenario)}"
    if context:
        system += (f"\n\nWhere the user is in the app right now: {context[:600]}\n"
                   "Use it to resolve words like \"this\", \"here\" or \"this plan\". Don't repeat it back.")
    plans = [p for p in plans or [] if isinstance(p, dict) and isinstance(p.get("id"), int)]
    if plans:
        system += "\n\nThe user's plans in the app (id: name, changes):\n" + "\n".join(
            f"- {p['id']}: {str(p.get('name', ''))[:60]}, {p.get('changes', 0)} change(s)"
            + (", from the assistant" if p.get("source") == "assistant" else "") for p in plans[:12])
    convo = [{"role": "system", "content": system}] + [
        {"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")
    ]
    schemas = tools.SCHEMAS + ([REMOVE_PLANS_SCHEMA] if plans else [])
    removed = []
    shown = proposal = optimization = chart = None
    shown_all = []  # every plan shown this turn, in order: the app draws a card for each
    # What the reply's figures may come from: the building's parameters, today's values in the tool descriptions,
    # what the app said in the system message, and (added below) every tool result of this turn.
    given = [tools.DATA["params"], system[len(SYSTEM):]] + [s["function"]["description"] for s in schemas]
    question = "\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")
    verification = None
    repaired = []  # figures the first draft stated without a source

    research = []  # balanced cards from upgrade_tradeoffs; dropped if the model shows plans of its own

    def show(plan, from_tradeoffs=False):
        nonlocal shown
        if plan:
            shown = plan
            shown_all[:] = [p for p in shown_all if p["scenario"] != plan["scenario"]] + [plan]
            if from_tradeoffs:
                research.append(plan)

    def out(reply):
        plans_out, last, chart_out = list(shown_all), shown, chart
        own = [p for p in plans_out if not any(p is r for r in research)]
        if own and len(own) < len(plans_out):  # "give us 3 plans" shows 3 cards, not 3 plus the research
            plans_out, last, chart_out = own, own[-1], None
        return {"reply": reply, "scenario": last, "scenarios": plans_out, "proposal": proposal, "optimization": optimization,
                "removed_plan_ids": list(removed),
                "chart": chart_out, "verification": verification}

    emit = on_event or (lambda event: None)

    def on_delta(kind, text):
        emit({"type": kind, "text": text})

    def run_tool(call_id, name, args):
        emit({"type": "tool_start", "id": call_id, "name": name, "args": args})
        started = time.monotonic()
        ok = False
        try:
            result = tools.run(name, args)
            ok = True
            return result
        finally:
            emit({"type": "tool_end", "id": call_id, "name": name, "ok": ok,
                  "seconds": round(time.monotonic() - started, 1)})

    def remove_plans(call_id, args):
        """Nothing runs here: the app removes the plans. Only ids from the app's list count."""
        emit({"type": "tool_start", "id": call_id, "name": "remove_plans", "args": args})
        known = {p["id"]: p.get("name") for p in plans}
        ids = [i for i in args.get("plan_ids") or [] if i in known and i not in removed]
        unknown = [i for i in args.get("plan_ids") or [] if i not in known]
        removed.extend(ids)
        emit({"type": "tool_end", "id": call_id, "name": "remove_plans", "ok": bool(ids), "seconds": 0})
        out = {"removed": [known[i] for i in ids]}
        if unknown:
            out["unknown_ids"] = unknown
        if removed and len(removed) == len(known):
            out["note"] = "Every plan is removed; the app keeps one empty plan, today's building."
        return out

    if confirm:
        # Run the confirmed problem ourselves and hand the model the result as if it had called optimize.
        keys = ("objective", "constraints", "locked", "allowed", "per_floor", "allow_warnings", "events")
        args = {k: confirm[k] for k in keys if k in confirm}
        if on_tool:
            on_tool("optimize (confirmed)", args)
        result = run_tool("confirmed_optimize", "optimize", args)
        optimization = {"problem": result["problem"], "all_limits_met": result["all_limits_met"],
                        "limits_missed": result["limits_missed"]}
        show(tools.app_scenario("Optimized plan", result["scenario"], args.get("events")))
        schemas = schemas + [tools.OPTIMIZE_SCHEMA]  # the call below must name a known tool
        call = {"id": "confirmed_optimize", "type": "function",
                "function": {"name": "optimize", "arguments": json.dumps(args)}}
        convo += [{"role": "assistant", "content": "", "tool_calls": [call]},
                  {"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)}]
        given.append(result)

    for _ in range(MAX_STEPS):
        msg = _post({"model": MODEL, "messages": convo, "tools": schemas}, on_delta)["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        convo.append({"role": "assistant", "content": msg.get("content") or "",
                      **({"tool_calls": calls} if calls else {}),
                      **{k: msg[k] for k in REASONING_FIELDS if msg.get(k)}})
        if not calls:
            reply = msg.get("content") or ""
            verification = grounding.check(reply, grounding.sources(*given), question)
            if not verification["ok"] and not repaired:
                # One repair round: name the figures no tool returned, and let the model fix or drop them.
                repaired = verification["unsupported"]
                emit({"type": "check", "status": "retry", "unsupported": repaired})
                convo.append({"role": "user", "content": grounding.repair_message(verification)})
                continue
            verification = {**verification, "repaired": bool(repaired), "first_draft_unsupported": repaired}
            emit({"type": "check", "status": "done", "result": verification})
            return out(reply)
        for call in calls:
            name = call["function"]["name"]
            try:
                if name == "optimize":
                    raise ValueError("Don't run optimize yourself: call propose_problem and let the user confirm.")
                args = json.loads(call["function"].get("arguments") or "{}")
                if on_tool:
                    on_tool(name, args)
                if name == "remove_plans":
                    result = remove_plans(call["id"], args)
                else:
                    result = run_tool(call["id"], name, args)
                if name == "show_scenario":
                    show(tools.app_scenario(**args))
                if name == "propose_problem":
                    proposal = {"problem": result["problem"], "today": result["today"]}
                if name == "upgrade_tradeoffs":  # shows its balanced package itself
                    chart = tools.tradeoff_chart(result)
                    show(tools.knee_scenario(result, args.get("events")), from_tradeoffs=True)
            except Exception as e:  # the model sees the error and can fix its call
                result = {"error": str(e)}
            convo.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
            given.append(result)
    verification = None
    return out("Sorry, I couldn't finish that. Try a simpler question.")


def _show(event):
    """Terminal view of the live events: thinking in grey, jobs on their own line, then the answer."""
    kind = event["type"]
    if kind == "thinking":
        print(f"\033[2m{event['text']}\033[0m", end="", flush=True)
    elif kind == "text":
        print(event["text"], end="", flush=True)
    elif kind == "tool_start":
        print(f"\n  ▶ running {event['name']} {json.dumps(event['args']) if event['args'] else ''}", file=sys.stderr)
    elif kind == "tool_end":
        print(f"  {'✓' if event['ok'] else '✗'} {event['name']} ({event['seconds']} s)\n", file=sys.stderr)
    elif kind == "check" and event["status"] == "retry":
        print(f"\n  ✗ not in the tool results: {', '.join(event['unsupported'])}. Rewriting.\n", file=sys.stderr)
    elif kind == "check":
        r = event["result"]
        print(f"\n  {'✓' if r['ok'] else '✗'} {r['matched']} of {r['checked']} figures match the engine"
              + (f"; not found: {', '.join(r['unsupported'])}" if r["unsupported"] else ""), file=sys.stderr)


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
        out = chat(history, confirm=confirm, on_event=_show)
        pending = out["proposal"]["problem"] if out["proposal"] else None
        history.append({"role": "assistant", "content": out["reply"]})
        print()
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
