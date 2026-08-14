# NL→Bash Model Evaluation Report

Benchmark: NL2SH-ALFA (100 pairs, difficulty 0 / easy)
Date: 2026-03-18
System prompt: minimal (1 sentence, command-only instruction)
Temperature: 0, Stop: [\n]

## Results

| Provider | Model | Exact % | Fuzzy % | Avg Latency | P50 | P95 | Cost/1K calls | Cost/correct |
|----------|-------|---------|---------|-------------|-----|-----|---------------|-------------|
| cerebras | qwen-3-235b-a22b-instruct… | **66%** | **66%** | 441ms | 305ms | 1160ms | $0.2100 | $0.000318 |
| cerebras | llama3.1-8b | **52%** | **53%** | 444ms | 295ms | 1153ms | $0.2100 | $0.000396 |
| groq | llama-3.1-8b-instant | **52%** | **53%** | 92ms | 90ms | 130ms | $0.0525 | $0.000099 |
| groq | openai/gpt-oss-20b | **41%** | **41%** | 227ms | 205ms | 375ms | $0.0525 | $0.000128 |
| groq | qwen/qwen3-32b | **0%** | **0%** | 642ms | 653ms | 751ms | $0.0525 | $∞ |

## Analysis

### Best accuracy: cerebras/qwen-3-235b-a22b-instruct-2507
- 66% exact match, 66% fuzzy
- Avg latency: 441ms

### Fastest (viable): groq/llama-3.1-8b-instant
- 92ms avg, 52% exact

### Most cost-efficient: groq/llama-3.1-8b-instant
- $0.000099/correct answer
- $0.0525/1000 calls

## Notes

- **qwen3-32b (Groq)**: 0% — outputs `<think>` reasoning tags, stop:[\n] cuts before command. Needs `thinking_mode=disabled` or different prompting.
- **gpt-oss-20b (Groq)**: Many empty responses — model sometimes returns nothing with stop:[\n].
- **Exact match** = normalized string equality. **Fuzzy match** = same binary + args + flags (order-independent).
- All tests used difficulty=0 (easy) pairs. Medium and hard pairs would show larger gaps.
- Cost assumes ~350 tokens/call. Actual cost depends on system prompt size (open-terminal sends ~1200 tokens).

## Recommendation

| Use Case | Best Model | Why |
|----------|-----------|-----|
| **Best accuracy** | Cerebras qwen-3-235b | 66% exact, free tier |
| **Best speed** | Groq llama-3.1-8b-instant | 92ms avg, 52% exact |
| **Best balance** | Cerebras qwen-3-235b | Highest accuracy at acceptable latency |
| **Cheapest per correct** | Groq llama-3.1-8b-instant | $0.15/M tokens × good accuracy |