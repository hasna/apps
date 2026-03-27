# @hasna/evals

Open source AI evaluation framework — LLM-as-judge + assertion-based evals for any AI app.

**CLI** (`evals`) · **MCP server** (`evals-mcp`) · **TypeScript SDK**

---

## Install

```bash
bun install -g @hasna/evals
# or
npm install -g @hasna/evals
```

## 5-minute quickstart

**1. Write a dataset** (`datasets/smoke.jsonl`):
```jsonl
{"id":"q-001","input":"What is 2+2?","assertions":[{"type":"contains","value":"4"}],"judge":{"rubric":"Must answer 4 correctly."}}
{"id":"q-002","input":"Say hello","assertions":[{"type":"min_length","value":2}],"judge":{"rubric":"Should respond with a greeting."}}
```

**2. Run evals against your app**:
```bash
evals run datasets/smoke.jsonl --adapter http --url http://localhost:3000/api/chat
```

**3. Output**:
```
✓ PASS  q-001    124ms
✓ PASS  q-002     89ms
────────────────────────────────
  2/2 passed (100%)  0.2s  $0.0012
```

---

## Eval case format

### Single-turn
```json
{
  "id": "greeting-001",
  "input": "Hello, what can you do?",
  "expected": "A welcoming response listing capabilities",
  "adapter": { "type": "http", "url": "http://localhost:3000/api/chat" },
  "assertions": [
    { "type": "min_length", "value": 20 },
    { "type": "not_contains", "value": "I cannot" },
    { "type": "max_length", "value": 500 }
  ],
  "judge": {
    "rubric": "Should be welcoming and list 2-3 capabilities. PASS if friendly and informative.",
    "model": "claude-sonnet-4-6"
  },
  "tags": ["smoke", "greeting"]
}
```

### Multi-turn
```json
{
  "id": "refund-flow-001",
  "turns": [
    { "role": "user", "content": "I want a refund." },
    { "role": "assistant", "expected": "asks for order ID" },
    { "role": "user", "content": "Order #1234" },
    { "role": "assistant", "expected": "confirms refund process" }
  ],
  "judge": {
    "rubric": "Should collect order ID before processing. Should not promise instant refund."
  }
}
```

### Pass^k (consistency testing)
```json
{
  "id": "booking-001",
  "input": "Book a flight to Paris",
  "repeat": 5,
  "passThreshold": 0.8,
  "judge": { "rubric": "Should ask for dates and destination confirmation." }
}
```

---

## Assertion types

| Type | What it checks | Example |
|------|---------------|---------|
| `contains` | Output contains string | `{"type":"contains","value":"hello"}` |
| `not_contains` | Output does NOT contain string | `{"type":"not_contains","value":"error"}` |
| `starts_with` / `ends_with` | Prefix/suffix match | `{"type":"starts_with","value":"Sure"}` |
| `equals` | Exact match | `{"type":"equals","value":"4"}` |
| `regex` / `not_regex` | Regex match | `{"type":"regex","value":"\\d{4}"}` |
| `max_length` / `min_length` | Character count | `{"type":"max_length","value":500}` |
| `json_valid` | Response is valid JSON | `{"type":"json_valid"}` |
| `json_schema` | Response matches JSON schema | `{"type":"json_schema","value":{...}}` |
| `tool_called` | Specific tool was invoked | `{"type":"tool_called","value":"search"}` |
| `tool_not_called` | Tool was NOT invoked | `{"type":"tool_not_called","value":"delete"}` |
| `tool_call_count` | Number of tool calls in range | `{"type":"tool_call_count","min":1,"max":3}` |
| `tool_args_match` | Tool arguments match expected | `{"type":"tool_args_match","value":{"tool":"search","args":{"query":"AI"}}}` |
| `response_time_ms` | Response under time limit | `{"type":"response_time_ms","max":3000}` |
| `token_count` | Token count in range | `{"type":"token_count","min":10,"max":500}` |
| `cost_usd` | Cost under budget | `{"type":"cost_usd","max":0.01}` |
| `semantic_similarity` | Meaning matches expected | `{"type":"semantic_similarity","value":"acknowledge frustration","threshold":0.8}` |

