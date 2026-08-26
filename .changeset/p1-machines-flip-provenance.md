---
"@hasna/machines": patch
---

P1-C flip provenance gates + per-run ledger (todos 0c0324c1): `machines flip` proves the freshly written `~/.hasna/fleet-env/<app>.env` supplied the connection before reporting ok (rejects legacy-env tier, any `~/.hasna/cloud` source, and unreportable api-mode sources); the flip script reports the written env file's sha256; every flip writes one value-free JSONL ledger row per machine to `~/.hasna/machines/flip-ledger.jsonl`.
