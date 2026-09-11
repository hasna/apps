---
"@hasna/switcher": patch
---

Add an explicit artifact-digest-verified executable permission repair command for vault bindings installed with writable bin modes. Preserve launch-time executable ownership, ancestor and permission checks; no credentials are accessed by repair.
