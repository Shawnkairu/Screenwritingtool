#!/usr/bin/env python3
"""
Update docs/evaluation.md tables with results from:
  - data/ablation_results.json
  - data/prompt_comparison_results.json

Run after both scripts complete.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
EVAL_MD = ROOT / 'docs' / 'evaluation.md'

# ─── Load ablation results ─────────────────────────────────────────────────────

def load_ablation():
    path = ROOT / 'data' / 'ablation_results.json'
    if not path.exists():
        return None
    with open(path) as f:
        data = json.load(f)

    # Handle both list (from script) and dict (from notebook save)
    if isinstance(data, list):
        results = data
    else:
        results = data.get('raw_results', [])

    if not results:
        return None

    from collections import defaultdict
    agg = defaultdict(lambda: defaultdict(list))
    for r in results:
        c = r['condition']
        for m in ['question_count', 'craft_terms', 'specificity', 'prescriptions']:
            agg[c][m].append(r.get(m, 0))

    summary = {}
    for c, vals in agg.items():
        summary[c] = {m: round(sum(v)/len(v), 1) for m, v in vals.items()}

    return summary


# ─── Load prompt comparison results ───────────────────────────────────────────

def load_prompt_comparison():
    path = ROOT / 'data' / 'prompt_comparison_results.json'
    if not path.exists():
        return None
    with open(path) as f:
        results = json.load(f)
    return {r['version']: r for r in results if 'error' not in r}


# ─── Update ablation table ─────────────────────────────────────────────────────

def update_ablation_table(md_text: str, summary: dict) -> str:
    cond_map = {
        'baseline':     ('Baseline', '❌', '❌'),
        'analyst_only': ('Analyst only', '✅', '❌'),
        'rag_only':     ('RAG only', '❌', '✅'),
        'full_system':  ('Full system', '✅', '✅'),
    }

    new_rows = []
    for cond_key, (label, analyst, rag) in cond_map.items():
        s = summary.get(cond_key, {})
        if s:
            new_rows.append(
                f"| {label} | {analyst} | {rag} | {s['question_count']:.1f} | "
                f"{s['craft_terms']:.1f} | {s['specificity']:.1f} | {s['prescriptions']:.1f} |"
            )
        else:
            new_rows.append(f"| {label} | {analyst} | {rag} | — | — | — | — |")

    # Replace the table rows in the ablation section
    old_pattern = r'(\| Baseline \| ❌ \| ❌ \|.*?\n)(\| Analyst only.*?\n)(\| RAG only.*?\n)(\| Full system.*?\n)'
    new_table = '\n'.join(new_rows) + '\n'
    result = re.sub(old_pattern, new_table, md_text, flags=re.DOTALL)
    return result


# ─── Update prompt comparison table ───────────────────────────────────────────

def update_prompt_table(md_text: str, pc: dict) -> str:
    version_map = {
        'v1_baseline':       'v1 baseline',
        'v2_five_dimensions':'v2 five dimensions',
        'v3_current':        'v3 current',
    }
    new_rows = []
    for key, label in version_map.items():
        r = pc.get(key, {})
        if r:
            new_rows.append(
                f"| {label} | {r.get('question_count', '—')} | {r.get('craft_terms', '—')} | "
                f"{r.get('specificity', '—'):.0f} | {r.get('prescriptions', '—')} | "
                f"{r.get('socratic_rate', '—'):.2f}% |"
            )
        else:
            new_rows.append(f"| {label} | — | — | — | — | — |")

    old_pattern = r'(\| v1 baseline \|.*?\n)(\| v2 five dimensions.*?\n)(\| v3 current.*?\n)'
    new_table = '\n'.join(new_rows) + '\n'
    result = re.sub(old_pattern, new_table, md_text, flags=re.DOTALL)
    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    md_text = EVAL_MD.read_text()
    updated = False

    ablation = load_ablation()
    if ablation:
        md_new = update_ablation_table(md_text, ablation)
        if md_new != md_text:
            md_text = md_new
            updated = True
            print("✓ Ablation table updated")
            for cond, s in ablation.items():
                print(f"  {cond:<16}: Q={s['question_count']} craft={s['craft_terms']} spec={s['specificity']} presc={s['prescriptions']}")
    else:
        print("⚠ Ablation results not found or incomplete")

    pc = load_prompt_comparison()
    if pc:
        md_new = update_prompt_table(md_text, pc)
        if md_new != md_text:
            md_text = md_new
            updated = True
            print("✓ Prompt comparison table updated")
            for v, r in pc.items():
                print(f"  {v:<22}: Q={r['question_count']} craft={r['craft_terms']} spec={r['specificity']:.0f} socratic={r['socratic_rate']:.2f}%")
    else:
        print("⚠ Prompt comparison results not found")

    if updated:
        EVAL_MD.write_text(md_text)
        print(f"\n✓ Saved → {EVAL_MD}")
    else:
        print("\nNo updates needed.")


if __name__ == '__main__':
    main()
