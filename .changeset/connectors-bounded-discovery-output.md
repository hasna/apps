---
"@hasna/connectors": minor
---

Make connector discovery bounded and progressively disclosed for agents. `connectors list --json` now returns a minified 20-row compact envelope with truthful totals and continuation metadata across the main, category, installed, and brief catalog views. `--json --verbose` keeps full fields inside a bounded page, while `--json --full` and `--json --all` preserve the legacy exhaustive bare arrays. MCP connector pages now report the applied limit, current cursor, completion state, and catalog version, and bypass optional LLM stripping so continuation receipts cannot be removed.
