# Release Compatibility

`todos release-compat check` builds a local release readiness report for the OSS
package. It is designed for agents to run before publishing, updating a global
install, or preparing rollback notes.

```bash
todos release-compat check --json
todos release-compat check --format markdown
```

The check covers:

- package identity: `@hasna/todos`, public publish access, and `hasna/todos`
  repository metadata
- binary stability for `todos`, `todos-mcp`, and `todos-serve`
- package export stability for the root package, SDK, MCP manifest, registry,
  contracts, and storage adapter
- in-memory migration simulations from empty and recent local schema levels
- Bun global install, smoke test, and rollback commands
- changelog readiness through `todos release-notes`, `generate_release_notes`,
  and the `release_notes` JSON contract

MCP clients use `check_release_compatibility`. The JSON payload is the stable
`release_compatibility_report` contract and does not require network access.
