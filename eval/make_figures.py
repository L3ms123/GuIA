"""Generate the evaluation figures for the two GuIA papers.

Reads the real result JSONs in eval/results/ and writes publication-ready PNGs
to eval/figures/. Reproducible: re-run after a new eval run to refresh them.

    python -m eval.make_figures

Figures
-------
Paper A (technical, four-component evaluation):
  A1  faithfulness_by_bucket.png   — mean faithfulness + hallucination rate per
                                      question bucket (grounded / out-of-graph /
                                      near-miss): the headline Part 1 result.
  A2  prompt_sensitivity.png       — Part 4 sensitivity ratio per prompt axis vs
                                      the run-to-run noise floor.
  A3  prompt_sensitivity_by_lang.png — Part 4 sensitivity ratio per axis grouped
                                      by language (the effect ordering is stable
                                      across en/es/ca).
  A4  verdicts_by_language.png     — Part 1 verdict mix (faithful / partial /
                                      fabrication) per language (multilingual
                                      consistency).

Paper B (social innovation / accessibility):
  B1  cultural_gap.png             — Part 3 mean attribution gap P(c)-Q(c) per
                                      cultural origin (the eurocentric fingerprint).
  B2  retrieval_recall.png         — Part 2 retrieval recall per fact category.
  B3  cbs_by_origin.png            — Part 3 Cultural Bias Score per artist origin
                                      (non-Italian works are flattened more).
  B4  cbs_by_language.png          — Part 3 CBS per language, raw vs excluding
                                      content-free refusals (multilingual ≠ fair).
"""
from __future__ import annotations

import glob
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
FIGDIR = os.path.join(HERE, "figures")

# Muted, print-friendly palette (no reliance on colour alone — see hatches/labels).
NAVY = "#2f4b7c"
TEAL = "#3c8d8d"
RUST = "#a05a2c"
GREY = "#9aa0a6"
RED = "#c0392b"
GREEN = "#2e7d52"


def _latest(part: str) -> dict:
    files = sorted(glob.glob(os.path.join(RESULTS, f"{part}_*.json")))
    if not files:
        raise FileNotFoundError(f"no results for {part} in {RESULTS}")
    # Prefer the largest run (full over smoke), then most recent.
    def nitems(f):
        try:
            return len(json.load(open(f, encoding="utf-8")).get("items", []))
        except Exception:
            return 0
    files.sort(key=lambda f: (nitems(f), f))
    return json.load(open(files[-1], encoding="utf-8"))


def _save(fig, name: str) -> None:
    os.makedirs(FIGDIR, exist_ok=True)
    path = os.path.join(FIGDIR, name)
    fig.savefig(path, dpi=200, bbox_inches="tight")
    fig.savefig(path.replace(".png", ".pdf"), bbox_inches="tight")  # vector for LaTeX
    plt.close(fig)
    print(f"  wrote {os.path.relpath(path, HERE)} (+ .pdf)")


# --- A1 — Part 1 faithfulness by question bucket ----------------------------
def fig_faithfulness_by_bucket() -> None:
    s = _latest("part1")["summary"]
    bk = s["by_bucket"]
    order = ["grounded", "out_of_graph", "near_miss"]
    labels = ["Grounded", "Out-of-graph", "Near-miss\n(adversarial)"]
    faith = [bk[b]["mean_faithfulness"] for b in order]
    halluc = [bk[b]["hallucination_rate"] for b in order]
    ns = [bk[b]["n"] for b in order]

    fig, ax1 = plt.subplots(figsize=(6.4, 3.8))
    x = range(len(order))
    bars = ax1.bar(x, faith, width=0.6, color=NAVY, label="Mean faithfulness")
    ax1.set_ylabel("Mean faithfulness", color=NAVY)
    ax1.set_ylim(0, 1.05)
    ax1.tick_params(axis="y", labelcolor=NAVY)
    ax1.set_xticks(list(x))
    ax1.set_xticklabels([f"{l}\n(n={n})" for l, n in zip(labels, ns)])
    for b, v in zip(bars, faith):
        ax1.text(b.get_x() + b.get_width() / 2, v + 0.015, f"{v:.2f}",
                 ha="center", va="bottom", fontsize=9, color=NAVY)

    ax2 = ax1.twinx()
    line = ax2.plot(list(x), halluc, "o-", color=RED, label="Hallucination rate")
    ax2.set_ylabel("Hallucination (fabrication) rate", color=RED)
    ax2.set_ylim(0, max(0.2, max(halluc) * 1.4))
    ax2.tick_params(axis="y", labelcolor=RED)
    for xi, v in zip(x, halluc):
        ax2.text(xi, v + 0.006, f"{v:.0%}", ha="center", va="bottom", fontsize=9, color=RED)

    ax1.set_title("Generation faithfulness by question type (90 items, en/es/ca)")
    handles = [bars, line[0]]
    # Anchor below the axes so it never overlaps the bars or the rate markers.
    ax1.legend(handles, ["Mean faithfulness", "Hallucination rate"],
               loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=2,
               fontsize=8, framealpha=0.9)
    fig.tight_layout()
    _save(fig, "faithfulness_by_bucket.png")


