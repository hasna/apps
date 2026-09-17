---
"@hasna/recordings": patch
"@hasna/notes": patch
---

Give the Recordings HTTP server and authenticated Notes create/update routes finite, configurable defaults of 12,000 requests per minute. Preserve Recordings legacy overrides, reject malformed or excessive budgets, and retain authentication, proxy handling, and separate Notes OTP/device protections.
