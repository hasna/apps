---
"@hasna/docs": patch
---

Remove the unused install-time home-directory creation for this headless library.
Preserve the SDK, React entry point, and explicit-file CLI behavior. Scan the exact
npm archive with lifecycle-recursion and inherited-dry-run guards before release.
Align optional TipTap menus to the exact selected core/pm version so fresh
consumers do not resolve newer menus against incompatible older peers.
