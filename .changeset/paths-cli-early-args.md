---
"@hasna/paths": patch
---

`paths --version` and `paths --help` now answer before any argument validation (previously `--version` exited 2 as an unknown argument and `--help` exited 2 because the required-`--app` check ran first). The `paths` bin stays execution-free for metadata probes.
