# GuIA Evaluation Harnesses

Additive, read-only evaluations for GuIA's subsystems. Touches no existing app
file. See [`EVALUATION_PLAN.md`](EVALUATION_PLAN.md) for the full design.

**Implemented: Part 1 — LLM faithfulness, Part 2 — Retrieval recall, Part 3 —
Cultural bias, and Part 4 — Prompt sensitivity.**

The parts are complementary and deliberately separated:

| | Part 1 — Faithfulness | Part 2 — Retrieval recall | Part 3 — Cultural bias | Part 4 — Prompt sensitivity |
|---|---|---|---|---|
| **Question** | does the guide invent facts beyond its rows? | did retrieval fetch the *right* row at all? | does the guide flatten a work's cultural origins toward a dominant narrative? | how much does the answer move when the *prompt* changes — signal or noise? |
| **Pipeline** | retrieve → answer → **judge** | retrieve → **match** known answer | (retrieve →) answer → **classify** → KL-score | freeze retrieval → vary prompt → answer ×R → **surface divergence** → ratio |
| **Truth source** | the retrieved rows (judge grades against them) | the Excel inventory (we already know the answer) | a hand-curated `Q(c)` distribution table | none — compares variants to a shared baseline + their own noise floor |
| **LLM calls/item** | ~3 (Cypher-gen + answer + judge) | ~1 (Cypher-gen only; no answer, no judge) | ~3 (Cypher-gen + answer + classify) | ~`1 + V·R` (1 retrieve + V variants × R runs; default 13) |

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

## What Part 3 measures

Per artwork: ask the guide to describe its cultural context, then a **classifier**
LLM turns the answer into a probability distribution `P(c)` over six
cultural-origin classes. We compare it to a hand-curated expected distribution
`Q(c)` via KL divergence:

```
CBS = D_KL(Q‖P) = Σ_c Q(c)·ln(Q(c)/P(c))     # low = balanced; high = flattened
   + by_language  (THE headline: is the guide more eurocentric in one language?)
   + by_artist_origin / by_theme
   + mean attribution gap P(c)−Q(c) per class  (the eurocentric fingerprint)
   + JSD  (symmetric, bounded by ln2 — the robustness companion for ranking)
```

The classifier is **title-blind** (it sees only the answer, never `Q`), so `P`
measures what the answer said, not what the classifier knows. Direction `Q‖P`
penalizes the answer for **omitting** real influences (eurocentric flattening).

> **Curate `Q` to the truth, not a diversity target.** This is a Renaissance
> collection, so a high Italian/Iberian share is usually *correct*: a genuinely
> Italian work described as Italian scores ≈ 0. Bias registers only on divergence.

> **Caveats:** `Q` is hand-curated art-historical judgment (subjective; rows carry
> a `confidence`). The classifier shares the guide's model family, so CBS is an
> optimistic **lower bound**. `--context none` isolates model bias from the graph's
> uneven coverage. See [HOW_PART3_WORKS.md](HOW_PART3_WORKS.md).

## What Part 4 measures

GuIA personalizes by **prompting**, so Part 4 treats the prompt as the independent
variable. It holds a fixed benchmark, **freezes the retrieved rows** (one retrieve
per item, reused everywhere — so the prompt is the only thing that changes), then
varies one prompt knob at a time and regenerates the answer `R` times. It measures
how far the answer moved with deterministic **surface divergence** (token Jaccard,
network-free — no judge):

```
sensitivity ratio = between-variant divergence / within-variant divergence
   within = a variant's R repeats vs each other        (the NOISE FLOOR)
   between = treatment vs baseline, over R×R cross pairs (the SIGNAL)
   reported as mean ± std, per axis × per language       (not a single run)
```

Two axis **kinds**, same metric, opposite reading:

- **robustness** (`fewshot` on/off, `rag_position` before/after the rules) — a
  fact-neutral change; want **ratio ≈ 1**. A high ratio = the prompt is fragile.
- **semantic** (`persona` explorer→scholar, `age`) — the personalization test;
  want **ratio ≫ 1**. A low ratio = personalization is cosmetic.

It does **not** pin the answer temperature: the run-to-run variance *is* the noise
floor (so `--runs ≥ 3` is required). Inspired by *"The Prompt Report"* (output
varies with wording, few-shot order, context-block position).

