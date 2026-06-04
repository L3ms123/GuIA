# GuIA Evaluation Harnesses

Additive, read-only evaluations for GuIA's subsystems. Touches no existing app
file. See [`EVALUATION_PLAN.md`](EVALUATION_PLAN.md) for the full design.

**Implemented so far: Part 1 — LLM faithfulness, and Part 2 — Retrieval recall.**
(Parts 3 & 4 are planned in `EVALUATION_PLAN.md` but not yet built.)

The two parts are complementary and deliberately separated:

| | Part 1 — Faithfulness | Part 2 — Retrieval recall |
|---|---|---|
| **Question** | does the guide invent facts beyond its rows? | did retrieval fetch the *right* row at all? |
| **Pipeline** | retrieve → answer → **judge** | retrieve → **match** known answer |
| **Truth source** | the retrieved rows (judge grades against them) | the Excel inventory (we already know the answer) |
| **LLM calls/item** | ~3 (Cypher-gen + answer + judge) | ~1 (Cypher-gen only; no answer, no judge) |

Part 1 can score an answer **faithful** even when retrieval fetched the wrong
row (the guide repeated it honestly). Whether the *right* row was fetched is
exactly what Part 2 measures — so read them together.

## What Part 1 measures

Per question: retrieve graph context → generate a guide answer → a second Cohere
call **judges** whether the answer is faithful to the retrieved rows only.

```
{"faithfulness": 0.0-1.0, "answered": true|false, "verdict": 1|2|3}
   verdict 1 = faithful (or correct refusal on empty rows)
   verdict 2 = partial invention (grounded core + unsupported detail)
   verdict 3 = fabrication (asserts facts absent from / contradicting the rows)
```

Three question buckets: **grounded** (real facts from the Excel inventory, expect
verdict 1), **out-of-graph** (facts the schema can't hold — the headline
"does it invent when given nothing?" test), and **near-miss** (real entity,
unstored fact — probes the 2-vs-3 boundary).

> **Caveat:** the judge is the same model family as the guide, so reported
> faithfulness is an **optimistic upper bound**. Swap `JUDGE_MODEL` in
> `config.py` to de-bias.

## What Part 2 measures

Per question whose answer we already know from the Excel inventory: retrieve
graph context → check whether the **known answer appears in the returned rows**
(normalized substring match — row column names are dynamic, so we match against
*values*, never keys). No answer generation, no judge — this isolates retrieval.

```
retrieval_recall = hits / scored          # the headline
                 + per-category recall (artist / technique / location / dating)
                 + retrieval_empty_rate, retrieval_error_rate  (explains low recall)
                 + multi-valued micro-recall + all_present_rate
```

Two categories get answer-aware matching, grounded in how the graph stores data:

- **location** — the UI label `P1-S3` is **not** stored verbatim; `kg.ipynb`
  splits it into `Sala.palau="1"` + `Sala.id="3"` (ground-floor `PB-S0` →
  palau `"B"`). We require both tokens, never the literal `P1-S3`.
- **dating** — noisy free text ("c. 1550", "1450-1460"); we HIT on any matching
  4-digit year.

> **Faithful ≠ correct:** Part 1 can call an answer faithful even if retrieval
> fetched the *wrong* row. Part 2 is the check on whether the *right* row was
> fetched. Low Part-2 recall + high Part-1 faithfulness = "honest about the wrong
> facts."

## Requirements

- **`COHERE_LLM_KEY`** — required for any live run (the backend builds the Cohere
  client at import). Read from the process env or from `LLM/.env`.
- **`NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD`** — **required in practice
  for Part 2** (recommended for Part 1). Without them every retrieval returns
  `None` (counted as `retrieval_error`): Part 1's grounded bucket can't get rows,
  and Part 2's recall reads ~0. The run still completes; the
  `retrieval_error_rate` metric makes the misconfig explicit instead of showing
  a silent "0%", and `retrieval_recall_excl_error` isolates Cypher quality from
  connectivity.
- No new third-party dependencies (stdlib + the already-installed `cohere`).

## How to run

All commands run from the **repo root** (`GuIA/`), as a module:

```bash
# 1. Inspect the ground-truth question set — NO API key, NO network needed.
#    Confirms the Excel header locators and prints sample (question, expected) pairs.
python -m eval.groundtruth --dump

# 2. Preview the assembled Part 1 question set — NO API calls.
python -m eval.part1_faithfulness --dry-run --smoke

# 3. Judge-contract sanity check — needs COHERE_LLM_KEY (no Neo4j). 3 Cohere calls.
python -m eval.test_judge_contract

# 4. Smoke run — needs the keys. ~6 specs x 3 languages = 18 items, writes results/.
python -m eval.part1_faithfulness --smoke

# 5. Full run — 30 specs PER LANGUAGE x {en, es, ca} = 90 items.
python -m eval.part1_faithfulness
#    custom size / seed / subset of languages:
python -m eval.part1_faithfulness --n 12 --seed 42
python -m eval.part1_faithfulness --lang en        # just English
python -m eval.part1_faithfulness --lang es,ca     # Spanish + Catalan
```

