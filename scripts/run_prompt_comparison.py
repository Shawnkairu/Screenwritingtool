#!/usr/bin/env python3
"""
Prompt engineering comparison for The Instructor.

Evaluates 3 instructor prompt versions (v1/v2/v3) against the same screenplay excerpt.
Saves results to data/prompt_comparison_results.json.

Item 14: Applied prompt engineering with 3+ designs evaluated (3 pts).
"""

import json
import re
import sys
import time
from pathlib import Path

import requests

BACKEND = "http://localhost:8000"
OUT_FILE = Path("data/prompt_comparison_results.json")

# ─── Three prompt versions ─────────────────────────────────────────────────────

# v1: Basic Socratic instructor (original prototype approach — minimal constraints)
PROMPT_V1 = """You are a screenwriting instructor. You help writers improve their screenplays through questioning rather than telling them what to write.

Ask probing questions about the writer's choices. Never write story content for them. Be honest and direct."""

# v2: Added structure — 5 dimensions, draft stage calibration, triage intelligence
PROMPT_V2 = """You are a world-class screenwriting instructor with decades of experience.

CORE CONSTRAINT:
You never generate story. Your weapon is the question, not the answer. If they ask "what should happen next?" — respond with "What does your character want to happen?"

TRIAGE INTELLIGENCE:
You see fifteen problems. You surface one — maybe two. Pick the highest-leverage observation. Pull that thread first.

DRAFT STAGE calibration:
- FIRST DRAFT: Structure and momentum only. Push writers forward.
- REVISION: Get granular on character interiority, subtext, specificity.
- POLISH: Nothing gets past.

THE FIVE DIMENSIONS:
1. STRUCTURAL ARCHITECTURE — dramatic question, scene values, turning points
2. CHARACTER DEPTH — interior life, contradictions, competing desires
3. WORLD-BUILDING — does the setting feel inhabited?
4. VISUAL LANGUAGE — does it read like a movie?
5. CONSEQUENCE CHAINS — airtight causality, nothing wasted

YOUR VOICE: Direct. No fluff. No "great job!" Brief warmth when earned. Reference great films to illustrate."""

# v3: Full current prompt — adds Surprise Engine, Competing Desires, Character specificity pushes
PROMPT_V3 = open("src/system-prompts/instructor.ts").read()
# Strip the TypeScript export wrapper
_m = re.search(r'`([\s\S]+)`', PROMPT_V3)
PROMPT_V3 = _m.group(1).strip() if _m else PROMPT_V3


# ─── Test excerpt ──────────────────────────────────────────────────────────────

# Use a rich, well-known excerpt for reliable scoring
TEST_EXCERPT = """INT. WHITE HOUSE - SPARE BEDROOM - NIGHT

WALTER WHITE (50s, beige, forgettable) lies in bed unable to sleep. His wife SKYLER sleeps beside him.

Walter stares at the ceiling. He gets up quietly, moves to the window. Looks out at the dark suburban street. Everything normal. Everything fine.

He goes to a box in the closet. Opens it. Inside: stacks of cash. He stares at it for a long moment.

He closes the box. Goes back to bed. Lies down.

SKYLER
(sleepy)
You okay?

WALTER
Yeah. Go back to sleep.

She does. Walter stares at the ceiling again."""


# ─── Scoring ──────────────────────────────────────────────────────────────────

CRAFT_TERMS = [
    "value shift", "gap", "subtext", "inciting", "protagonist", "antagonist",
    "tension", "conflict", "stakes", "turning point", "scene function",
    "character want", "character need", "dramatic", "scene value", "interior",
    "McKee", "three-act", "act break", "visual", "causality", "consequence",
]

def score_response(text: str) -> dict:
    text_l = text.lower()
    question_count = text.count("?")
    craft_count = sum(1 for t in CRAFT_TERMS if t in text_l)
    # Specificity: uppercase words (character names, titles) + numbers
    specificity = len(re.findall(r'\b[A-Z][A-Z]+\b', text)) + len(re.findall(r'\b\d+\b', text))
    # Prescriptions: telling not asking
    prescription_phrases = [
        "you should", "you need to", "you must", "make sure", "try to",
        "consider adding", "add a", "write a", "include a", "change the",
    ]
    prescriptions = sum(1 for p in prescription_phrases if p in text_l)
    # Socratic quality score: questions per 100 words
    word_count = max(1, len(text.split()))
    socratic_rate = (question_count / word_count) * 100
    return {
        "question_count": question_count,
        "craft_terms": craft_count,
        "specificity": float(specificity),
        "prescriptions": float(prescriptions),
        "socratic_rate": round(socratic_rate, 2),
        "response_length": len(text),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def run_with_prompt(version: str, system_prompt: str, excerpt: str) -> dict:
    """Call the backend with a custom system prompt override...
    Since the backend uses its own system prompt, we call Ollama directly."""
    OLLAMA_URL = "http://localhost:11434/api/chat"
    OLLAMA_MODEL = "qwen2.5:7b-instruct"

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"[WRITER'S SCREENPLAY]\n{excerpt}"},
        ],
        "options": {
            "temperature": 0.2,
            "num_predict": 1000,
            "num_ctx": 4096,
        },
    }

    print(f"  [{version}] calling Ollama …", end="", flush=True)
    t0 = time.time()
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=600)
        r.raise_for_status()
        elapsed = time.time() - t0
        print(f" {elapsed:.0f}s")
        content = r.json().get("message", {}).get("content", "").strip()
        scores = score_response(content)
        return {
            "version": version,
            "elapsed_s": round(elapsed, 1),
            "response_preview": content[:400],
            **scores,
        }
    except Exception as e:
        elapsed = time.time() - t0
        print(f" FAILED after {elapsed:.0f}s: {e}")
        return {"version": version, "error": str(e)}


def main():
    print("── Prompt Engineering Comparison ───────────────────────────────")
    print(f"Test excerpt: Breaking Bad pilot — Walter stares at the money")
    print()

    versions = [
        ("v1_baseline", PROMPT_V1),
        ("v2_five_dimensions", PROMPT_V2),
        ("v3_current", PROMPT_V3),
    ]

    results = []
    for name, prompt in versions:
        result = run_with_prompt(name, prompt, TEST_EXCERPT)
        results.append(result)

        # Save incrementally
        with open(OUT_FILE, "w") as f:
            json.dump(results, f, indent=2)

    print("\n── Results ─────────────────────────────────────────────────────")
    print(f"\n{'Version':<22} {'Q?':>4} {'Craft':>6} {'Specific':>9} {'Prescrip':>9} {'SocRate':>8}")
    print("-" * 62)
    for r in results:
        if "error" in r:
            print(f"{r['version']:<22} ERROR: {r['error']}")
            continue
        print(f"{r['version']:<22} {r['question_count']:>4} {r['craft_terms']:>6} "
              f"{r['specificity']:>9.0f} {r['prescriptions']:>9.0f} {r['socratic_rate']:>8.2f}%")

    print(f"\nResults saved → {OUT_FILE}")

    # Print response previews
    print("\n── Response Previews ───────────────────────────────────────────")
    for r in results:
        if "error" not in r:
            print(f"\n[{r['version']}]\n{r['response_preview']}\n")


if __name__ == "__main__":
    main()
