# GuIA Evaluation Harnesses — Plan (Parts 1 & 2)

## Context

GuIA is an AI museum audioguide (Flask + Cohere `command-a-03-2025` + Neo4j knowledge-graph RAG). It currently has **zero automated tests or evaluations** — quality is only inferred indirectly from runtime analytics (`dontKnow` rate, `retrievalEmpty`). We want to *measure* how well four distinct subsystems work, building them **one at a time**. This document plans the first two:

- **Part 1 — LLM faithfulness:** does the guide stay faithful to the facts it retrieves from the graph, or does it invent things?
- **Part 2 — Retrieval recall:** does `retrieve_neo4j_context` actually surface the right fact for a question whose answer we already know?

This document began as the design for Parts 1 & 2 only. Those are now built and run; **Part 3 — cultural bias is also built** (see its section below). Part 4 will be planned later in its own pass. It lives at `eval/EVALUATION_PLAN.md` so it sits alongside the harness code under `eval/`.

---

## Verified facts that shape the design

All line numbers are in [../LLM/LLM_Call.py](../LLM/LLM_Call.py).

- **The module is import-safe.** Flask `app.run()` is guarded by `if __name__ == "__main__"` (`:2535`), so we can `import LLM_Call` and call its functions directly — no HTTP server, no Flask test client needed.
- **But importing has side effects:** `load_dotenv(LLM/.env)` runs at `:32`, and `COHERE_CLIENT = cohere.Client(os.environ["COHERE_LLM_KEY"])` at `:36` raises a bare `KeyError` if the key is missing. → We must validate env **before** importing.
- **`LLM/` is not a Python package** (no `__init__.py`), and `LLM_Call.py` does *sibling* imports (`import analytics`, `from unresolved_questions import ...` at `:28-29`). So `from LLM.LLM_Call import ...` breaks. → Use a `sys.path` shim that puts the `LLM/` directory on the path, then `import LLM_Call`.
- **Retrieval has an LLM in the loop.** `retrieve_neo4j_context(message, session_id, room, artwork, visual_descriptions)` (`:1984`) calls `generate_query_api_cypher` (`:1870`, a Cohere call) to write Cypher, runs it via the Neo4j HTTPS Query API (`:1781`), with a fallback chain (exact → `CONTAINS` → accent-insensitive fuzzy → artwork-title-token). Returns `{"message","cypher","rows"}` **or `None`**.
  - **`None` = retrieval error / Neo4j unconfigured; `rows == []` = query ran, found nothing.** These are different and must be tracked separately.
  - **`rows` column names are dynamic** — whatever the generated Cypher chose to `RETURN` (e.g. `{"artist.name": "..."}` one time, `{"a.title": "...", "t.name": "..."}` another). → Matching must look at row *values*, never assume column keys.
- **Answer generation:** `call_cohere_guide(message, session_id, language, age_range, personality, room, artwork, graph_context, simple_language, visual_descriptions, more_time) -> str` (`:2050`) embeds `graph_context["rows"]` as `json.dumps(rows, indent=2)` under a `"RETRIEVED NEO4J CONTEXT:"` section (`:1334-1348`), calls Cohere, returns the formatted answer. We use this directly (the plain Cohere path; we avoid the iDEM easy-read branch in `call_llm` so there is one model path to reason about).
- **`conversation_id=f"guia_{session_id}"`** is passed on the guide call (`:2080`), and `SESSION_CONTEXTS` carries follow-up state (`:1992`). → Use a **fresh unique `session_id` per question** so items don't contaminate each other; evaluate every question cold.
- **Reusable helpers already present:**
  - `normalize_text_for_cypher(text)` (`:1404`) — lowercases and folds Catalan accents/apostrophes. Good base for Part 2 matching (needs a thin wrapper to also strip punctuation + collapse whitespace).
  - `read_xlsx_rows(path)` (`:983`) — stdlib-only `.xlsx` reader. `load_locations_from_excel()` (`:1095`) — returns `{"rooms":[{"id","label","artworks":[{"id","title"}]}]}`.
  - `detect_dont_know(text, language)` (`:869`) — regex refusal detector (es/ca/en), useful as a cross-check on the judge's `answered` flag.
  - JSON-from-LLM parsing idiom (first `{` … last `}` slice) at `parse_translation_response` (`:2150`) — copy for the judge parser.
