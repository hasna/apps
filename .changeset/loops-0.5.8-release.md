---
"@hasna/loops": patch
---

release(loops): 0.5.8 — contracts storage kit regenerated to @hasna/contracts@0.13.1 (check aligned to the no-STORAGE_MODE contract), optional @hasna/machines pinned to the published 0.2.29, packed-artifact gate hardened (ARN/account-id patterns plus content-level secrets scan with a fail-closed JSON payload check and two-sided fixtures), both lockfiles regenerated from the 0.5.8 manifest (root workspace record + standalone Docker-build lock) with frozen-install verification, runtime-design docs secret-ref example moved to `<vault:...>` placeholder syntax, and LoopsClient.healthScan daemonPidPath so daemon probes are hermetic.
