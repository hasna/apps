# AGENTS.md — How AI Agents Should Use @hasna/evals

## Quick start

```bash
# Install globally
bun install -g @hasna/evals

# Register MCP server with your agent runtime
evals mcp register --claude      # Claude Code
evals mcp register --codex       # Codex CLI
evals mcp register --gemini      # Gemini CLI
evals mcp register --all         # all three at once
# Restart your agent — evals_* tools will be available
```

## MCP tools

| Tool | When to use |
|------|-------------|
| `evals_run_single` | Self-check your own response before returning it to a user |
| `evals_run` | Run a full test suite against an app |
| `evals_judge` | One-shot judge call without a dataset |
| `evals_list_datasets` | Discover available eval datasets |
| `evals_get_results` | Look up a past run by ID |
| `evals_compare` | Check for regressions between two runs |
| `evals_create_case` | Add a new test case to a dataset |
| `evals_generate_cases` | Auto-generate cases from a description |

## Recommended patterns

### Self-check before responding
```
evals_run_single(
  input: <user's question>,
  output: <your drafted response>,
  rubric: "Should be accurate, helpful, and under 200 words."
)
```
If verdict is FAIL or UNKNOWN, revise your response before returning it.

### Run smoke tests after a code change
```
evals_run(
  dataset: "datasets/smoke.jsonl",
  adapter: { type: "http", url: "http://localhost:3000/api/chat" },
  save: true
)
```

### Check for regressions in CI
```
evals_compare(before: "main", after: "<latest-run-id>")
```

## Anti-patterns

❌ **Don't pass numeric scores in rubrics** — write pass/fail criteria instead
❌ **Don't skip the judge on important cases** — UNKNOWN means human review needed
❌ **Don't run evals without saving** — `save: true` enables history and baseline comparison
❌ **Don't use `evals_run_single` for bulk testing** — use `evals_run` with a dataset file
