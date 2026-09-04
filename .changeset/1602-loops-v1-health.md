---
"@hasna/loops": patch
---

Serve `GET /v1/health` (and `/v1/healthz`) as open foundation probes alongside `/health`/`/healthz` — they previously fell through the route-policy allowlist and returned `403 route_policy_missing` with a valid key (hasna/apps#1602).
