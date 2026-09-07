---
"@hasna/skills": patch
---

Preserve directories with foreign or malformed ownership markers during ordinary sync and both library agent-removal helpers. Require the exact Skills owner before updating or removing a managed directory, while retaining explicit force adoption for directories containing SKILL.md.

Apply the same ownership requirement to remote tombstone deletion and registry reconciliation baselines, preserving explicit conflict overrides.
