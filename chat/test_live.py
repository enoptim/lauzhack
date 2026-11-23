"""Live test: asks the real model a few questions through the real agent and checks that every figure in each reply
is in the engine's output. It costs a few cents, so it only runs when ASSISTANT_MODEL_API_KEY is set (root .env).
Run from the repo root: python3 -m chat.test_live"""
import os
import sys
import time

from chat import agent

QUESTIONS = [
    "Which single upgrades pay back fastest? Give the top 3 with cost, yearly saving and payback.",
    "What would LED lighting on every floor cost up front, and what are the yearly saving, payback and ROI?",
    "What does our building cost to run today: the monthly energy bill and the yearly electricity use?",
]


def main():
    if not os.environ.get("ASSISTANT_MODEL_API_KEY"):
        print("SKIP: no ASSISTANT_MODEL_API_KEY in the root .env or the environment")
        return 0
    failed = 0
    for q in QUESTIONS:
        started = time.monotonic()
        out = agent.chat([{"role": "user", "content": q}])
        v = out["verification"] or {}
        ok = v.get("ok") and v.get("checked", 0) > 0
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'} ({time.monotonic() - started:.0f} s) {q}")
        print(f"  {v.get('matched')} of {v.get('checked')} figures grounded"
              + (f", fixed after one repair (first draft: {', '.join(v['first_draft_unsupported'])})"
                 if v.get("repaired") else "")
              + (f"; unsupported: {', '.join(v['unsupported'])}" if v.get("unsupported") else ""))
        print("  " + out["reply"].replace("\n", "\n  "))
    print(f"{len(QUESTIONS) - failed}/{len(QUESTIONS)} passed (model {agent.MODEL})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
