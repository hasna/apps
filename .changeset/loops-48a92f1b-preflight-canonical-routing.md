---
"@hasna/loops": patch
---

Agent-loop preflight (and execution) machine routing now fails closed through the package-owned Machines canonical route instead of degrading an unresolvable machine id to a raw `ssh <machine-id>` invocation (task 48a92f1b). `@hasna/machines`' `resolveMachineCommand` falls back to raw ssh when the id is missing from the topology; loops' preflight previously inherited that fallback, so a canonical machine name such as the apple03 -> station03 alias produced a DNS failure rather than a route error. Loops' `resolveMachineCommand` wrapper now resolves the canonical route once and throws `OpenMachines route not found for machine: <id>` when the id cannot be resolved; command plans are built from the route's canonical command target, preserving exact machine identity. All preflight paths (CLI create, workflow preflight, MCP validation, doctor, runtime before-run) funnel through the same wrapper.
