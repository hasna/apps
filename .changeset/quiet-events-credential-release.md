---
"@hasna/events": patch
"@hasna/secrets": patch
---

Track Contracts 1.1.0 explicitly so clean registry installs retain the credential
resolver used by Events and Secrets after the workspace release. Secrets vault
migration retains the resolver's refusal of recursive bootstrap references.
