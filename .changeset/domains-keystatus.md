---
"@hasna/domains": patch
---

Wire the recommended `keyStatus` hook (`ApiKeyStore.keyStatus` from @hasna/contracts/auth) into domains-serve's verifier, replacing the deprecated `isRevoked`-only wiring and the hook-less test construction (row 5eb0c0df). The contracts auth verifier fails closed at construction without a key-status hook, so the server suite's 10 app tests threw at build time. Tests now construct the app with a key-status resolver and add a regression proving a revoked key is denied through the hook.
