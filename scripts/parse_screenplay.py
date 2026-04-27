"""
Parse raw screenplay text into scene chunks with structural metadata.

Each chunk = one scene (INT./EXT. heading to next heading).
Metadata tags each chunk so the RAG retriever can match by structure,
not just surface similarity.

Usage:
    python scripts/parse_screenplay.py --input data/raw --output data/chunks

Output:
    data/chunks/chunks.jsonl  — one JSON object per line, one chunk per scene
"""

import argparse
import json
import re
from pathlib import Path


# Scene heading pattern: handles the common variants found in PDF-extracted screenplays:
#   Standard:           INT. ROOM - DAY  /  EXT. LOCATION - NIGHT
#   Scene-numbered:     1 INT. ROOM - DAY 1   (Parasite, Succession, Hamnet ...)
#   Alpha-numbered:     A3 EXT. BOAT - DAY A3
#   No-dot hyphen:      EXT - COUNTRYSIDE - DAY   (Django Unchained)
#   Em-dash:            EXT-DAIRY FARM-DAY        (Inglourious Basterds)
#   Combined:           INT/EXT. SPACE - TIME
#   Location-first:     2- BOIS (près du chalet) - EXT/JOUR
SCENE_HEADING_RE = re.compile(
    r'^'
    r'(?:'
    r'(?:[A-Za-z]{0,2}\d+[A-Za-z]?\s+)?'  # optional scene number prefix
    r'(?:INT\.?|EXT\.?|INT/EXT\.?|I/E\.?)'  # keyword, dot optional
    r'[\s\.\-\u2014]+.+'
    r'|'
    r'\d+\s*[\-\u2013\u2014]\s*.{3,120}?'
    r'(?:INT|EXT|INT/EXT|EXT/INT|INT\s*\+\s*EXT|EXT\s*\+\s*INT)'
    r'\s*(?:[./&+]\s*)?(?:JOUR|NUIT|MATIN|SOIR|MIDI|AUBE|CREPUSCULE|FIN DE MATIN[ÉE]E)?'
    r'.*'
    r')',
    re.IGNORECASE | re.MULTILINE
)

# Character name: all-caps cue line. Many PDF/text sources preserve cues without
# indentation, so extraction happens line-by-line with context filters below.
CHARACTER_RE = re.compile(
    r'^\s*([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9\s\'\-\.\(\)]{1,38})\s*$'
)
CHARACTER_PAREN_RE = re.compile(r'\s*\((?:CONT(?:\'D|INUED)?|O\.S\.|V\.O\.|OFF|ON PHONE|INTO PHONE|PRE-LAP)\)\s*$', re.IGNORECASE)

# Approximate page breaks (each page ~55 lines in a screenplay)
LINES_PER_PAGE = 55


def detect_act_position(scene_index: int, total_scenes: int) -> str:
    """
    Rough act position based on scene index.
    Three-act structure: Act 1 ~25%, Act 2 ~50%, Act 3 ~25%.
    """
    pct = scene_index / max(total_scenes - 1, 1)
    if pct < 0.22:
        return "act_1"
    elif pct < 0.55:
        return "act_2_first_half"
    elif pct < 0.75:
        return "act_2_second_half"
    else:
        return "act_3"


def detect_scene_type(text: str, heading: str) -> str:
    """Classify scene as action, dialogue, or mixed based on content ratio."""
    lines = [l for l in text.split('\n') if l.strip()]
    dialogue_lines = sum(1 for l in lines if re.match(r'^\s{20,}', l))
    action_lines = sum(1 for l in lines if re.match(r'^\s{10,20}', l))
    total = max(len(lines), 1)

    dialogue_ratio = dialogue_lines / total
    if dialogue_ratio > 0.5:
        return "dialogue_heavy"
    elif dialogue_ratio < 0.2:
        return "action_heavy"
    else:
        return "mixed"


