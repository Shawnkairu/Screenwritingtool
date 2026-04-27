#!/bin/bash
# Run all evaluation scripts in sequence, then update evaluation.md
# Usage: ./scripts/run_all_evals.sh
# Expects backend running at http://localhost:8000 with LLM_PROVIDER=ollama

PYTHON=/Library/Frameworks/Python.framework/Versions/3.12/bin/python3
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== The Instructor — Full Evaluation Pipeline ==="
echo "Root: $ROOT"
echo "Python: $PYTHON"
echo ""

# Check backend
echo "Checking backend..."
STATUS=$($PYTHON -c "
import requests
try:
    r = requests.get('http://localhost:8000/llm/status', timeout=5).json()
    print(r['provider'] + '/' + r['model'] + ' ready=' + str(r['ready']))
except Exception as e:
    print('ERROR: ' + str(e))
" 2>&1)
echo "  $STATUS"
echo ""

# 1. Ablation study (resumable — skip if already complete)
ABLATION_COUNT=$($PYTHON -c "
import json
try:
    with open('$ROOT/data/ablation_results.json') as f:
        r = json.load(f)
    if isinstance(r, list):
        print(len(r))
    else:
        print(len(r.get('raw_results', [])))
except:
    print(0)
" 2>/dev/null)

echo "Ablation: $ABLATION_COUNT / 20 results already saved"
if [ "$ABLATION_COUNT" -lt 20 ]; then
    echo "Running ablation study..."
    cd "$ROOT"
    $PYTHON scripts/run_ablation.py
    echo ""
else
    echo "  → Ablation complete, skipping"
fi

# 2. Prompt comparison
if [ ! -f "$ROOT/data/prompt_comparison_results.json" ] || \
   [ "$($PYTHON -c "import json; d=json.load(open('$ROOT/data/prompt_comparison_results.json')); print(len([r for r in d if 'error' not in r]))")" -lt 3 ]; then
    echo "Running prompt engineering comparison..."
    cd "$ROOT"
    $PYTHON scripts/run_prompt_comparison.py
    echo ""
else
    echo "Prompt comparison: already complete, skipping"
fi

# 3. Update evaluation.md tables
echo "Updating evaluation.md tables..."
cd "$ROOT"
$PYTHON scripts/update_eval_tables.py

echo ""
echo "=== Done ==="
echo "Next steps:"
echo "  1. Run notebooks/ablation_study.ipynb to generate figures"
echo "  2. Review docs/evaluation.md"
echo "  3. Submit GitHub repo"
