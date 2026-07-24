# Changelog

All notable changes to `@hasna/personalnotes` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-24

### Changed — rename to the Hasna OSS standard

- **Product renamed to "Personal Notes"** (was "Hasna Notes" / "OpenNotes") across
  README, docs, CLI/MCP help text, the local serve surface, and the bundled web UI
  wordmark. The existing UI is unchanged in behaviour.
- **Package identity added**: this repo now publishes as the public npm package
  `@hasna/personalnotes` (`publishConfig.access: public`). A root `package.json` is
  introduced; the repo previously shipped only a Swift `Package.swift`.
- **Standard bins wired**:
  - `personalnotes` → `cli/personalnotes.mjs`
  - `personalnotes-mcp` → `mcp/personalnotes-mcp.mjs`
  - `personalnotes-serve` → `ai-sidecar/server.mjs`
- **Entry files renamed** to match the bins: `cli/hasna-notes.mjs` →
  `cli/personalnotes.mjs`, `mcp/hasna-notes-mcp.mjs` → `mcp/personalnotes-mcp.mjs`.
- **README rewritten** to tell the canonical 2-mode story (user-hosted, or
  Personal Notes Cloud) and document the npm install + standard bins.

### Notes

- On-disk data contracts are intentionally left untouched by this rename: the
  `HASNA_NOTES_*` environment prefix, the `~/.hasna/apps/notes/` data root, and the
  `agent: hasna-notes-app` frontmatter token remain for back-compat. Storage
  standardisation is tracked as a separate workstream.
- Repository rename (`hasna/notes` → `hasna/personalnotes`) and npm publish are
  landing steps performed after this PR is reviewed and merged.
