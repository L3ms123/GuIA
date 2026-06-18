# GuIA Evaluation — Developer Overview

A one-page map of the `eval/` harness: what it measures, what each script does,
how to run it, and how another developer reproduces a run from scratch. For the
conceptual walkthroughs see [HOW_PART1_WORKS.md](HOW_PART1_WORKS.md),
[HOW_PART2_WORKS.md](HOW_PART2_WORKS.md) and
[HOW_PART3_WORKS.md](HOW_PART3_WORKS.md); for the original design see
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

Parts 1 and 2 are complementary: Part 1 can score an answer **faithful** even when
retrieval fetched the *wrong* row (the guide honestly repeated it). Part 2 is the
check on whether the right row was fetched. Read together they separate a
*retrieval* problem from a *hallucination* problem. Part 3 is orthogonal to both:
an answer can be perfectly faithful to correctly-retrieved rows and still present
a culturally lopsided story — Part 3 measures that lopsidedness via a Cultural
Bias Score (`CBS = D_KL(Q‖P)`) against a hand-curated reference distribution.

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
| `llm_bridge.py` | The **only** file that talks to Cohere/Neo4j: thin wrappers `retrieve` / `answer` / `judge_raw` / `classify_raw` + global 429 backoff over every Cohere call. | yes |
| `part1_faithfulness.py` | Part 1 driver: assemble → run pipeline across languages → aggregate → write reports. | yes |
| `part2_retrieval.py` | Part 2 driver: same shape, retrieve→match, with `--runs N` stability mode. | yes |
| `part3_cultural_bias.py` | Part 3 driver: sample artworks (balanced by origin/theme) → (retrieve→)answer→classify→KL-score → aggregate (by language/origin/theme) → write reports. `--context none` ablation. | yes |
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
python -m eval.part1_faithfulness --dry-run --smoke # preview Part 1 questions
python -m eval.part2_retrieval  --dry-run --smoke   # preview Part 2 questions
python -m eval.part3_cultural_bias --dry-run --smoke # preview Part 3 questions + Q(c)

# ---- needs COHERE_LLM_KEY (+ Neo4j for retrieval) ----
python -m eval.test_judge_contract                 # 3 judge calls, sanity check
python -m eval.part1_faithfulness --smoke          # ~6 specs x 3 langs, wiring check
python -m eval.part2_retrieval  --smoke            # ~10 specs x 3 langs, wiring check
python -m eval.part3_cultural_bias --smoke         # ~5 artworks x 3 langs, wiring check

# ---- full runs ----
python -m eval.part1_faithfulness                  # 30 specs x 3 langs = 90 items
python -m eval.part2_retrieval                     # 60 specs x 3 langs = 180 items
python -m eval.part3_cultural_bias                 # ~20 artworks x 3 langs = 60 items
```

Useful flags: `--lang en` / `--lang es,ca` (subset); Part 1 `--n`, Part 2
`--per-category` / `--multi`, Part 3 `--per-origin` (sample sizes); `--seed`
(reshuffle); Part 2 `--runs 3` (re-run each question 3× → report hit-stability);
Part 3 `--context none` (pure-LLM bias ablation, skips retrieval).

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
  (and the answer) vary run to run. All three parts are therefore **statistical
  metrics over N questions, not per-question assertions.** A single miss may be
  the LLM mistyping a title literal, not a real recall gap — re-run or use Part 2
  `--runs 3` to separate flaky from systematic. Part 3 additionally compares
  against a hand-curated `Q(c)`, so its CBS is only as defensible as that table
  (rows carry a `confidence`; CBS is reported per-confidence).

**5. Rate limits.** Trial Cohere keys cap at ~20 calls/min. `config.REQUEST_SLEEP_S`
spaces items (Part 1 ≈ 3 calls/item → use ~15s; Part 2 ≈ 1 call/item → ~5s is
fine; Part 3 ≈ 3 calls/item → ~15s), and `llm_bridge` installs exponential 429
backoff over *all* Cohere calls. Per-item errors are recorded; the run never aborts.

---



**Cultural bias deviation is now built as Part 3** (above): it scores whether the
guide's presentation of an artwork's cultural origins deviates from the work's
real, multi-cultural heritage (`CBS = D_KL(Q‖P)` against a hand-curated reference
distribution), broken down by language. It is implemented and self-tested; the
remaining step is a full live run by the user (and, optionally, expanding the
curated `Q(c)` table beyond its current 33 artworks).

The one remaining component, **explanation style evaluation** (Part 4), has not
yet been built. It is intended to verify that the guide styles and age profiles
produce measurably different explanations from the same retrieved facts. That
component, together with the user evaluation described below, is the main pending
step before stronger claims can be made.