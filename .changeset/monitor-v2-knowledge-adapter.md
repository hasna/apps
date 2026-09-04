---
"@hasna/monitor": patch
---

MON-V2-09: knowledge native adapter. `client.search` maps to `query()`, `client.items` to `create()`; failures return structured outcomes with `last_error_class`; stable-id create is idempotent and serialized per id; every persisted field is bounded and redacted at a single persistence choke point before reaching the SDK. No direct database or HTTP path — enforced by a global-fetch spy regression test.