- **Cohere call shape:** `COHERE_CLIENT.chat(model=, preamble=<system>, message=<user>, conversation_id=)` → `.text`. The codebase never passes `temperature=` to `.chat()` — to verify the installed SDK accepts it; if not, omit and rely on retries.
- **Ground-truth source (Part 2):** [../raw_data/2026_obres_Museu_del_Renaixement.xlsx](../raw_data/2026_obres_Museu_del_Renaixement.xlsx) — 72 artworks. Catalan headers (after `normalize_header`): `titol`/`title`, `ubic` (location like `P1-S3`), expected `autoria` (artist), `datacio` (dating), `tecnica`/`tipologia` (technique). **Exact extra-column headers to be confirmed at implementation time by dumping the normalized header row.**

---

## Shared foundation: `eval/` layout

A new, fully additive `eval/` folder at repo root. Touches no existing file.

```
eval/
  EVALUATION_PLAN.md     # this document
  __init__.py            # marks package -> run as `python -m eval.part1_faithfulness`
  _bootstrap.py          # env validation + sys.path shim; import this FIRST
  llm_bridge.py          # thin wrappers over LLM_Call (retrieve / answer / judge_raw)
  normalization.py       # recall matcher built on normalize_text_for_cypher
  groundtruth.py         # build deterministic Q&A set from the Excel inventory
  judge.py               # Part 1 judge: prompt, minimal schema, parse + retry
  part1_faithfulness.py  # Part 1 driver + aggregation
  part2_retrieval.py     # Part 2 driver + aggregation
  config.py              # tunables (sample sizes, JUDGE_MODEL, retries, sleep, seed)
  results/               # timestamped JSON/CSV/summary output (gitignored)
  README.md              # how to run, required env, cost note
```

**`_bootstrap.py`** (imported at the top of every entry point):
1. Validate env *before* importing `LLM_Call`: require `COHERE_LLM_KEY`; for retrieval also `NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` (the `NEO4J_REQUIRED_ENV` tuple at `:37`). Print a friendly message and exit cleanly if missing — never print secret values.
2. Insert `str(REPO_ROOT / "LLM")` at `sys.path[0]`, then expose a `load_llm()` that does the one-time `import LLM_Call`.

**`llm_bridge.py`** re-exports exactly what we use and nothing else: a `retrieve()` that distinguishes error (`None`) from empty (`[]`); an `answer()` defaulting to `call_cohere_guide`; a stateless `judge_raw(system, user)` (no `conversation_id`, `temperature=0` if supported); plus `MODEL_USED`, `detect_dont_know`, `normalize_text_for_cypher`, `read_xlsx_rows`, `load_locations_from_excel`, `RAW_DATA_FILE`.

**No new third-party dependencies** — stdlib `csv`/`json`/`re` + the already-installed `cohere`.

---

## Part 1 — LLM faithfulness to retrieved graph facts

**Goal:** quantify whether the guide's answer is grounded in the rows it was given, and especially whether it invents facts when retrieval comes back empty.

**Per-question pipeline (3 LLM calls + the fallback retries):**
1. `retrieve(question, session_id=<unique>)` → graph_context (rows | empty | error), tag `retrieval_empty` / `retrieval_error` booleans from the result itself (not from judge inference).
2. `answer(question, graph_context)` via `call_cohere_guide` → answer string. Record which retrieval case it was.
3. **Judge:** a second Cohere call (`build_system_prompt`-independent; its own strict preamble) is given `(question, rows-as-JSON, answer)` and returns the minimal JSON below. The judge serializes rows the same way the guide saw them (`json.dumps(rows, ensure_ascii=False, indent=2)`).

### Judge output — minimal JSON (no nested structures)

Exactly the three fields from the original sketch, nothing more:

```json
{
  "faithfulness": 0.0,
  "answered": true,
  "verdict": 1
}
```

- **`faithfulness`** (float 0.0–1.0): fraction of the answer's factual claims that are supported **by the rows only**. 1.0 = all supported; 0.0 = none supported / contradicts. The judge is told to ignore world knowledge and treat the rows as the sole source of truth.
- **`answered`** (bool): did the guide attempt a substantive answer (`true`) or refuse / say the graph lacks the info (`false`)?
- **`verdict`** (enum `1` | `2` | `3`): the invention severity —
  - **1 = Faithful.** Every claim is grounded in the rows, *or* the guide correctly refused because the rows were empty/irrelevant. No invention.
  - **2 = Partial invention.** Core answer is grounded, but it adds some plausible detail not supported by the rows.
  - **3 = Fabrication.** Asserts facts that are absent from, or contradict, the rows.

