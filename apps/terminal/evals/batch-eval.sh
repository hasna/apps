#!/bin/bash
# Run all prompt variants against Cerebras qwen-235b and output leaderboard
set -e
source ~/.secrets

PROVIDER="cerebras"
MODEL="qwen-3-235b-a22b-instruct-2507"
LIMIT=100
DELAY=300

PROMPTS=(minimal fewshot cot_extract fewshot_strict minimal_strict expert fewshot_hard selfcorrect json_extract simplest fewshot_large)

echo "═══════════════════════════════════════════════════════════════"
echo "  BATCH EVAL: ${#PROMPTS[@]} prompt variants × $LIMIT pairs"
echo "  Provider: $PROVIDER / $MODEL"
echo "═══════════════════════════════════════════════════════════════"

for prompt in "${PROMPTS[@]}"; do
  echo ""
  echo "──── Running: $prompt ────"
  bun evals/run-eval.ts --provider=$PROVIDER --model=$MODEL --limit=$LIMIT --delay=$DELAY --prompt=$prompt 2>&1 | grep -E "^(═|📊|  Total:|  Exact|  Fuzzy|  Avg score|  Latency|  Errors|  Saved)"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  LEADERBOARD"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Parse results and rank
python3 << 'PYEOF'
import json, os, glob

results = []
for f in glob.glob("evals/results/cerebras-qwen-3-235b-*"):
    data = json.load(open(f))
    s = data["summary"]
    # Extract prompt name from filename
    name = f.replace("evals/results/cerebras-qwen-3-235b-a22b-instruct-2507", "").replace(".json", "").lstrip("-") or "minimal"
    results.append({"prompt": name, "exact": s["exactMatchPct"], "fuzzy": s["fuzzyMatchPct"], "latency": s["avgLatencyMs"], "score": s["avgScore"]})

results.sort(key=lambda x: -x["exact"])

print(f"{'Rank':<6}{'Prompt':<20}{'Exact %':<10}{'Fuzzy %':<10}{'Latency':<10}{'Score':<8}")
print(f"{'─'*6}{'─'*20}{'─'*10}{'─'*10}{'─'*10}{'─'*8}")
for i, r in enumerate(results):
    marker = " 🏆" if i == 0 else ""
    print(f"{i+1:<6}{r['prompt']:<20}{r['exact']:<10}{r['fuzzy']:<10}{r['latency']:<10}{r['score']:<8}{marker}")
PYEOF
