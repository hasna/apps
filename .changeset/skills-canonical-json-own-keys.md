---
"@hasna/skills": patch
---

Preserve explicit `__proto__` JSON keys during canonical serialization, including
nested objects and arrays. Run input and request digests now distinguish these
inputs from inputs without that data, while equivalent key orderings still
deduplicate. Existing persisted admissions and idempotency-key lookups are unchanged.
