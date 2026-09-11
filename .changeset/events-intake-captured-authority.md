---
"@hasna/events": patch
---

Expose the intake client's immutable canonical authority from its exact shared transport snapshot so durable producers can freeze the destination they actually use. Preserve per-request credential and authority revalidation.
