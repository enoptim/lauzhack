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
- `optimize`: turns the user's goal and limits (budget, things that must not change, only certain options) into a problem for the optimizer in `model/optimize.py`, and returns the best plan it found next to today.
- `upgrade_tradeoffs`: the best packages from cheapest to biggest saving (the cost-vs-savings curve from `model/search.py`), so people can see what more saving costs.
- `show_scenario`: simulates a package and sends it to the app. `optimize` and `upgrade_tradeoffs` show their own plan, so the model uses this for a specific change or another package.

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
- `chart`: `null`, or the cost-vs-savings curve when the assistant compared packages: `x_label`, `y_label`, `points` (each with `x`, `y`, a `label` of the changes and its `scenario`) and `knee_index`, the balanced point.
- `problem`: `null`, or the goal and limits the assistant optimized for. Show it so the user can check and correct it. The format is in [model/README.md](../model/README.md#optimizer-optimizepy).

## Files

- `agent.py`: the model's instructions (`SYSTEM`), the tool loop and the terminal chat.
- `tools.py`: the tools and the summary of engine results the model sees.
- The `/api/chat` route is in `model/server.py`.