**Part 2 — retrieval recall** (same `eval/` package; needs Neo4j to be useful):

```bash
# A. Matcher self-test — NO API key, NO network. Proves the hit/miss logic.
python -m eval.normalization --selftest

# B. Preview the assembled Part 2 question set — NO API calls.
python -m eval.part2_retrieval --dry-run --smoke

# C. Smoke run — needs the keys. ~2/category/language, writes results/.
python -m eval.part2_retrieval --smoke

# D. Full run — 12 single-valued/category + 6 multi/category, x {en, es, ca}.
python -m eval.part2_retrieval
#    subset / size / stability mode:
python -m eval.part2_retrieval --lang en              # just English
python -m eval.part2_retrieval --per-category 6       # smaller
python -m eval.part2_retrieval --runs 3               # re-run each Q 3x, report stability
```

Suggested order: 1 → 2 → 3 → 4 → 5 then A → B → C → D (cheap/free checks first,
then API spend).

**Multilingual:** every question is asked in each of `en`, `es`, `ca`
(`config.LANGUAGES`) — Part 1 also *answers* in each language; Part 2 only asks,
since the matcher always compares against the graph's (Catalan) row values. All
three are tested on the *same* sampled items, so per-language numbers are
directly comparable. Part 1's `--n` and Part 2's `--per-category` are **per
language**. See [HOW_PART1_WORKS.md](HOW_PART1_WORKS.md) and
[HOW_PART2_WORKS.md](HOW_PART2_WORKS.md) for full walkthroughs.

## Output

Timestamped files under `eval/results/` (gitignored), one set per part:

- `partN_<ts>.json` — run config + every per-item record + summary block.
- `partN_<ts>.csv` — flat per-item rows for triage (`utf-8-sig` so Excel renders
  Catalan accents).
- `partN_<ts>.summary.txt` — human-readable metrics + worst offenders. Part 1:
  the verdict-3 fabrications, with their answers. Part 2: the recall **misses,
  with their generated Cypher** (usually the root cause of a miss).

## Cost & rate limits

**Part 1:** each item ≈ retrieve (1 Cohere call for Cypher-gen; its other retries
hit Neo4j, not Cohere) + 1 answer + 1 judge ≈ 3 Cohere calls. The default run is
30 specs × 3 languages = 90 items ≈ ~270 Cohere calls.

**Part 2:** each item ≈ 1 Cohere call (Cypher-gen only — no answer, no judge), so
it is ~3× cheaper per item. The default run is (12×4 + 6×2) = 60 specs × 3
languages = 180 items ≈ ~180 Cohere calls × `--runs` (default 1).

**Trial keys are capped at 20 calls/min**, so set `REQUEST_SLEEP_S` accordingly
(≈15s spaces it safely); the bridge also installs exponential 429 backoff over
*all* Cohere calls and records per-item errors rather than aborting the run. To
spend less, use `--lang en`, Part 1 `--n`, or Part 2 `--per-category`.

## Determinism

Part 1's judge call (the one we fully own) pins `temperature=0` and a fixed
`seed`. Retrieval and answer generation run an LLM internally with **no
temperature control exposed**, so they are **not** bit-deterministic — both parts
are statistical metrics over N questions, not per-question assertions. The
sampled question sets are reproducible via `RANDOM_SEED`. Part 2's `--runs N`
re-runs each question N times and reports mean recall + hit-stability, to
*quantify* the retrieval variance rather than pretend it is zero. (Making
retrieval bit-deterministic would require adding `temperature=0` to the
Cypher-gen call at `LLM_Call.py:1896` — out of scope for this read-only eval.)

## Files

| File | Purpose |
|------|---------|
| `_bootstrap.py` | env validation + `sys.path` shim; import first |
| `llm_bridge.py` | thin wrappers over `LLM_Call` (retrieve / answer / judge) |
| `config.py` | tunables (sizes, judge model, seeds, retries, sleep) |
| `groundtruth.py` | deterministic Q&A from the Excel inventory (network-free) |
| `question_bank.py` | hand-written out-of-graph + near-miss adversarial probes (Part 1) |
| `normalization.py` | Part 2 recall matcher (network-free; `--selftest`) |
| `judge.py` | judge prompt, JSON contract, parse + bounded retry (Part 1) |
| `part1_faithfulness.py` | Part 1 driver, aggregation, output writers |
| `part2_retrieval.py` | Part 2 driver, aggregation, output writers |
| `test_judge_contract.py` | 3-fixture rubric sanity check (Part 1) |
