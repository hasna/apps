---
"@hasna/skills": patch
---

Correct the 0.8.11 package artifact by declaring the Secrets SDK used for vault-reference credentials, redacting vault item identifiers from diagnostics, and verifying byte-reproducible packs through a fresh installed-package runtime test. The packed production-only consumer also verifies credential rotation and terminal provider failures in an isolated environment.
