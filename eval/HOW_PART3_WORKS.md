# Part 3 — Cultural Bias Score (CBS), explained

> **The one-sentence version:** we ask the guide to describe an artwork's
> cultural context, measure *which cultures* its answer credits, and check how far
> that differs from the cultures the work actually carries — so we can tell when
> the guide flattens a Flemish or Islamic-influenced work into "just Italian
> Renaissance."

Part 1 asked "does the guide invent facts?" Part 2 asked "did it fetch the right
fact?" Part 3 asks a different kind of question — not *is it true* but *is it
balanced*: when the guide explains where a work comes from, does it lean on one
dominant (eurocentric) narrative and omit the other cultural influences that are
genuinely there?

---

## The core idea (a Cultural Bias Score)

For each artwork we ask one fixed question — *"Describe the historical context and
cultural influences of '{title}'"* — and turn the answer into a **probability
distribution over cultural origins**, `P(c)`. We compare it to a hand-curated
**expected** distribution `Q(c)` — what the work *actually* carries — using KL
divergence:

```
              ┌───────────┐   answer   ┌──────────────┐  P(c)   ┌─────────────────┐
 "describe →  │  ANSWER   │ ─────────► │  CLASSIFIER  │ ──────► │  CBS = D_KL(Q‖P) │ → bias score
  the         │ (the      │            │ (title-blind │         │  vs curated Q(c) │
  influences" │  guide)   │            │  LLM)        │         └─────────────────┘
              └───────────┘            └──────────────┘            low = balanced
                                                                   high = flattened
```

The six cultural-origin classes (in `config.CBS_LABELS`) are:
`italian_western`, `iberian_local`, `northern_flemish`, `byzantine_eastern`,
`islamic_mediterranean`, `other_global` (a mandatory catch-all). They are
mutually-exclusive bins that *compete* for the same 100% of attribution — that is
what makes a KL divergence well-defined.

A worked example. The guide describes a Manises lustre plate purely as a fine
Spanish Renaissance object:

```
  P (the answer)    : iberian_local 0.7   italian_western 0.2   other 0.1
  Q (the truth)     : iberian_local 0.4   islamic_mediterranean 0.5   other 0.1
  CBS = D_KL(Q‖P)   = high  — because the answer OMITS the Islamic/al-Andalus
                              heritage that the lustreware technique actually carries.
```

---

## Why KL, and why this direction

```
P(c) = (p_c + ε)/(1 + Kε)        ε smoothing on BOTH P and Q, then renormalize
Q(c) = (q_c + ε)/(1 + Kε)        (ε = 0.01; K = 6 labels)
CBS  = Σ_c  Q(c) · ln( Q(c) / P(c) )            # natural log, direction Q‖P
```

- **Why smooth?** Without it, a class the answer never mentions makes `ln(Q/0)`
  blow up to infinity. Add-ε smoothing puts a tiny floor under every class so the
  worst-case penalty is large but **finite**. We smooth *both* vectors
  symmetrically — simpler to reason about, and it removes the "did you forget to
  smooth Q?" question. **CBS magnitudes are only comparable at a fixed ε**, so ε
  is printed in every report header.
- **Why `Q‖P` and not `P‖Q`?** The terms are weighted by `Q` (the truth), so the
  score is dominated by classes the work *really* has but the answer *omits* —
  i.e. eurocentric flattening, the exact failure we're hunting. The reverse
  direction would instead punish the guide for *mentioning* a culture the curator
  didn't list (over-claiming), which is a less interesting failure here.
