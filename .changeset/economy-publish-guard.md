---
"@hasna/economy": patch
---

fix: prepack typecheck resolves the optional @hasna/projects SDK as a runtime-only module (non-literal dynamic import), so the build no longer fails TS2307 against the unbuilt workspace member in a fresh checkout. Todos 029ceb00.
