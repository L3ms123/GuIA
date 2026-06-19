"""Deterministic question/answer ground truth built from the Excel inventory.

Source of truth: ``raw_data/2026_obres_Museu_del_Renaixement.xlsx`` (72 artworks).
The knowledge graph was built from this very file (see ``KG/kg.ipynb``), which
maps the raw Catalan headers to ArtPiece properties:

    UBIC.                -> room / Sala (e.g. "P1-S3")
    TÍTOL / DESCRIPCIÓ   -> ArtPiece.title
    AUTORIA              -> ArtPiece.artist
    DATACIÓ              -> ArtPiece.dating
    TÈCNICA / TIPOLOGIA  -> ArtPiece.technique

After ``normalize_header`` (lowercase -> fold accents -> strip non-alphanumeric)
those become the tokens we locate columns by: ``ubic``, ``titoldescripcio``
(startswith ``titol``), ``autoria``, ``datacio``, ``tecnicatipologia``
(startswith ``tecnica`` — NOT ``== "tecnica"``, the slash+TIPOLOGIA concatenate).

This module is intentionally **self-contained and network-free**: it inlines
verbatim copies of the two pure stdlib helpers from ``LLM_Call`` rather than
importing the backend, so the question set can be dumped and eyeballed with no
Cohere key and no Neo4j — the "ground-truth sanity before API spend" step.

Honesty rules baked in (denominators stay truthful):
* Cells that are empty after strip are skipped, recorded with a reason.
* The graph MERGEs ArtPiece by title, so a title that appears on more than one
  inventory row collapses to a single node with ambiguous artist/dating/etc.
  We skip such duplicate titles for the per-artwork single-valued questions
  (recorded with reason ``duplicate_title``) so each expected value is unambiguous.
* "Works by artist" skips anonymous authors (``Anònim``) — grouping every
  anonymous work under one "artist" is not a meaningful question.

Run ``python -m eval.groundtruth --dump`` to print header diagnostics, per-category
counts, skip reasons, and a sample of (question, expected) pairs.
"""
from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ._bootstrap import REPO_ROOT

RAW_DATA_FILE = REPO_ROOT / "raw_data" / "2026_obres_Museu_del_Renaixement.xlsx"
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


# --- Verbatim copies of pure stdlib helpers from LLM_Call -------------------
# Kept in sync intentionally; duplicated (not imported) so this module needs no
# Cohere key / network. Sources: LLM_Call.excel_column_index (:972),
# read_xlsx_rows (:983), normalize_header (:953).
def excel_column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "")
    if not letters:
        return 0
    index = 0
    for char in letters.group(0):
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def read_xlsx_rows(path: Path) -> list[list[str]]:
    """Read the first worksheet of an .xlsx using only the standard library."""
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", XLSX_NS):
                shared_strings.append(
                    "".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS))
                )

        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows: list[list[str]] = []
        for row in sheet.findall(".//a:row", XLSX_NS):
            values: list[str] = []
            for cell in row.findall("a:c", XLSX_NS):
                index = excel_column_index(cell.get("r", ""))
                while len(values) <= index:
                    values.append("")
                value_node = cell.find("a:v", XLSX_NS)
                inline_node = cell.find("a:is", XLSX_NS)
                if cell.get("t") == "s" and value_node is not None:
                    values[index] = shared_strings[int(value_node.text)]
                elif inline_node is not None:
                    values[index] = "".join(
                        text.text or "" for text in inline_node.findall(".//a:t", XLSX_NS)
                    )
                elif value_node is not None:
                    values[index] = value_node.text or ""
            rows.append(values)
    return rows


def normalize_header(value: str) -> str:
    normalized = value.strip().lower()
    for source, target in {
        "à": "a", "á": "a", "è": "e", "é": "e", "í": "i", "ï": "i",
        "ò": "o", "ó": "o", "ú": "u", "ü": "u", "ç": "c",
    }.items():
        normalized = normalized.replace(source, target)
    return re.sub(r"[^a-z0-9]+", "", normalized)


# --- Data model -------------------------------------------------------------
SINGLE_VALUED = ("artist-of", "technique-of", "location-of", "dating-of")
MULTI_VALUED = ("artworks-in-room", "works-by-artist")


