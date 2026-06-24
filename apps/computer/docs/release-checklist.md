# Release Checklist

This checklist is enforced by `bun run verify:release` and is intended to fail before publishing when the package is stale, incomplete, unsafe to expose, or inconsistent with the runtime schema.

## Security

- Run the security and package regression suite through `bun run test`; run dashboard browser coverage through `bun run test:dashboard`.
- Keep REST, MCP, and direct action paths behind auth, policy, audit, run-control, and runtime lease gates.
- Reject unauthenticated mode on non-loopback hosts.
- Verify packed artifacts do not include local state, secrets, test trees, databases, or environment files.

## Docs

- Ship `README.md`, `LICENSE`, `docs/security-control-plane.md`, `docs/runtime-schema.md`, `docs/compatibility.md`, `docs/non-destructive-machine-validation.md`, and this release checklist.
- Update the security control-plane threat model when actors, transports, trusted boundaries, high-risk capabilities, auth, or approval policies change.
- Update runtime schema documentation when tables, status transitions, leases, approvals, or sync behavior change.
- Update compatibility documentation when package versions, provider baselines, cross-repo test coverage, or live validation gates change.

## Tests

- Run `bun run typecheck`.
- Run `bun run test` for Bun unit/integration tests.
- Run `bun run test:dashboard` on a Chromium-capable machine for dashboard browser coverage and screenshot evidence.
- Run package import and installed-bin smoke checks from a clean temp app.
- Run `bun run verify:workspace` before cross-repo test work and attach the JSON report to Todo evidence.
- Run `bun run verify:packed-cross-repo -- --write /tmp/occtrl-packed-cross-repo-smoke.json` before final release dry-runs when all four sibling repos are present.
- Run `bun run verify:workspace:release` before publishing or updating consumers; it must fail when worktrees are dirty or behind, package versions are behind npm, or repo release gates are incomplete.
- Keep `prepublishOnly` wired to `bun run verify:workspace:release && bun run verify:release` so npm publish cannot skip workspace policy gates.

## Migrations

- Keep `src/db/pg-migrations.ts` and `src/db/migrations/001_initial.sql` aligned for all storage sync tables.
- Verify runtime tables, policy decisions, artifacts, audit events, and the unique active lease index are present.

## Package Files

- Build `dist` before packing.
- Inspect the tarball for required entries and forbidden private-state paths.
- Reject unapproved packed paths, source maps, test declarations, fixture/mock residue, private-state files, literal secret tokens, and unexpected large files.
- Verify packaged helper hashes through `helpers/manifest.json` and smoke the installed dashboard HTML/assets from a temp install.
- Keep the packed tarball under the configured size budget unless the budget is deliberately changed.

## Examples

- Keep local-only smoke examples non-destructive.
- Do not include examples that open external sites, use credentials, make payments, or mutate user state.
- Keep live machine sampler evidence fixture-only with cleanup proof before marking P8 complete.

## Changelog

- Update `CHANGELOG.md` with the package version before release.
- Include security, runtime, migration, packaging, and verification changes when relevant.
