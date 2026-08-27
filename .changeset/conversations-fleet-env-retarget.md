---
"@hasna/conversations": patch
---

P1-B (todos 12e26c2b): the client credential resolver's disk tier is retargeted to the PRIMARY fleet credential location `~/.hasna/fleet-env/conversations.env` (consulted when the environment is fully silent), matching the @hasna/contracts order; the legacy `~/.hasna/cloud/conversations.env` location is deprecated (removed after 2026-10-01). Applies to both the vendored TS transport (`src/lib/contracts-client/transport.ts`) and the macOS Swift core (`Sources/HasnaConversationsCore/StoreResolution.swift`). No behavior change when no fleet-env file exists.