@dataclass
class GroundTruthItem:
    """A language-neutral ground-truth fact. The question text is rendered per
    language on demand via ``question_in`` / ``render_question`` so the same item
    can be asked in en/es/ca."""
    category: str
    expected: Any            # str (single-valued) or list[str] (multi-valued)
    title: str = ""          # artwork the question pivots on, when applicable
    room: str = ""           # UBIC, when applicable
    artist: str = ""         # artist, when applicable
    multi_valued: bool = False

    def question_in(self, lang: str) -> str:
        return render_question(
            self.category, lang, title=self.title, room=self.room, artist=self.artist
        )

    def to_record(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "expected": self.expected,
            "title": self.title,
            "room": self.room,
            "artist": self.artist,
            "multi_valued": self.multi_valued,
        }


@dataclass
class Skipped:
    category: str
    subject: str
    reason: str


@dataclass
class Inventory:
    header_index: int
    headers: list[str]                  # normalized header tokens
    columns: dict[str, Optional[int]]   # role -> column index (or None if absent)
    data_rows: list[list[str]]          # rows after the header row


# --- Inventory parsing ------------------------------------------------------
def _locate_columns(headers: list[str]) -> dict[str, Optional[int]]:
    """Map roles to column indices using the verified tolerant locators."""
    def first(pred) -> Optional[int]:
        return next((i for i, h in enumerate(headers) if pred(h)), None)

    return {
        "title": first(lambda h: h.startswith("titol") or h.startswith("title")),
        "location": first(lambda h: h == "ubic"),
        "artist": first(lambda h: h.startswith("autoria")),
        "dating": first(lambda h: h.startswith("datacio")),
        # "TÈCNICA / TIPOLOGIA" normalizes to the single token "tecnicatipologia",
        # so a `== "tecnica"` check would silently miss it. startswith is required.
        "technique": first(lambda h: h.startswith("tecnica") or "tipologia" in h),
        "description": first(lambda h: h == "description"),
    }


def load_inventory(path: Path = RAW_DATA_FILE) -> Inventory:
    """Parse the xlsx into a header-aware Inventory. Raises if structure is unexpected."""
    if not path.exists():
        raise FileNotFoundError(f"Inventory file not found: {path}")

    rows = read_xlsx_rows(path)
    # The real header row is the one containing a cell normalizing to "ubic"
    # (row 0 is a title banner — mirrors load_locations_from_excel's approach).
    header_index = next(
        (i for i, row in enumerate(rows) if any(normalize_header(c) == "ubic" for c in row)),
        None,
    )
    if header_index is None:
        raise ValueError(
            "Could not find the header row (no cell normalizes to 'ubic'). "
            "The inventory layout may have changed."
        )

    headers = [normalize_header(c) for c in rows[header_index]]
    columns = _locate_columns(headers)
    if columns["title"] is None or columns["location"] is None:
        raise ValueError(
            f"Missing essential columns. Found headers: {headers}. "
            f"Need a title column (startswith 'titol') and a location column (== 'ubic')."
        )
    return Inventory(
        header_index=header_index,
        headers=headers,
        columns=columns,
        data_rows=rows[header_index + 1:],
    )


def _cell(row: list[str], idx: Optional[int]) -> str:
    """Length-guarded cell access (rows are ragged); '' when absent/short."""
    if idx is None or idx < 0 or len(row) <= idx:
        return ""
    return (row[idx] or "").strip()


def _is_anonymous(artist: str) -> bool:
    return "anonim" in normalize_header(artist)


