"""Part 1 faithfulness judge: prompt, minimal JSON contract, parse + retry.

A second Cohere call grades whether the guide's answer is grounded in the rows
it was given. The judge is stateless (no conversation_id) and uses its own
strict preamble, independent of the guide's ``build_system_prompt``.

Output contract — EXACTLY three keys, no nesting:

    {"faithfulness": 0.0-1.0, "answered": true/false, "verdict": 1|2|3}

Self-bias caveat: the judge is the same model family as the guide, so reported
faithfulness is an optimistic UPPER BOUND. ``config.JUDGE_MODEL`` makes it
swappable to de-bias later.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Optional

from . import config, llm_bridge

# --- The verbatim rubric ----------------------------------------------------
JUDGE_SYSTEM = """\
You are a strict evaluation judge for a museum audio-guide AI. You assess ONE
thing: whether the guide's ANSWER is faithful to the RETRIEVED ROWS it was
given. The rows are graph-database results and are the SOLE source of truth.

CRITICAL RULES:
- Judge ONLY against the rows. IGNORE your own world knowledge. If the answer
  states something true in the real world but absent from the rows, that is
  still unsupported.
- The rows may be empty. If the rows are empty (or do not contain what the
  question asks), a faithful guide REFUSES or says the graph lacks the
  information. Refusing on empty rows is FAITHFUL, not a failure.
- Greetings, generic framing ("Let me tell you about this artwork"),
  invitations to ask more, and clearly-hedged interpretation ("this may
  suggest...") are NOT inventions. Do not penalize them.
- Only concrete factual CLAIMS count: names, dates, places, techniques,
  attributions, materials, measurements, ownership, etc.
- The QUESTION and ANSWER may be in English, Spanish, or Catalan; the rows are
  often in Catalan. Judge the meaning across languages — a Spanish or Catalan
  answer that matches the rows is faithful. Do NOT penalize the answer's
  language or treat a translation of a row value as an unsupported claim.

Output THREE fields:

1. "faithfulness" (float 0.0 to 1.0): the fraction of the answer's concrete
   factual claims that are supported by the rows. 1.0 = every claim supported
   (or a correct refusal on empty/irrelevant rows). 0.0 = none supported, or
   the answer contradicts the rows.

2. "answered" (boolean): true if the guide attempted a substantive answer;
   false if it refused or said the graph lacks the information.

3. "verdict" (integer 1, 2, or 3): the invention severity.
   - 1 = Faithful. Every claim is grounded in the rows, OR the guide correctly
     refused because the rows were empty/irrelevant. No invention.
   - 2 = Partial invention. The core answer is grounded, but it adds some
     plausible detail not supported by the rows.
   - 3 = Fabrication. It asserts facts that are absent from, or contradict,
     the rows (this includes confidently answering when the rows are empty).

Output ONLY the JSON object with exactly these three keys — no markdown, no
prose, no code fences. Example: {"faithfulness": 1.0, "answered": true, "verdict": 1}
"""

JUDGE_USER_TEMPLATE = """\
QUESTION:
{question}

RETRIEVED ROWS (the only source of truth; may be empty):
{rows_json}

GUIDE ANSWER:
{answer}

Return ONLY the JSON object with keys faithfulness, answered, verdict.
"""

_RETRY_NUDGE = (
    "\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object "
    'in exactly this form: {"faithfulness": <0.0-1.0>, "answered": <true|false>, '
    '"verdict": <1|2|3>} — no other text.'
)


@dataclass
class JudgeResult:
    faithfulness: Optional[float]
    answered: Optional[bool]
    verdict: Optional[int]
    parse_failed: bool
    raw: str          # last raw judge text (for triage)
    attempts: int

    def to_record(self) -> dict[str, Any]:
        return {
            "faithfulness": self.faithfulness,
            "answered": self.answered,
            "verdict": self.verdict,
            "judge_parse_failed": self.parse_failed,
            "judge_attempts": self.attempts,
            "judge_raw": self.raw,
        }


def _serialize_rows(rows: Optional[list]) -> str:
    """Serialize rows exactly as the guide saw them (json.dumps, ensure_ascii=False, indent=2)."""
    return json.dumps(rows or [], ensure_ascii=False, indent=2)


def _coerce(parsed: dict) -> Optional[dict]:
    """Validate keys/types; clamp faithfulness to [0,1]; coerce verdict & answered.

    Returns a clean dict, or None if the required fields cannot be coerced.
    """
    if not isinstance(parsed, dict):
        return None
    if not all(k in parsed for k in ("faithfulness", "answered", "verdict")):
        return None

    try:
        faithfulness = float(parsed["faithfulness"])
    except (TypeError, ValueError):
        return None
    faithfulness = max(0.0, min(1.0, faithfulness))

    answered_raw = parsed["answered"]
    if isinstance(answered_raw, bool):
        answered = answered_raw
    elif isinstance(answered_raw, str):
        answered = answered_raw.strip().lower() in {"true", "yes", "1"}
    elif isinstance(answered_raw, (int, float)):
        answered = bool(answered_raw)
    else:
        return None

    try:
        verdict = int(parsed["verdict"])
    except (TypeError, ValueError):
        return None
    if verdict not in (1, 2, 3):
        return None

    return {"faithfulness": faithfulness, "answered": answered, "verdict": verdict}


def parse_judge_json(text: str) -> Optional[dict]:
    """Parse the judge reply: strip fences, try whole string then the {...} slice.

    Mirrors the first-'{' .. last-'}' idiom from LLM_Call.parse_translation_response.
    Returns the coerced dict or None.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    # Strip a leading/trailing markdown code fence if present.
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start:end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        coerced = _coerce(parsed)
        if coerced is not None:
            return coerced
    return None


def judge(question: str, rows: Optional[list], answer: str) -> JudgeResult:
    """Run the judge with bounded retry on unparseable JSON.

    On final failure: parse_failed=True with null fields (the driver excludes it
    from means and counts it). Never raises for a bad reply — only a hard Cohere
    error propagates, which the driver catches per item.
    """
    rows_json = _serialize_rows(rows)
    user = JUDGE_USER_TEMPLATE.format(
        question=question, rows_json=rows_json, answer=answer or "(empty answer)"
    )

    last_raw = ""
    total_attempts = config.JUDGE_RETRIES + 1
    for attempt in range(1, total_attempts + 1):
        prompt = user if attempt == 1 else user + _RETRY_NUDGE
        last_raw = llm_bridge.judge_raw(JUDGE_SYSTEM, prompt)
        parsed = parse_judge_json(last_raw)
        if parsed is not None:
            return JudgeResult(
                faithfulness=parsed["faithfulness"],
                answered=parsed["answered"],
                verdict=parsed["verdict"],
                parse_failed=False,
                raw=last_raw,
                attempts=attempt,
            )

    return JudgeResult(
        faithfulness=None,
        answered=None,
        verdict=None,
        parse_failed=True,
        raw=last_raw,
        attempts=total_attempts,
    )
