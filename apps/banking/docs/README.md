# Documentation

Current behavior is documented here:

- [CLI reference](CLI.md): commands, options, credentials, output, and exit status.
- [SDK reference](SDK.md): exported surfaces, execution boundaries, workflow, and stores.
- [MCP reference](MCP.md): binary behavior, tool descriptors, dispatch inputs, and limitations.
- [State layout](STATE_LAYOUT.md): package-owned and caller-owned paths.
- [Postgres schema](schema/postgres.sql): production-store reference schema and transaction boundary.
- [Migration guide](migration/iapp-payments-to-banking.md): moving direct integrations to the provider-operation model.

Dated research and evidence are retained separately:

- [Provider API inventory (2026-06-29)](providers/api-inventory-2026-06-29.md)
- [0.0.2 release evidence](releases/0.0.2.md)
- [0.0.7 release evidence](releases/0.0.7.md)

Dated pages describe what was checked or released at that time. Use the current
references above for the package's present command and API behavior.
