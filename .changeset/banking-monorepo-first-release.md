---
"@hasna/banking": patch
---

First release from the hasna/apps monorepo. The package was imported from hasna/banking with history preserved. `0.0.7` is burned on the registry (published then unpublished 2026-08-15; npm refuses republish with E400 Cannot publish over previously published version), so 0.0.8 ships as the first actual npm publish. The delta since the last in-tree release 0.0.7 (ffd15fc32, 2026-06-29) is the monorepo import plus: banking execution safety workflow (97504a8ff), global state migration to ~/.hasna/banking (#2), complete LICENSE replacement (#3), alignment with @hasna/contracts (#4), docs deep-scan (#5), .editorconfig (#6), mercury --secret-key fix for secrets 0.2.9 non-TTY refusal (#7), artifact-scan packing to scratch rather than the repo root (#46), and the approval-status fix (rejected approval reports denied, not approved).
