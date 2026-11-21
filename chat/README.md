# Chat with the twin

Ask the building a question in plain words, like "Cut our monthly energy bill by 5%. What does it cost and what's the ROI?" The assistant picks the upgrades, tests them in Oscar's engine, answers with cost, savings, payback and ROI, and hands the app a scenario to show.

## How it works

The language model can't run code. It can only ask for a tool.

1. Every request to OpenRouter includes a list of tools: a name, a description and the inputs each one takes (`SCHEMAS` in `tools.py`).
2. The model replies with either a final answer or a request to run a tool with certain inputs.
3. `agent.py` runs that tool, which runs Oscar's engine (`model/engine.py`), and sends the result back to the model.
4. This repeats until the model answers in plain text. A question takes 3 to 8 rounds.

The tools:
- `get_building_overview`: today's bill, energy use, what's installed and what's worn out, air quality, money limits.
- `list_options`: the products for one group, with prices and descriptions.
- `rank_upgrades`: every single upgrade, ranked by payback, for the whole building or floor by floor.
- `simulate_scenario`: runs the engine on a set of swaps, optionally with events such as a price spike.
- `find_best_upgrades`: searches every combination of upgrades for a goal (`model/optimize.py`). Goals: the cheapest package that reaches a savings target, the most savings within a budget, or the lowest total cost over some years. It can keep some things as they are, change only some things, or force a change. When savings are counted on the energy bill or in kWh, a package may not raise total running costs (e.g. capsule coffee machines use less electricity but cost more in capsules), unless the user cares only about energy.
- `upgrade_tradeoffs`: the best packages from cheapest to biggest saving, so people can see what more saving costs. Each package saves the most possible for its cost.
- `show_scenario`: the package the model recommends, sent to the app.

The model never does the maths. Every number it gives comes from the engine.

## Run

1. Copy `.env.example` to `.env` and paste the OpenRouter key. Git ignores `.env`; never commit the key anywhere else.
2. `make dev` serves the assistant at `POST /api/chat`, next to the engine's other endpoints.
3. To chat in the terminal instead, run `python3 -m chat.agent` from the repo root. It prints each tool call.

The default model is Claude Sonnet 5.5, at about 5 US cents and 15 seconds per question. The shared key has a USD 10 limit. While testing, put `CHAT_MODEL=anthropic/claude-haiku-5.5` in `.env`. It's about 20 times cheaper.

## For the app

`POST /api/chat`, typed as `api.chat()` in `frontend/src/api/client.ts`. Send the whole conversation each time; the server keeps no state.

```json
{
  "messages": [{"role": "user", "content": "Cut our bill by 5%"}],
  "scenario": [{"group": "lighting", "option": "lighting_mid", "floor": 2}]
}
```

`scenario` is optional. It's the scenario the app shows right now, so the assistant can answer "what if we also do floor 3?".

The reply:
- `reply`: Markdown for the chat panel.
- `scenario`: `null`, or the package the assistant recommends:
  - `title`: a short name.
  - `scenario`: the swaps, ready for `/api/simulate`.
  - `events`: any what-if events it used.
  - `item_ids`: the items that change. They match the mesh names, so they can be highlighted in 3D.
  - `summary`: the figures the assistant quoted, such as `upfront_cost_chf`, `energy_bill_chf_month` and `payback_years`.
- `chart`: `null`, or a chart to draw when the assistant compared packages (`upgrade_tradeoffs`):
  - `type`: `"pareto"`, meaning every point is a package no other package beats on both cost and saving.
  - `x_metric`, `x_label`: up-front cost in CHF.
  - `y_metric`, `y_label`: the yearly saving, e.g. "Running-cost saving (CHF/year)".
  - `points`: sorted by cost. Each has `x`, `y`, a `label` listing the changes, and the `scenario` (swaps for `/api/simulate`).
  - `knee_index`: the balanced point. Past it, each extra franc buys less saving.

## Files

- `agent.py`: the model's instructions (`SYSTEM`), the tool loop and the terminal chat.
- `tools.py`: the tools and the summary of engine results the model sees.
- The `/api/chat` route is in `model/server.py`.
