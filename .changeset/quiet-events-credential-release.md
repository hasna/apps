---
"@hasna/events": patch
---

Track Contracts 1.1.0 explicitly so clean registry installs retain the credential
resolver used by Events and Secrets after the workspace release. Secrets vault
migration retains the resolver's refusal of recursive bootstrap references.
Contracts' development SDK uses an exact public registry artifact, preserving
producer acceptance without creating a circular workspace build dependency.
