"""Offline tests for the propose -> confirm -> optimize flow and for the check that every figure in a reply comes
from the engine. The language model is replaced by a script, so nothing is sent to OpenRouter.
Run from the repo root: python3 -m chat.test_agent. chat/test_live.py asks the real model."""
import json
import sys

from chat import agent, grounding, tools

PROBLEM = {"objective": {"metric": "running_cost_chf_year"},
           "constraints": [{"metric": "upfront_cost_chf", "max": 200000}],
           "locked": [{"group": "ventilation"}]}


def _script(*replies):
    """Fake _post: returns the given model messages in order and records each request."""
    sent = []

    def post(payload, on_delta=None):
        sent.append(json.loads(json.dumps(payload)))
        return {"choices": [{"message": replies[len(sent) - 1]}]}
    return post, sent


def _call(name, args, id_="c1"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": id_, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def _counting_solve():
    runs = []
    real = tools.optimize.solve

    def solve(data, problem, solver=None):
        runs.append(problem)
        return real(data, problem, solver)
    return solve, runs


def _with(post, solve, fn):
    old_post, old_solve = agent._post, tools.optimize.solve
    agent._post, tools.optimize.solve = post, solve
    try:
        return fn()
    finally:
        agent._post, tools.optimize.solve = old_post, old_solve


def test_a_proposal_runs_nothing():
    post, sent = _script(_call("propose_problem", PROBLEM), {"content": "Here is what I understood. Run it?"})
    solve, runs = _counting_solve()
    out = _with(post, solve, lambda: agent.chat([{"role": "user", "content": "cheapest to run, 200k max"}]))
    assert out["proposal"]["problem"]["objective"]["metric"] == "running_cost_chf_year"
    assert {"metric": "new_warnings", "max": 0} in out["proposal"]["problem"]["constraints"]
    assert "running_cost_chf_year" in out["proposal"]["today"]
    assert out["optimization"] is None and out["scenario"] is None
    assert runs == []                                           # the optimizer never ran
    assert "optimize" not in [t["function"]["name"] for t in sent[0]["tools"]]


def test_confirm_runs_exactly_the_confirmed_problem():
    confirmed = tools.propose_problem(**PROBLEM)["problem"]
    post, sent = _script({"content": "Done: here is the plan."})
    solve, runs = _counting_solve()
    out = _with(post, solve, lambda: agent.chat(
        [{"role": "user", "content": "Looks good, run the optimization."}], confirm=confirmed))
    assert len(runs) == 1 and runs[0]["locked"] == [{"group": "ventilation"}]
    assert out["optimization"]["problem"]["constraints"] == confirmed["constraints"]
    assert out["optimization"]["all_limits_met"] is True
    assert out["scenario"] and out["scenario"]["scenario"]             # the plan reaches the app
    assert not any(sw["group"] == "ventilation" for sw in out["scenario"]["scenario"])
    msgs = sent[0]["messages"]
    assert msgs[-2]["tool_calls"][0]["function"]["name"] == "optimize" and msgs[-1]["role"] == "tool"


def test_the_model_cannot_run_the_optimizer_itself():
    post, sent = _script(_call("optimize", PROBLEM), {"content": "OK, I'll propose instead."})
    solve, runs = _counting_solve()
    out = _with(post, solve, lambda: agent.chat([{"role": "user", "content": "just run it"}]))
    assert runs == [] and out["optimization"] is None
    assert "propose_problem" in sent[1]["messages"][-1]["content"]     # the model was told why


def test_the_model_can_remove_only_plans_the_app_has():
    plans = [{"id": 1, "name": "Plan 1", "changes": 0}, {"id": 2, "name": "LED plan", "changes": 1}]
    post, sent = _script(_call("remove_plans", {"plan_ids": [2, 99]}), {"content": "I removed LED plan."})
    solve, runs = _counting_solve()
    out = _with(post, solve, lambda: agent.chat([{"role": "user", "content": "remove the LED plan"}], plans=plans))
    assert out["removed_plan_ids"] == [2]                              # 99 is not a plan in the app
    assert "remove_plans" in [t["function"]["name"] for t in sent[0]["tools"]]
    assert "2: LED plan" in sent[0]["messages"][0]["content"]          # the model sees the plan list
    result = json.loads(sent[1]["messages"][-1]["content"])
    assert result["removed"] == ["LED plan"] and result["unknown_ids"] == [99]


def test_without_plans_the_model_cannot_remove_any():
    post, sent = _script({"content": "Hello."})
    out = _with(post, _counting_solve()[0], lambda: agent.chat([{"role": "user", "content": "hi"}]))
    assert out["removed_plan_ids"] == []
    assert "remove_plans" not in [t["function"]["name"] for t in sent[0]["tools"]]


# ------------------------------------------------------------------ grounding: figures in the reply vs tool output

def _texts(reply):
    return [f["text"] for f in grounding.figures(reply)]


def _check(reply, *facts, question=""):
    return grounding.check(reply, grounding.sources(*facts), question)


def test_figures_are_read_in_every_usual_format():
    figs = {f["text"]: f for f in grounding.figures(
        "CHF 4,106, CHF 4'106, 4’106 CHF, CHF 33k, CHF 1.2M, CHF 1.2 million, 12.5%, 12,5 %, 8 years, 8.5-year "
        "payback, 18 months, 1.2 MWh, 3,400 kWh, 850 ppm, 2.3 °C, 120 people")}
    assert figs["CHF 4,106"]["value"] == figs["CHF 4'106"]["value"] == figs["4’106 CHF"]["value"] == 4106
    assert figs["CHF 33k"]["value"] == 33000 and figs["CHF 33k"]["step"] == 1000
    assert figs["CHF 1.2M"]["value"] == figs["CHF 1.2 million"]["value"] == 1.2e6
    assert figs["12,5 %"]["value"] == 12.5 and figs["12.5%"]["kind"] == "percent"
    assert figs["8.5-year"]["kind"] == "years" and figs["18 months"]["value"] == 1.5
    assert figs["1.2 MWh"]["value"] == 1200 and figs["1.2 MWh"]["kind"] == "energy"   # in kWh, the engine's unit
    assert {figs[t]["kind"] for t in ("850 ppm", "2.3 °C", "120 people")} == {"ppm", "temperature", "people"}


def test_numbers_without_a_unit_are_not_figures():
    # Floors, dates, list items, counts and names carry no unit, so nothing here is checked.
    assert _texts("1. Floor 2 and floors 1-3, from 2026 to 2030, top 3 upgrades, CO2 levels, option lighting_mid, "
                  "year 1, 48 units") == []


def test_a_figure_matches_within_the_rounding_it_shows():
    assert _check("Saves CHF 33k a year.", {"saving_chf_year": 32600})["ok"]
    assert not _check("Saves CHF 33k a year.", {"saving_chf_year": 32400})["ok"]
    assert _check("Pays back in 8 years.", {"payback_years": 8.4})["ok"]
    assert not _check("Pays back in 8 years.", {"payback_years": 8.6})["ok"]
    assert _check("It costs CHF 26,100.", {"upfront_cost_chf": 26145})["ok"]     # rounded to the hundred
    assert not _check("It costs CHF 26,145.", {"upfront_cost_chf": 26100})["ok"]  # exact figures must be exact
    assert _check("It costs CHF 200,000.", {"upfront_cost_chf": 196400})["ok"]
    assert not _check("It costs CHF 200,000.", {"upfront_cost_chf": 185000})["ok"]  # never coarser than 2 digits


def test_plain_rescaling_is_allowed():
    assert _check("It saves 154 MWh a year.", {"electricity_kwh_year": 154498})["ok"]
    assert _check("The discount rate is 3%.", {"discount_rate_real": 0.03})["ok"]       # a share as a percent
    assert _check("It saves CHF 4,106 a year.", {"saving_chf_year": -4106})["ok"]       # the sign doesn't matter
    assert _check("That is CHF 2,575 a month.", {"energy_bill_saving_chf_year": 30900})["ok"]  # a year / 12


def test_a_figure_must_match_a_field_of_its_kind():
    assert not _check("Payback is 2 years.", {"changed_floors": [1, 2, 3]})["ok"]        # floor 2 is not 2 years
    assert not _check("It costs CHF 15.", {"payback_years": 15})["ok"]                   # years are not francs
    assert not _check("It cuts the bill by 14%.", {"upfront_cost_chf": 14})["ok"]
    assert _check("Over 15 years.", "Ranked over horizon 15 years.")["ok"]                # free text counts


def test_numbers_from_the_question_are_given():
    result = _check("For CHF 200,000 you cut the bill by 5%.", {}, question="Cut the bill by 5% for 200k max")
    assert result["ok"] and result["checked"] == 0 and len(result["from_question"]) == 2


def test_engine_output_grounds_a_real_reply():
    facts = tools.simulate_scenario([{"group": "lighting", "option": "lighting_mid"}])
    reply = (f"LED lights cost CHF {facts['upfront_cost_chf']:,} and cut the energy bill by "
             f"{facts['energy_bill_saving_pct']:g}% (CHF {facts['energy_bill_saving_chf_year']:,} a year). "
             f"Payback is {facts['payback_years']:g} years over the {facts['horizon_years']}-year horizon.")
    result = _check(reply, facts)
    assert result["ok"] and result["checked"] == 5, result


LIGHTS = [{"group": "lighting", "option": "lighting_mid"}]


def _grounded_reply():
    s = tools.simulate_scenario(LIGHTS)
    return f"LED lights cost CHF {s['upfront_cost_chf']:,} and pay back in {s['payback_years']:g} years."


def test_a_made_up_figure_is_sent_back_and_fixed():
    events = []
    post, sent = _script(_call("simulate_scenario", {"scenario": LIGHTS}),
                         {"content": "LED lights cost CHF 99,999 and pay back in 1.8 years."},
                         {"content": _grounded_reply()})
    out = _with(post, _counting_solve()[0], lambda: agent.chat([{"role": "user", "content": "LED lights?"}],
                                                               on_event=events.append))
    repair = sent[2]["messages"][-1]
    assert repair["role"] == "user" and "CHF 99,999" in repair["content"] and "1.8" not in repair["content"]
    assert out["reply"] == _grounded_reply()
    v = out["verification"]
    assert v["ok"] and v["repaired"] and v["first_draft_unsupported"] == ["CHF 99,999"] and v["checked"] == 2
    checks = [e for e in events if e["type"] == "check"]
    assert [e["status"] for e in checks] == ["retry", "done"]        # the app hears about both


def test_a_figure_still_unsupported_after_the_repair_is_flagged():
    post, sent = _script(_call("simulate_scenario", {"scenario": LIGHTS}),
                         {"content": "LED lights save 42% and cost CHF 99,999."},
                         {"content": "LED lights save 42%. " + _grounded_reply()})
    out = _with(post, _counting_solve()[0], lambda: agent.chat([{"role": "user", "content": "LED lights?"}]))
    assert len(sent) == 3                                               # one repair round, no more
    v = out["verification"]
    assert not v["ok"] and v["unsupported"] == ["42%"] and v["matched"] == 2 and v["repaired"]
    assert out["reply"].startswith("LED lights save 42%")             # the reply is sent, with the flag


def test_a_grounded_reply_needs_no_repair():
    post, sent = _script(_call("simulate_scenario", {"scenario": LIGHTS}), {"content": _grounded_reply()})
    out = _with(post, _counting_solve()[0], lambda: agent.chat([{"role": "user", "content": "LED lights?"}]))
    assert len(sent) == 2 and out["verification"]["ok"] and not out["verification"]["repaired"]


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError as e:
            failed += 1
            print("FAIL", t.__name__, e)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