# --- Ground-truth construction ----------------------------------------------
# Per-language question templates. The same sampled item is rendered in each
# language so the buckets stay directly comparable across en/es/ca.
#
# NOTE on the multi-valued templates ("artworks-in-room", "works-by-artist"):
# they deliberately ask for *all* / *the complete list*. This is the honest
# natural-language form of a "which works are…?" question, AND it is LOAD-BEARING
# for Part 2 recall: clean_graph_rows (LLM_Call:1656) caps retrieval at 5 rows
# unless the message trips user_asked_for_all (:1625) — whose trigger words are
# "all"/"every"/"complete list"/"full list"/"todas"/"todos"/"llista completa"/
# "lista completa". Each multi-valued template below contains one of those, so
# rooms/artists with >5 works are not silently truncated to a 5-row ceiling.
_TEMPLATES = {
    "en": {
        "artist-of": "Who created the artwork titled '{title}'?",
        "technique-of": "What technique or material was used to make '{title}'?",
        "location-of": "In which room of the museum is '{title}' displayed?",
        "dating-of": "When was '{title}' made?",
        "artworks-in-room": "List all the artworks displayed in room {room}.",
        "works-by-artist": "List all the artworks in the museum that were created by {artist}.",
    },
    "es": {
        "artist-of": "¿Quién creó la obra titulada '{title}'?",
        "technique-of": "¿Qué técnica o material se utilizó para realizar '{title}'?",
        "location-of": "¿En qué sala del museo se expone '{title}'?",
        "dating-of": "¿Cuándo se realizó '{title}'?",
        "artworks-in-room": "Enumera todas las obras que se exponen en la sala {room}.",
        "works-by-artist": "Enumera todas las obras del museo que fueron creadas por {artist}.",
    },
    "ca": {
        "artist-of": "Qui va crear l'obra titulada '{title}'?",
        "technique-of": "Quina tècnica o material es va utilitzar per fer '{title}'?",
        "location-of": "En quina sala del museu s'exposa '{title}'?",
        "dating-of": "Quan es va fer '{title}'?",
        "artworks-in-room": "Dóna'm la llista completa de les obres exposades a la sala {room}.",
        "works-by-artist": "Dóna'm la llista completa de les obres del museu creades per {artist}.",
    },
}


def render_question(category: str, lang: str, *, title: str = "", room: str = "", artist: str = "") -> str:
    """Render a grounded question in the target language (falls back to English)."""
    table = _TEMPLATES.get(lang) or _TEMPLATES["en"]
    template = table.get(category) or _TEMPLATES["en"][category]
    return template.format(title=title, room=room, artist=artist)

# category -> key in the per-row `fact` dict below. NOTE: location-of maps to
# "room" (not "location") because the UBIC is stored under fact["room"] — the
# graph itself treats UBIC as the room (LLM_Call.load_locations_from_excel:1135).
_SINGLE_SPEC = {
    "artist-of": "artist",
    "technique-of": "technique",
    "location-of": "room",
    "dating-of": "dating",
}


def build_groundtruth(path: Path = RAW_DATA_FILE) -> tuple[list[GroundTruthItem], list[Skipped]]:
    """Build the deterministic (question, expected, category, ...) set.

    Returns (items, skipped). Order is deterministic (inventory order), so a
    fixed-seed sample downstream is reproducible.
    """
    inv = load_inventory(path)
    cols = inv.columns
    items: list[GroundTruthItem] = []
    skipped: list[Skipped] = []

    # Pass 1: gather per-row facts and detect duplicate titles.
    title_counts: Counter[str] = Counter()
    by_room: dict[str, list[str]] = defaultdict(list)
    by_artist: dict[str, list[str]] = defaultdict(list)
    parsed_rows: list[dict[str, str]] = []
    for row in inv.data_rows:
        title = _cell(row, cols["title"])
        room = _cell(row, cols["location"])
        if not title or not room:
            continue  # not a real artwork row
        fact = {
            "title": title,
            "room": room,
            "artist": _cell(row, cols["artist"]),
            "dating": _cell(row, cols["dating"]),
            "technique": _cell(row, cols["technique"]),
        }
        parsed_rows.append(fact)
        title_counts[title] += 1
        if title not in by_room[room]:
            by_room[room].append(title)
        if fact["artist"] and not _is_anonymous(fact["artist"]):
            if title not in by_artist[fact["artist"]]:
                by_artist[fact["artist"]].append(title)

    # Pass 2: single-valued per-artwork questions (unique, non-empty cells only).
    seen_single_dupe: set[str] = set()
    for fact in parsed_rows:
        title = fact["title"]
        if title_counts[title] > 1:
            if title not in seen_single_dupe:
                seen_single_dupe.add(title)
                skipped.append(Skipped("per-artwork", title, "duplicate_title"))
            continue
        for category, role in _SINGLE_SPEC.items():
            value = fact[role]
            if not value:
                skipped.append(Skipped(category, title, "empty_expected"))
                continue
            items.append(
                GroundTruthItem(
                    category=category,
                    expected=value,
                    title=title,
                    room=fact["room"],  # always the UBIC; for location-of this == expected
                    artist=fact["artist"],
                )
            )

    # Pass 3: multi-valued reverse questions.
    for room, titles in by_room.items():
        items.append(
            GroundTruthItem(
                category="artworks-in-room",
                expected=list(titles),
                room=room,
                multi_valued=True,
            )
        )
    for artist, titles in by_artist.items():
        items.append(
            GroundTruthItem(
                category="works-by-artist",
                expected=list(titles),
                artist=artist,
                multi_valued=True,
            )
        )

    return items, skipped