Assertions run **cheapest-first** — deterministic checks before embeddings. The LLM judge only runs if all assertions pass.

---

## Adapters

Configure which adapter connects the eval runner to your app:

```bash
# HTTP (any REST endpoint)
evals run dataset.jsonl --adapter http --url http://localhost:3000/api/chat

# Direct Anthropic API
evals run dataset.jsonl --adapter anthropic --model claude-sonnet-4-6

# Direct OpenAI API (also works with Ollama)
evals run dataset.jsonl --adapter openai --model gpt-4o --url http://localhost:11434

# MCP tool (eval your MCP server directly)
evals run dataset.jsonl --adapter mcp --mcp-command "node dist/mcp/index.js" --tool my_tool

# JS function (fastest, no network)
evals run dataset.jsonl --adapter function --module ./src/handler.js

# CLI command (pipe stdin, capture stdout)
evals run dataset.jsonl --adapter cli --command "my-cli-tool --input '{{input}}'"
```

---

## LLM judge

- **PASS / FAIL / UNKNOWN** — no numeric scales
- **Chain-of-thought before verdict** — judge always reasons first
- **temperature=0** — deterministic judgments
- **Configurable model** — default `claude-sonnet-4-6`, supports any Anthropic or OpenAI model

```json
"judge": {
  "rubric": "Should answer in Romanian. Should reference at least one feature. Under 100 words.",
  "model": "claude-opus-4-6",
  "provider": "anthropic"
}
```

---

## CLI reference

```bash
# Run a dataset
evals run datasets/smoke.jsonl --adapter http --url http://localhost:3000/api/chat

# CI mode — exit 1 on regression
evals ci run datasets/smoke.jsonl --adapter http --url http://localhost:3000/api/chat --baseline main --fail-if-regression 5

# Set baseline for CI comparison
evals ci set-baseline main

# Cost estimate before running (no API calls)
evals estimate datasets/smoke.jsonl --model claude-sonnet-4-6

# Compare two runs
evals compare <run-id-before> <run-id-after>
evals compare main latest --markdown

# One-shot judge
evals judge --input "What is AI?" --output "AI is..." --rubric "Should define AI clearly"

# Generate eval cases from a description
evals generate --description "users asking about refund policies" --count 20 --output datasets/refunds.jsonl

# Calibrate your judge against gold labels
evals calibrate gold-50.jsonl --model claude-sonnet-4-6

# Capture production traffic as eval cases
evals capture --app http://localhost:3000 --rate 0.1 --output datasets/captured.jsonl

# Health check
evals doctor

# Register MCP server with Claude Code
evals mcp --claude
```

---

## CI / GitHub Actions

```yaml
- name: Run evals
  run: |
    evals ci run datasets/smoke.jsonl \
      --adapter http \
      --url ${{ env.APP_URL }} \
      --baseline main \
      --fail-if-regression 5
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## MCP tools (for agents)

Register with Claude Code: `evals mcp --claude`

| Tool | Description |
|------|-------------|
| `evals_run` | Run a full eval dataset |
| `evals_run_single` | Judge a single response mid-session |
| `evals_judge` | One-shot LLM judge call |
| `evals_list_datasets` | List available datasets |
| `evals_get_results` | Get past run results |
| `evals_compare` | Compare two runs |
| `evals_create_case` | Add a case to a dataset |
| `evals_generate_cases` | Auto-generate cases from a description |

**Key agent pattern** — self-check before responding:
```
evals_run_single(
  input: "What is the capital of France?",
  output: "The capital of France is Paris.",
  rubric: "Must correctly identify Paris as the capital."
)
→ PASS — The response correctly identifies Paris.
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
