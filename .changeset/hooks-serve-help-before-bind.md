---
"@hasna/hooks": patch
---

hooks-serve answers --help and --version before any port parse or bind; previously `hooks-serve --version` fell through to the bind path, bound the listener at 127.0.0.1:39428, and never exited (rc=124 under timeout, empty stdout) instead of printing the version (todos row dc92977d).
