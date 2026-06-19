# Part 4 — Prompt Sensitivity, explained

> **The one-sentence version:** GuIA personalizes by *prompting*, so we change one
> thing in the prompt at a time — drop the few-shot examples, move the RAG block,
> switch the persona — and measure how much the answer moves, relative to the
> answer's own run-to-run noise, to tell **real personalization from fragility**.

Part 1 asked "does the guide invent facts?" Part 2 asked "did it fetch the right
fact?" Part 3 asked "is the answer culturally balanced?" Part 4 asks a question
about the *mechanism* itself: GuIA's persona, age band, few-shot examples and the
order of its prompt blocks are all **prompt choices**, and the literature — *"The
Prompt Report: A Systematic Survey of Prompting Techniques"* — warns that LLM
output can swing with wording, few-shot example order, and the **position of the
context block** (RAG before vs after the rules). So: *which* prompt changes move
the answer, and is that movement **signal or noise**?

---

## The core idea (a sensitivity ratio)

We hold a **fixed benchmark** of questions and **freeze the retrieved rows**, then
vary exactly one part of the prompt and regenerate the answer several times:

```
                    ┌──────────────┐
  fixed question →  │  BASELINE    │ → answer ×R ─┐
  + frozen rows     │  prompt      │              │   surface
                    └──────────────┘              ├─ divergence ─► sensitivity
                    ┌──────────────┐              │   (Jaccard)     ratio =
                    │  TREATMENT   │ → answer ×R ─┘                 between
                    │  (one change)│                                ───────
                    └──────────────┘                                within
```

Two **kinds** of change, the **same** metric, **opposite** readings:

| axis kind | example axes | the change is… | we WANT |
|-----------|--------------|----------------|---------|
| **robustness** | `fewshot` (examples on/off), `rag_position` (RAG before/after rules) | fact-neutral — should not move the answer | ratio **≈ 1** |
| **semantic** | `persona` (explorer→scholar), `age` | personalization — *should* move the answer | ratio **≫ 1** |

A robustness axis with a high ratio means the prompt is **fragile** (a cosmetic
change moved the output). A semantic axis with a ratio near 1 means
personalization is **cosmetic** (the persona label changed but the answer didn't).

---

## Why a *ratio*, and what "mean and variance" buys us

The headline feedback this part answers: *report mean and variance, not a single
run.* A single answer tells you nothing — LLM answers vary every time you ask,
even with an identical prompt. That natural variation is the **noise floor**, and
it is the whole point:

- **within-variant divergence** (the noise) = how much a variant's `R` repeats
  differ from *each other* (same prompt, resampled). Mean ± std over the
  `R·(R−1)/2` within pairs.
- **between-variant divergence** (the signal) = how much the treatment differs
  from the baseline. Mean ± std over the `R×R` cross pairs.
- **sensitivity ratio = between / within_pooled** — the effect size *in units of
  noise*. A ratio of 1 means "this prompt change moved the answer no more than
  asking the same prompt twice would." A ratio of 4 means the change moved it 4×
  beyond noise.

Reporting `between` alone would be unreadable: is a Jaccard of 0.3 big? Only the
ratio tells you, because it is measured against the model's own jitter. This is
why **`--runs ≥ 3`** is required — with `--runs 1` there are no within-pairs, the
noise floor is undefined, and the driver warns and reports only raw `between`.

> **Pairing choice.** `between` is averaged over the **full R×R cross product** of
> treatment×baseline runs, not a 1:1 run pairing. Run indices are arbitrary (no
> shared seed, temperature unpinned), so the cross product is the unbiased
> estimator of E[divergence(treatment, baseline)]. `within_pooled` averages the
> baseline's and the treatment's own within-noise so a noisier treatment can't
> inflate the ratio by shrinking the denominator.

---

## Freeze the retrieval (remove the confound)

GuIA's retrieval is itself nondeterministic — an LLM writes the Cypher (Part 2
exists because of this). If we re-retrieved per variant, a changed answer could be
the *rows* changing, not the *prompt*. So Part 4 **retrieves once per (question,
language) and reuses those exact rows** for every variant and every repeat. After
that, the **only** thing that varies downstream is the prompt — which is the whole
experiment.

A consequence: the `rag_position` axis only makes sense when there *are* rows.
Moving an empty or absent RAG block changes nothing, so for any item whose frozen
retrieval returned empty/error, `rag_position` is **excluded** for that item (the
`fewshot` and `persona` axes still run — they test the non-RAG prompt). The
benchmark is deliberately drawn from **grounded single-valued** questions
(`groundtruth.single_valued`) precisely so retrieval reliably returns rows.

---