def single_valued(items: list[GroundTruthItem]) -> list[GroundTruthItem]:
    return [it for it in items if it.category in SINGLE_VALUED]


def by_category(items: list[GroundTruthItem]) -> dict[str, list[GroundTruthItem]]:
    out: dict[str, list[GroundTruthItem]] = defaultdict(list)
    for it in items:
        out[it.category].append(it)
    return out


# --- CLI: network-free inspection -------------------------------------------
def _dump(sample: int) -> None:
    inv = load_inventory()
    print("=" * 72)
    print("GROUND-TRUTH DUMP (network-free; no Cohere/Neo4j needed)")
    print("=" * 72)
    print(f"Inventory file : {RAW_DATA_FILE}")
    print(f"Header row idx : {inv.header_index}")
    print(f"Data rows      : {len(inv.data_rows)}")
    print("\nNormalized headers (index: token):")
    for i, h in enumerate(inv.headers):
        print(f"  {i:>2}: {h!r}")
    print("\nLocated columns (role -> index -> header token):")
    for role, idx in inv.columns.items():
        token = inv.headers[idx] if idx is not None and idx < len(inv.headers) else None
        marker = "" if idx is not None else "   <-- NOT FOUND"
        print(f"  {role:<12} -> {idx}{'' if idx is None else f' ({token!r})'}{marker}")

    items, skipped = build_groundtruth()
    cats = by_category(items)
    print("\nQuestions per category:")
    for cat in SINGLE_VALUED + MULTI_VALUED:
        print(f"  {cat:<18}: {len(cats.get(cat, []))}")
    print(f"  {'TOTAL':<18}: {len(items)}")

    skip_reasons = Counter(s.reason for s in skipped)
    print("\nSkipped (with reasons):")
    for reason, count in skip_reasons.most_common():
        print(f"  {reason:<18}: {count}")

    print(f"\nSample of {sample} single-valued (English question -> expected):")
    sv = single_valued(items)
    step = max(1, len(sv) // sample) if sv else 1
    for it in sv[::step][:sample]:
        print(f"  [{it.category}] {it.question_in('en')}")
        print(f"       expected: {it.expected!r}  (title={it.title!r})")

    mv = [it for it in items if it.multi_valued]
    print(f"\nSample of up to 3 multi-valued:")
    for it in mv[:3]:
        exp = it.expected if isinstance(it.expected, list) else [it.expected]
        print(f"  [{it.category}] {it.question_in('en')}")
        print(f"       expected ({len(exp)} titles): {exp[:5]}{' ...' if len(exp) > 5 else ''}")

    print("\nTranslation check (same item rendered in each language):")
    for it in sv[:2]:
        print(f"  [{it.category}] title={it.title!r}")
        for lang in ("en", "es", "ca"):
            print(f"       {lang}: {it.question_in(lang)}")
    print("=" * 72)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect the deterministic ground-truth set.")
    parser.add_argument("--dump", action="store_true", help="print headers, counts, and sample pairs")
    parser.add_argument("--sample", type=int, default=12, help="how many single-valued pairs to show")
    args = parser.parse_args(argv)
    if not args.dump:
        parser.print_help()
        return 0
    _dump(args.sample)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
