---
"@hasna/contracts": patch
---

Release-line reconciliation: queue the registry release of the absorbed 0.11.0 tree (the registry still holds 0.10.6; the import landed 0.11.0 in-tree ahead of the registry). No functional changes — this patch lets the release lane publish and clears the KNOWN_NPM_DRIFT record (reconcile task 48a6ef7f).
