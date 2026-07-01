# Knowledge Write Boundary

This workspace is protected against direct agent writes.

## Rules

- Agents must not write directly to .hasna/knowledge or generated artifact files.
- Use knowledge CLI, knowledge-mcp, or the @hasna/knowledge SDK for every durable knowledge write.
- Use --approve-write --approved-by <name> for generated wiki or repair writes that require approval.
- Run knowledge storage validate --strict after changes to detect direct artifact writes.

## Allowed Write Paths

- `knowledge wiki compile --approve-write --approved-by <name>`
- `knowledge wiki file-answer --approve-write --approved-by <name>`
- `knowledge ingest ...`, `knowledge reindex ...`, `knowledge sync ...`, and other knowledge CLI/MCP/SDK commands that record provenance and audit evidence.

Direct file writes under this directory are treated as knowledge corruption because they bypass citations, storage manifests, run ledgers, and audit events.

Workspace: /home/hasna/Workspace/hasna/opensource/open-knowledge/.hasna/knowledge
