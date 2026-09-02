---
"@hasna/slides": patch
---

Remove unused install-time home-directory creation while preserving the guarded
source-dashboard bootstrap. Scan the actual npm artifact without lifecycle
recursion, preserving the deck SDK, React viewer, and CDN/inline exports.