# --- A2 — Part 4 prompt sensitivity ratio per axis --------------------------
def fig_prompt_sensitivity() -> None:
    s = _latest("part4")["summary"]
    by = s["by_axis"]
    nf = s["noise_floor"]["baseline_within_mean"]
    order = ["fewshot", "persona", "rag_position"]
    names = ["Few-shot\nexamples", "Guide style\n(explorer→scholar)", "RAG block\nposition"]
    kinds = [by[a]["kind"] for a in order]
    ratios = [by[a]["mean_ratio"] for a in order]
    stds = [by[a]["std_ratio"] for a in order]
    # Colour by kind: robustness vs semantic.
    colors = [TEAL if by[a]["kind"] == "robustness" else RUST for a in order]

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    x = range(len(order))
    bars = ax.bar(x, ratios, yerr=stds, width=0.6, color=colors,
                  capsize=4, error_kw={"ecolor": GREY, "elinewidth": 1.2})
    ax.axhline(1.0, color="black", ls="--", lw=1, label="ratio = 1 (no effect beyond noise)")
    ax.set_xticks(list(x))
    ax.set_xticklabels(names)
    ax.set_ylabel("Sensitivity ratio  (between / within)")
    ax.set_ylim(0, max(ratios) + max(stds) + 0.6)
    for b, r, k in zip(bars, ratios, kinds):
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.05, f"{r:.2f}",
                ha="center", va="bottom", fontsize=9)

    # legend for the two axis kinds
    from matplotlib.patches import Patch
    legend = [
        Patch(facecolor=TEAL, label="Robustness axis (want ≈ 1)"),
        Patch(facecolor=RUST, label="Semantic axis (want ≫ 1)"),
    ]
    handles, labs = ax.get_legend_handles_labels()
    ax.legend(handles=legend + handles, loc="upper right", fontsize=8, framealpha=0.9)
    ax.set_title(f"Prompt sensitivity per axis (noise floor = {nf:.2f}; 12 items × 3 langs × 3 runs)")
    fig.tight_layout()
    _save(fig, "prompt_sensitivity.png")


# --- B1 — Part 3 cultural attribution gap (eurocentric fingerprint) ---------
def fig_cultural_gap() -> None:
    s = _latest("part3")["summary"]
    gap = s["mean_gap"]
    order = ["italian_western", "iberian_local", "northern_flemish",
             "byzantine_eastern", "islamic_mediterranean", "other_global"]
    labels = ["Italian /\nWestern", "Iberian /\nlocal", "Northern /\nFlemish",
              "Byzantine /\nEastern", "Islamic /\nMediterr.", "Other /\nglobal"]
    vals = [gap[k] for k in order]
    colors = [RED if v > 0 else NAVY for v in vals]

    fig, ax = plt.subplots(figsize=(6.6, 3.8))
    x = range(len(order))
    bars = ax.bar(x, vals, width=0.62, color=colors)
    ax.axhline(0, color="black", lw=1)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylabel("Mean attribution gap  P(c) − Q(c)")
    pad = max(abs(v) for v in vals) * 0.18
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + (pad if v >= 0 else -pad),
                f"{v:+.2f}", ha="center", va="bottom" if v >= 0 else "top", fontsize=9)
    ax.set_ylim(min(vals) - 0.18, max(vals) + 0.18)

    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(facecolor=RED, label="over-attributed (>0)"),
                       Patch(facecolor=NAVY, label="under-attributed / omitted (<0)")],
              loc="lower right", fontsize=8, framealpha=0.95)
    ax.set_title("Cultural attribution gap per origin (60 items; pure-LLM, no retrieval)")
    fig.tight_layout()
    _save(fig, "cultural_gap.png")


