---
"@hasna/monitor": patch
---

Ship the canonical `monitor-serve` server bin (same entrypoint as `bins/monitor-server.js`); `monitor-server` stays installed as a one-release deprecated alias. Contract manifest now records both remaining undeclared bins (monitor-serve, monitor-server) under `metadata.contractAlignment.pendingBinRenames` with the conformance baseline pinned to the exact failure (monitor-web was dropped by the dashboard-removal wave, #1678). Part of the fleet bin-naming wave (hasna/apps#1602).
