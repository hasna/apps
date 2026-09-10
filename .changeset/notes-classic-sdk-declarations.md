---
"@hasna/notes": patch
---

Ship generated TypeScript declarations for the existing package root and `./sdk` HTTP client, including typed note inputs, pagination, exports, transport reports, and errors. Keep both runtime entrypoints and the separate browser SDK unchanged. Add a fresh packed strict consumer that checks inferred positive and negative types without skipping dependency declaration checks.