# --- B2 — Part 2 retrieval recall per category ------------------------------
def fig_retrieval_recall() -> None:
    s = _latest("part2")["summary"]
    cat = s["by_category"]
    order = ["artist-of", "technique-of", "dating-of", "location-of"]
    labels = ["Author", "Technique", "Dating", "Room\nlocation"]
    # Single-valued categories use retrieval_recall; keep only those present.
    order = [c for c in order if c in cat]
    labels = labels[:len(order)]
    recall = [cat[c]["retrieval_recall"] for c in order]
    ns = [cat[c]["n_single"] for c in order]

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    x = range(len(order))
    bars = ax.bar(x, recall, width=0.6, color=TEAL)
    ax.set_ylim(0, 1.08)
    ax.set_ylabel("Retrieval recall")
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"{l}\n(n={n})" for l, n in zip(labels, ns)])
    for b, v in zip(bars, recall):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.015, f"{v:.0%}",
                ha="center", va="bottom", fontsize=9)
    # overall single-valued recall line
    overall = s.get("retrieval_recall")
    if overall is not None:
        ax.axhline(overall, color=RUST, ls="--", lw=1.2,
                   label=f"overall = {overall:.0%}")
        ax.legend(loc="lower left", fontsize=8, framealpha=0.9)
    ax.set_title("Retrieval recall by fact category (single-valued, 144 items, en/es/ca)")
    fig.tight_layout()
    _save(fig, "retrieval_recall.png")


# --- A3 — Part 4 sensitivity ratio per axis, grouped by language ------------
def fig_prompt_sensitivity_by_lang() -> None:
    s = _latest("part4")["summary"]
    by_lang = s["by_language"]
    nf = s["noise_floor"]["baseline_within_mean"]
    axes_order = ["fewshot", "persona", "rag_position"]
    axis_labels = ["Few-shot", "Guide style", "RAG position"]
    langs = [l for l in ("en", "es", "ca") if l in by_lang]
    lang_labels = {"en": "English", "es": "Spanish", "ca": "Catalan"}
    lang_colors = {"en": NAVY, "es": TEAL, "ca": RUST}

    fig, ax = plt.subplots(figsize=(6.6, 3.8))
    n_lang = len(langs)
    group_w = 0.8
    bar_w = group_w / n_lang
    base_x = list(range(len(axes_order)))
    for j, lang in enumerate(langs):
        offs = [bx - group_w / 2 + bar_w * (j + 0.5) for bx in base_x]
        vals = [by_lang[lang][a]["mean_ratio"] for a in axes_order]
        ax.bar(offs, vals, width=bar_w, color=lang_colors[lang], label=lang_labels[lang])
        for xi, v in zip(offs, vals):
            ax.text(xi, v + 0.04, f"{v:.1f}", ha="center", va="bottom", fontsize=7.5)

    ax.axhline(1.0, color="black", ls="--", lw=1, label="ratio = 1")
    ax.set_xticks(base_x)
    ax.set_xticklabels(axis_labels)
    ax.set_ylabel("Sensitivity ratio  (between / within)")
    allv = [by_lang[l][a]["mean_ratio"] for l in langs for a in axes_order]
    ax.set_ylim(0, max(allv) + 0.5)
    ax.legend(loc="upper right", fontsize=8, framealpha=0.9, ncol=2)
    ax.set_title(f"Prompt sensitivity per axis, by language (noise floor = {nf:.2f})")
    fig.tight_layout()
    _save(fig, "prompt_sensitivity_by_lang.png")


# --- A4 — Part 1 verdict distribution per language --------------------------
def fig_verdicts_by_language() -> None:
    s = _latest("part1")["summary"]
    by = s["by_language"]
    langs = [l for l in ("en", "es", "ca") if l in by]
    lang_labels = {"en": "English", "es": "Spanish", "ca": "Catalan"}
    # verdict 1 = faithful, 2 = partial invention, 3 = fabrication
    faithful, partial, fab = [], [], []
    for l in langs:
        vd = by[l]["verdict_distribution"]
        tot = sum(vd.get(str(k), 0) for k in (1, 2, 3)) or 1
        faithful.append(100 * vd.get("1", 0) / tot)
        partial.append(100 * vd.get("2", 0) / tot)
        fab.append(100 * vd.get("3", 0) / tot)

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    x = range(len(langs))
    b1 = ax.bar(x, faithful, color=GREEN, label="Faithful (verdict 1)")
    b2 = ax.bar(x, partial, bottom=faithful, color=GREY, label="Partial invention (2)")
    bottom2 = [f + p for f, p in zip(faithful, partial)]
    b3 = ax.bar(x, fab, bottom=bottom2, color=RED, label="Fabrication (3)")
    ax.set_xticks(list(x))
    ax.set_xticklabels([lang_labels[l] for l in langs])
    ax.set_ylabel("Share of judged answers (%)")
    ax.set_ylim(0, 108)
    for xi, f in zip(x, faithful):
        ax.text(xi, f - 5, f"{f:.0f}%", ha="center", va="top", fontsize=9, color="white")
    # annotate the small partial / fabrication slices above each bar
    for xi, p, fb in zip(x, partial, fab):
        ax.text(xi, 102, f"partial {p:.0f}% / fab {fb:.0f}%", ha="center", va="bottom",
                fontsize=7.5, color="#444")
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.30), ncol=3, fontsize=8, framealpha=0.9)
    ax.set_title("Faithfulness verdict mix by language (30 items each; partial%/fab% above)")
    fig.tight_layout()
    _save(fig, "verdicts_by_language.png")


