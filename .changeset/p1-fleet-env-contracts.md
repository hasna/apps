---
"@hasna/contracts": patch
---

P1 fleet-env credential migration (todos 85c176bc): the client credential resolver's disk tier now reads `~/.hasna/fleet-env/<name>.env` FIRST, with the legacy `~/.hasna/cloud/<name>.env` and config `-cloud.env` alias as NOISY deprecated fallbacks (removal deadline 2026-10-01), a new deliberate `HASNA_<APP>_API_KEY_REF` vault-pointer tier with TERMINAL failure semantics, and a refusal of vault-path-shaped literals in the literal API-key tiers. Config tier final filename is `~/.config/hasna/<name>.env`.
