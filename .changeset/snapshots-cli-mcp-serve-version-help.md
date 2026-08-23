---
"@hasna/snapshots": patch
---

snapshots, snapshots-mcp and snapshots-serve answer --help and --version before any dispatch, transport connect or bind; previously `snapshots --version` printed usage JSON instead of the version, `snapshots-mcp --version` entered stdio mode and printed nothing, and `snapshots-serve --version` ignored argv and bound the HTTP port (todos row cbb7ca3d).
