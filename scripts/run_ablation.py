#!/usr/bin/env python3
"""
Ablation study for The Instructor.

2×2 factorial design:
  - analyst_context: no / yes  (does structured JSON analysis improve instructor quality?)
  - rag_examples:   no / yes  (does retrieval improve specificity / craft grounding?)

Conditions:
  baseline      — no analyst, no RAG
  analyst_only  — analyst JSON, no RAG
  rag_only      — no analyst, RAG enabled
  full_system   — analyst JSON + RAG  (production configuration)

Five screenplay excerpts sampled with random.seed(7) across act positions.

The script is RESUMABLE: analyst JSONs are cached to data/ablation_cache/.
If a call fails or times out, re-run and it will skip what's already done.
"""

import json
import os
import random
import re
import sys
import time
from pathlib import Path

import requests

BACKEND = "http://localhost:8000"
CACHE_DIR = Path("data/ablation_cache")
OUT_FILE = Path("data/ablation_results.json")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ─── Pick 5 representative excerpts ──────────────────────────────────────────

def pick_excerpts():
    random.seed(7)
    chunks = []
    with open("data/chunks/chunks.jsonl") as f:
        for line in f:
            chunks.append(json.loads(line))

    by_act = {}
    for c in chunks:
        by_act.setdefault(c.get("act_position", "unknown"), []).append(c)

    order = ["act_1", "act_2_first_half", "act_2_second_half", "act_3"]
    excerpts = []
    for pos in order:
        pool = by_act.get(pos, [])
        # Only pick chunks with enough text (field is 'text' not 'content')
        pool = [c for c in pool if len(c.get("text", "")) > 300]
        if pool:
            excerpts.append(random.choice(pool))

    # 5th excerpt: any remaining
    remaining = [c for c in chunks if c not in excerpts and len(c.get("text", "")) > 300]
    if remaining:
        excerpts.append(random.choice(remaining))

    return excerpts[:5]


# ─── Scoring ──────────────────────────────────────────────────────────────────

CRAFT_TERMS = [
    "value shift", "gap", "subtext", "inciting", "protagonist", "antagonist",
    "tension", "conflict", "stakes", "turning point", "scene function",
    "character want", "character need", "dramatic", "scene value",
    "McKee", "three-act", "act break", "resolution", "complication",
]

def score_response(text: str) -> dict:
    text_l = text.lower()
    question_count = text.count("?")
    craft_count = sum(1 for t in CRAFT_TERMS if t in text_l)
    # Specificity: mentions specific proper nouns or scene details (capitalised words, numbers)
    specificity = len(re.findall(r'\b[A-Z][A-Z]+\b', text)) + len(re.findall(r'\b\d+\b', text))
    # Prescriptions: prescriptive phrases (instructor should ask, not tell)
    prescription_phrases = ["you should", "you need to", "you must", "make sure", "try to",
                            "consider adding", "you could add", "add a", "write a", "include a"]
    prescriptions = sum(1 for p in prescription_phrases if p in text_l)
    latency_ms = 0  # filled in by caller
    return {
        "question_count": question_count,
        "craft_terms": craft_count,
        "specificity": float(specificity),
        "prescriptions": float(prescriptions),
        "response_length": len(text),
        "latency_ms": latency_ms,
    }


# ─── API helpers ──────────────────────────────────────────────────────────────

def get_analyst_json(excerpt: dict) -> dict | None:
    """Generate analyst JSON for an excerpt (cached to disk)."""
    title = excerpt.get("title", "unknown")
    cache_key = re.sub(r"[^\w]+", "_", title) + "_analyst.json"
    cache_path = CACHE_DIR / cache_key

    if cache_path.exists():
        print(f"  [cache hit] analyst JSON for {title}")
        with open(cache_path) as f:
            return json.load(f)

    print(f"  [analyst]  generating for {title} …", end="", flush=True)
    t0 = time.time()
    try:
        r = requests.post(
            f"{BACKEND}/analyze",
            json={"text": excerpt.get("text", "")[:MAX_TEXT_CHARS]},
            timeout=600,
        )
        r.raise_for_status()
        elapsed = time.time() - t0
        print(f" {elapsed:.0f}s")
        raw = r.json().get("raw", "")
        # Try to parse the JSON inside the raw response
        # The analyst returns raw text; repairJSON logic: find first { to last }
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            parsed = json.loads(match.group())
            with open(cache_path, "w") as f:
                json.dump(parsed, f)
            return parsed
        else:
            print(f"  [warn] could not parse analyst JSON for {title}")
            return None
    except Exception as e:
        elapsed = time.time() - t0
        print(f" FAILED after {elapsed:.0f}s: {e}")
        return None


MAX_TEXT_CHARS = 1500  # cap excerpt length to stay within Qwen 7B context window

def run_chat(excerpt: dict, analyst_json: dict | None, use_rag: bool) -> tuple[str, float]:
    """Run instructor chat and return (response_text, latency_ms)."""
    text = excerpt.get("text", "")[:MAX_TEXT_CHARS]  # cap to avoid context overflow
    messages = [{"role": "user", "content": text}]
    payload = {
        "messages": messages,
        "analysis": analyst_json,
        "use_rag": use_rag,
    }
    t0 = time.time()
    try:
        r = requests.post(f"{BACKEND}/chat", json=payload, timeout=600)
        r.raise_for_status()
        elapsed_ms = (time.time() - t0) * 1000
        response_text = r.json().get("response", "")
        return response_text, elapsed_ms
    except Exception as e:
        elapsed_ms = (time.time() - t0) * 1000
        print(f"  [error] chat call failed: {e}")
        return "", elapsed_ms


