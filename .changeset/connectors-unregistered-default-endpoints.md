---
"@hasna/connectors": patch
---

Remove 23 registrable domains that were unregistered yet hardcoded as default endpoints in shipped connector code, each contacted with the user's API key as an Authorization: Bearer token (todos 6109cc1b, PR #1106). A connector now sends API keys only to endpoints the user registered.
