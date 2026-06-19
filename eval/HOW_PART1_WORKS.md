# Part 1 — LLM Faithfulness, explained

> **The one-sentence version:** we hand the guide a question, watch what it
> retrieves from the knowledge graph, read its answer, and ask a second AI one
> blunt question — *"did the guide stick to the facts it was given, or did it
> make things up?"*

GuIA is a museum audio-guide: Cohere `command-a` writing answers on top of a
Neo4j knowledge graph. The risk with any RAG system is **confident invention** —
the model filling gaps with plausible-but-fake facts. Part 1 measures exactly
that, in **English, Spanish, and Catalan**.

---

## The core idea

For every question we run a three-step pipeline and score the result:

```
            ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
 question → │  RETRIEVE   │ rows │   ANSWER    │ text │    JUDGE    │ → verdict
            │ (graph RAG) │ ───→ │ (the guide) │ ───→ │ (2nd model) │
            └─────────────┘      └─────────────┘      └─────────────┘
              rows│empty│error                         {faithfulness,
                                                        answered, verdict}
```

1. **Retrieve** — ask the real backend (`retrieve_neo4j_context`) to turn the
   question into Cypher and pull rows from the graph. Three outcomes, tracked
   separately: **hits** (got rows), **empty** (query ran, nothing matched),
   **error** (couldn't run — e.g. Neo4j down, or the LLM wrote invalid Cypher).
2. **Answer** — feed those rows to the guide (`call_cohere_guide`) and capture
   the answer it gives the visitor.
3. **Judge** — a second, independent Cohere call reads `(question, rows, answer)`
   and returns a small JSON verdict. It's told the rows are the **only** truth
   and to ignore its own world knowledge.

The headline question the whole thing exists to answer:
**when retrieval comes back empty, does the guide refuse — or invent?**

---

## The verdict

The judge returns exactly three fields, nothing more:

```json
{ "faithfulness": 0.0, "answered": true, "verdict": 1 }
```

| field | meaning |
|-------|---------|
| `faithfulness` | 0.0–1.0 — fraction of the answer's factual claims actually supported by the rows |
| `answered` | did the guide give a real answer (`true`) or refuse / say it doesn't know (`false`) |
| `verdict` | **1** = faithful (or a correct refusal) · **2** = partial invention (grounded core + unsupported extras) · **3** = fabrication (made-up or contradicting facts) |

`verdict == 3` is the one that matters. A faithful guide handed empty rows scores
**1** by refusing; a hallucinating guide scores **3** by answering anyway.

---

## The three question buckets

We don't just ask easy questions — we bait the guide into inventing.

| bucket | what it asks | what *should* happen |
|--------|--------------|----------------------|
| **grounded** | facts that ARE in the graph (artist, technique, room, dating of real artworks) | retrieve hits → faithful answer → verdict 1 |
| **out_of_graph** | facts the schema simply can't hold (an artwork's weight, accession number, humidity…) | retrieve empty → guide should refuse → verdict 1. Inventing → verdict 3. **This is the headline test.** |
| **near_miss** | real artworks/artists, but facts not stored (exact size in cm, prior owners, pigments…) | probes the 2-vs-3 boundary: does it add plausible fiction? |

Grounded questions come from the museum's own Excel inventory (so we *know* the
right answer). Adversarial ones are hand-written probes that name real works.

---

## Why "the same questions in three languages"

A visitor can ask in English, Spanish, or Catalan — so faithfulness must hold in
all three. The trick: we **sample the question set once**, then **render each
question in every language**. English `en`, Spanish `es`, Catalan `ca` are tested
on *identical* content, so the per-language numbers are directly comparable —
any difference is the language, not luck of the draw.

```
   one sampled "spec"  ──►  en: "Who created 'Davallament'?"
   (language-neutral)  ──►  es: "¿Quién creó 'Davallament'?"
                       ──►  ca: "Qui va crear 'Davallament'?"
```

---

## What each file does

