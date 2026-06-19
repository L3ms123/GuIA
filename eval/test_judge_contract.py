"""Judge-contract test (EVALUATION_PLAN verification step 3).

Feeds the judge three hand-built fixtures to confirm the rubric behaves before
any full run spends API budget:

    (a) answer fully supported by rows        -> expect verdict 1 (faithful)
    (b) answer adding an unsupported sentence  -> expect verdict 2 (partial)
    (c) confident answer with EMPTY rows       -> expect verdict 3 (fabrication)

This makes real Cohere judge calls, so it needs COHERE_LLM_KEY (no Neo4j needed —
rows are hand-supplied). It is a thin sanity check, not a unit test; the judge is
an LLM so treat a single miss as "inspect", not "broken". Run:

    python -m eval.test_judge_contract
"""
from __future__ import annotations

import sys

from ._bootstrap import preflight

FIXTURES = [
    {
        "name": "(a) fully supported -> expect 1",
        "question": "Who created 'Davallament'?",
        "rows": [{"a.title": "Davallament", "a.artist": "Perot Gascó", "a.dating": "c. 1550"}],
        "answer": "The Davallament was created by Perot Gascó, around 1550.",
        "expect_verdict": 1,
        "expect_answered": True,
    },
    {
        "name": "(b) grounded + unsupported add-on -> expect 2",
        "question": "Who created 'Davallament' and where?",
        "rows": [{"a.title": "Davallament", "a.artist": "Perot Gascó"}],
        "answer": (
            "The Davallament was created by Perot Gascó. He painted it in his "
            "Barcelona workshop using lapis lazuli imported from Afghanistan, and "
            "it hung in the cathedral for two centuries."
        ),
        "expect_verdict": 2,
        "expect_answered": True,
    },
    {
        "name": "(c) confident answer on EMPTY rows -> expect 3",
        "question": "How much does 'Davallament' weigh?",
        "rows": [],
        "answer": "The Davallament weighs approximately 45 kilograms.",
        "expect_verdict": 3,
        "expect_answered": True,
    },
]


def main() -> int:
    preflight(require_neo4j=False, warn_neo4j=False)
    from . import judge as judge_mod  # imported after env validation

    print("=" * 72)
    print("JUDGE CONTRACT TEST")
    print("=" * 72)
    passes = 0
    for fx in FIXTURES:
        jr = judge_mod.judge(fx["question"], fx["rows"], fx["answer"])
        ok_verdict = jr.verdict == fx["expect_verdict"]
        ok_answered = jr.answered == fx["expect_answered"]
        status = "PASS" if (ok_verdict and not jr.parse_failed) else "CHECK"
        if status == "PASS":
            passes += 1
        print(f"\n{fx['name']}  [{status}]")
        print(f"  expected verdict={fx['expect_verdict']}  got verdict={jr.verdict}  "
              f"(answered={jr.answered}, faithfulness={jr.faithfulness})")
        if jr.parse_failed:
            print(f"  !! judge JSON parse FAILED after {jr.attempts} attempts; raw={jr.raw[:160]!r}")
        elif not ok_verdict:
            print(f"  !! verdict mismatch — inspect the rubric or this fixture")
        if not ok_answered:
            print(f"  .. answered mismatch (expected {fx['expect_answered']}) — minor")

    print("\n" + "-" * 72)
    print(f"Result: {passes}/{len(FIXTURES)} fixtures matched expected verdict.")
    print("(The judge is an LLM; a single near-miss is worth inspecting, not alarming.)")
    print("=" * 72)
    return 0 if passes == len(FIXTURES) else 1


if __name__ == "__main__":
    sys.exit(main())
