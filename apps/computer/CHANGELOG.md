# Changelog

## 0.1.13

- Added durable runtime goals, workflow runs, replay steps, observations, approvals, policy decisions, artifacts, and exclusive resource leases.
- Added runtime schema documentation and migration coverage for local SQLite plus PostgreSQL storage sync shape.
- Enforced display leases in `runTask` and direct policy-backed action execution.
- Added owner-safe lease release, TTL expiry, DB-level run transition checks, and `max_steps_exceeded` as a distinct terminal state.
- Hardened REST server auth defaults by refusing unauthenticated mode on non-loopback hosts.
- Added release verification for typecheck, tests, build, npm pack contents, temp-app imports, installed bin help/version, and local storage status smoke.
- Added dashboard API-key handling, live run timelines, responsive operator layout, and dashboard-local Playwright coverage with offline mocks and screenshot evidence.
- Updated cross-repo compatibility/release documentation and scoped root Bun tests so dashboard Playwright specs run only through the explicit browser-ready gate.
- Added a packed cross-repo temp-app smoke for local `@hasna/computer`, `@hasna/browser`, `@hasna/machines`, and `@hasna/todos` tarballs, including export imports, direct local-bin checks, server/status smokes, and dependency-alignment evidence.
