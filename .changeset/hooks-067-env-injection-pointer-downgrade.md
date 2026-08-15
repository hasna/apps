---
"@hasna/hooks": patch
---

Hooks hardening 0.6.7: strip interpreter-injection variables from hook child environments (BASH_ENV/ENV sourcing vectors, BASHOPTS/SHELLOPTS, NODE_OPTIONS/NODE_PATH, PYTHONSTARTUP/PYTHONINSPECT/PYTHONPATH, LD_PRELOAD/LD_LIBRARY_PATH — bug cf99cf76), and never move the registry latest pointer down: publish compares by full semver precedence (shared compareVersions) so an older-version republish stores its row without downgrading the pointer, and the crash-window heal picks the highest semver per name rather than the latest published_at (bug 6e412e52). See apps/hooks/CHANGELOG.md.
