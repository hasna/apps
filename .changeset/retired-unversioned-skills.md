---
"@hasna/skills": minor
---

Retire unversioned server submissions and embedded skill implementations. The
legacy worker terminates queued records without executing them; historical run
reads, outputs, and cancellation remain available. Managed executions continue
to require an immutable published bundle. Pin the published Contracts 1.1.0
credential resolver for reproducible CLI builds.
