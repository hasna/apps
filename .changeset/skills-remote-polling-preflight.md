---
"@hasna/skills": patch
---

Reject malformed, nonpositive and overflowing remote run polling values before quoting or creating a run, instead of silently truncating them or using defaults. Bound polling milliseconds to 2147483647 so native timers cannot overflow into rapid requests.
