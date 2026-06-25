# Gemini Agent Instructions

Follow [AGENTS.md](./AGENTS.md). The critical rule is that Gemini must never
write directly to `.hasna/apps/knowledge` or generated artifact files. Use the
`knowledge` CLI, `knowledge-mcp`, or the `@hasna/knowledge` SDK, then run
`knowledge storage validate --strict --scope project --json` after knowledge
state changes.
