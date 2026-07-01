# Agent Instructions

## Knowledge Write Boundary

- Never write directly to `.hasna/knowledge`, `.hasna/knowledge/artifacts`, or generated knowledge files.
- Use the `knowledge` CLI, `knowledge-mcp`, or the `@hasna/knowledge` SDK for every durable knowledge write.
- For generated wiki or repair writes, require `--approve-write --approved-by <name>` unless the command is explicitly dry-run only.
- Before handing work back, run `knowledge storage validate --strict --scope project --json` when knowledge state changed.
- If strict validation reports `untracked_artifact_file`, `artifact_hash_mismatch`, `missing_artifact_file`, or `direct_workspace_artifact_file`, treat it as corruption from a bypassed write path and fix it through the CLI/MCP/SDK path.

## Normal Workflow

1. Inspect with `knowledge inventory`, `knowledge search`, `knowledge source resolve`, and MCP resources.
2. Write with approved `knowledge` commands or SDK calls only.
3. Validate with `knowledge storage validate --strict --scope project --json`.
4. Do not edit generated SQLite, artifact, wiki, index, log, run, schema, export, or storage policy files by hand.
