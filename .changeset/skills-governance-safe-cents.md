---
"@hasna/skills": patch
---

Reject negative, fractional, non-finite and unsafe monetary amounts before SDK admission, reservation or settlement writes. Limit each reservation and charge to 2147483647 cents across all stores, preventing PostgreSQL integer overflow after run creation; monthly totals and ceilings may still exceed this per-reservation limit. Capture validated estimates before asynchronous admission checks, and preserve zero amounts and first-reconciliation replay behavior.
