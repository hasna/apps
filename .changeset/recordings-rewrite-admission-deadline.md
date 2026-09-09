---
"@hasna/recordings": patch
---

Count queue admission and command preparation against the existing native rewrite
deadline. Refuse exhausted work before command execution while preserving process
cleanup, capture-reader joins, and the interactive return reserve.
