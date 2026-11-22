"""Offline tests for the propose -> confirm -> optimize flow. The language model is replaced by a script,
so nothing is sent to OpenRouter. Run from the repo root: python3 -m chat.test_agent"""
import json

from chat import agent, tools

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


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except AssertionError:
            failed += 1
            print("FAIL", t.__name__)
    print(f"{len(tests) - failed}/{len(tests)} passed")