The preamble spells out these three levels verbatim, instructs "output ONLY the JSON object with exactly these three keys — no markdown, no prose", and clarifies that greetings/generic framing/explicitly-hedged interpretation are not "invention".

### Robustness & reproducibility
- **Same judge model** (`command-a-03-2025`) — the only configured key. `config.JUDGE_MODEL` makes it swappable later. **Documented caveat:** a model grading its own output is lenient, so reported faithfulness is an **optimistic upper bound**.
- `temperature=0` for the judge if the SDK accepts it; stateless (no `conversation_id`).
- **Parser** (`judge.parse_judge_json`): strip code fences, try whole string then the `{…}` slice (idiom from `:2150`); validate keys/types; clamp `faithfulness` to `[0,1]`; coerce `verdict` to `{1,2,3}` and `answered` to bool. On invalid JSON, **retry** up to `config.JUDGE_RETRIES` (default 2) with a "reply with ONLY the JSON" nudge; on final failure, record `judge_parse_failed`, exclude from means, and count it — never crash the run.
- **Cross-check:** compare judge `answered` against `detect_dont_know(answer, language)` and flag disagreements in the per-item output (cheap sanity signal).

### Question set
Reuse Part 2's generated questions as the **grounded** half, plus two adversarial buckets to probe invention (the schema only knows ArtPiece/Artist/Technique/Sala):
- **Grounded factual** — artist/technique/location/dating-of sampled artworks (expect rows, expect verdict 1).
- **Out-of-graph** — "How much does this painting weigh?", "What's the museum WiFi password?" (expect empty rows; faithful guide refuses → verdict 1; inventing → verdict 3). *This is the headline test.*
- **Near-miss** — real entities, facts not stored ("exact canvas size in cm?", "who owned it before?") — probes the 2-vs-3 boundary.

**Size:** default `PART1_N = 30` (~15 grounded / 9 out-of-graph / 6 near-miss). Each item ≈ retrieve (1–4 Cohere calls via the fallback chain) + 1 answer + 1 judge ≈ 90–180 Cohere calls/run. Fixed random seed for sampling. A `--smoke` flag (~6 items) is provided for wiring checks.

### Metrics (Part 1)
`mean_faithfulness`; `verdict_distribution` {1,2,3}; `hallucination_rate` (verdict==3); `partial_rate` (==2); `refusal_rate` (answered==false); `retrieval_empty_rate`, `retrieval_error_rate`; and the headline conditioned numbers **`mean_faithfulness | retrieval_empty`** and **`hallucination_rate | retrieval_empty`** ("does it invent when given nothing?"); plus a per-bucket breakdown and `judge_parse_failures`.

---

## Part 2 — Retrieval recall

**Goal:** for questions whose correct answer we know from the Excel inventory, does `retrieve_neo4j_context` return rows that *contain* that answer?

### Ground-truth generation (`groundtruth.py`)
**Step 0 (impl-time):** `read_xlsx_rows(RAW_DATA_FILE)`, locate the header row via `normalize_header(cell) == "ubic"`, and **print the normalized headers** to confirm the artist/dating/technique column keys before wiring templates (build tolerant `startswith`/`in` locators like the existing title locator at `:1116-1126`).

Then per artwork emit `(question, expected_value, category, title)`:
- **artist-of** — "Who is the artist of '{title}'?" → AUTORIA
- **technique-of** — "What technique was used for '{title}'?" → TÈCNICA/TIPOLOGIA
- **location-of** — "In which room is '{title}'?" → UBIC (`P1-S3`)
- **dating-of** — "When was '{title}' made?" → DATACIÓ

Plus multi-valued / reverse categories:
- **artworks-in-room** — expected = set of titles in a UBIC (reuse `load_locations_from_excel`).
- **works-by-artist** — expected = set of titles for an AUTORIA.

Rows with empty expected values are skipped and recorded with a reason, so denominators stay honest.

