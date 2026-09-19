---
"@hasna/domains": minor
---

Add generic website-origin provisioning with explicit per-job origin TLS policy and readback, positive registration and renewal quotes, durable lookup by domain, conflict-safe adoption of existing owned domains, and bounded TXT/CNAME/MX reconciliation with provider readback. Production deployment now requires and projects the hosted provider's account and registrar-source settings before service mutation, and Cloudflare operations have bounded request time and response size.
