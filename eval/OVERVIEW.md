# GuIA Evaluation — Developer Overview

A one-page map of the `eval/` harness: what it measures, what each script does,
how to run it, and how another developer reproduces a run from scratch. For the
conceptual walkthroughs see [HOW_PART1_WORKS.md](HOW_PART1_WORKS.md),
[HOW_PART2_WORKS.md](HOW_PART2_WORKS.md), [HOW_PART3_WORKS.md](HOW_PART3_WORKS.md)
and [HOW_PART4_WORKS.md](HOW_PART4_WORKS.md); for the original design see
[EVALUATION_PLAN.md](EVALUATION_PLAN.md).

---

## What this is

GuIA (Flask + Cohere `command-a-03-2025` + Neo4j knowledge-graph RAG) shipped
with **zero automated quality measurement**. `eval/` is an **additive, package**
(`python -m eval.*`) that quantifies how well its subsystems work, one part at a
time. It is designed to be **read-mostly against the app** — it imports the real
backend (`LLM/LLM_Call.py`) and calls its functions directly, no HTTP server.

| Part | Question it answers | Pipeline | Status |
|------|--------------------|----------|--------|
| **1 — Faithfulness** | Does the guide invent facts beyond its retrieved rows? | retrieve → answer → **judge** | built + run |
| **2 — Retrieval recall** | Did retrieval fetch the *right* fact at all? | retrieve → **match** known answer | built + run |
| **3 — Cultural bias** | Does the guide flatten a work's cultural origins toward a dominant (eurocentric) narrative? | (retrieve →) answer → **classify** → KL-score vs curated `Q(c)` | built |
| **4 — Prompt sensitivity** | Personalization is prompting — how much does the answer move when we change the prompt (few-shot, RAG position, persona)? Signal or noise? | freeze retrieval → vary prompt → answer ×R → **surface divergence** → ratio vs noise floor | built |

Parts 1 and 2 are complementary: Part 1 can score an answer **faithful** even when
retrieval fetched the *wrong* row (the guide honestly repeated it). Part 2 is the
check on whether the right row was fetched. Read together they separate a
*retrieval* problem from a *hallucination* problem. Part 3 is orthogonal to both:
an answer can be perfectly faithful to correctly-retrieved rows and still present
a culturally lopsided story — Part 3 measures that lopsidedness via a Cultural
Bias Score (`CBS = D_KL(Q‖P)`) against a hand-curated reference distribution.
Part 4 is orthogonal again: it doesn't grade an answer's content at all — it
treats the **prompt** as the variable and measures how much the answer *moves*
when a prompt knob changes, relative to the answer's own run-to-run noise, to
separate real personalization (persona — output *should* diverge) from fragility
(few-shot / RAG-block position — output should *not* change the facts).

---

## Scripts at a glance

Each is run as a module from the repo root: `python -m eval.<name>`.

| Script | Role | Needs API? |
|--------|------|:---:|
| `_bootstrap.py` | Env validation + `sys.path` shim so `import LLM_Call` resolves; injects `truststore` for the corporate TLS proxy. Imported first by everything. | — |
| `config.py` | All tunables: languages, judge model, sample sizes, seed, sleep, retries, `RETRIEVAL_RUNS`. **Start here to change behaviour.** | — |
| `groundtruth.py` | Builds the deterministic known-answer question set from the Excel inventory. Network-free. `--dump` to inspect. | no |
| `question_bank.py` | Hand-written **out-of-graph** + **near-miss** adversarial probes (Part 1), in en/es/ca. | no |
| `normalization.py` | **Part 2 recall matcher**: row-values → haystack, with the location (palau/sala split) and dating (year) special cases. `--selftest` runs 18 network-free cases. | no |
| `judge.py` | **Part 1 judge**: prompt + minimal JSON contract `{faithfulness, answered, verdict}` + tolerant parser with bounded retry. | — |
| `cbs.py` | **Part 3 scoring heart**: pure CBS/KL/JSD math (`--selftest`) + the title-blind narrative **classifier** (distribution over `CBS_LABELS` + coverage + critical-lens flag). | math no / classify yes |
| `cultural_groundtruth.py` | **Part 3 curated `Q(c)`**: load + `--validate` + `--dump` + `--template` (LLM-draft rows). Joins titles to the inventory via `normalization.norm`. | validate no / template yes |
| `data/cultural_groundtruth.json` | The **hand-curated** expected cultural distributions (committed, versioned — the Part 3 contract). | — |
| `divergence.py` | **Part 4 scoring heart**: pure surface-divergence math — token Jaccard / cosine / length / readability (`--selftest`). | no |
| `prompt_variants.py` | **Part 4 prompt builder + axis registry**: parametrized mirror of `build_system_prompt`; `--selftest` asserts the baseline is byte-identical to the backend prompt. | selftest yes |
| `llm_bridge.py` | The **only** file that talks to Cohere/Neo4j: thin wrappers `retrieve` / `answer` / `answer_with_prompt` / `judge_raw` / `classify_raw` + global 429 backoff over every Cohere call. | yes |
| `part1_faithfulness.py` | Part 1 driver: assemble → run pipeline across languages → aggregate → write reports. | yes |
| `part2_retrieval.py` | Part 2 driver: same shape, retrieve→match, with `--runs N` stability mode. | yes |
| `part3_cultural_bias.py` | Part 3 driver: sample artworks (balanced by origin/theme) → (retrieve→)answer→classify→KL-score → aggregate (by language/origin/theme) → write reports. `--context none` ablation. | yes |
| `part4_prompt_sensitivity.py` | Part 4 driver: sample grounded benchmark → freeze retrieval → vary prompt (per axis) → answer ×R → surface-divergence → ratio (mean±std, by axis × language) → write reports. | yes |
| `test_judge_contract.py` | 3-fixture sanity check that the judge returns 1/2/3 on obvious cases. | yes (no Neo4j) |

