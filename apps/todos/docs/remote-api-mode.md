# Remote API Mode

`@hasna/todos` remains local-first. With no remote configuration, the CLI and
server use the local SQLite database exactly as before.

Remote mode is opt-in for hosted compatible APIs:

```bash
TODOS_API_URL=https://todos.example TODOS_API_KEY=tdos_... todos list --json
```

Or store the non-secret URL in config:

```bash
todos config --set apiUrl=https://todos.example
todos config --set mode=remote
```

`TODOS_API_KEY` takes priority over any stored `apiKey` value and is preferred
for shared machines and CI. The CLI never prints the full stored key.

## Mode Selection

- Default: local SQLite.
- `TODOS_API_URL` or config `apiUrl`: remote API mode.
- `TODOS_MODE=remote`: force remote mode and require an API URL.
- `TODOS_MODE=local`: force local mode even if config has `apiUrl`.

`TODOS_URL` is still accepted as a legacy alias, but new integrations should use
`TODOS_API_URL`.

## Remote-Only Entrypoint

The package also builds `todos-remote` from the remote command set. That
entrypoint imports the REST SDK and config helpers only; it does not import the
local database modules or initialize SQLite. Paid or hosted distributions should
package this remote entrypoint instead of the OSS local CLI.

## Local Data Safety

Remote mode does not delete, rewrite, or migrate local SQLite data. Local data
stays on disk until a user explicitly runs a future copy/import command and
separately chooses to clean up local files.

The local-to-cloud migration path must be copy-only by default: export local
projects, plans, task lists, tasks, agents, templates, comments, audit history,
dispatches, checkpoints, and metadata to the remote API while preserving source
IDs as provenance.