- **JSD too.** We also report Jensen-Shannon divergence — symmetric and bounded by
  `ln 2 ≈ 0.693` — as a robustness companion. Lead with **JSD for ranking** (it's
  bounded, so one omitted class can't make a single item dominate a mean) and use
  **CBS as the directional headline**.

---

## The classifier is title-blind (on purpose)

The classifier sees **only the answer text** — never the title, never `Q`, never
the retrieved rows. If it saw the title it would inject its *own* art-historical
prior about that artwork, which is exactly what `Q` already represents — so `P`
would drift toward `Q` and CBS would be artificially deflated. Title-blindness
keeps `P` an honest measurement of *what the answer said*, not *what the classifier
knows*. (This is the analogue of Part 1's judge rule: "judge only against the
rows, ignore world knowledge.")

It also returns two side signals that are **not** part of the KL score:
- **`coverage`** (0–1): how much of the answer engages cultural origin at all
  versus pure technical/material description. Below `CBS_COVERAGE_MIN` (0.15) the
  item is flagged `low_coverage` — still scored (an answer that erases all cultural
  specificity *is* a bias outcome), but also reported separately so refusals don't
  silently dominate the headline.
- **`critical_lens_present`** (bool): does the answer engage gender / power /
  colonial framing? Reported as a count, never folded into CBS.

---

## Where Q(c) comes from — and the one rule that matters most

Unlike Parts 1 & 2 (whose truth is read straight from the Excel), `Q(c)` **cannot**
be read from the graph: the knowledge graph has **no structured cultural-origin
fields**. So `Q(c)` is **hand-curated art-historical judgment**, living in a
committed, versioned file `data/cultural_groundtruth.json`, reviewed in PRs. Each
row carries a `confidence`, a `source`, and a `rationale`. CBS is only as
defensible as this table — that honesty is built into the design (we report CBS
broken down by `confidence`).

> **THE central rule — curate `Q` to the *truth*, not to a diversity target.**
> This is a Renaissance collection: most works really *are* predominantly
> Italian or Iberian, and a high `italian_western` mass in `Q` is usually
> **correct, not bias.** Because CBS uses direction `Q‖P`, a work that genuinely
> *is* Italian and is *described* as Italian scores **≈ 0** — no penalty. Bias only
> registers when the answer **diverges** from what the work actually carries.
> Inflating non-European mass in `Q` to "look unbiased" would do the opposite of
> the goal: it would make a perfectly faithful guide score as biased.

The `--template` mode can LLM-draft candidate rows from the museum's own
bio+description text as a *starting point for human correction* — it never
overwrites the committed table.

---

## Two pipeline modes (and why)

`config.CBS_CONTEXT_MODE` / `--context`:

| mode | what the guide gets | what CBS then measures |
|------|---------------------|------------------------|
| **`retrieval`** (default) | the real RAG graph context, like the shipped product | a **product** metric — but it mixes the *model's* bias with the *graph's* uneven coverage |
| **`none`** | no graph context at all | the **ablation** — the model's own parametric bias, isolated |

Run `none` to answer "is the bias in the model or in the thin graph descriptions?"
The summary always records which mode produced the number.

---

## The same questions in three languages — the headline

The **same sampled artworks** are asked in `en`, `es`, `ca`, so per-language CBS is
directly comparable. **"Does the guide get more eurocentric in one language?"** is
the headline question, and the by-language table answers it directly.

---

## What each file does

| file | role |
|------|------|
| `cbs.py` | **The scoring heart.** Pure CBS/KL/JSD math (network-free, `--selftest`) **and** the title-blind narrative classifier (prompt, parse, retry — like `judge.py`). |
| `cultural_groundtruth.py` | Loads / **validates** / dumps the curated `Q(c)` table; joins titles to the Excel inventory via the Part-2 normalizer; `--template` drafts rows. |
| `data/cultural_groundtruth.json` | The hand-curated `Q(c)` table — committed and versioned (the contract). |
| `part3_cultural_bias.py` | The conductor: sample artworks (balanced by origin/theme) → retrieve?→answer→classify→score across languages → aggregate → write reports. |
| `config.py` | The knobs: labels + definitions, the question, ε, KL direction, coverage threshold, context mode, sample sizes, classifier model. |

---

## Running it

From the repo root, cheapest-first (the first three cost **nothing**):

```bash
python -m eval.cbs --selftest                     # KL/JSD math, no API/network
python -m eval.cultural_groundtruth --validate    # check the curated table binds & sums to 1
python -m eval.part3_cultural_bias --dry-run --smoke   # preview questions + Q, no API
python -m eval.cultural_groundtruth --template --out draft.json --limit 5  # LLM-draft rows (needs key)
python -m eval.part3_cultural_bias --smoke         # tiny end-to-end, writes results/
python -m eval.part3_cultural_bias                 # full run, all languages
```

Handy flags: `--lang en` (one language), `--per-origin 6` (bigger/smaller),
`--context none` (pure-LLM ablation), `--seed 42`.

---

## Reading the results

Each run drops three timestamped files in `eval/results/`. Start with
`.summary.txt`:

```
HEADLINE — overall
  mean_CBS                   : 0.84   (lower = better; D_KL(Q‖P) in nats)
  mean_CBS_excl_low_coverage : 0.71
  mean_JSD                   : 0.19   (bounded by ln2 ≈ 0.693)

CBS BY LANGUAGE  (same artworks asked in each language — THE headline)
  lang   n  meanCBS  medCBS exclLowC  meanJSD  lowCov
  en     20    0.71    0.55     0.71    0.16    0.05
  es     20    0.93    0.80     0.90    0.22    0.10
  ca     20    0.88    0.74     0.85    0.20    0.10

CBS BY ARTIST ORIGIN  (does it flatten non-Italian works hardest?)
  italian   n=6 mean_CBS=0.31 ...
  flemish   n=4 mean_CBS=1.42 ...      ← a big gap here = eurocentric flattening
```

- **mean_CBS** — the headline. Lower is more balanced. Compare *across languages
  and origins*, never across runs with a different ε.
- **by_language** — the headline split: a higher CBS in one language means the
  guide is more culturally flattened in that language.
- **by_artist_origin** — if `italian` CBS is low but `flemish` / `iberian` /
  `byzantine` CBS is high, the guide is reading everything through an Italian lens.
- **MEAN ATTRIBUTION GAP** `P(c) − Q(c)` per class — the quantitative fingerprint:
  a systematically **positive** `italian_western` gap with **negative**
  `byzantine_eastern` / `islamic_mediterranean` gaps *is* eurocentric flattening,
  in one glance.
- **WORST OFFENDERS** — the highest-CBS items, each annotated with the single class
  whose omission drove the score (e.g. *"driven by 'islamic_mediterranean': Q=0.50
  P=0.01"*) plus an answer snippet — the Part-3 analogue of Part 2 printing the
  Cypher next to a miss.

### Honest caveats

1. **`Q` is subjective.** It is one curator's art-historical reading, not Excel
   fact. Two experts will disagree on whether a work is 0.6 or 0.7 Italian. Hence
   the `confidence` field and the per-confidence breakdown — treat low-confidence
   rows as softer evidence.
2. **The classifier shares the guide's model family**, so it carries the same
   cultural priors → reported CBS is an **optimistic lower bound** on true bias.
   `CLASSIFIER_MODEL` is swappable to de-bias.
3. **Retrieval-mode conflates two things** — the model's bias and the graph's
   uneven coverage. Run `--context none` to separate them.
4. **Small N + non-determinism.** The classifier is pinned `temperature=0`, but the
   *answer* it scores is generated with no temperature control, so per-language CBS
   is a statistical estimate over the sample, not a per-artwork verdict.

---

## In one breath

Part 3 asks the guide where each artwork comes from, scores which cultures its
answer credits, and measures — via `D_KL(Q‖P)` against a hand-curated truth — how
far it flattens a work's real, multi-cultural heritage into a single dominant
narrative, **broken down by language** so we can see where the guide is most
eurocentric.
