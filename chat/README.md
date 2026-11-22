# Chat with the twin

Ask the building a question in plain words, like "Cut our monthly energy bill by 5%. What does it cost and what's the ROI?" or "Lowest running costs for at most CHF 200k, but don't touch the ventilation." The assistant picks the upgrades, tests them in Oscar's engine, answers with cost, savings, payback and ROI, and hands the app a scenario to show.

## How it works

The language model can't run code. It can only ask for a tool.

1. Every request to OpenRouter includes a list of tools: a name, a description and the inputs each one takes (`SCHEMAS` in `tools.py`).
2. The model replies with either a final answer or a request to run a tool with certain inputs.
3. `agent.py` runs that tool, which runs Oscar's engine (`model/engine.py`), and sends the result back to the model.
4. This repeats until the model answers in plain text. A goal takes about 2 model calls: one to call optimize, one to answer. optimize and upgrade_tradeoffs show their plan in the app themselves.

The tools:
- `get_building_overview`: today's bill, energy use, what's installed and what's worn out, air quality, money limits.
- `list_options`: the products for one group, with prices and descriptions.
- `rank_upgrades`: every single upgrade, ranked by payback, for the whole building or floor by floor.
- `simulate_scenario`: runs the engine on a set of swaps, optionally with events such as a price spike.
- `list_metrics`: the goals and limits the optimizer understands, with today's value of each.
- `propose_problem`: turns the user's goal and limits (budget, things that must not change, only certain options) into a problem for the optimizer in `model/optimize.py`. It checks the problem and adds today's values, but runs nothing.
- `optimize`: runs the optimizer. Only the server calls it, after the user confirms (see below). If the model tries, it is told to propose instead.
- `upgrade_tradeoffs`: the best packages from cheapest to biggest saving (the cost-vs-savings curve from `model/search.py`), so people can see what more saving costs. It shows the balanced package in the app itself.
- `show_scenario`: simulates a package and sends it to the app. The confirmed optimization and `upgrade_tradeoffs` show their own plan, so the model uses this for a specific change or another package.

The model never does the maths. Every number it gives comes from the engine.

## Optimizing: propose, confirm, run

For a goal with limits ("lowest running costs for at most CHF 200k, keep the ventilation"), the user checks the problem before anything runs:
1. The model calls `propose_problem` and replies briefly. The app shows the goal and limits with a "Run optimization" button.
2. To change something, the user just says so ("the budget is 250k"). The model proposes again.
3. When the user presses the button, the app sends the proposal's problem as `confirm`. The server runs the optimizer on exactly that problem, so the model can't change it, and then the model explains the plan.

In the terminal chat, type `y` to run a proposal.

## Run

1. Copy `.env.example` to `.env` and paste the OpenRouter key. Git ignores `.env`; never commit the key anywhere else.
2. `make dev` serves the assistant at `POST /api/chat`, next to the engine's other endpoints.
3. To chat in the terminal instead, run `python3 -m chat.agent` from the repo root. It prints each tool call.

The model thinks briefly before it answers. `CHAT_REASONING` in `.env` sets how hard: `low` (default), `medium`, `high`, or `off`.

The default model is Claude Sonnet 5.5, at about 5 US cents and 15 seconds per question. The shared key has a USD 10 limit. While testing, put `CHAT_MODEL=anthropic/claude-haiku-5.5` in `.env`. It's about 20 times cheaper.

## For the app

`POST /api/chat`, typed as `api.chat()` in `frontend/src/api/client.ts`. Send the whole conversation each time; the server keeps no state.

The app uses the live version, `POST /api/chat/stream` (`api.chatStream()`). It takes the same body and sends one JSON object per line as things happen:
- `thinking` and `text`: the next piece of the model's thinking or of its reply.
- `tool_start` and `tool_end`: a job in the building model starts or ends (`name`, `args`, then `ok` and `seconds`). The app shows these apart from thinking, so people can tell the model is waiting for the engine.
- `ping`: every 10 s while nothing else happens. If the line stays silent for 35 s, the app gives up and says the API is not responding.
- `done` with `result`: the same answer as `/api/chat`. Or `error` with `message`.

```json
{
  "messages": [{"role": "user", "content": "Cut our bill by 5%"}],
  "scenario": [{"group": "lighting", "option": "lighting_mid", "floor": 2}],
  "confirm": null,
  "context": "The user is in the 3D building view, looking at the lighting for floor 2."
}
```

`scenario` is optional. It's the scenario the app shows right now, so the assistant can answer "what if we also do floor 3?".

`context` is optional. It says in words where the user is in the app, e.g. "The user is in the 3D building view, looking at the lighting for floor 2 …". The assistant uses it for "this" and "here", so "Which option pays back fastest here?" works.

The reply:
- `reply`: Markdown for the chat panel.
- `scenario`: `null`, or the package the assistant recommends:
  - `title`: a short name.
  - `scenario`: the swaps, ready for `/api/simulate`.
  - `events`: any what-if events it used.
  - `item_ids`: the items that change. They match the mesh names, so they can be highlighted in 3D.
  - `summary`: the figures the assistant quoted, such as `upfront_cost_chf`, `energy_bill_chf_month` and `payback_years`.
- `chart`: `null`, or the cost-vs-savings curve when the assistant compared packages: `x_label`, `y_label`, `points` (each with `x`, `y`, a `label` of the changes and its `scenario`) and `knee_index`, the balanced point.
- `proposal`: `null`, or a problem waiting for the user's OK: `problem` (already checked, with relative limits turned into absolute ones and a "no new warnings" limit added) and `today` (today's value of the goal and each limit). To run it, send the next message with `"confirm": proposal.problem`. The format is in [model/README.md](../model/README.md#optimizer-optimizepy).
- `optimization`: `null`, or after a confirmed run: `problem`, `all_limits_met` and `limits_missed`.

`confirm` is optional: a problem from an earlier `proposal` that the user confirmed.

## Files

- `agent.py`: the model's instructions (`SYSTEM`), the tool loop, the confirmed-run step and the terminal chat.
- `test_agent.py`: offline tests of propose, confirm and run, with the model replaced by a script (`make test` runs them).
- `tools.py`: the tools and the summary of engine results the model sees.
- The `/api/chat` route is in `model/server.py`.
