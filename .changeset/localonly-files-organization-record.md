---
"@hasna/files": patch
---

Record the strong reason for the organization local-transport guard (local-only-capability-removal workflow 2026-08-18): organization reviews operate on Google-Drive-imported metadata that only exists on-box; the hosted server has no schema, routes, or producer for that data plane. Gate comments now carry the dated evidence chain, and a behavior-lock test asserts the api-mode refusal fires with the documented reason. No runtime behavior change.
