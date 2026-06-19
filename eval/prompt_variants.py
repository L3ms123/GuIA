"""Parametrized system-prompt builder + variant registry for Part 4.

Part 4 (prompt sensitivity) treats the SYSTEM PROMPT as the independent variable.
The shipped backend bakes the prompt inside ``call_cohere_guide`` via
``build_system_prompt`` (LLM_Call.py:1434-1559), so to vary it cleanly we mirror
that builder here with the axes exposed as parameters:

* ``few_shot`` — include the two EXAMPLE A/B few-shot blocks or not.
* ``rag_position`` — put the RETRIEVED NEO4J CONTEXT block AFTER the rules (the
  shipped order) or BEFORE them (the canonical "Prompt Report" context-position
  probe).
* ``personality`` / ``age_range`` — the personalization (semantic) axes.
* ``example_order`` — order of the two few-shot examples (a future robustness
  axis; functional but OFF by default in the registry).

DRIFT RISK + MITIGATION. The block TEXT (intro, the two examples, the RAG
instructions, the grounding check) is copied verbatim from ``build_system_prompt``
— it cannot be imported piecemeal because that function assembles one string. So
this module can silently fall out of sync if someone edits the backend prompt
(the user recently added the few-shot examples and the grounding check). The
``--selftest`` guards exactly this: it asserts the BASELINE variant is
byte-identical to ``_LLM.build_system_prompt(...)`` for the same inputs. Run it
after any backend prompt edit:

    python -m eval.prompt_variants --selftest

The RULE TEXT (language rule, persona rule) and the detail-trigger and visual
guidelines are pulled live from the backend (``get_language_rule`` :145,
``get_persona_rule`` :150, ``user_requested_detail`` :1372,
``VISUAL_DESCRIPTION_GUIDELINES`` :1357) so those never drift.

Importing this module triggers the backend import (via llm_bridge -> _bootstrap),
so it needs COHERE_LLM_KEY like the other live modules.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from typing import Any, Optional

from . import config


def _backend():
    """Lazily import the backend (LLM_Call) module via the bridge.

    Deferred so the registry, dataclasses and the driver's --dry-run path stay
    network-free / key-free — only actually BUILDING a prompt (or the parity
    selftest) needs the live backend, exactly like Part 2/3 lazy-import llm_bridge.
    """
    from .llm_bridge import _LLM
    return _LLM


# --- Block literals (verbatim copies of build_system_prompt, :1452-1557) -----
# Guarded by the byte-identity --selftest below. Keep in sync with the backend.

_INTRO = (
    "You are GuIA, the AI audio guide of the Museu del Renaixement in Molins de Rei."
    "You speak only about this museum and its collection."
    "You answer the user's questions using the retrieved context provided by the "
    "retrieval-augmented generation pipeline. "
    "You answer questions related to museums, artworks, rooms, artists, history and art interpretation. "
    "Never invent facts. If the information is not present in the retrieved context, "
    "say that you do not know or that the answer cannot be determined from the provided data. "
    "Format answers for a chat bubble using plain text, not Markdown. "
    "Use short paragraphs and real line breaks. "
    "Keep each paragraph to 1 or 2 sentences. "
    "For a single artwork, answer in 2 or 3 short paragraphs: what it is, why it matters, and one concrete detail. "
    "For lists, use numbered items like '1. Title - explanation'. "
    "Do not use bold markers, tables, headings, or decorative language. "
    "Avoid long monologues and do not end with generic follow-up questions. "
    "If the graph returns many rows, summarize the most relevant 3 to 5 items unless the user asks for all of them. "
    "Do not mention missing fields, null values, NaN values, or unavailable details for individual items. "
)

_EXAMPLE_A = (
    "EXAMPLE A - factual single-artwork answer (when graph returns data):\n"
    "Question: Who painted this work and when was it made?\n"
    "Context: A row with title 'Portrait of a Man', artist 'Piero della Francesca', dating 'c. 1460-1465'\n"
    "Answer: This painting is a portrait by Piero della Francesca. It was made around 1460 to 1465. Piero della Francesca was an Italian painter known for his precise geometric style and use of light.\n\n"
)

_EXAMPLE_B = (
    "EXAMPLE B - no-information answer (when graph returns no relevant rows):\n"
    "Question: What international exhibitions has this painting travelled to?\n"
    "Context: Empty rows or rows without exhibition history\n"
    "Answer: I do not have information about international exhibitions for this painting. The available data does not include exhibition history.\n\n"
)

_LANGUAGE_TAIL = (
    "Do not answer in any other language unless the user explicitly asks you to "
    "change language (only english, spanish or catalan) in the current message."
)

_EASY = (
    "\n\nEASY-READ ACCESSIBILITY MODE: The user selected Texto facil / Easy Read. "
    "Prioritize cognitive accessibility. Use common words and explain any necessary difficult word immediately. "
    "Use short direct sentences, active voice, and one idea per sentence. "
    "Keep paragraphs very short. Prefer 2 to 4 concise paragraphs. "
    "Avoid idioms, abstract metaphors, jargon, subordinate-heavy sentences, and decorative language. "
    "Choose easy words from the first draft. Do not rely on later replacement. "
    "Before using any noun, adjective, or verb that may be specialized, ask if a common word or short explanation can say the same thing. "
    "Prefer short explanations over rare synonyms. "
    "Do not use specialist terms such as architectural, technical, historical, or artistic jargon unless the exact term is essential. "
    "If a difficult term is essential, write a simple explanation instead of using only the term. "
    "For example, do not write specialist architectural terms by themselves; explain the shape or idea with common words. "
    "If a list helps, use a short numbered list with no more than 5 items. "
    "Do not patronize the user and do not remove essential meaning. "
    "For Spanish, aim for Lectura Facil around CEFR A1-A2 when the facts allow it. "
    "AI-generated Easy Read still needs human validation for formal publication."
)

_VISUAL_TAIL = (
    "For a single artwork, prefer 3 to 5 short paragraphs: label facts, overall image, spatial description, and context. "
    "For a room or multiple artworks, briefly describe each item's visible/material characteristics only where context supports them."
)

_PACING = (
    "\n\nPACING REQUEST: Give the answer in a slower rhythm for audio. "
    "Use clear sentence boundaries and avoid dense clauses."
)

_DETAIL = (
    "\n\nDETAIL REQUEST: The user explicitly asked for substantial information. "
    "Use the retrieved rows fully and give a richer answer than usual: 4 to 6 short paragraphs when the data supports it. "
    "Do not stop after only a brief identification if biography or contextual fields are present."
)

_RAG_INSTRUCTIONS = (
    "\n\nRETRIEVED NEO4J CONTEXT:\n"
    "Use these graph database results as factual context for the answer. "
    "If the rows do not answer the user's question, say that the graph does not contain enough information. "
    "Do not mechanically list every returned field. Prefer title, artist, dating, technique, and one concise interpretive detail when available. "
    "If a row only has a title, include the title without apologizing for missing metadata. "
    "For navigation rows, use the 'directions' field as the route instruction. "
    "If a navigation row has source and destination locations but no directions field, say the graph identifies the rooms but does not contain a route instruction. "
    "For artwork_location rows, state the floor and room clearly."
)

_GROUNDING = (
    "\n\nINTERNAL GROUNDING CHECK: "
    "Before writing your answer, silently verify each factual claim against the retrieved rows above. "
    "If a claim cannot be grounded in the provided context, omit it rather than inventing information."
)


def _fewshot_block(few_shot: bool, example_order: str = "AB") -> str:
    """The few-shot segment. Empty when ``few_shot`` is False; otherwise the two
    EXAMPLE blocks in the requested order (default A then B = the shipped order)."""
    if not few_shot:
        return ""
    if example_order == "BA":
        return _EXAMPLE_B + _EXAMPLE_A
    return _EXAMPLE_A + _EXAMPLE_B


def _segments(
    *,
    language: str,
    age_range: str,
    personality: str,
    few_shot: bool,
    rag_position: str,
    graph_context: Optional[dict[str, Any]],
    simple_language: bool,
    visual_descriptions: bool,
    more_time: bool,
    room: Optional[str],
    artwork: Optional[str],
    example_order: str,
) -> list[str]:
    """Build the ordered list of prompt segments. ``rag_position`` controls only
    WHERE the RAG segment sits; the segment SET is identical either way, which is
    what makes ``rag_position='before'`` a provable permutation of the baseline."""
    llm = _backend()
    language_rule = llm.get_language_rule(language)
    persona_rule = llm.get_persona_rule(personality)
    detail_requested = llm.user_requested_detail(
        graph_context.get("message", "") if graph_context else ""
    )

    seg_intro = _INTRO + "\n\n"
    seg_fewshot = _fewshot_block(few_shot, example_order)
    seg_rules = (
        f"LANGUAGE RULE: {language_rule} "
        + _LANGUAGE_TAIL
        + "\n\n"
        + f"VISITOR PROFILE: The user can be described as {age_range}. "
        + f"GUIDE STYLE: {persona_rule}."
    )

    conditionals = ""
    if simple_language:
        conditionals += _EASY
    if visual_descriptions:
        conditionals += (
            "\n\nVISUAL DESCRIPTION ACCESSIBILITY MODE: "
            f"{llm.VISUAL_DESCRIPTION_GUIDELINES} "
            + _VISUAL_TAIL
        )
    if more_time:
        conditionals += _PACING
    if detail_requested:
        conditionals += _DETAIL
    if room or artwork:
        conditionals += "\n\nCURRENT MUSEUM CONTEXT:"
        if room:
            conditionals += f"\n- Room: {room}"
        if artwork:
            conditionals += f"\n- Artwork being viewed: {artwork}"

    seg_rag = ""
    if graph_context:
        cypher = graph_context.get("cypher")
        rows = graph_context.get("rows") or []
        seg_rag = _RAG_INSTRUCTIONS
        if cypher:
            seg_rag += f"\nGenerated Cypher: {cypher}"
        seg_rag += "\nRows:\n"
        seg_rag += json.dumps(rows, ensure_ascii=False, indent=2)
        seg_rag += _GROUNDING

    if rag_position == "before":
        return [seg_intro, seg_fewshot, seg_rag, seg_rules, conditionals]
    return [seg_intro, seg_fewshot, seg_rules, conditionals, seg_rag]


def build_prompt(
    *,
    language: str = "en",
    age_range: str = config.PROMPT_DEFAULT_AGE,
    personality: str = "explorer",
    few_shot: bool = True,
    rag_position: str = "after",
    graph_context: Optional[dict[str, Any]] = None,
    simple_language: bool = False,
    visual_descriptions: bool = False,
    more_time: bool = False,
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    example_order: str = "AB",
) -> str:
    """Assemble a system prompt for the given axis settings.

    With ``few_shot=True, rag_position='after'`` and all conditional flags at
    their defaults this reproduces ``_LLM.build_system_prompt(...)`` byte-for-byte
    (asserted by ``--selftest``)."""
    if rag_position not in config.PROMPT_RAG_POSITIONS:
        raise ValueError(f"rag_position must be one of {config.PROMPT_RAG_POSITIONS}, got {rag_position!r}")
    return "".join(_segments(
        language=language, age_range=age_range, personality=personality,
        few_shot=few_shot, rag_position=rag_position, graph_context=graph_context,
        simple_language=simple_language, visual_descriptions=visual_descriptions,
        more_time=more_time, room=room, artwork=artwork, example_order=example_order,
    ))


# --- Variant registry -------------------------------------------------------
@dataclass(frozen=True)
class Variant:
    """A named set of overrides on top of BASELINE_PARAMS."""
    name: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Axis:
    """One experimental condition: a baseline vs a single treatment variant.

    ``kind`` drives interpretation of the sensitivity ratio:
    * ``"robustness"`` — a fact-neutral change; we WANT ratio ~= 1 (output moves
      no more than resampling noise). A high ratio means the prompt is fragile.
    * ``"semantic"`` — a personalization change; we WANT ratio >> 1 (the change
      is real, not cosmetic). A low ratio means personalization is superficial.
    """
    key: str
    kind: str  # "robustness" | "semantic"
    treatment: Variant
    enabled_by_default: bool
    doc: str


# The control prompt shared across every axis (so we generate it once per item).
# Matches build_system_prompt's defaults so the baseline reproduces the shipped
# prompt exactly.
BASELINE_PARAMS: dict[str, Any] = {
    "personality": config.PROMPT_PERSONAS[0],   # "explorer"
    "age_range": config.PROMPT_DEFAULT_AGE,
    "few_shot": True,
    "rag_position": "after",
    "example_order": "AB",
}
BASELINE_NAME = "baseline"

AXES: list[Axis] = [
    Axis("fewshot", "robustness",
         Variant("fewshot_off", {"few_shot": False}), True,
         "Remove the two EXAMPLE A/B few-shot blocks (robustness: facts should not move)."),
    Axis("persona", "semantic",
         Variant("persona_scholar", {"personality": "scholar"}), True,
         "explorer -> scholar GUIDE STYLE (semantic: personalization SHOULD diverge)."),
    Axis("rag_position", "robustness",
         Variant("rag_before", {"rag_position": "before"}), True,
         "Move the RETRIEVED NEO4J CONTEXT block before the rules (robustness: facts should not move)."),
    # --- registered, OFF by default; enable with --axes ---
    Axis("age", "semantic",
         Variant("age_child", {"age_range": "Young 10-18 years old"}), False,
         "Adult -> young visitor profile (semantic: personalization SHOULD diverge)."),
    Axis("example_order", "robustness",
         Variant("examples_swapped", {"example_order": "BA"}), False,
         "Swap the order of the two few-shot examples (robustness: facts should not move)."),
]

_AXIS_BY_KEY = {a.key: a for a in AXES}


def default_axis_keys() -> list[str]:
    return [a.key for a in AXES if a.enabled_by_default]


def resolve_axes(subset: Optional[list[str]] = None) -> list[Axis]:
    """Return the Axis objects to run. ``None`` -> the default-enabled set.

    Raises ValueError on an unknown key so the driver can exit cleanly."""
    if subset is None:
        keys = default_axis_keys()
    else:
        unknown = [k for k in subset if k not in _AXIS_BY_KEY]
        if unknown:
            raise ValueError(f"unknown axis key(s): {unknown}. known: {list(_AXIS_BY_KEY)}")
        keys = subset
    return [_AXIS_BY_KEY[k] for k in keys]


def variants_for(axes: list[Axis]) -> list[tuple[str, dict[str, Any]]]:
    """The distinct variants to GENERATE for a run: the shared baseline plus one
    treatment per axis. Returns ``[(variant_name, full_params), ...]`` where
    full_params merges BASELINE_PARAMS with the treatment overrides."""
    out: list[tuple[str, dict[str, Any]]] = [(BASELINE_NAME, dict(BASELINE_PARAMS))]
    for ax in axes:
        out.append((ax.treatment.name, {**BASELINE_PARAMS, **ax.treatment.params}))
    return out


# --- Parity / permutation self-test -----------------------------------------
def _selftest() -> int:
    """Assert the baseline variant matches the live backend prompt byte-for-byte,
    and that the treatments are well-formed differences. Returns exit code."""
    cases: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        cases.append((name, bool(ok), detail or name))

    sample_rows = [{"a.title": "Anunciació", "a.artist": "Perot Gascó", "a.dating": "c. 1550"}]
    contexts = [
        ("no-rows", None),
        ("with-rows", {"message": "Who created this?", "cypher": "MATCH (a) RETURN a LIMIT 1", "rows": sample_rows}),
    ]

    llm = _backend()
    for lang in config.LANGUAGES:
        for persona in config.PROMPT_PERSONAS:
            for ctx_name, gc in contexts:
                gold = llm.build_system_prompt(
                    lang, config.PROMPT_DEFAULT_AGE, persona, None, None, gc, False, False, False,
                )
                baseline = build_prompt(
                    language=lang, age_range=config.PROMPT_DEFAULT_AGE, personality=persona,
                    few_shot=True, rag_position="after", graph_context=gc,
                    simple_language=False, visual_descriptions=False, more_time=False,
                    room=None, artwork=None, example_order="AB",
                )
                ok = baseline == gold
                detail = f"baseline==gold [{lang}/{persona}/{ctx_name}]"
                if not ok:
                    # Surface the first divergence index to make a drift obvious.
                    i = next((k for k in range(min(len(baseline), len(gold))) if baseline[k] != gold[k]),
                             min(len(baseline), len(gold)))
                    detail += (f" DIFFER at {i}: "
                               f"base...{baseline[max(0,i-20):i+20]!r} vs gold...{gold[max(0,i-20):i+20]!r}"
                               f" (len base={len(baseline)} gold={len(gold)})")
                check(detail, ok, detail)

    # few_shot=False differs from baseline by exactly the few-shot block.
    gc = {"message": "Who?", "cypher": "MATCH (a) RETURN a", "rows": sample_rows}
    base = build_prompt(language="en", graph_context=gc, **BASELINE_PARAMS)
    nofs = build_prompt(language="en", graph_context=gc, personality="explorer",
                        age_range=config.PROMPT_DEFAULT_AGE, few_shot=False,
                        rag_position="after", example_order="AB")
    fewshot_text = _EXAMPLE_A + _EXAMPLE_B
    check("fewshot_off removes exactly the few-shot block",
          nofs != base and base.replace(fewshot_text, "", 1) == nofs,
          f"base.replace(fewshot)==nofs? {base.replace(fewshot_text, '', 1) == nofs}")

    # rag_position='before' is a permutation: same segment SET, different order.
    after_segs = _segments(language="en", age_range=config.PROMPT_DEFAULT_AGE, personality="explorer",
                           few_shot=True, rag_position="after", graph_context=gc,
                           simple_language=False, visual_descriptions=False, more_time=False,
                           room=None, artwork=None, example_order="AB")
    before_segs = _segments(language="en", age_range=config.PROMPT_DEFAULT_AGE, personality="explorer",
                            few_shot=True, rag_position="before", graph_context=gc,
                            simple_language=False, visual_descriptions=False, more_time=False,
                            room=None, artwork=None, example_order="AB")
    check("rag_before is a segment permutation", sorted(after_segs) == sorted(before_segs),
          "segment multiset preserved")
    check("rag_before actually reorders", "".join(after_segs) != "".join(before_segs),
          "before != after as strings")

    # persona treatment changes the GUIDE STYLE text (semantic axis is live).
    p_explorer = build_prompt(language="en", graph_context=gc, personality="explorer",
                              age_range=config.PROMPT_DEFAULT_AGE, few_shot=True, rag_position="after")
    p_scholar = build_prompt(language="en", graph_context=gc, personality="scholar",
                             age_range=config.PROMPT_DEFAULT_AGE, few_shot=True, rag_position="after")
    check("persona changes prompt", p_explorer != p_scholar, "explorer != scholar prompt")

    # registry sanity
    check("default axes are the 3 expected",
          default_axis_keys() == ["fewshot", "persona", "rag_position"],
          f"default_axis_keys()={default_axis_keys()}")
    check("variants_for(defaults) yields baseline + 3 treatments",
          len(variants_for(resolve_axes())) == 4,
          f"n_variants={len(variants_for(resolve_axes()))}")

    passed = sum(1 for _, ok, _ in cases if ok)
    print("=" * 64)
    print(f"prompt_variants self-test: {passed}/{len(cases)} passed")
    print("=" * 64)
    for name, ok, detail in cases:
        print(f"  [{'PASS' if ok else 'FAIL'}] {detail if not ok else name}")
    if passed != len(cases):
        print("\nA FAIL on baseline==gold means the backend prompt drifted from the\n"
              "copies in this file. Re-sync the literals against LLM_Call.build_system_prompt.")
    return 0 if passed == len(cases) else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 4 prompt-variant builder (parity self-test).")
    parser.add_argument("--selftest", action="store_true",
                        help="assert baseline == backend build_system_prompt (needs COHERE_LLM_KEY to import backend)")
    parser.add_argument("--show", metavar="VARIANT",
                        help="print a variant prompt (e.g. baseline, fewshot_off, rag_before) and exit")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    if args.show:
        all_variants = dict(variants_for(resolve_axes(list(_AXIS_BY_KEY))))
        if args.show not in all_variants:
            print(f"unknown variant {args.show!r}; known: {list(all_variants)}")
            return 2
        gc = {"message": "Who made this?", "cypher": "MATCH (a) RETURN a", "rows": [{"a.title": "Anunciació"}]}
        print(build_prompt(language="en", graph_context=gc, **all_variants[args.show]))
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
