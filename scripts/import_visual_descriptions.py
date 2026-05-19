import argparse
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from neo4j import GraphDatabase


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / "LLM" / ".env"

IMPORT_QUERY = """
MATCH (a:ArtPiece {artwork_id: $artwork_id})
MERGE (a)-[:HAS_VISUAL_DESCRIPTION]->(vd:VisualDescription {artwork_id: $artwork_id})
SET
  vd.title = $title,
  vd.artist = $artist,
  vd.room_or_location = $room_or_location,
  vd.visual_overview = $visual_overview,
  vd.subject_matter = $subject_matter,
  vd.composition = $composition,
  vd.foreground = $foreground,
  vd.middle_ground = $middle_ground,
  vd.background = $background,
  vd.figures_gestures = $figures_gestures,
  vd.objects_symbols = $objects_symbols,
  vd.colors = $colors,
  vd.materials_textures = $materials_textures,
  vd.mood_atmosphere = $mood_atmosphere,
  vd.spatial_order = $spatial_order,
  vd.audio_description = $audio_description,
  vd.uncertainties = $uncertainties,
  vd.source = $source,
  vd.reviewed = $reviewed,
  vd.model = $model,
  vd.language = $language,
  vd.updated_at = datetime(),
  vd.created_at = coalesce(vd.created_at, datetime())
RETURN a.title AS matched_title, vd.artwork_id AS artwork_id
"""


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        return "" if stripped.lower() in {"nan", "none", "null"} else stripped
    return str(value)


def load_json_files(path: Path) -> list[tuple[str, dict[str, Any]]]:
    if path.is_dir():
        files = sorted(path.glob("*.json"))
        return [(file.name, json.loads(file.read_text(encoding="utf-8"))) for file in files]

    if path.suffix.lower() == ".zip":
        items = []
        with zipfile.ZipFile(path) as archive:
            for name in sorted(archive.namelist()):
                if name.endswith("/") or not name.lower().endswith(".json"):
                    continue
                if Path(name).name.lower() == "manifest.json":
                    continue
                with archive.open(name) as file:
                    items.append((name, json.loads(file.read().decode("utf-8"))))
        return items

    if path.suffix.lower() == ".json":
        return [(path.name, json.loads(path.read_text(encoding="utf-8")))]

    raise ValueError(f"Expected a .zip, .json, or directory of .json files: {path}")


def params_from_json(filename: str, data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError(f"{filename}: expected a JSON object, got {type(data).__name__}")

    match = data.get("artwork_match") or {}
    desc = data.get("visual_description") or {}
    props = data.get("neo4j_properties") or {}
    artwork_id = clean_text(match.get("artwork_id"))

    if not artwork_id:
        raise ValueError(f"{filename}: missing artwork_match.artwork_id")

    return {
        "artwork_id": artwork_id,
        "title": clean_text(match.get("title")),
        "artist": clean_text(match.get("artist")),
        "room_or_location": clean_text(match.get("room_or_location")),
        "visual_overview": clean_text(desc.get("visual_overview")),
        "subject_matter": clean_text(desc.get("subject_matter")),
        "composition": clean_text(desc.get("composition")),
        "foreground": clean_text(desc.get("foreground")),
        "middle_ground": clean_text(desc.get("middle_ground")),
        "background": clean_text(desc.get("background")),
        "figures_gestures": clean_text(desc.get("figures_gestures")),
        "objects_symbols": clean_text(desc.get("objects_symbols")),
        "colors": clean_text(desc.get("colors")),
        "materials_textures": clean_text(desc.get("materials_textures")),
        "mood_atmosphere": clean_text(desc.get("mood_atmosphere")),
        "spatial_order": clean_text(desc.get("spatial_order")),
        "audio_description": clean_text(desc.get("audio_description")),
        "uncertainties": clean_text(desc.get("uncertainties")),
        "source": clean_text(props.get("source")) or "vision_llm",
        "reviewed": bool(props.get("reviewed", False)),
        "model": clean_text(props.get("model")),
        "language": clean_text(props.get("language")) or "en",
    }


def is_dummy_description(params: dict[str, Any]) -> bool:
    dummy_uncertainty = "no artwork image was provided" in params["uncertainties"].lower()
    has_real_description = any(
        params[key]
        for key in (
            "visual_overview",
            "subject_matter",
            "composition",
            "foreground",
            "middle_ground",
            "background",
            "figures_gestures",
            "objects_symbols",
            "colors",
            "materials_textures",
            "mood_atmosphere",
            "audio_description",
        )
    )
    return dummy_uncertainty or not has_real_description


def import_descriptions(items: list[tuple[str, dict[str, Any]]], dry_run: bool) -> int:
    parsed = []
    errors = 0
    skipped_dummies = 0
    seen_ids = set()

    for filename, data in items:
        try:
            params = params_from_json(filename, data)
        except Exception as exc:
            errors += 1
            print(f"ERROR {exc}", file=sys.stderr)
            continue

        if is_dummy_description(params):
            skipped_dummies += 1
            print(f"SKIP-DUMMY {filename} -> {params['artwork_id']} {params['title']}")
            continue

        duplicate = params["artwork_id"] in seen_ids
        seen_ids.add(params["artwork_id"])
        parsed.append((filename, params, duplicate))

    print(f"Found {len(items)} JSON files.")
    print(f"Valid files: {len(parsed)}.")
    print(f"Skipped dummy files: {skipped_dummies}.")
    if errors:
        print(f"Invalid files: {errors}.", file=sys.stderr)

    for filename, params, duplicate in parsed:
        suffix = " duplicate artwork_id in import set" if duplicate else ""
        print(f"DRY-RUN {filename} -> {params['artwork_id']} {params['title']}{suffix}")

    if dry_run:
        return 1 if errors else 0

    load_dotenv(DEFAULT_ENV_FILE)
    required = ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD")
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    driver = GraphDatabase.driver(
        os.environ["NEO4J_URI"],
        auth=(os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"]),
    )
    database = os.getenv("NEO4J_DATABASE", "neo4j")

    imported = 0
    unmatched = 0
    try:
        with driver.session(database=database) as session:
            for filename, params, _duplicate in parsed:
                result = session.run(IMPORT_QUERY, params).single()
                if result:
                    imported += 1
                    print(f"IMPORTED {filename} -> {result['matched_title']}")
                else:
                    unmatched += 1
                    print(f"NO MATCH {filename} -> {params['artwork_id']} {params['title']}")
    finally:
        driver.close()

    print(f"Imported: {imported}. No matching ArtPiece: {unmatched}. Invalid: {errors}.")
    return 1 if errors or unmatched else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Import visual-description JSON files into Neo4j.")
    parser.add_argument("path", type=Path, help="Path to a .zip, .json file, or directory of JSON files.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print what would be imported.")
    args = parser.parse_args()

    items = load_json_files(args.path)
    return import_descriptions(items, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
