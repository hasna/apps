---
"@hasna/hooks": patch
---

Timeout kill now targets the whole process group: Bun's `process.kill(-pid)` is a silent no-op and the fleet's Landlock signal-scope domains block negative-pid kills even via the system kill binary (both measured), so `killGroup` enumerates the hook's group from /proc and kills every member by positive pid. A hook's children can no longer outlive it with PPID=1 (bug 4d4c8f0b), on either the timeout or the post-exit drain path. Verified through the real stdio MCP server with pgid-based probes.
