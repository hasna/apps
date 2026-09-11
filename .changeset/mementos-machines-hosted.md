---
"@hasna/mementos": minor
---

The machine registry is now a hosted resource: new `/v1/machines` routes, and the
machine tools and the machine-visibility filter use them.

Machines was the last mementos domain with no server route at all. Every read and
write went to the per-station SQLite file, so `list_machines` on one station could
never see a machine registered on another, `set_primary_machine` was a local-only
opinion, and the machine filter behind `mementos projects`, `inject`, `context` and
`project-panel` silently fell back to "no machine filter" whenever the local read
failed — widening, not narrowing, what a station could see.

- **New routes** (already in the generated `/v1/openapi.json`, which is derived from
  the live route table): `POST /v1/machines` (register, idempotent by hostname),
  `GET /v1/machines`, `GET /v1/machines/{id}` (by id or name),
  `PATCH /v1/machines/{id}` (rename), `POST /v1/machines/{id}/primary`,
  `POST /v1/machines/{id}/touch`, `DELETE /v1/machines/{id}`. They run against the
  server's own store; the `machines` table already existed in both schemas.
- **Registration carries the caller's identity.** The server cannot observe the
  hostname of the machine talking to it — inside the container `hostname()` is the
  task id — so `POST /v1/machines` takes `hostname` and `platform` in the body and
  answers 400 when they are missing, instead of registering the server itself as
  the user's machine.
- **Clients use them**: the MCP tools `register_machine`, `list_machines`,
  `rename_machine` and `set_primary_machine`, and `getCurrentMachineId`, which is
  what the machine-visibility filter resolves.
- **`getCurrentMachineId` resolves once per process.** It sits on the `memory_save`,
  `memory_inject` and machine-visibility read paths, where the local arm was one indexed
  SELECT; without a memo its hosted equivalent would put an idempotent-register write in
  front of every read. A machine's identity cannot change while the process lives.
- **New `./sdk` methods**: `listMachines`, `registerMachine`, `getMachine`,
  `renameMachine`, `setPrimaryMachine`, `deleteMachine`, plus the exported
  `MementosMachine` type.

Renaming to a taken name is a 409 rather than a silent no-op, and deleting the
primary machine is refused with a 409, matching the local arm's errors.
