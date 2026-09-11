# Retired local client fixtures

Ordinary CLI command registration now uses the authenticated API directly. Help and parsing do not resolve credentials; actions still do. The separate server entrypoint and explicit storage library retain their existing compatibility behavior.

The following previously shipped implementations are retained solely to preserve historical regression coverage. Their filenames end in `.test-support.ts`; no production entrypoint may reach them, and TypeScript declaration builds and Docker build contexts exclude them. `src/entrypoint-reachability.test.ts` enforces both boundaries.

| Retired implementation | Preserved coverage |
| --- | --- |
| `cli/commands/daemon.local` | `daemon.local.test.ts` |
| `cli/commands/email-log.local` | `email-log.local.test.ts`, `email-log-search.local.test.ts`, `email-log-send-alias.test.ts` |
| `cli/commands/inbox.local` | `inbox.local.test.ts`, `inbox.test.ts`, `inbox-explain.test.ts` |
| `cli/commands/misc.local` | `misc.local.test.ts` |
| `cli/commands/sync.local` | `sync.test.ts` |
| `cli/tui/autopull`, `cli/tui/autopull-targets` | `autopull.test.ts`, retired inbox fixture dependencies |
| `lib/inbound-realtime-aws` | Retired inbox/autopull fixture dependencies |

Tests import these fixtures explicitly. The historical inbox fixture constructs `SqliteMailDataSource` directly, like explicit storage-library tests; it cannot select or bypass the ordinary API client factory. No test cases were removed. Two attachment-inventory rejection tests now assert the action-time error because registration no longer performs authentication or storage resolution.

Current behavior is covered separately by `cli/api-help.test.ts`, `cli/api-only-client.test.ts`, the API command suites, and server integration tests. These historical fixtures are not supported public CLI commands and must not be reintroduced into production imports.
