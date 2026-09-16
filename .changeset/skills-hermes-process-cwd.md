---
"@hasna/skills": patch
---

Allow native Hermes prompt hooks when TERMINAL_CWD exactly matches the process working directory. Reject alternate, relative and aliased paths, and always check the effective directory for native skill copies even when an SDK caller supplies another project.