Outputs land in `eval/results/` (gitignored) as a timestamped trio per run:
`partN_<ts>.json` (full records), `.csv` (per-item triage, `utf-8-sig`),
`.summary.txt` (human-readable metrics + worst offenders).

---

## How to run

All commands from the repo root (`GuIA/`). **Cheapest/free first**, then API spend.

```bash
# ---- free, no API key, no network ----
python -m eval.groundtruth --dump                   # inspect the known-answer set
python -m eval.normalization --selftest             # prove the Part 2 matcher logic
python -m eval.cbs --selftest                       # prove the Part 3 CBS/KL/JSD math
python -m eval.cultural_groundtruth --validate      # check the Part 3 curated Q(c) table
python -m eval.divergence --selftest                # prove the Part 4 surface-divergence math
python -m eval.part1_faithfulness --dry-run --smoke # preview Part 1 questions
python -m eval.part2_retrieval  --dry-run --smoke   # preview Part 2 questions
python -m eval.part3_cultural_bias --dry-run --smoke # preview Part 3 questions + Q(c)
python -m eval.part4_prompt_sensitivity --dry-run --smoke # preview Part 4 benchmark + variants + budget

# ---- needs COHERE_LLM_KEY (+ Neo4j for retrieval) ----
python -m eval.test_judge_contract                 # 3 judge calls, sanity check
python -m eval.prompt_variants --selftest          # Part 4 parity: baseline == backend prompt
python -m eval.part1_faithfulness --smoke          # ~6 specs x 3 langs, wiring check
python -m eval.part2_retrieval  --smoke            # ~10 specs x 3 langs, wiring check
python -m eval.part3_cultural_bias --smoke         # ~5 artworks x 3 langs, wiring check
python -m eval.part4_prompt_sensitivity --smoke    # ~2 items x 3 langs x 4 variants x 3 runs

# ---- full runs ----
python -m eval.part1_faithfulness                  # 30 specs x 3 langs = 90 items
python -m eval.part2_retrieval                     # 60 specs x 3 langs = 180 items
python -m eval.part3_cultural_bias                 # ~20 artworks x 3 langs = 60 items
python -m eval.part4_prompt_sensitivity            # 12 items x 3 langs x 4 variants x 3 runs = 468 calls
```

Useful flags: `--lang en` / `--lang es,ca` (subset); Part 1 `--n`, Part 2
`--per-category` / `--multi`, Part 3 `--per-origin`, Part 4 `--n` (sample sizes);
`--seed` (reshuffle); Part 2 `--runs 3` (re-run each question 3× → report
hit-stability); Part 3 `--context none` (pure-LLM bias ablation, skips retrieval);
Part 4 `--runs N` (repeats per variant = the noise floor; ≥3 needed for a ratio)
and `--axes fewshot,persona` (subset the prompt conditions).

---

## Reproducibility (for another developer)

**1. Dependencies.** All in `requirements.txt` *except one*:

