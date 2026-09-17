---
"@hasna/files": minor
---

Serve knowledge-source resolve, doctor, extracted-text, and snapshot reads over the authenticated Files `/v1` API without opening local SQLite. Hosted revision refs fail closed until an exact revision-aware byte route exists, so current bytes are never labeled as an older revision. Direct hosted snapshot commands also bind the extraction response to the exact requested file before framing success. MIME policy is shared across content, extraction, snapshots, and signed downloads; hosted doctor readiness requires a bounded extraction; `status=all` is exact; signed downloads require read scope. Snapshot framing is isolated in a pure module with no SQLite, AWS, filesystem, credential, or network imports.

Deploy the updated `files-serve` before publishing this client release because hosted doctor depends on exact `status=all` semantics and read-scoped signing.
