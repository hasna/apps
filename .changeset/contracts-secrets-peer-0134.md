---
"@hasna/contracts": patch
---

fix: correct the `@hasna/secrets` peer dependency to the published `0.3.3`. Contracts 0.13.3 shipped with a peer on `@hasna/secrets@0.3.4`, which does not exist on npm (registry versions end at 0.3.3) — the unsatisfiable peer makes bun 1.3.14's resolver loop forever in a workspace context (the internal-apps CI hang, todos 1555d199) and blocks fresh installs. `@hasna/secrets@0.3.4` must not publish until hasna/apps#769 lands, so the peer points at the published 0.3.3.
