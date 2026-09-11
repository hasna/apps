---
"@hasna/mementos": minor
---

The machine-visibility filter refuses instead of silently changing what you see.

`resolveVisibleMachineId` swallowed a failed machine-identity lookup into
`null` — a value indistinguishable from an explicit `machineId: null`. The two
transports then read that same `null` in opposite ways:

- **local**: `visible_to_machine_id === null` becomes `machine_id IS NULL`, so
  every machine-scoped memory is hidden;
- **hosted**: `toQuery` drops a null, so the parameter never reaches the
  server, the server never sets the filter, and memories scoped to *other*
  machines are returned.

One swallowed failure, two opposite wrong answers, neither visible to the
caller. Now the implicit case throws `MachineIdentityUnresolvedError` (code
`MEMENTOS_MACHINE_IDENTITY_UNRESOLVED`) carrying the cause.

- An **explicit** argument still wins, including an explicit `null` — that is
  how a caller asks for the machine-agnostic view on purpose, and it is
  unchanged.
- `isMemoryVisibleToMachine` stays total: for a machine-scoped memory, "not
  visible" is already the closed answer, so it absorbs the refusal and returns
  `false` rather than throwing.

Affects the implicit machine filter behind `memory_inject`, `memory_context`,
`memory_context_layered` and the CLI `projects` / `project-resources` /
`inject` / `context` / `project-panel` commands.