| file | role |
|------|------|
| `_bootstrap.py` | Validates the API key and fixes `sys.path` so the backend imports cleanly. Imported first by everything. Also injects the OS certificate store (`truststore`) for corporate TLS. |
| `config.py` | All the knobs: languages, judge model, sample sizes, seed, sleep between calls, retry counts. Start here to change behaviour. |
| `groundtruth.py` | Reads the Excel inventory and builds the **grounded** questions with their known answers. Runs with no API key (`--dump` to inspect). |
| `question_bank.py` | The hand-written **out_of_graph** and **near_miss** probes, translated into all three languages. |
| `llm_bridge.py` | Thin wrappers over the real backend (`retrieve` / `answer` / `judge_raw`) plus rate-limit backoff. The only file that talks to Cohere. |
| `judge.py` | The judge's prompt (the rubric above), the JSON contract, and a tolerant parser with retries. |
| `part1_faithfulness.py` | The conductor: assembles questions, runs the pipeline across all languages, aggregates metrics, writes the reports. |
| `test_judge_contract.py` | A 3-fixture sanity check that the judge actually gives 1 / 2 / 3 on obvious cases. Run it before spending on a full run. |

---

## Running it

From the repo root, cheapest-first (the first two cost **nothing**):

```bash
python -m eval.groundtruth --dump                 # inspect ground truth, no API
python -m eval.part1_faithfulness --dry-run        # preview all questions, no API
python -m eval.test_judge_contract                 # 3 judge calls, sanity check
python -m eval.part1_faithfulness --smoke          # ~6 specs x 3 langs end-to-end
python -m eval.part1_faithfulness                  # full run: 30 specs x 3 langs
```

Handy flags: `--lang en` (one language), `--lang es,ca` (a subset), `--n 12`
(items per language), `--seed 42` (reshuffle the sample).

> ⚠️ **Trial Cohere keys allow 20 calls/min.** Each item is ~3 calls, so a full
> 90-item run needs spacing — `REQUEST_SLEEP_S` in `config.py` (≈15s) keeps you
> under the cap, and the bridge retries on 429 anyway.

---

## Reading the results

Each run drops three timestamped files in `eval/results/`:

- **`.summary.txt`** — read this first. The **LANGUAGE COMPARISON** table is the
  payoff:

  ```
  lang   judged   faith  halluc  partial  refusal  empty  error  h|empty   dkΔ
  en         30    1.00    0.00     0.00     0.53   0.20   0.03     0.00     5
  es         30    0.97    0.03     0.00     0.50   0.20   0.03     0.00     6
  ca         29    1.00    0.00     0.00     0.55   0.21   0.00     0.00     4
  ```

  - **faith** — mean faithfulness (1.00 = nothing invented). Higher is better.
  - **halluc** — fabrication rate (verdict 3). **Lower is better; this is the headline.**
  - **refusal** — how often the guide said "I don't know" (expected to be high, because two of three buckets are deliberately unanswerable).
  - **empty / error** — retrieval health. High **error** usually means Neo4j isn't configured (the guide then gets no rows at all).
  - **h\|empty** — hallucination rate *specifically when retrieval returned nothing*. The single most important cell: it isolates "invents from thin air."
  - **dkΔ** — times the simple refusal-detector regex disagreed with the judge (a tuning signal, not a guide failure).

- **`.csv`** — one row per (question, language) with the answer, verdict, and the
  generated Cypher. Open in Excel, filter by `verdict == 3` or by `language` to
  triage. Written UTF-8-BOM so Catalan accents render.

- **`.json`** — everything, machine-readable: run config + every record +
  the full `by_language` / `by_bucket` metric blocks.

### Two honest caveats

1. **The judge is the same model family as the guide**, so it grades a little
   leniently — read faithfulness as an *optimistic upper bound*, not gospel.
2. **Faithful ≠ correct.** The judge checks the answer matches the *rows*, not
   reality. If retrieval hands the guide a wrong row and the guide repeats it
   faithfully, that's still verdict 1 here — whether retrieval fetched the
   *right* row is **Part 2's** job (retrieval recall).

---

## In one breath

Part 1 asks the guide real and impossible questions in three languages, then has
a second model check whether each answer stayed inside the facts it was given.
The number to watch is **hallucination-rate-when-retrieval-is-empty**: how often
the guide makes something up when it has nothing to stand on.
