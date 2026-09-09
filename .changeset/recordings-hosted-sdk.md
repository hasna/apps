---
"@hasna/recordings": minor
---

Add an explicit hosted JSON client under `@hasna/recordings/hosted`, sharing
structural wire contracts while preserving the legacy SDK. Bound requests before
credential access, retain end-to-end cancellation and decoded response limits,
and expose safe status-aware errors without automatic retries.
