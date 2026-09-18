# Working with Instructions

Follow the repository root AGENTS.md and its release rules. This package stores
versioned configuration and renders reviewed instruction sources into native
provider files. Stored settings, scripts, execution policies and instruction
prose are different surfaces; a complete machine profile is not a prompt profile.

## Authority and changes

Use the installed `instructions` CLI, command-based `instructions-mcp --stdio`,
or the generated `@hasna/instructions/sdk` client. Resolve the configured
hosted authority through the shared credential provider. Never print credentials.
An authentication or reachability failure must not switch a managed deployment
to a local database. Explicit local mode exists for isolated OSS use and tests;
it does not authorize a managed-fleet fallback.

Read the full current record before editing it. Preserve its immutable identity,
metadata, version history and scoped output targets. Export the complete domain
before a migration; a backup does not replace an atomic version precondition.
Do not automatically sync changed disk files into the hosted authority: disk
changes can be stale, generated, or owned by another process. Review and reconcile
source changes explicitly.

## Prompt generation

Create curated profiles containing reviewed `rules` in text or Markdown format.
Resolve templates before injection. Retired records, executable settings and
provider execution policies must stay out of prompt bodies. Declare provider,
role, project, path and activation scope; do not promote a finance or other
project rule to global merely because its source appeared on one station.

Use `instructions session plan` and `instructions session apply --dry-run`
before activation. The graph compiler validates source eligibility, provider
capabilities, dependencies, replacements and conditional fallbacks. Existing
ownership manifests, exact preimage checks, drift detection and snapshots protect
unrelated files. Never use a blanket force overwrite to resolve unknown drift.
Generated files are projections of hosted sources, not a second source of truth.

Sumi uses flattened `AGENTS.md` in its actual resolved configuration directory
or repository. Supply an explicit target. A global render can emit
`SUMI_CONFIG_DIR`; a project render must not reroute its global configuration.
Do not assume that OpenCode's config instruction array is consumed by Sumi.
Preserve the harness's built-in system prompt and dynamic tool guidance.
Prove the native loader or actual assembled request; a file existing is not
proof that a running session adopted it. Preserve active sessions.

## Commands and reference

Use current `--help` rather than historical command or tool counts:

```sh
instructions list --help
instructions show --help
instructions add --help
instructions profile --help
instructions session --help
instructions export --help
instructions package-manager-scan --fail-on-findings .
```

See [CLI](docs/cli.md), [MCP](docs/mcp.md), [HTTP API](docs/http-api.md),
[session rendering](docs/session-rendering.md), and
[storage](docs/storage-and-sync.md). `configs` is a compatibility alias; prefer
`instructions` in new documentation.

## Engineering and verification

Core types live in `src/types`; store adapters in `src/lib`; isolated SQLite
compatibility in `src/db`; authenticated PostgreSQL routes in `src/server`;
CLI/MCP in their respective directories; generated SDK in `src/sdk`.
The hosted server never falls back to SQLite. Backups are a recovery plane,
not an authority selector.

Use the root-pinned Bun version. Run the affected tests, package typecheck and
build, then the root-required checks for the final release head. Tests must use
isolated synthetic data and never a fleet credential or live application store.
Preserve path confinement, symlink refusal, ownership, drift and restore tests.
Keep secrets and private operational prompt payloads out of source and tarballs.

Publish only through the root's changeset, task-worktree, PR and per-package npm
release process. The SDK ships in the same package; do not invent a separate
SDK release or use `bun publish`. Public scope and artifact scans still apply.