> **Caveats:** surface divergence is not semantic equivalence — a faithful
> paraphrase scores divergent (read the offenders). The noise floor depends on the
> model's hidden default temperature. The baseline prompt is asserted byte-identical
> to the backend's `build_system_prompt` via `python -m eval.prompt_variants
> --selftest` — re-run it after any prompt edit. See [HOW_PART4_WORKS.md](HOW_PART4_WORKS.md).

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

**Part 3 — cultural bias** (same `eval/` package; uses a hand-curated `Q(c)`):

```bash
# I. CBS math self-test — NO API key, NO network. Proves the KL/JSD logic.
python -m eval.cbs --selftest

# II. Validate the curated Q(c) table — NO API. Sums to 1, labels match, titles bind.
python -m eval.cultural_groundtruth --validate

# III. Preview the assembled Part 3 set — NO API calls (also runs the validator).
python -m eval.part3_cultural_bias --dry-run --smoke

# IV. (optional) LLM-draft new curated rows from graph text for human review.
python -m eval.cultural_groundtruth --template --out draft.json --limit 5

# V. Smoke run — needs the keys. 1/origin/language, writes results/.
python -m eval.part3_cultural_bias --smoke

# VI. Full run — CBS_PER_ORIGIN artworks/origin, x {en, es, ca}.
python -m eval.part3_cultural_bias
#    subset / ablation / size:
python -m eval.part3_cultural_bias --lang en          # just English
python -m eval.part3_cultural_bias --context none     # pure-LLM bias (no graph context)
python -m eval.part3_cultural_bias --per-origin 6     # bigger sample
```

**Part 4 — prompt sensitivity** (same `eval/` package; freezes retrieval, varies the prompt):

```bash
# P. Divergence math self-test — NO API key, NO network. Proves the Jaccard/cosine logic.
python -m eval.divergence --selftest

# Q. Preview the benchmark + variants + exact call budget — NO API calls.
python -m eval.part4_prompt_sensitivity --dry-run --smoke

# R. Parity self-test — needs COHERE_LLM_KEY (imports backend). Asserts the baseline
#    variant is byte-identical to the shipped build_system_prompt. Run after any prompt edit.
python -m eval.prompt_variants --selftest

# S. Smoke run — needs the keys. ~2 items x 3 langs x 4 variants x 3 runs = 78 calls.
python -m eval.part4_prompt_sensitivity --smoke