## Surface metrics, not a judge (on purpose)

Part 4 asks *"did the output move, and by how much vs noise?"* — a **stability**
question, not a *quality* one. So divergence is measured with deterministic,
network-free **surface metrics** (`divergence.py`), not an LLM judge:

- **token Jaccard distance** — primary scalar (`1 − |A∩B|/|A∪B|` over token sets).
- **cosine distance** — secondary, over token-*count* vectors, so it catches
  repetition/emphasis the set-based Jaccard discards.
- **length ratio** and a **readability proxy** (`awps` = avg words/sentence,
  `acpw` = avg chars/word) — describe *how* the shape changed; they corroborate
  semantic axes (a `scholar` persona should read denser than `explorer`).

Tokenization lowercases and folds accents (the same convention as
`normalization.py`), so en/es/ca answers compare on equal footing.

> **The honest caveat:** surface divergence is **not** semantic equivalence. A
> faithful paraphrase ("It was painted around 1550" vs "Its date is circa 1550")
> scores as divergent. Part 4 measures surface *stability/variation*, not
> correctness — which is exactly the right tool for a robustness question, but it
> means the "most-divergent offenders" list carries answer snippets so a human can
> eyeball whether a divergence was cosmetic or real.

---

## Don't pin the temperature (it's the measuring stick)

Part 1's judge and Part 3's classifier pin `temperature=0` because they are
reproducible *graders*. Part 4's answer call does the **opposite**: it pins
nothing, because the model's natural sampling variance **is** the noise floor we
divide by. Pinning temp=0 would collapse `within` toward 0 and make the ratio
explode or go undefined. The answer call (`llm_bridge.answer_with_prompt`) also
omits the `conversation_id` so that one variant's answer can never leak into the
next via Cohere's multi-turn memory — each generation is independent.

---

## The axes, and how to add more

Axes live in a small registry in `prompt_variants.py` (`AXES`). Each axis is a
*baseline vs one treatment* comparison; the baseline is **shared** across all
axes, so a default run generates `1 + (#axes)` distinct prompts, not `2×#axes`.

| key | kind | treatment | default |
|-----|------|-----------|:---:|
| `fewshot` | robustness | remove the two EXAMPLE A/B blocks | ON |
| `persona` | semantic | `explorer` → `scholar` GUIDE STYLE | ON |
| `rag_position` | robustness | RAG block **before** the rules instead of after | ON |
| `age` | semantic | adult → young visitor profile | off |
| `example_order` | robustness | swap the order of the two few-shot examples | off |

Adding an axis is a one-line `Axis(...)` entry; enable it with `--axes`. (The
`fewshot` and `rag_position` treatments are exactly the prompt changes a developer
makes when iterating — Part 4 turns "did my prompt edit help or just churn the
output?" into a number.)

---

## The parity guard (the most important safety net)

`prompt_variants.py` reproduces the backend's prompt blocks (intro, the two
few-shot examples, the RAG instructions, the grounding check) as **verbatim
copies** — it has to, because `build_system_prompt` assembles one big string. That
invites silent drift the moment someone edits the backend prompt. So
`--selftest` asserts the **baseline variant is byte-identical** to
`LLM_Call.build_system_prompt(...)` across {en,es,ca} × {explorer,scholar} ×
{with rows, no rows}, and that the treatments are well-formed differences
(`fewshot_off` removes *exactly* the few-shot block; `rag_before` is a *permutation*
of the same blocks). Run it after any backend prompt edit:

```bash
python -m eval.prompt_variants --selftest    # needs COHERE_LLM_KEY (imports backend)
```

A FAIL here means the copies drifted from the backend — re-sync the literals
before trusting any Part 4 number.

---

## What each file does

| file | role |
|------|------|
| `divergence.py` | **The scoring heart.** Pure surface-divergence math — Jaccard / cosine / length / readability (network-free, `--selftest`). |
| `prompt_variants.py` | The parametrized prompt builder mirroring `build_system_prompt`, the axis **registry**, and the byte-identity parity `--selftest`. |
| `part4_prompt_sensitivity.py` | The conductor: sample the benchmark → freeze retrieval → generate every variant ×R → compute within/between/ratio → aggregate (per axis × per language) → write reports. |
| `llm_bridge.py` | Adds `answer_with_prompt(system_prompt, message)` — the one stateless, un-pinned answer call Part 4 needs. |
| `config.py` | The knobs: `PART4_N`, `PROMPT_RUNS`, axis vocabulary, divergence tokenization, verdict thresholds. |

---

## Running it

From the repo root, cheapest-first (the first two cost **nothing**):

