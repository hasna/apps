---
"@hasna/brains": patch
"@hasna/browser": patch
"@hasna/calendar": patch
"@hasna/connectors": patch
"@hasna/controls": patch
"@hasna/conversations": patch
"@hasna/domains": patch
"@hasna/evals": patch
"@hasna/holdings": patch
"@hasna/instructions": patch
"@hasna/knowledge": patch
"@hasna/logs": patch
"@hasna/repos": patch
"@hasna/secrets": patch
"@hasna/sessions": patch
"@hasna/snapshots": patch
"@hasna/styles": patch
"@hasna/testers": patch
"@hasna/tickets": patch
"@hasna/todos": patch
---

Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
