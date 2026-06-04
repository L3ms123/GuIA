# Part 2 — Retrieval Recall, explained

> **The one-sentence version:** we ask the guide a question we already know the
> answer to, look only at the rows it pulled from the knowledge graph, and check
> one thing — *was the right fact actually in there?*

Part 1 asked "does the guide make things up?" Part 2 asks the question that comes
*before* it: **did the search even find the fact?** A guide can be perfectly
honest about rows that never contained the answer — faithful, but useless. Part 2
is the recall check that catches that case.

---

## The core idea

GuIA answers a question by first turning it into a Neo4j query (Cypher), running
it, and feeding the resulting rows to the model. Part 2 stops after the *search*
step — no answer is written, no judge is called:

```
            ┌─────────────┐      ┌──────────────────────┐
 question → │  RETRIEVE   │ rows │   MATCH the answer    │ → hit / miss
 (answer    │ (graph RAG) │ ───→ │ we already know it    │
  known)    └─────────────┘      └──────────────────────┘
              rows│empty│error      is the known answer
                                    somewhere in the rows?
```

Because we already know the correct answer (it comes straight from the museum's
Excel inventory — the same file the graph was built from), we don't need a model
to grade anything. We just ask: **does the known answer appear in the returned
rows?**

---

## Why "does it appear in the rows", not "is the column right"

The generated Cypher decides what to `RETURN`, and it varies run to run — one
time it's `RETURN a.artist`, another `RETURN artist.name`, another
`RETURN a.title, t.name`. So we never look at *column names*. We flatten every
value in every row into one big normalized string (a "haystack") and check
whether the known answer is a **substring** of it.

Substring, not exact equality, on purpose: the guide's own search fallback is
itself `CONTAINS`-based, and a row like `"Oli sobre tela i fusta"` should count as
a hit for the expected technique `"Oli sobre tela"`. Matching folds away accents,
apostrophes and case first (`Gascó` → `gasco`), so Catalan spelling never causes
a false miss.

---

## Two facts get special handling

Most questions (artist, technique) are a plain substring check. Two aren't,
because of *how the graph physically stores the data* — both verified against
`KG/kg.ipynb` and `LLM/LLM_Call.py`:

| fact | the trap | what we do |
|------|----------|------------|
| **location** | The label `P1-S3` is **not** stored as-is. `kg.ipynb` splits it into `Sala.palau = "1"` and `Sala.id = "3"`. Ground floor `PB-S0` becomes palau `"B"` (a letter!). | We split the expected UBIC the *same way the graph did* and require **both** tokens to appear. Never the literal `P1-S3`. |
| **dating** | Free text and messy: `"c. 1550"`, `"1450-1460"`, `"Segle XVI"`. | Pull out 4-digit years; **hit if any expected year appears**. No year (a century in Roman numerals)? Fall back to requiring all tokens, so `XVI` doesn't match inside `XVII`. |

These two rules are the whole reason the matcher lives in its own file with a
`--selftest` — they're easy to get subtly wrong, so they're pinned down by
hand-built cases that run with no API key.

---

## Single-valued vs. multi-valued questions

- **Single-valued** — one right answer (who made it? what room?). Scored as a
  clean **hit / miss**. This is the headline `retrieval_recall`.
- **Multi-valued** — a *set* of right answers (which works are in room P1-S3? what
  did this artist make?). Scored as **micro-recall** (how many of the expected
  titles came back) plus `all_present` (did *every* one come back).

> **A subtlety that bites recall:** the backend trims retrieval to **5 rows**
> unless the question asks for "all" / "the complete list". So the multi-valued
> question templates are deliberately phrased *"List all the artworks…"* /
> *"…llista completa…"* — without that, a room with 8 works could never score
> above 5/8 no matter how good the search was.

---

## The same questions in three languages

A visitor asks in English, Spanish or Catalan, but the artwork titles in the
graph are Catalan either way (the Cypher-generator is explicitly told not to
translate them). So we **sample the question set once** and ask each question in
all three languages, while the matcher always compares against the graph's
Catalan row values. The per-language numbers are then directly comparable and
isolate one thing: *does asking in Spanish/English hurt the search?*

