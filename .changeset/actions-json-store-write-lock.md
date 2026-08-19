---
"@hasna/actions": patch
---

fix(actions): serialize JsonActionsStore read-modify-write cycles with an inter-process lock so concurrent writers never lose records
