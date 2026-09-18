---
"@hasna/files": patch
---

Harden production readiness and recovery identity. `/ready` now rejects whitespace-wrapped deployment source commits and image digests as invalid raw input before touching PostgreSQL. The Files current-server recovery lane also restores its captured predecessor only when the live ECS service is still anchored to this run's exact candidate task definition; a concurrent newer deployment produces metadata-only `RECONCILIATION_REQUIRED` evidence and is never overwritten. Successful deployment evidence now proves the canonical OpenAPI advertises exactly one `/v1` server and the live `/files/v1/knowledge/manifest` data-plane route enforces authentication without sending a credential.
