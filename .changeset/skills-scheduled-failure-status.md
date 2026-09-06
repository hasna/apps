---
"@hasna/skills": patch
---

Return a nonzero exit status when any scheduled item fails, in both human and JSON output. Preserve every per-item result, identify actual local executor attempts with `attempted`, and count only those attempts in `ran`. Refusals before execution leave the occurrence due and its history unchanged; actual local attempts retain success/error bookkeeping. Hosted scheduling remains unsupported, and dry runs or batches with nothing due remain successful.

Report a history-write failure separately from the execution outcome without retrying the write or abandoning later due items. Preserve execution errors and warn callers to inspect the skill's effects before retrying an attempt whose history could not be saved.