# --- B3 — Part 3 CBS per artist origin (raw vs excl. refusals) --------------
def fig_cbs_by_origin() -> None:
    s = _latest("part3")["summary"]
    bo = s["by_artist_origin"]
    order = sorted(bo.keys(), key=lambda k: bo[k]["mean_CBS"])
    labels = [o.capitalize() for o in order]
    raw = [bo[o]["mean_CBS"] for o in order]
    excl = [bo[o]["mean_CBS_excl_low_coverage"] for o in order]

    fig, ax = plt.subplots(figsize=(6.6, 3.8))
    x = range(len(order))
    w = 0.4
    b1 = ax.bar([i - w / 2 for i in x], raw, width=w, color=GREY, label="Raw (incl. refusals)")
    b2 = ax.bar([i + w / 2 for i in x], excl, width=w, color=NAVY,
                label="Excl. content-free refusals")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("Cultural Bias Score  (D$_{KL}$(Q‖P), nats)")
    ax.set_ylim(0, max(raw) + 0.5)
    for i in x:
        ax.text(i - w / 2, raw[i] + 0.04, f"{raw[i]:.1f}", ha="center", va="bottom", fontsize=7.5)
        ax.text(i + w / 2, excl[i] + 0.04, f"{excl[i]:.1f}", ha="center", va="bottom", fontsize=7.5)
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    ax.set_title("Cultural Bias Score by artist origin (lower = more balanced; 60 items)")
    fig.tight_layout()
    _save(fig, "cbs_by_origin.png")


# --- B4 — Part 3 CBS per language (raw vs excl. refusals) -------------------
def fig_cbs_by_language() -> None:
    s = _latest("part3")["summary"]
    bl = s["by_language"]
    langs = [l for l in ("en", "es", "ca") if l in bl]
    lang_labels = {"en": "English", "es": "Spanish", "ca": "Catalan"}
    raw = [bl[l]["mean_CBS"] for l in langs]
    excl = [bl[l]["mean_CBS_excl_low_coverage"] for l in langs]
    lowcov = [bl[l].get("low_coverage_rate", 0) for l in langs]

    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    x = range(len(langs))
    w = 0.4
    ax.bar([i - w / 2 for i in x], raw, width=w, color=GREY, label="Raw (incl. refusals)")
    ax.bar([i + w / 2 for i in x], excl, width=w, color=TEAL, label="Excl. content-free refusals")
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"{lang_labels[l]}\n(refusals {lc:.0%})" for l, lc in zip(langs, lowcov)])
    ax.set_ylabel("Cultural Bias Score  (D$_{KL}$(Q‖P), nats)")
    ax.set_ylim(0, max(raw) + 0.5)
    for i in x:
        ax.text(i - w / 2, raw[i] + 0.04, f"{raw[i]:.1f}", ha="center", va="bottom", fontsize=8)
        ax.text(i + w / 2, excl[i] + 0.04, f"{excl[i]:.1f}", ha="center", va="bottom", fontsize=8)
    ax.legend(loc="upper right", fontsize=8, framealpha=0.9)
    ax.set_title("Cultural Bias Score by language: raw vs. content-only (60 items)")
    fig.tight_layout()
    _save(fig, "cbs_by_language.png")


def main() -> int:
    print("[figures] Paper A (technical):")
    fig_faithfulness_by_bucket()
    fig_prompt_sensitivity()
    fig_prompt_sensitivity_by_lang()
    fig_verdicts_by_language()
    print("[figures] Paper B (social innovation):")
    fig_cultural_gap()
    fig_retrieval_recall()
    fig_cbs_by_origin()
    fig_cbs_by_language()
    print(f"[figures] done -> {os.path.relpath(FIGDIR, HERE)}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