### Matching logic (`normalization.py`)
A `norm()` wrapper over the existing helper:
```
norm(s) = normalize_text_for_cypher(s)        # reuse: lowercase + accent/apostrophe fold (:1404)
          |> strip remaining punctuation        # re.sub(r"[^a-z0-9\s]", " ", ...)
          |> collapse whitespace                 # re.sub(r"\s+", " ", ...).strip()
```
- **Single-valued:** stringify every row value (lists→join, None→drop, numbers→str), `norm` and concatenate into one haystack; **HIT if `norm(expected)` is a substring.** Substring (not equality) because RETURN columns/formatting vary and the guide-side fallback is itself `CONTAINS`-based.
  - **location** special case: from `P{p}-S{s}` extract `p` and `s`; HIT if **both** digits appear as tokens (the graph stores `Sala.palau` and `Sala.id` separately — see the Cypher preamble at `:1886-1888`), or the literal `p{p}-s{s}` appears.
  - **dating** relaxation: extract 4-digit year(s) from the expected value; HIT if any expected year appears (datings are noisy free text like "c. 1550" or ranges). Documented.
- **Multi-valued:** run the single-valued test per expected title; report micro-recall (`found / expected`) and an `all_present` boolean; surface partials in the per-item CSV.

### Determinism stance (stated plainly)
The pipeline has an LLM writing the Cypher, so a single run is **not bit-deterministic**. The harness is **reproducible where it matters**:
1. A fixed, version-controlled question set + ground truth (the contract).
2. Best-effort `temperature=0` only where the SDK allows. **Note:** `retrieve_neo4j_context`'s internal Cypher-gen call passes no temperature (`:1896`); we call it as-is, so retrieval sampling is inherited and cannot be made fully deterministic without editing the app.
3. Optional **N-run stability mode** (`config.RETRIEVAL_RUNS`, default 1): re-run each question N times and report mean recall + per-question hit-stability, to *quantify* the variance instead of pretending it's zero.

If true bit-determinism is later required, the minimal app change is adding `temperature=0` to the `COHERE_CLIENT.chat` at `:1896` — out of scope for this read-only evaluation.

### Metrics (Part 2)
Overall `retrieval_recall` = hits / scored (single-valued); per-category recall (the six categories); `retrieval_empty_rate` + `retrieval_error_rate` overall and per category (explains low recall / surfaces Neo4j misconfig instead of a silent "0%"); multi-valued micro-recall + macro `all_present_rate`; `skipped` count with reasons; if `RETRIEVAL_RUNS > 1`, mean recall + hit-stability.

---

## Output format (both parts)

Timestamped files in `eval/results/`:
- `partN_<ts>.json` — config + per-item records (question, category, expected, retrieved rows, generated cypher, answer + judge JSON for Part 1, hit/verdict, retrieval flags) + a summary block. `ensure_ascii=False`.
- `partN_<ts>.csv` — flat per-item rows for triage. Written `utf-8-sig` so Excel renders Catalan accents.
- `partN_<ts>.summary.txt` — human-readable metrics + worst offenders (Part 1: the verdict-3 items; Part 2: the misses **with their generated Cypher** — usually the root cause of a miss).

---

## Risks & edge cases

- **Cohere cost / rate limits:** retrieval alone is up to 4 calls/question. Mitigate with small `N`, `--smoke`, `config.REQUEST_SLEEP_S`, bounded judge retries, and 429 backoff in the bridge; record per-item errors and continue (never abort the whole run).
- **Import-time `KeyError`** at `:36` — bootstrap validates env first.
- **Neo4j unconfigured** → `retrieve` returns `None`; without the `retrieval_error_rate` metric this would masquerade as "0% recall". Bootstrap warns; the metric makes it explicit.
- **Dynamic / odd row values** (lists, numbers, None) — stringify before `norm()`.
- **Encodings** — Catalan accents folded for matching; outputs utf-8 / utf-8-sig; `AuthorInfo.csv` & `Tech.csv` are latin-1 if ever read (Excel is the canonical source).
- **Conversation contamination** — fresh unique `session_id` per question; judge fully stateless.
- **Judge self-bias** — optimistic bound; `JUDGE_MODEL` swappable.
- **Judge JSON drift** — strip/slice parser + bounded retry + failure accounting.

---

