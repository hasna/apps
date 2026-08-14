#!/bin/bash
# Run output processing eval across ALL provider+model combinations
set -e
source ~/.secrets

LIMIT=50
DELAY=300

# All viable models (skip whisper, guard, orpheus audio models, qwen3-32b think tags)
COMBOS=(
  "cerebras:qwen-3-235b-a22b-instruct-2507"
  "cerebras:llama3.1-8b"
  "cerebras:gpt-oss-120b"
  "groq:llama-3.1-8b-instant"
  "groq:llama-3.3-70b-versatile"
  "groq:openai/gpt-oss-20b"
  "groq:openai/gpt-oss-120b"
  "groq:meta-llama/llama-4-scout-17b-16e-instruct"
  "openai:gpt-4.1-nano"
  "openai:gpt-4.1-mini"
  "openai:gpt-4o-mini"
)

echo "═══════════════════════════════════════════════════════════════"
echo "  OUTPUT PROCESSING EVAL: ${#COMBOS[@]} models × $LIMIT samples"
echo "═══════════════════════════════════════════════════════════════"

for combo in "${COMBOS[@]}"; do
  IFS=':' read -r provider model <<< "$combo"
  echo ""
  echo "──── $provider / $model ────"
  bun evals/eval-output.ts --provider=$provider --model=$model --limit=$LIMIT 2>&1 | grep -E "^(═|📊|  Samples|  Token|  Avg comp|  Avg lat|  Error|  Number|  Quality|  Saved)" || echo "  FAILED"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  LEADERBOARD"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'PYEOF'
import json, glob

results = []
for f in glob.glob("evals/results/output-*.json"):
    data = json.load(open(f))
    s = data["summary"]
    results.append(s)

results.sort(key=lambda x: (-x.get("numberPreservation",0)*100 - x.get("errorPreservation",0)*100, -x["avgSavingsPct"], x["avgLatency"]))

print(f"\n{'Rank':<5}{'Provider':<10}{'Model':<35}{'Compress':<10}{'Quality':<9}{'ErrPres':<9}{'NumPres':<9}{'Latency':<10}")
print(f"{'─'*5}{'─'*10}{'─'*35}{'─'*10}{'─'*9}{'─'*9}{'─'*9}{'─'*10}")
for i, r in enumerate(results):
    model = r["model"][:33]
    quality = round((r.get("errorPreservation",0) + r.get("numberPreservation",0)) / 2 * 100)
    marker = " ★" if i == 0 else ""
    print(f"{i+1:<5}{r['provider']:<10}{model:<35}{r['avgSavingsPct']}%{'':<5}{quality}%{'':<4}{round(r.get('errorPreservation',0)*100)}%{'':<4}{round(r.get('numberPreservation',0)*100)}%{'':<4}{r['avgLatency']}ms{marker}")
PYEOF
