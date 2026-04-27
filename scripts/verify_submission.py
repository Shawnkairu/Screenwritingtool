#!/usr/bin/env python3
"""
Pre-submission evidence check for CS 372 final project.
Verifies that all claimed evidence files exist and have reasonable content.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PASS = "✓"
FAIL = "✗"
WARN = "⚠"

errors = []
warnings = []

def check(label: str, path: Path, min_size: int = 0, check_fn=None):
    if not path.exists():
        errors.append(f"{FAIL} MISSING: {label} ({path.relative_to(ROOT)})")
        return False
    size = path.stat().st_size
    if size < min_size:
        errors.append(f"{FAIL} TOO SMALL: {label} ({size} bytes, expected >{min_size})")
        return False
    if check_fn:
        result = check_fn(path)
        if result is not True:
            warnings.append(f"{WARN} {label}: {result}")
    print(f"  {PASS} {label}")
    return True

def check_json(path, required_keys=None):
    try:
        with open(path) as f:
            d = json.load(f)
        if required_keys:
            missing = [k for k in required_keys if k not in d]
            if missing:
                return f"missing keys: {missing}"
        return True
    except Exception as e:
        return f"JSON error: {e}"

def check_jsonl(path, min_lines=100):
    count = sum(1 for l in path.read_text().splitlines() if l.strip())
    if count < min_lines:
        return f"only {count} lines (expected >{min_lines})"
    return True

print("═══════════════════════════════════════════════════════════════")
print("  The Instructor — Pre-Submission Evidence Check")
print("═══════════════════════════════════════════════════════════════\n")

# ─── Core application ──────────────────────────────────────────────────────────
print("── Core Application ───────────────────────────────────────────")
check("Frontend entry point", ROOT / "src/App.tsx", 1000)
check("API layer", ROOT / "src/api.ts", 500)
check("Instructor system prompt", ROOT / "src/system-prompts/instructor.ts", 3000)
check("Analysis system prompt", ROOT / "src/system-prompts/analysis.ts", 500)
check("repairJSON utility", ROOT / "src/utils/repairJSON.ts", 200)
check("WritingEditorColumn", ROOT / "src/components/WritingEditorColumn.tsx", 500)
check("Backend main.py", ROOT / "backend/main.py", 2000)
check("Backend RAG retrieve.py", ROOT / "backend/rag/retrieve.py", 1000)
check("Backend requirements.txt", ROOT / "backend/requirements.txt", 50)

# ─── Data pipeline ─────────────────────────────────────────────────────────────
print("\n── Data Pipeline ──────────────────────────────────────────────")
check("PDF converter script", ROOT / "scripts/convert_pdfs.py", 500)
check("Scene parser script", ROOT / "scripts/parse_screenplay.py", 1000)
check("RAG index builder", ROOT / "scripts/build_rag_index.py", 2000)
check("Chunks JSONL corpus", ROOT / "data/chunks/chunks.jsonl", 500000,
      lambda p: check_jsonl(p, 3000))
check("Corpus stats", ROOT / "data/chunks/stats.json", 50,
      lambda p: check_json(p))
check("Embedding comparison", ROOT / "data/embedding_comparison.json", 100,
      lambda p: check_json(p))

# ─── RAG system ────────────────────────────────────────────────────────────────
print("\n── RAG System ─────────────────────────────────────────────────")
check("Ablation cache: sentimental-value analyst JSON",
      ROOT / "data/ablation_cache/sentimental_value_2026_analyst.json", 100)
check("Ablation cache: breaking-bad analyst JSON",
      ROOT / "data/ablation_cache/breaking_bad_101_pilot_2008_analyst.json", 100)

# ─── Evaluation ────────────────────────────────────────────────────────────────
print("\n── Evaluation ─────────────────────────────────────────────────")
check("Error analysis notebook", ROOT / "notebooks/error_analysis.ipynb", 10000)
check("Ablation notebook", ROOT / "notebooks/ablation_study.ipynb", 5000)
check("Ablation results JSON", ROOT / "data/ablation_results.json", 500,
      lambda p: check_json(p))
check("Prompt comparison script", ROOT / "scripts/run_prompt_comparison.py", 1000)

# ─── Figures ───────────────────────────────────────────────────────────────────
print("\n── Figures ────────────────────────────────────────────────────")
for fig in ["fig_heading_formats.png", "fig_repair_json.png", "fig_corpus_quality.png",
            "fig_retrieval_quality.png", "fig_embedding_comparison.png"]:
    check(fig, ROOT / "data" / fig, 10000)

# ─── Documentation ─────────────────────────────────────────────────────────────
print("\n── Documentation ──────────────────────────────────────────────")
check("README.md", ROOT / "README.md", 3000)
check("ATTRIBUTION.md", ROOT / "ATTRIBUTION.md", 1000)
check("docs/evaluation.md", ROOT / "docs/evaluation.md", 5000)
check("docs/architecture.md", ROOT / "docs/architecture.md", 1000)
check("docs/self-assessment.md", ROOT / "docs/self-assessment.md", 2000)

# ─── Ablation results count ────────────────────────────────────────────────────
print("\n── Ablation Study Status ──────────────────────────────────────")
abl_path = ROOT / "data/ablation_results.json"
if abl_path.exists():
    with open(abl_path) as f:
        d = json.load(f)
    results = d if isinstance(d, list) else d.get('raw_results', [])
    n = len(results)
    if n >= 20:
        print(f"  {PASS} Ablation complete: {n}/20 results")
    elif n >= 4:
        print(f"  {WARN} Ablation partial: {n}/20 results (still running?)")
        warnings.append(f"Ablation has {n}/20 results — ensure full run before submission")
    else:
        print(f"  {FAIL} Ablation incomplete: {n}/20 results")
        errors.append(f"Ablation incomplete: {n}/20")

# ─── Prompt comparison ─────────────────────────────────────────────────────────
pc_path = ROOT / "data/prompt_comparison_results.json"
if pc_path.exists():
    with open(pc_path) as f:
        d = json.load(f)
    n_ok = len([r for r in d if 'error' not in r])
    if n_ok >= 3:
        print(f"  {PASS} Prompt comparison: {n_ok}/3 versions complete")
    else:
        print(f"  {WARN} Prompt comparison: {n_ok}/3 versions (run scripts/run_prompt_comparison.py)")
        warnings.append(f"Prompt comparison has {n_ok}/3 versions")
else:
    print(f"  {FAIL} Prompt comparison results missing — run scripts/run_prompt_comparison.py")
    errors.append("Prompt comparison results missing")

# ─── Summary ───────────────────────────────────────────────────────────────────
print("\n═══════════════════════════════════════════════════════════════")
if errors:
    print(f"\n{len(errors)} ERROR(S):")
    for e in errors:
        print(f"  {e}")
if warnings:
    print(f"\n{len(warnings)} WARNING(S):")
    for w in warnings:
        print(f"  {w}")
if not errors and not warnings:
    print("\n✓ All checks passed — ready for submission!")
elif not errors:
    print("\n✓ No blocking errors — review warnings before submission.")
else:
    print("\n✗ Fix errors before submission.")

sys.exit(len(errors))