```
   one sampled fact   ──►  en: "Who created 'Davallament'?"
   (we know answer)   ──►  es: "¿Quién creó 'Davallament'?"   ─┐ all matched against
                       ──►  ca: "Qui va crear 'Davallament'?"  ─┘ the same Catalan rows
```

---

## What each file does

| file | role |
|------|------|
| `groundtruth.py` | Reads the Excel inventory and builds the known-answer questions (shared with Part 1's grounded bucket). Runs with no API key (`--dump`). |
| `normalization.py` | **The scoring heart.** Turns rows into a haystack and decides hit/miss, with the location + dating special cases. Network-free; `--selftest`. |
| `llm_bridge.py` | Thin wrapper over the real backend's `retrieve` + rate-limit backoff. The only file that talks to Cohere/Neo4j. |
| `part2_retrieval.py` | The conductor: samples questions, runs retrieve→match across all languages, aggregates recall, writes the reports. |
| `config.py` | The knobs: per-category sample sizes, `RETRIEVAL_RUNS` (stability), languages, sleep. |

---

## Running it

From the repo root, cheapest-first (the first two cost **nothing**):

```bash
python -m eval.normalization --selftest            # matcher logic, no API/network
python -m eval.part2_retrieval --dry-run --smoke   # preview questions, no API
python -m eval.part2_retrieval --smoke             # tiny end-to-end, writes results/
python -m eval.part2_retrieval                     # full run, all languages
```

Handy flags: `--lang en` (one language), `--per-category 6` (smaller),
`--runs 3` (re-run each question 3× and report stability), `--seed 42`.

> ⚠️ **Part 2 really needs Neo4j.** With `NEO4J_*` unset, every retrieval is a
> `retrieval_error` and recall reads 0 — that's the misconfiguration, not the
> search quality. The summary warns loudly and `retrieval_recall_excl_error`
> separates "couldn't connect" from "connected but didn't find it".

---

## Reading the results

Each run drops three timestamped files in `eval/results/`. Start with
`.summary.txt`:

```
HEADLINE — single-valued recall (all languages pooled)
  retrieval_recall              : 0.78   (hits / all scored)
  retrieval_recall_excl_error   : 0.83   (hits / where retrieval actually ran)
  retrieval empty / error / hits: 0.10 / 0.05 / 0.85

RECALL BY LANGUAGE
  lang   single  recall   r|ran  empty  error  multiμR  allPres
  en         48    0.79    0.83   0.10   0.04     0.71     0.55
  es         48    0.77    0.81   0.12   0.04     0.69     0.52
  ca         48    0.81    0.85   0.08   0.04     0.74     0.58
```

- **retrieval_recall** — the headline: of all questions, what fraction returned
  the right fact. Higher is better.
- **r|ran** (`_excl_error`) — recall counting only questions where retrieval
  actually executed. The gap between this and raw recall is your Neo4j/connection
  losses, not search quality.
- **empty / error** — retrieval health. High **error** ≈ Neo4j unreachable or the
  LLM wrote invalid Cypher; **empty** ≈ the query ran but matched nothing.
- **multiμR** — multi-valued micro-recall (fraction of expected titles found).
- **allPres** — fraction of multi-valued questions where *every* expected title
  came back.

The **per-category** table is where the diagnosis lives: if `location-of` recall
is low but `artist-of` is high, the room-splitting Cypher is the suspect. And the
**MISSES** section prints each miss *with its generated Cypher* — usually the
query itself tells you why it missed.

### Two honest caveats

1. **Retrieval isn't deterministic.** An LLM writes the Cypher with no temperature
   control, so a single run is a sample, not a verdict. Use `--runs 3+` to see how
   stable each question is (`hit_stability_rate`).
2. **A miss isn't always the search's fault.** Some facts genuinely aren't in the
   graph — anonymous works have no Artist node, for instance — so an `artist-of`
   miss there is a *data gap*, not a retrieval bug. The generated Cypher in the
   misses list is what lets you tell the two apart.

---

## In one breath

Part 2 asks questions whose answers we already know, in three languages, and
checks whether the graph search returned rows containing that answer — isolating
**"did we fetch the right fact?"** from Part 1's **"did we stay honest about the
facts we fetched?"** Read together, they separate a retrieval problem from a
hallucination problem.