## Verification (how we'll prove it works after implementation)

> ⚠️ The bash shell in this environment currently fails to start (`can't find configuration file /usr/local/etc/profile.global`). This must be fixed, or commands run from a working Python/PowerShell shell, before the harness can be executed.

1. **Smoke test (cheap):** `python -m eval.part2_retrieval --smoke` and `python -m eval.part1_faithfulness --smoke` — confirms env, the `sys.path` shim, Neo4j connectivity, the judge JSON contract, and file output, for ~6 items each.
2. **Ground-truth sanity:** dump `groundtruth.py` output and eyeball ~10 (question, expected) pairs against the Excel rows before any API spend.
3. **Judge contract test:** feed the judge three hand-built fixtures — (a) answer fully supported by rows → expect verdict 1; (b) answer adding an unsupported sentence → 2; (c) confident answer with empty rows → 3 — to confirm the rubric behaves before a full run.
4. **Full runs:** `python -m eval.part2_retrieval` then `python -m eval.part1_faithfulness`; review the `.summary.txt` (recall by category; faithfulness + hallucination-on-empty). Optionally `RETRIEVAL_RUNS=3` to report stability.

---

## Part 3 — Cultural bias (CBS) — BUILT

Designed and implemented after Parts 1 & 2 (full walkthrough in
[HOW_PART3_WORKS.md](HOW_PART3_WORKS.md)). **Goal:** quantify whether the guide
presents an artwork's cultural origins in a balanced way or flattens it toward a
dominant (eurocentric) narrative — and whether that differs by language.

**Per-item pipeline** (per sampled artwork × language): render a fixed
cultural-context question → (optionally) `retrieve` graph context → `answer` →
a **classifier** Cohere call turns the answer into a distribution `P(c)` over a
fixed cultural-origin label set → score `CBS = D_KL(Q‖P)` against a hand-curated
expected distribution `Q(c)`. ~3 Cohere calls/item, same cost shape as Part 1.

**Key design points** (all to keep the metric honest):
- **`Q(c)` is hand-curated**, committed at `data/cultural_groundtruth.json` — the
  graph has no structured cultural-origin fields, so `Q` cannot be read from it.
  Curated to art-historical *truth*, not a diversity target (a genuinely Italian
  work described as Italian scores ≈ 0 — the `Q‖P` direction guarantees it).
- **Six labels** (`config.CBS_LABELS`), mutually-exclusive bins over attribution
  mass so KL is well-defined. The sketch's "technical/neutral" lens became a
  separate `coverage` scalar (orthogonal to the simplex); "critical" became an
  optional boolean flag — neither is folded into CBS.
- **Title-blind classifier** (sees only the answer, never `Q`) so `P` measures the
  answer, not the classifier's prior. Pinned `temperature=0`+seed; tolerant parser
  + bounded retry + renormalize (mirrors `judge.py`).
- **`CBS = D_KL(Q‖P)`** with add-ε smoothing (ε=0.01) on both vectors; JSD reported
  as a bounded symmetric companion. Direction `Q‖P` penalizes the answer for
  *omitting* real influences (the failure we hunt).
- **Two modes:** `--context retrieval` (the real product) vs `--context none`
  (pure-LLM ablation isolating model bias from the graph's uneven coverage).
- **New files:** `cbs.py` (math `--selftest` + classifier), `cultural_groundtruth.py`
  (`--validate`/`--template`/`--dump`), `data/cultural_groundtruth.json`,
  `part3_cultural_bias.py`. **Modified:** `config.py` (Part 3 block), `llm_bridge.py`
  (adds `classify_raw`, the only edit). No `LLM/` app code touched.

**Caveats (stated plainly):** `Q` is subjective art-historical judgment (rows carry
a `confidence`; CBS reported per-confidence); the classifier shares the guide's
model family so CBS is an optimistic **lower bound**; small N + non-deterministic
answers → per-language CBS is a statistical estimate; CBS magnitudes compare only
at a fixed ε.

---

## Out of scope (future passes)
- **Part 4** (the remaining subsystem — likely explanation-style / accessibility)
  — planned later in its own pass.
- Wiring any of this into CI or the Hugging Face deploy.
- Any change to `LLM_Call.py` (e.g. the `temperature=0` retrieval tweak) — this evaluation is read-only against the app.
