---
"@hasna/browser": patch
---

fix: prepack typecheck resolves the optional @hasna/conversations SDK as a runtime-only module (non-literal dynamic import), so build:types no longer fails TS2307 against the unbuilt workspace member in a fresh checkout. Todos 0cbbd621.
