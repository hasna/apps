---
"@hasna/signatures": patch
---

Republish with the canonical `signatures` bin. npm 0.1.14 is stale relative to this tree: the registry tarball still declares the retired `open-signatures` bin (renamed pre-import in hasna/signatures#7), while the monorepo tree and `hasna.contract.json` both declare `signatures`/`signatures-mcp`/`signatures-serve`. This version bump exists so the next release-train publish supersedes the stale registry metadata at a new version instead of colliding with 0.1.14 content.
