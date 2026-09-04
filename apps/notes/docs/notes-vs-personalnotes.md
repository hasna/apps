# Notes and PersonalNotes evidence matrix

This package is the public Hasna **Notes** application. PersonalNotes is a
separate desktop/SaaS product. The names meet only at the published wire
protocol that both products already implement.

| Surface | Source evidence | Canonical name in this package | Treatment |
|---|---|---|---|
| npm package | `package.json` | `@hasna/notes` | Preserve. |
| package directory | monorepo membership law | `apps/notes` | Preserve. |
| executable surfaces | `package.json#bin` | `notes`, `notes-mcp`, `notes-serve` | Preserve. |
| CLI/MCP/SDK client identity | `client/transport.mjs`, `sdk/index.mjs` | `notes` / `NotesClient` | Preserve and use one authenticated HTTPS transport. |
| client configuration | `hasna.contract.json#metadata.client` | `HASNA_NOTES_API_URL`, `HASNA_NOTES_API_KEY` | Preserve. Both are required; neither selects a local fallback. |
| server database configuration | `hasna.contract.json#metadata.service` | `HASNA_NOTES_DATABASE_URL` | Preserve on the server/migration surface only. It is rejected by clients. |
| XDG application segment | in-package XDG resolver (former `@hasna/paths` contract) | `notes` | Preserve. New resolution is XDG-native; legacy data moves only through the explicit migration command. |
| public service contract | `hasna.contract.json` | service name `notes` | Preserve. |
| external desktop/SaaS product | merged PR #934 (`20804a7c`) | `hasna-products/personalnotes` / PersonalNotes | Preserve as an external product reference; do not rename or absorb it. |
| wire protocol | merged PRs #287 (`913fa460`) and #934 (`20804a7c`) | `personalnotes/v1` | Preserve verbatim. It is a compatibility protocol name, not this package's product identity. |
| external GitHub/npm/domain/AWS resources | outside this package's source authority | existing published identifiers | Do not rename from this repository. |
| retired client selector | `client/transport.mjs` | `PERSONALNOTES_MODE` | Keep only as a fail-loud retired variable; it is not a supported PersonalNotes compatibility mode. |

The package therefore must not rename the `personalnotes/v1` paths or the
external `hasna-products/personalnotes` link while normalizing its own client,
paths, documentation, tests, and manifests to Notes.
