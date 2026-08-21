---
"@hasna/domains": patch
---

Remove the dead 'cloud-http' transport token from the store wiring (row 0fdd8998). The removed-modes directive (owner 2026-07-29) retired the deployment-mode vocabulary and @hasna/contracts now resolves client transports as "sqlite" | "http"; the stale 'cloud-http' comparison made the member build fail with TS2367/TS2339 at src/db/store.ts:920/:926. The DomainsStore transport union, ApiStore constant, hosted-client check and the doctor banner now use "http", with a compile-time union regression in store.ts.
