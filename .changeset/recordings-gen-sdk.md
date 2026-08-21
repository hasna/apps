---
"@hasna/recordings": patch
---

fix: generate:sdk passes again at @hasna/contracts 0.13.1 — the query serializer now emits array-aware serialization natively (per-item append, null/undefined skipped), so the script asserts the measured 0.13.1 shape instead of patching the retired 0.8.4 scalar-only output, and v1.generated.ts is regenerated from the current API.
