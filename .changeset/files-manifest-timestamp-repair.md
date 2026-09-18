---
"@hasna/files": patch
---

Normalize hosted knowledge-manifest snapshot timestamps to strict RFC 3339 for existing and future rows, and execute the owner-managed global cursor capture through a fixed-search-path security-definer function so runtime file mutations remain authorized.
