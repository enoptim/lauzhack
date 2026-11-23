# Chat with the twin

Ask the building a question in plain words, like "Cut our monthly energy bill by 5%. What does it cost and what's the ROI?" or "Lowest running costs for at most CHF 200k, but don't touch the ventilation." The assistant picks the upgrades, tests them in Oscar's engine, answers with cost, savings, payback and ROI, and hands the app a scenario to show.

## How it works

The language model can't run code. It can only ask for a tool.

1. Every request to Nebius Token Factory includes a list of tools: a name, a description and the inputs each one takes (`SCHEMAS` in `tools.py`).
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
- `remove_plans`: removes plans from the app's plan list when the user asks. It's only offered when the app sends its `plans`. The app removes them and shows an Undo button.
- `show_scenario`: simulates a package and sends it to the app. The confirmed optimization and `upgrade_tradeoffs` show their own plan, so the model uses this for a specific change or another package.

The model never does the maths. Every number it gives comes from the engine, and a program checks that.

## Checking the figures

A language model can still write a number that no tool gave it. So after it answers, `grounding.py` checks every figure in the reply before the reply is sent:
1. It finds each number with a unit: CHF amounts (`CHF 4,106`, `4'106 CHF`, `CHF 33k`, `CHF 1.2M`), percentages, years and months, kWh/MWh, ppm, °C and people. Numbers without a unit, like dates, floor numbers and list items, are not checked.
2. It looks for the same number in this turn's tool results, the building's parameters and today's values. A CHF figure must match a field measured in CHF (`upfront_cost_chf`), a payback in years a field in years, and so on.
3. A figure matches within the rounding it shows: "CHF 33k" matches 32,500 to 33,499, "8 years" matches 7.5 to 8.49, "CHF 26,100" matches 26,050 to 26,149. Only plain rescaling is allowed: kWh to MWh, a share to a percent (0.12 to 12%), per year to per month, and the sign ("saves CHF 4,106" for -4,106). Other sums are not checked: a figure the model worked out itself fails.
4. Numbers the user typed (a budget, a target) count as given.

If a figure fails, the model gets one more round: it is told exactly which figures are not in the tool results and rewrites its reply, calling tools if it needs to. If a figure still fails, the reply is sent with a warning. Either way the result comes back as `verification`, and the app shows one quiet line under the reply: "All 6 figures match the building model", or which figures could not be checked.

## Optimizing: propose, confirm, run

For a goal with limits ("lowest running costs for at most CHF 200k, keep the ventilation"), the user checks the problem before anything runs:
1. The model calls `propose_problem` and replies briefly. The app shows the goal and limits with a "Run optimization" button.
2. To change something, the user just says so ("the budget is 250k"). The model proposes again.
3. When the user presses the button, the app sends the proposal's problem as `confirm`. The server runs the optimizer on exactly that problem, so the model can't change it, and then the model explains the plan.

In the terminal chat, type `y` to run a proposal.

## Run

1. Copy the root `.env.example` to `.env` and set `ASSISTANT_MODEL_API_KEY` to your Nebius Token Factory key. Git ignores `.env`; never commit the key anywhere else.
2. `make dev` serves the assistant at `POST /api/chat`, next to the engine's other endpoints.
3. To chat in the terminal instead, run `python3 -m chat.agent` from the repo root. It prints each tool call.

The default model is `Qwen/Qwen3-235B-A22B-Instruct-2507`. To use another Nebius model, set `ASSISTANT_MODEL` to its model ID. Choose one that supports tool calls. `ASSISTANT_MODEL_BASE_URL` sets the API base URL (ending in `/v1`).

If your model supports reasoning effort, set `CHAT_REASONING` to `low`, `medium`, or `high`. The default, `off`, leaves that setting to the model.

## For the app

`POST /api/chat`, typed as `api.chat()` in `frontend/src/api/client.ts`. Send the whole conversation each time; the server keeps no state.

The app uses the live version, `POST /api/chat/stream` (`api.chatStream()`). It takes the same body and sends one JSON object per line as things happen:
- `thinking` and `text`: the next piece of the model's thinking or of its reply.
- `tool_start` and `tool_end`: a job in the building model starts or ends (`name`, `args`, then `ok` and `seconds`). The app shows these apart from thinking, so people can tell the model is waiting for the engine.
- `check`: the figure check. `status: "retry"` with `unsupported` (the figures that failed) means the draft is dropped and a rewrite follows. `status: "done"` with `result` is the final `verification`.
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
- `removed_plan_ids`: the plans the assistant removed. The app removes them and offers an undo. Removing every plan leaves one empty plan, today's building.
- `scenarios`: every plan the assistant showed in this reply, in order. Ask for "3 plans" and you get 3; the app draws a card for each and can add them all to the plan list. The last one is `scenario`.
- `chart`: `null`, or the cost-vs-savings curve when the assistant compared packages: `x_label`, `y_label`, `points` (each with `x`, `y`, a `label` of the changes and its `scenario`) and `knee_index`, the balanced point.
- `proposal`: `null`, or a problem waiting for the user's OK: `problem` (already checked, with relative limits turned into absolute ones and a "no new warnings" limit added) and `today` (today's value of the goal and each limit). To run it, send the next message with `"confirm": proposal.problem`. The format is in [model/README.md](../model/README.md#optimizer-optimizepy).
- `optimization`: `null`, or after a confirmed run: `problem`, `all_limits_met` and `limits_missed`.
- `verification`: the figure check (see "Checking the figures"): `checked` and `matched` (counts), `unsupported` (figures as written), `from_question`, `ok`, and `repaired` with `first_draft_unsupported` when the first draft failed.

`plans` is optional: the plans in the app, as `{"id", "name", "changes", "source"}`. With it the assistant can remove plans; the ids it removed come back in `removed_plan_ids`.

`confirm` is optional: a problem from an earlier `proposal` that the user confirmed.

## Files

- `agent.py`: the model's instructions (`SYSTEM`), the tool loop, the confirmed-run step and the terminal chat.
- `grounding.py`: the figure check.
- `test_agent.py`: offline tests of propose, confirm and run, and of the figure check, with the model replaced by a script (`make test` runs them).
- `test_live.py`: asks the real model 3 questions and fails if any figure in a reply is not in the engine's results. It costs a few cents, so it only runs with a key: `python3 -m chat.test_live`. Without a key it prints SKIP.
- `tools.py`: the tools and the summary of engine results the model sees.
- The `/api/chat` route is in `model/server.py`.