```bash
python -m eval.divergence --selftest                   # divergence math, no API/network
python -m eval.part4_prompt_sensitivity --dry-run --smoke   # preview benchmark + variants + call budget
python -m eval.prompt_variants --selftest              # parity check (needs key; imports backend)
python -m eval.part4_prompt_sensitivity --smoke         # tiny end-to-end (~78 calls), writes results/
python -m eval.part4_prompt_sensitivity                 # full run, all languages (~468 calls)
```

Handy flags: `--lang en` (one language, thirds the cost), `--axes fewshot` (one
axis, fewer variants), `--runs 5` (tighter noise estimate), `--n 6` / `--seed 42`.

**Cost** = `N×L × (1 + V×R)` Cohere calls (`V` = baseline + #axes). Default
(`N=12, L=3, V=4, R=3`) = **468 calls** ≈ 2 h at `REQUEST_SLEEP_S=15`; smoke
(`N=2`) = **78 calls** ≈ 20 min. The trial-key cap (~20/min) is well clear of the
~4/min the sleep enforces, and `llm_bridge` adds 429 backoff over every call.

---

## Reading the results

Each run drops three timestamped files in `eval/results/`. Start with
`.summary.txt`:

```
NOISE FLOOR — baseline within-variant divergence (R repeats, same prompt)
  baseline within Jaccard : 0.180 ± 0.060   (over 36 items)

HEADLINE — per axis (all languages pooled)
  fewshot        (robustness)  ratio=1.10 ± 0.30  between=0.198 ± 0.05  within=0.180  [robust]
  rag_position   (robustness)  ratio=2.80 ± 0.70  between=0.504 ± 0.10  within=0.180  [NOT ROBUST]
  persona        (semantic)    ratio=3.40 ± 0.90  between=0.612 ± 0.12  within=0.180  [differentiates]

PER AXIS x PER LANGUAGE  —  ratio (± std)
  axis                      en            es            ca
  fewshot              1.05±0.20     1.12±0.30     1.14±0.35
  rag_position         2.60±0.60     2.90±0.70     2.90±0.80
  persona              3.10±0.80     3.50±0.90     3.60±1.00
```

- **NOISE FLOOR** — the baseline's own jitter. Every ratio is measured against
  this; if it's ~0 the model is near-deterministic and ratios will look large.
- **per-axis ratio** — the headline. For **robustness** axes (`fewshot`,
  `rag_position`) a ratio near 1 = robust; above `PROMPT_ROBUST_RATIO_WARN` (2.0)
  it's flagged **NOT ROBUST** — a fact-neutral change moved the surface, worth
  investigating. For **semantic** axes (`persona`, `age`) a ratio ≫ 1 confirms
  personalization is real; below `PROMPT_SEMANTIC_RATIO_MIN` (1.5) it's flagged
  **may be COSMETIC**.
- **per axis × per language** — does a prompt change bite harder in one language?
  (e.g. few-shot examples authored in English may stabilize `en` more than `ca`.)
- **READABILITY DELTAS** — corroborate semantic axes: a real `persona` shift
  should show a non-trivial `acpw`/`awps` delta (scholar reads denser), not just
  reshuffled words.
- **MOST-DIVERGENT (item, language, axis)** — the top items by `between`, each with
  the baseline vs treatment answer snippet so you can judge whether the divergence
  was meaningful or cosmetic — the Part-4 analogue of Part 2 printing the Cypher
  next to a miss.

### Honest caveats

1. **Surface ≠ semantics.** A faithful paraphrase scores divergent. The ratio
   measures *stability/variation of the surface*, not correctness. Read the
   offenders before concluding a robustness axis is broken.
2. **The noise floor depends on a hidden temperature.** Cohere's default sampling
   isn't exposed; the ratio normalizes against it, but the *absolute* within-divergence
   would shift if those defaults changed. The run config records `temperature_pinned: false`.
3. **Small N + nondeterminism.** Ratios over ~12 items are estimates with real
   spread — that's why every ratio is reported with its ± std and a noise floor,
   not as a single number.
4. **Parity is only as fresh as the last selftest.** If the backend prompt was
   edited and `prompt_variants --selftest` wasn't re-run, the baseline may no longer
   match the shipped prompt. Run it first.

---

## In one breath

Part 4 freezes the retrieved rows, changes one part of the prompt at a time
(few-shot on/off, RAG-block position, persona), regenerates the answer several
times, and reports — per axis and per language, with mean **and** variance — how
far the answer moved *relative to its own run-to-run noise*, so we can tell prompt
**robustness** (fact-neutral changes that shouldn't move the answer, ratio ≈ 1)
from real **personalization** (persona changes that should, ratio ≫ 1).
