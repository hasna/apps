---
"@hasna/estate-sync": minor
---

Shared cloud-sync engine for the apps estate store bucket (O15-00627): push a digest bundle plus a signed index pointer, pull by resolving the signed index, fetching by digest, verifying sha256, and hydrating atomically. Parameterized by (estate bucket, app prefix). Ships the `estate-sync` CLI, `./sdk` importable module, and the `-serve` server surface with skills/loops prefix wiring.
