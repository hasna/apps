---
"@hasna/billing": patch
---

billing-serve answers --help and --version before binding, creating the DB pool, or touching credentials; previously it bound the server first (rc=124 timeout) and never printed help or the version (BUG row ad3ae2fe).
