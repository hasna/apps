---
"@hasna/recordings": patch
---

First release from the hasna/apps monorepo. The package was imported from hasna/recordings with history preserved (import capsule a28d4f0b, import merge bcff7306); the frozen source tip is the 0.3.0 line (deployment-mode removal), which was never published from the source repo — npm latest there was 0.2.14. The delta vs 0.2.14 is that 0.3.0 content, plus the monorepo workspace wiring and the documented absorption fixes (exact registry pins for @hasna/contracts 0.8.4 and @hasna/events 0.1.11, matching the standalone lockfile). This patch establishes version ownership under the monorepo.