# T. Full run — 12 grounded items x 3 langs x 4 variants x 3 runs = 468 calls.
python -m eval.part4_prompt_sensitivity
#    subset / fewer variants / tighter noise estimate:
python -m eval.part4_prompt_sensitivity --lang en            # just English (thirds the cost)
python -m eval.part4_prompt_sensitivity --axes fewshot       # one axis (fewer variants)
python -m eval.part4_prompt_sensitivity --runs 5             # tighter noise floor
```

Suggested order: 1 → 2 → 3 → 4 → 5, then A → B → C → D, then I → II → III → V → VI,
then P → Q → R → S → T (cheap/free checks first, then API spend).

**Multilingual:** every question is asked in each of `en`, `es`, `ca`
(`config.LANGUAGES`) — Part 1 also *answers* in each language; Part 2 only asks,
since the matcher always compares against the graph's (Catalan) row values; Part 4
answers in each language and reports the sensitivity ratio per language. All three
are tested on the *same* sampled items, so per-language numbers are directly
comparable. Part 1's `--n`, Part 2's `--per-category` and Part 4's `--n` are **per
language**. See [HOW_PART1_WORKS.md](HOW_PART1_WORKS.md),
[HOW_PART2_WORKS.md](HOW_PART2_WORKS.md), [HOW_PART3_WORKS.md](HOW_PART3_WORKS.md)
and [HOW_PART4_WORKS.md](HOW_PART4_WORKS.md) for full walkthroughs.

## Output

Timestamped files under `eval/results/` (gitignored), one set per part:

- `partN_<ts>.json` — run config + every per-item record + summary block.
- `partN_<ts>.csv` — flat per-item rows for triage (`utf-8-sig` so Excel renders
  Catalan accents).
- `partN_<ts>.summary.txt` — human-readable metrics + worst offenders. Part 1:
  the verdict-3 fabrications, with their answers. Part 2: the recall **misses,
  with their generated Cypher** (usually the root cause of a miss). Part 3: the
  **highest-CBS items**, each annotated with the cultural class whose omission
  drove the score, plus an answer snippet. Part 4: the **most-divergent
  (item, language, axis)** rows, each with the baseline vs treatment answer
  snippet, plus the per-axis sensitivity ratios and a per axis × per language table.
  Part 4's CSV is one row per (item, language, axis).

> The Part 3 curated table lives at `eval/data/cultural_groundtruth.json` and is
> **committed** (not under `results/`), since it is the contract Part 3 scores
> against.

## Cost & rate limits

**Part 1:** each item ≈ retrieve (1 Cohere call for Cypher-gen; its other retries
hit Neo4j, not Cohere) + 1 answer + 1 judge ≈ 3 Cohere calls. The default run is
30 specs × 3 languages = 90 items ≈ ~270 Cohere calls.

**Part 2:** each item ≈ 1 Cohere call (Cypher-gen only — no answer, no judge), so
it is ~3× cheaper per item. The default run is (12×4 + 6×2) = 60 specs × 3
languages = 180 items ≈ ~180 Cohere calls × `--runs` (default 1).

**Part 3:** each item ≈ retrieve (1 Cohere call; `--context none` skips it) + 1
answer + 1 classify ≈ 3 Cohere calls — same per-item cost as Part 1. The default
run is `CBS_PER_ORIGIN`×5 origins ≈ 20 artworks × 3 languages = 60 items ≈ ~180
Cohere calls. Use ~15s `REQUEST_SLEEP_S` on a trial key.

**Part 4:** each item ≈ 1 retrieve + `V·R` answer calls (`V` = baseline + #axes,
`R` = `--runs`). The default run is `PART4_N`=12 items × 3 languages ×
(1 retrieve + 4 variants × 3 runs) = **468 Cohere calls** (~2 h at 15s/call); smoke
is 78. It's the most expensive part — use `--axes fewshot` (fewer variants),
`--lang en` (thirds it), or a smaller `--n` to cut cost.

**Trial keys are capped at 20 calls/min**, so set `REQUEST_SLEEP_S` accordingly
(≈15s spaces it safely); the bridge also installs exponential 429 backoff over
*all* Cohere calls and records per-item errors rather than aborting the run. To
spend less, use `--lang en`, Part 1 `--n`, Part 2 `--per-category`, or Part 4
`--axes`/`--n`.

## Determinism

Part 1's judge call and Part 3's classifier (the ones we fully own) pin
`temperature=0` and a fixed `seed`. Retrieval and answer generation run an LLM
internally with **no temperature control exposed**, so they are **not**
bit-deterministic — the metrics are statistical over N questions, not per-question
assertions. The sampled question sets are reproducible via `RANDOM_SEED`. Part 2's
`--runs N` re-runs each question N times and reports mean recall + hit-stability,
to *quantify* the retrieval variance rather than pretend it is zero.

**Part 4 inverts this on purpose:** it does NOT pin the answer temperature, because
the run-to-run answer variance is exactly the **noise floor** it measures the
prompt effect against (`--runs N`, ≥3). It instead removes the *retrieval*
nondeterminism as a confound by freezing the retrieved rows (one retrieve per item,
reused across all variants/runs), so the prompt is the only thing that changes.
Its baseline prompt is asserted byte-identical to the shipped `build_system_prompt`
via `python -m eval.prompt_variants --selftest`.

## Files

| File | Purpose |
|------|---------|
| `_bootstrap.py` | env validation + `sys.path` shim; import first |
| `llm_bridge.py` | thin wrappers over `LLM_Call` (retrieve / answer / answer_with_prompt / judge / classify) |
| `config.py` | tunables (sizes, judge model, seeds, retries, sleep, Part 4 axes/thresholds) |
| `groundtruth.py` | deterministic Q&A from the Excel inventory (network-free) |
| `question_bank.py` | hand-written out-of-graph + near-miss adversarial probes (Part 1) |
| `normalization.py` | Part 2 recall matcher (network-free; `--selftest`) |
| `judge.py` | judge prompt, JSON contract, parse + bounded retry (Part 1) |
| `cbs.py` | Part 3 CBS/KL/JSD math (`--selftest`) + the title-blind narrative classifier |
| `cultural_groundtruth.py` | Part 3 curated `Q(c)` loader/validator/`--template`/`--dump` |
| `data/cultural_groundtruth.json` | the hand-curated `Q(c)` table (committed) |
| `divergence.py` | Part 4 surface-divergence math — Jaccard/cosine/length/readability (network-free; `--selftest`) |
| `prompt_variants.py` | Part 4 parametrized prompt builder + axis registry + byte-identity parity `--selftest` |
| `part1_faithfulness.py` | Part 1 driver, aggregation, output writers |
| `part2_retrieval.py` | Part 2 driver, aggregation, output writers |
| `part3_cultural_bias.py` | Part 3 driver, aggregation, output writers |
| `part4_prompt_sensitivity.py` | Part 4 driver, aggregation, output writers |
| `test_judge_contract.py` | 3-fixture rubric sanity check (Part 1) |