# ─── Main ─────────────────────────────────────────────────────────────────────

CONDITIONS = [
    ("baseline",     False, False),
    ("analyst_only", True,  False),
    ("rag_only",     False, True),
    ("full_system",  True,  True),
]

def main():
    print("── Ablation Study: The Instructor ──────────────────────────────")
    print(f"Backend: {BACKEND}")
    print()

    # Check backend
    try:
        status = requests.get(f"{BACKEND}/llm/status", timeout=5).json()
        print(f"LLM provider: {status.get('provider')} / {status.get('model')}")
        print(f"Ready: {status.get('ready')}")
    except Exception as e:
        print(f"ERROR: Backend not reachable: {e}")
        sys.exit(1)

    excerpts = pick_excerpts()
    print(f"\nSelected {len(excerpts)} excerpts:")
    for i, e in enumerate(excerpts):
        print(f"  E{i+1}: [{e.get('title')}] {e.get('scene_heading', '')[:50]} ({e.get('act_position')})")

    # Load existing results if resuming
    results_path = OUT_FILE
    all_results = []
    if results_path.exists():
        with open(results_path) as f:
            loaded = json.load(f)
        # Only resume if it's a list of result dicts
        if isinstance(loaded, list) and all(isinstance(r, dict) for r in loaded):
            all_results = loaded
            print(f"\nResuming: {len(all_results)} results already saved.")
        else:
            print("\nOld results format detected — starting fresh.")

    done_keys = {(r["excerpt_id"], r["condition"]) for r in all_results}

    # Pre-generate analyst JSONs (only needed for analyst_only + full_system)
    print("\n── Phase 1: Pre-generate analyst JSONs ─────────────────────────")
    analyst_jsons = {}
    for i, excerpt in enumerate(excerpts):
        title = excerpt.get("title", f"E{i+1}")
        analyst_jsons[i] = get_analyst_json(excerpt)

    # Run all conditions
    print("\n── Phase 2: Run instructor calls ───────────────────────────────")
    for i, excerpt in enumerate(excerpts):
        for cond_name, needs_analyst, use_rag in CONDITIONS:
            key = (f"E{i+1}", cond_name)
            if key in done_keys:
                print(f"  [skip]  E{i+1} / {cond_name} (already done)")
                continue

            analyst_json = analyst_jsons[i] if needs_analyst else None
            print(f"  [run]   E{i+1} / {cond_name} (analyst={'yes' if analyst_json else 'no'}, rag={use_rag})", end="", flush=True)
            t0 = time.time()
            response, latency_ms = run_chat(excerpt, analyst_json, use_rag)
            total = time.time() - t0
            print(f" → {total:.0f}s")

            if response:
                scores = score_response(response)
                scores["latency_ms"] = latency_ms
                result = {
                    "excerpt_id": f"E{i+1}",
                    "title": excerpt.get("title", ""),
                    "scene_heading": excerpt.get("scene_heading", ""),
                    "act_position": excerpt.get("act_position", ""),
                    "condition": cond_name,
                    "needs_analyst": needs_analyst,
                    "use_rag": use_rag,
                    "analyst_available": analyst_json is not None,
                    "response_preview": response[:200],
                    **scores,
                }
                all_results.append(result)
                # Save after every call
                with open(results_path, "w") as f:
                    json.dump(all_results, f, indent=2)
            else:
                print(f"  [warn]  empty response for E{i+1}/{cond_name}")

    # ── Summary table ──────────────────────────────────────────────────────────
    print("\n── Results ─────────────────────────────────────────────────────")

    # Aggregate by condition
    summary: dict[str, dict] = {}
    for r in all_results:
        c = r["condition"]
        summary.setdefault(c, {"question_count": [], "craft_terms": [], "specificity": [], "prescriptions": [], "latency_ms": []})
        for k in summary[c]:
            summary[c][k].append(r.get(k, 0))

    # Average
    avg: dict[str, dict] = {}
    for c, vals in summary.items():
        avg[c] = {k: sum(v)/len(v) if v else 0 for k, v in vals.items()}

    print(f"\n{'Condition':<16} {'Questions':>9} {'Craft':>7} {'Specific':>9} {'Prescrip':>10} {'Latency':>7}")
    print("-" * 62)
    for cond in ["baseline", "analyst_only", "rag_only", "full_system"]:
        s = avg.get(cond, {})
        if not s:
            print(f"{cond:<16} (no data)")
            continue
        print(f"{cond:<16} {s['question_count']:>9.1f} {s['craft_terms']:>7.1f} "
              f"{s['specificity']:>9.1f} {s['prescriptions']:>10.1f} {s['latency_ms']:>7.0f}ms")

    print(f"\nAll results saved → {results_path}")
    print(f"Total runs: {len(all_results)} / {len(excerpts) * len(CONDITIONS)}")


if __name__ == "__main__":
    main()
