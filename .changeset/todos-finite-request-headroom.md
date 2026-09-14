---
"@hasna/todos": patch
---

Raise the HTTP server's default request allowance from 120 to 12,000 per minute per peer. Preserve canonical and legacy environment overrides, reject invalid or excessive budgets before startup, and retain authentication, proxy trust, and Retry-After behavior.

Write the complete CLI JSON manual through the existing output helper so piped output remains parseable.
