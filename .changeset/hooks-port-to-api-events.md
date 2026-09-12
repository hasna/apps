---
"@hasna/hooks": minor
---

Hook events are hosted: `hooks log`, `hooks run`, the MCP event tools and the
bundled observability hooks now use the registry API instead of a local
SQLite file.

New routes on `hooks-serve`, persisted in the server's PostgreSQL and
described in `/openapi.json` (all require the API key, all answer 503 rather
than empty data when the server has no event store configured):

- `POST /api/v1/events` — record one event or a batch of up to 100.
- `GET /api/v1/events` — query by `hook`, `session` prefix, `since` (ISO or
  `30m`/`2h`/`7d`), `q` substring, `errors_only` and `limit`.
- `DELETE /api/v1/events` — delete all events, or one hook's.
- `GET /api/v1/events/summary` — per-hook totals, error counts and error rate.
- `POST /api/v1/feedback` — store feedback.

Surfaces that now use those routes:

- CLI `hooks log list`, `log search`, `log tail`, `log errors`, `log clear`
  read and delete on the registry, and say which store the rows came from.
- CLI `hooks run` records the execution event on the registry.
- MCP `hooks_log_list`, `hooks_log_tail`, `hooks_log_errors`,
  `hooks_log_summary`, `hooks_run`, `hooks_batch_run` and `send_feedback` do
  the same, and every log response carries a `source` field.
- The bundled `commandlog`, `sessionlog`, `costwatch` and `errornotify` hooks
  post their events instead of writing `~/.hasna/hooks/hooks.db`
  unconditionally.

The local SQLite store is reachable only through the deliberate
`HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`) opt-in. Under a hosted
credential no log or run path imports `bun:sqlite` for events. Writes never
throw — a hook keeps running when the registry is unreachable, and the event
is reported as not recorded rather than silently written to disk — while
reads fail loudly, so an empty `hooks log` can never be what a refused
credential looks like. Event payloads are redacted and truncated before they
leave the machine, exactly as the local writer did.