```bash
pip install -r requirements.txt        # cohere, neo4j, python-dotenv, ...
pip install truststore                 # NOT in requirements; needed behind a
                                        # TLS-intercepting corporate proxy (see below)
```

The harness adds **no other third-party deps** — everything else is stdlib.

**2. Environment.** Read from the process env or `LLM/.env` (never printed):

| Var | Required? | Notes |
|-----|:---:|-------|
| `COHERE_LLM_KEY` | **yes** (any live run) | the backend builds `cohere.Client` at import |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` | **yes for Part 2** | without them every retrieval is a `retrieval_error` and recall reads 0 |
| `NEO4J_QUERY_API_URL` / `NEO4J_DATABASE` | optional | override the derived Query-API URL / db name |

`_bootstrap.preflight()` validates these and exits cleanly with a friendly
message if `COHERE_LLM_KEY` is missing; Neo4j is a **warning, not fatal** (the run
completes and `retrieval_error_rate` makes the misconfig explicit).

**3. Corporate TLS proxy.** If outbound HTTPS fails with
`CERTIFICATE_VERIFY_FAILED`, the machine is behind a TLS-intercepting proxy.
`_bootstrap` calls `truststore.inject_into_ssl()` before importing the backend so
Python trusts the OS certificate store. Install `truststore` (above) or expect
SSL failures.

**4. What's deterministic — and what isn't.** Be honest about this:

- ✅ **Question sets** are reproducible: fixed `RANDOM_SEED` (1234) → same sample.
  Same `--seed` + same sizes → identical questions every run.
- ✅ **The judge call** (Part 1) and **the classifier call** (Part 3) pin
  `temperature=0` + a fixed `seed`.
- ❌ **Retrieval and answer generation are NOT bit-deterministic.** Both run a
  Cohere model internally with no exposed temperature, so the generated Cypher
  (and the answer) vary run to run. All four parts are therefore **statistical
  metrics over N questions, not per-question assertions.** A single miss may be
  the LLM mistyping a title literal, not a real recall gap — re-run or use Part 2
  `--runs 3` to separate flaky from systematic. Part 3 additionally compares
  against a hand-curated `Q(c)`, so its CBS is only as defensible as that table
  (rows carry a `confidence`; CBS is reported per-confidence).
- ⚙️ **Part 4 deliberately exploits that nondeterminism.** It does NOT pin the
  answer temperature, because the run-to-run answer variance IS the noise floor it
  measures the prompt effect against (`--runs N`, ≥3). It freezes retrieval (one
  retrieve per item, reused) so the prompt is the only thing that changes, and its
  baseline prompt is asserted byte-identical to the backend's via
  `python -m eval.prompt_variants --selftest` — re-run that after any prompt edit.

**5. Rate limits.** Trial Cohere keys cap at ~20 calls/min. `config.REQUEST_SLEEP_S`
spaces items (Part 1 ≈ 3 calls/item → use ~15s; Part 2 ≈ 1 call/item → ~5s is
fine; Part 3 ≈ 3 calls/item → ~15s; Part 4 ≈ `1 + V·R` calls/item → it sleeps
between every answer call, ~468 calls / ~2 h for a default run), and `llm_bridge`
installs exponential 429 backoff over *all* Cohere calls. Per-item errors are
recorded; the run never aborts.

---



**Cultural bias deviation is now built as Part 3** (above): it scores whether the
guide's presentation of an artwork's cultural origins deviates from the work's
real, multi-cultural heritage (`CBS = D_KL(Q‖P)` against a hand-curated reference
distribution), broken down by language. It is implemented and self-tested; the
remaining step is a full live run by the user (and, optionally, expanding the
curated `Q(c)` table beyond its current 33 artworks).

**Prompt sensitivity is now built as Part 4** (above), absorbing what was
originally sketched as "explanation style evaluation". Because GuIA personalizes
by *prompting*, Part 4 treats the prompt as the independent variable: it freezes
the retrieved rows, changes one prompt knob at a time (few-shot examples on/off,
RAG-block position, persona explorer→scholar), regenerates the answer `R` times,
and reports — per axis and per language, with **mean and variance** — how far the
answer moved relative to its own run-to-run noise (`sensitivity ratio = between /
within`). This unifies the personalization test (semantic axes — output *should*
diverge) with a prompt-robustness check (robustness axes — output should *not*
change the facts), per "The Prompt Report". It is implemented and self-tested
(including a byte-identity parity guard against the live backend prompt); the
remaining step is a full live run by the user. The **user evaluation** described
below remains the main pending step before stronger claims can be made.