def extract_characters(text: str) -> list[str]:
    """Extract character names from a scene."""
    skip = {
        "CUT TO", "FADE IN", "FADE OUT", "FADE TO BLACK", "SMASH CUT", "DISSOLVE TO",
        "TITLE CARD", "SUPER", "ANGLE ON", "CLOSE ON", "BACK TO", "MATCH CUT",
        "CONTINUED", "MORE", "THE END", "END OF ACT", "ACT ONE", "ACT TWO",
        "ACT THREE", "ACT FOUR", "ACT FIVE", "FINAL DRAFT", "ANOTHER MESSAGE",
        "LATER", "MOMENTS LATER", "INTERCUT", "FLASHBACK", "BACK TO SCENE",
    }
    names: list[str] = []
    seen: set[str] = set()
    lines = text.splitlines()

    for index, line in enumerate(lines):
        match = CHARACTER_RE.match(line)
        if not match:
            continue

        raw_name = match.group(1).strip()
        name = CHARACTER_PAREN_RE.sub("", raw_name).strip(" .")
        compact = re.sub(r"\s+", " ", name)
        upper = compact.upper()

        if upper in skip or SCENE_HEADING_RE.match(line):
            continue
        if len(compact) < 2 or len(compact) > 32:
            continue
        if any(ch.isdigit() for ch in compact):
            continue

        # A cue should usually be followed by dialogue, parenthetical direction,
        # or a dual-dialogue marker. This filters all-caps action slugs.
        next_nonblank = ""
        for next_line in lines[index + 1:index + 4]:
            if next_line.strip():
                next_nonblank = next_line.strip()
                break
        if not next_nonblank:
            continue
        if SCENE_HEADING_RE.match(next_nonblank):
            continue
        if re.match(r'^(CUT TO|FADE|DISSOLVE|SMASH CUT|ANGLE ON|CLOSE ON)\b', next_nonblank, re.IGNORECASE):
            continue

        if upper not in seen:
            seen.add(upper)
            names.append(compact)

    return names


def has_subtext(text: str) -> bool:
    """
    Heuristic: scene likely has subtext if characters speak but the
    action lines describe conflicting physical behavior.
    """
    has_dialogue = bool(re.search(r'^\s{20,}.+', text, re.MULTILINE))
    has_action = bool(re.search(r'^\s{10,20}.+', text, re.MULTILINE))
    return has_dialogue and has_action and len(text) > 300


def parse_screenplay(raw_text: str, title: str) -> list[dict]:
    """
    Split screenplay into scenes and extract metadata for each.
    Returns list of chunk dicts ready for embedding.
    """
    # Split on scene headings
    parts = SCENE_HEADING_RE.split(raw_text)
    headings = SCENE_HEADING_RE.findall(raw_text)

    # Interleave headings with body text
    # parts[0] = pre-first-scene text (preamble), then alternates
    scenes = []
    for i, heading_match in enumerate(SCENE_HEADING_RE.finditer(raw_text)):
        heading_line = heading_match.group(0).strip()
        start = heading_match.end()
        # Next scene heading or end of text
        next_match = list(SCENE_HEADING_RE.finditer(raw_text, start))
        end = next_match[0].start() if next_match else len(raw_text)
        body = raw_text[start:end].strip()

        if len(body) < 50:  # Skip nearly-empty scenes
            continue

        scenes.append((i, heading_line, body))

    total = len(scenes)
    chunks = []

    for idx, (scene_idx, heading, body) in enumerate(scenes):
        text = f"{heading}\n\n{body}"
        chunk = {
            "id": f"{title}__scene_{idx:04d}",
            "title": title,
            "scene_index": idx,
            "total_scenes": total,
            "scene_heading": heading,
            "text": text,
            "char_count": len(text),
            "act_position": detect_act_position(idx, total),
            "scene_type": detect_scene_type(body, heading),
            "characters": extract_characters(body),
            "has_subtext": has_subtext(body),
            "is_interior": bool(re.search(r'\bINT\b', heading, re.IGNORECASE)),
            "approx_page": idx * (120 / max(total, 1)),  # Rough page estimate
        }
        chunks.append(chunk)

    return chunks


def process_corpus(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / "chunks.jsonl"

    txt_files = list(input_dir.glob("*.txt"))
    print(f"Parsing {len(txt_files)} screenplays...")

    total_chunks = 0
    with output_file.open("w", encoding="utf-8") as out:
        for path in sorted(txt_files):
            title = path.stem.replace("_", " ")
            raw_text = path.read_text(encoding="utf-8", errors="ignore")
            chunks = parse_screenplay(raw_text, title)

            for chunk in chunks:
                out.write(json.dumps(chunk) + "\n")

            total_chunks += len(chunks)
            print(f"  {title}: {len(chunks)} scenes")

    print(f"\nDone. {total_chunks} chunks written to {output_file}")

    # Write summary stats
    stats = {
        "total_screenplays": len(txt_files),
        "total_chunks": total_chunks,
        "avg_chunks_per_screenplay": total_chunks / max(len(txt_files), 1),
    }
    (output_dir / "stats.json").write_text(json.dumps(stats, indent=2))
    print(f"Stats: {stats}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, default="data/raw")
    parser.add_argument("--output", type=str, default="data/chunks")
    args = parser.parse_args()
    process_corpus(Path(args.input), Path(args.output))
