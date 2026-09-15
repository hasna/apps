# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

Seven counts in this file — the ones in [Derived counts](#derived-counts) — are
re-derived from the tree by `src/lib/claude-md.test.ts`, which fails when they drift.
**Every other number here is unguarded prose**, true when written and verified by hand.
Do not copy a number out of this file into a commit message, an issue, or another
document without re-deriving it; that is how the previous version of this file rotted.

## Build and Development Commands

```bash
bun install                        # Install dependencies
bun run build                      # Clean, then build 5 bins + the library + .d.ts
bun test                           # Run the whole suite (Bun native runner)
bun test src/lib/registry.test.ts  # Run a single test file
HASNA_SKILLS_TEST_TIMEOUT_MS=5000 bun test   # Override the 30s per-test timeout
bun run typecheck                  # tsc --noEmit
bun run dev                        # Run the CLI from source
bun run dev:watch                  # CLI with --watch
bun run dev:mcp                    # MCP server with --watch
bun run dev:server                 # HTTP API server with --watch
bun run dev:worker                 # Run queue worker with --watch
bun run migrate                    # Apply migrations to the configured database
bun run verify:release             # Release guard: packlist + boundary + content scans
```

CI (`.github/workflows/ci.yml`) runs typecheck → **build** → test → release guard, in
that order. The build must precede the test run: several guards scan the packed file
list, and `bin/`/`dist/` only exist after a build. Reversing the order makes those
guards certify a tree they never read. CI also stands up a Postgres service and sets
`HASNA_SKILLS_TEST_DATABASE_URL`: the store suite always runs against memory and
SQLite, and adds Postgres only when that variable points at a reachable server. The
skip is announced, not silent — `src/server/app.test.ts` prints `storeBackendNotices()`
so "passed against both backends" is never claimed on a run that tested one.

## What this repository is

`@hasna/skills` is a catalog of AI agent skills plus the machinery to discover, pin,
document, and run them. Four surfaces share one set of core modules:

- **CLI** (`skills`) — Commander + an Ink TUI.
- **MCP server** (`skills-mcp`) — the same capabilities over Model Context Protocol.
- **HTTP API server** (`skills-serve` — deprecated alias `skills-server` — plus `skills-worker`, `skills-migrate`) — a real,
  shipped service you can run yourself: a queue, a durable store, and `/api/v1/*`.
- **Library** (`@hasna/skills`, plus the `@hasna/skills/storage` subpath).

There is **one deployment story: you run it.** No *deployment* mode concept survives —
no `local`/`self-hosted`/`cloud` config key, no storage mode, no `--mode` flag, no
`mode` field in any server payload. "Running locally" is the DELIBERATE unhosted
opt-in (`HASNA_SKILLS_LOCAL=1`, see `src/lib/local-opt-in.ts`): an unconfigured
install fails closed instead of silently serving this machine. See
[No deployment modes](#no-deployment-modes).

(Unrelated `mode`-named things do still exist and are not part of that cleanup:
`InstallMode` in `src/lib/installer.ts` labels a pin/source/manifest result, and
SQLite's `journal_mode` is a pragma. Neither describes a deployment.)

## Repository layout

```
src/
├── cli/
│   ├── index.tsx                 # Commander program; registers command groups, then parseAsync()
│   ├── commands/                 # Mostly one registrar per command group; runtime-mcp.ts
│   │                             # is a plain handler imported by runtime.ts, not a registrar
│   ├── components/               # Ink TUI (App, SearchView, SkillSelect, CategorySelect, …)
│   └── cli.*.test.ts             # CLI integration tests, split by area
├── mcp/
│   ├── index.ts                  # skills-mcp entry: stdio or Streamable HTTP
│   ├── server.ts                 # buildServer(): composition root, calls the 5 registrars
│   ├── http.ts                   # Streamable HTTP transport (127.0.0.1:8836 by default)
│   ├── discovery-tools.ts        # registrar
│   ├── operation-tools.ts        # registrar
│   ├── schedule-tools.ts         # registrar
│   ├── storage-tools.ts          # registrar
│   ├── resource-meta-tools.ts    # registrar + all 4 MCP resources
│   └── helpers.ts                # mcpJson()/mcpError() response shaping
├── server/
│   ├── index.ts                  # skills-server entry
│   ├── app.ts                    # Bun.serve fetch handler + /api/v1 dispatch + durability guards
│   ├── handlers.ts               # executeRun(): retire historical unversioned queue records
│   ├── store.ts                  # createStore(): postgres | sqlite | memory
│   ├── sqlite-store.ts           # bun:sqlite backend (the zero-config default)
│   ├── database-url.ts           # Pure URL -> backend target resolution
│   ├── migrate.ts                # skills-migrate entry
│   ├── worker.ts                 # skills-worker entry
│   ├── auth.ts                   # Bearer API key -> ApiPrincipal
│   ├── artifact-storage.ts       # Artifact bodies: database column or S3
│   ├── redaction.ts              # Scrub credentials out of logs and error text
│   └── config.ts, registry.ts, rows.ts, types.ts, migrations-dir.ts, store-fixtures.ts
├── lib/
│   ├── registry-data/            # Empty compatibility export; no bundled catalog
│   ├── registry.ts               # Registry loading, merging, caching, lookup
│   ├── registry-types.ts         # SkillMeta, SkillKind, SkillSource, CATEGORIES, BASIC_SKILL_NAMES
│   ├── installer.ts              # Project pins; installSkillForAgent() writes agent folders (agent-sync)
│   ├── project-state.ts          # .skills/project.json
│   ├── portable-skills.ts        # ~/.hasna/skills/installed/<name>/ corpus: scaffold, port, run
│   ├── skillinfo.ts              # Docs, requirements, env-var extraction, runSkill()
│   ├── config.ts                 # Config file + getDataDir()
│   ├── api-url.ts                # The only place an API origin is resolved
│   ├── content-scan.ts           # Guard: secrets, PII, private context, committed output
│   ├── infra-identifiers.ts      # Guard: no literal infra identifiers
│   ├── vendor-host-guard.ts      # Public facade for the vendor endpoint guard modules
│   ├── vendor-host-{policy,url,folding,code-scan,package}.ts
│   │                             # Policy, parsing, AST folding/scanning, package coverage
│   ├── packlist.ts               # The real npm-packed file list, from the packager
│   └── …                         # search, discovery, scheduler, run-state, tool-primitives, …
├── types/api.ts
├── index.ts                      # Library entry
├── storage.ts                    # @hasna/skills/storage subpath entry
└── test-preload.ts               # Per-test throwaway data dir (see Hermetic tests)

migrations/{postgres,sqlite}/     # One numbered migration per dialect, kept at parity
docs/{architecture,product,release}/  # Design docs, several of them test-asserted
scripts/                          # release-guard.ts + corpus/upstream drift checks
```

There is no `dashboard/` directory and no `src/server/serve.ts`.

### Derived counts

| Count | Value | Derived from |
|---|---|---|
| Catalog skills | 0 | `SKILLS.length` (`src/lib/registry-data/index.ts`) |
| Instruction-kind skills | 0 | `SKILLS` entries with `kind: "instruction"` |
| Categories | 17 | `CATEGORIES` (`src/lib/registry-types.ts`) |
| MCP tools | 72 | `tools/list` against a live `buildServer()` |
| MCP resources | 4 | `resources/list` + `resources/templates/list` (3 static + 1 template) |
| Published bins | 6 | `bin` in `package.json` |
| bun build invocations | 6 | the `build` script in `package.json` |

Skill content is private operator data. The public package and server image
include no skill corpus. The authenticated server reads only the caller's
organization records and never seeds from local files on startup. Local drafts
and verified caches are owned by the Skills CLI outside this repository.

## Interfaces

### CLI — `src/cli/index.tsx`

Commander program named `skills`. `index.tsx` is thin: it declares global options,
registers the default `interactive` command, then `await import()`s one registrar per
command group from `src/cli/commands/` and calls `parseAsync()`. Event and webhook
commands come from the external `@hasna/events/commander` package.

Top-level commands, grouped by registrar:

| Registrar | Commands |
|---|---|
| `index.tsx` itself | `interactive`/`i` (the default command) |
| `install.ts` | `pin`, `unpin`, `pins`, `update`, `install` (deprecated), `remove` (deprecated) |
| `list.ts` | `list`/`ls`, `search`/`s`, `categories`, `tags` |
| `introspect.ts` | `info`, `show`, `docs`, `requires`, `validate`, `diff` |
| `tool-primitives.ts` | `tools` (`list`, `info`, `deps`, `validate`) |
| `init.ts` | `init`, `export`, `import` |
| `diagnostic.ts` | `doctor`, `test`, `env-check`/`check-env`, `setup-info`, `outdated` |
| `runtime.ts` | `quote`, `run`, `runs`, `exports`, `mcp`, `setup`, `self-update` |
| `completion.ts` | `completion` |
| `create-sync-config.ts` | `config`, `create`, `sync` |
| `portable-skills.ts` | `new`/`scaffold`, `port`/`add` |
| `schedule.ts` | `schedule` |
| `registry.ts` | `registry sync`, `pull` |
| `auth.ts` | `auth`, `billing`, `credits` |
| `feedback.ts` | `feedback` |
| `storage.ts` | `storage` (`status`, `sync-plan`) |
| `@hasna/events` | `webhooks`, `events` |

**TTY detection.** `const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false)`
at the top of `index.tsx`. The default `interactive` command renders the Ink TUI when
that is true (after the read gate below); when false it prints the compact basic-profile registry as one line of
JSON and exits 0. (It does not print help — piping `skills` gives you machine-readable
output.)

### MCP server — `src/mcp/`

`buildServer()` in `src/mcp/server.ts` is the composition root and calls five
registrars in order. Tool counts per registrar:

| Registrar | Tools |
|---|---|
| `discovery-tools.ts` | 9 |
| `operation-tools.ts` | 14 |
| `schedule-tools.ts` | 5 |
| `storage-tools.ts` | 2 |
| `resource-meta-tools.ts` | 8 (3 `registerTool` + 5 legacy positional `server.tool`) |

`resource-meta-tools.ts` also registers all MCP resources.

**Transports.** The `skills-mcp` binary defaults to **Streamable HTTP** on
`127.0.0.1:8836`; stdio requires `--stdio` or `MCP_STDIO=1`. Port precedence is
`--port <n>` → `MCP_HTTP_PORT` → 8836. The HTTP transport builds a fresh server per
request and closes it when the response closes, and exposes `GET /health`.

**Fail closed at startup.** On both transports `skills-mcp` resolves the fleet
ladder (`assertSkillsMcpConfigured()` in `src/mcp/index.ts`) before it connects
anything: with no credential, no authority and no `HASNA_SKILLS_LOCAL=1` it exits 1
with the ladder's one line on stderr — before `initialize` is answered, before a port
is bound. Every data tool (`list_skills`, `search_skills`, `get_skill_info`,
`get_skill_docs`, `list_categories`, `list_tags`, `get_requirements`) also runs the
same per-call gate as the CLI read verbs through `src/lib/read-access.ts`
(`readSurface()` in `src/mcp/helpers.ts` turns the refusal into `AUTH_REQUIRED`), so
`buildServer()` embedded in-process refuses on its own. Guards:
`src/mcp/fail-closed-startup.test.ts`, `src/mcp/read-gate.test.ts`,
`src/cli/cli.fail-closed-reads.test.ts`.

**Known wart — the agent-session tools are stateless over the default transport.**
`register_agent` / `heartbeat` / `set_focus` / `list_agents` share a `Map` that is a
local of `registerResourceMetaTools()`, so its lifetime is one `buildServer()`. Under
stdio that is the process; under the default HTTP transport it is *one request*. So
over HTTP, `register_agent` returns an id that is discarded immediately, `heartbeat`
and `set_focus` always answer `AGENT_NOT_FOUND`, and `list_agents` always returns
empty. Do not build on those four until the state is moved somewhere that outlives a
request.

### HTTP API server — `src/server/`

This **is** shipped in this repository. `bun run build` produces `bin/server.js`,
`bin/worker.js`, and `bin/migrate.js`, published as `skills-serve` (deprecated
alias `skills-server`), `skills-worker`,
and `skills-migrate`. The `Dockerfile` runs `bun bin/server.js` and exposes 8787.

Routing is a hand-written dispatcher in `src/server/app.ts` — `handleApiV1` destructures
exactly four path segments after `/api/v1`.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness. Deliberately reports no deployment variant. |
| GET | `/ready` | |
| GET | `/api/auth/whoami` | Under `/api/auth`, not `/api/v1`. |
| GET | `/api/v1/skills` | `?tag=` filters the merged list to skills carrying that exact tag |
| GET | `/api/v1/skills/:slug` | |
| GET | `/api/v1/skills/:slug/skill.md` | `text/markdown` |
| POST | `/api/v1/skills/:slug/quote` | |
| GET | `/api/v1/tags` | Distinct tags across the authenticated org's published catalog, sorted `string[]` |
| GET | `/api/v1/tags/:tag/skills` | Merged skills carrying the exact tag, as `RemoteSkillSummary[]` |
| GET | `/api/v1/runs` | `?limit=` default 20, clamped to 100 |
| POST | `/api/v1/runs/:slug` | Retired: returns `410 LEGACY_EXECUTION_RETIRED` without enqueueing. |
| GET | `/api/v1/runs/:runId` | |
| GET | `/api/v1/runs/:runId/logs` | |
| GET | `/api/v1/runs/:runId/artifacts` | |
| GET | `/api/v1/runs/:runId/artifacts/:artifactId` | Streams the body as an attachment |
| POST | `/api/v1/runs/:runId/cancel` | |
| GET | `/api/v1/billing/status` | `{billingConfigured: false, code: "BILLING_NOT_CONFIGURED"}` — a capability statement, never a deployment name |
| GET | `/api/v1/billing/credits` | `{packs: []}` |
| POST | `/api/v1/billing/*` | `501 BILLING_NOT_CONFIGURED` |

Everything under `/api/` requires a bearer API key first (`401 AUTH_REQUIRED`).
Unmatched paths 404 — but note the dispatcher *ignores* a fifth and later segment
rather than rejecting it, so `/api/v1/skills/pdf-generate/skill.md/junk` still serves
markdown. Every JSON response carries `Cache-Control: no-store`. Org isolation is
enforced by `principal.orgId` predicates in the store layer.

Skill slugs are validated with `/^[a-z0-9-]+$/`. Authenticated document reads
resolve through organization storage and never construct a local filesystem
path. The router rejects decoded path escapes. Deprecated unscoped server
registry exports return empty results. Regression: `src/server/path-traversal.test.ts`.

Auth is a bearer token hashed with SHA-256 and looked up as `api_keys.key_hash`; the
raw token never reaches the store. `HASNA_SKILLS_BOOTSTRAP_API_KEY` seeds a dev
org/user/key. Scopes and roles are parsed and returned but not yet enforced —
authorization today is org scoping.

`skills-worker` drains historical unversioned queue records, honours
`cancel_requested`, and on error backs off linearly (`idle × consecutiveErrors`,
capped at 30s). `executeRun()` in `handlers.ts` performs no skill work: it fails
unfinished records with `LEGACY_EXECUTION_RETIRED` through the generation fence.
Historical completed records and outputs remain readable. Versioned cloud
execution uses `/api/v1/executions/:slug` and the managed runtime; `inlineWorker`
cannot restore the retired submission path.

### Library — `src/index.ts`

Re-exports registry, installer, project state, run state, skillinfo, config, remote
registry/client, remote run contract, pricing, discovery, tool primitives, scheduler,
skill validation, portable skills, CLI↔MCP parity, registry sync, MCP contracts,
feedback, skill aliases, native storage, and API types.

`src/storage.ts` is the `@hasna/skills/storage` subpath entry. It is a **duplicate**,
not a split: `src/index.ts` re-exports the same ~40 `native-storage.ts` symbols
verbatim, and nothing tests that the two lists agree. Add a storage export to one and
you must add it to the other by hand.

## Invariants worth knowing before you change anything

### No deployment modes

Removed wholesale (see `CHANGELOG.md` → Unreleased → Removed). There is no `mode`
config key, no `HASNA_SKILLS_STORAGE_MODE`, no `skills setup --mode`, and no `mode`
in `/health`. `skills config unset <key>` replaced `setup --mode local`.

A retired setting is now **refused, not ignored** — `src/lib/retired-settings.ts`.
That is the second half of the removal, and it matters more than the first: a
variable nobody reads produces a process on the default SQLite database and says
nothing, so an operator who exported `HASNA_SKILLS_STORAGE_MODE` to reach Postgres
could not tell "configured" from "silently discarded" until something needed the
rows. Every refusal names the retired setting, the setting that replaced it, and the
command that fixes it. Two discriminations keep that from doing damage: the match is
scoped to *this* app's variables (sibling Hasna apps are removing the same axis on
their own schedule and their variables share the shell), and only the suffixes that
named the deployment axis count — `SKILLS_TEST_MODE` and SQLite's `journal_mode` are
different axes and are left alone.

`skills config unset mode` deliberately still works on a key `config set` refuses:
the refusal advertises that command as the fix, so it has to run on a file every
other command rejects.

The one fact that survives is whether an API origin is configured, and
`src/lib/api-url.ts` is the only place that is resolved: `resolveApiUrl()` returns
`undefined` on read paths ONLY under the explicit local opt-in
(`HASNA_SKILLS_LOCAL=1` — callers then use only their owned local registry), and
`requireApiUrl()` throws `MissingApiUrlError` on auth and write paths. Without the
opt-in, an unconfigured install fails closed: `src/lib/fleet-credentials.ts` throws
a `MISSING_API_CREDENTIAL` refusal naming the opt-in, no SQLite is opened and no
`*-local-fallback` event is emitted (see `src/lib/local-opt-in.ts`).

Regression guards: `src/lib/retired-settings.test.ts` (the refusal, its namespacing,
and the live `*_MODE` settings it must not touch), `src/lib/config.test.ts` (every
legacy `mode` *value* refused in both config scopes, and `unset` repairing a file
`loadConfig` rejects), `src/lib/native-storage.test.ts` (the storage variable refused
on every entry point, a sibling app's ignored), `src/cli/cli.runtime.test.ts`
(`setup --help` contains `--api-url` and not `--mode`; the refusal reaching the real
binary as one line rather than a stack trace), `src/server/app.test.ts` (`/health` has
no `mode` property), and `src/lib/public-package-boundary.test.ts` (the vocabulary
banned in `src`, `scripts`, `docs` and `README.md` under all three spellings).

Out of scope for that ban, on purpose: **this file**, which has to name what it bans;
**`CHANGELOG.md`**, a historical record of the removal that must not be rewritten; and
**`migrations/*/0001_open_skills_self_hosted.sql`**, whose name is an applied-version
identifier in deployed databases (`src/server/migrate.ts` keys them by file basename,
so a rename re-applies 0001 everywhere).

### No vendor endpoint defaults

An unconfigured install must never produce a URL on a vendor-controlled host — there
is no fallback endpoint and no localhost default. `src/lib/vendor-host-guard.ts`
enforces this over the **packed** file list (not `src/`, because `files` negation
globs make the repo and the tarball different byte sets), with two checks of
deliberately different strength: an **allowlist** over URL string literals in code,
found by walking the TypeScript AST so position cannot hide one; and a weaker
**denylist** over prose. Naming a third-party provider's own published API for a
bring-your-own-key skill is explicitly allowed.

Related: `src/lib/infra-identifiers.ts`, which expresses "vendor infrastructure lives
behind one indirection" as six properties rather than a blocklist — `aws-account-id`,
`aws-arn`, `infra-resource-name`, `unparameterized-workflow-infra`,
`workflow-vendor-host`, and the cardinality rule `manifest-location-not-unique`. And
`src/lib/content-scan.ts` (secret values, contact PII, personal data, private fleet
context, and committed tool output). All findings are redacted before printing,
because they surface in potentially public CI logs.

### Durable storage or nothing

SQLite is the zero-config default. With `HASNA_SKILLS_DATABASE_URL` / `DATABASE_URL`
unset the server opens `<data dir>/server.db` and migrates it itself. Postgres is the
alternative and must be migrated explicitly with `skills-migrate` — several replicas
must not race to migrate a shared database.

`HASNA_SKILLS_DATABASE_URL` and `DATABASE_URL` are server-only. CLI, MCP, and SDK
clients never read them and never open a database connection: a client reaches the
cloud only through the authority the shared @hasna/contracts ladder resolves
(`HASNA_SKILLS_API_URL`, the macOS Keychain `api-url` item,
`~/.hasna/skills/config/credentials`, then the fleet gateway) plus the API key it
resolves alongside. The repo-native storage sync
(`src/lib/native-storage.ts`) is the deliberate exception — an operator tool, not an
API client path.

**The server refuses to start on a non-durable store.** `assertDurableTarget()` runs
against the *pure resolved target* before any file or connection is opened, so a
rejected configuration never creates a database. `MemorySkillsStore` still exists but
is unreachable without naming `memory:` explicitly *and* setting
`HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1`. There is no silent in-memory fallback. The
worker applies the same guard. `skills-migrate` refuses a non-durable target and
refuses to run with nothing configured, because the deploy workflow gates rollout on
its exit code.

Unresolvable database strings throw with a diagnosis rather than guessing; an
unreachable Postgres, or a reachable one with no schema, aborts startup rather than
falling back and splitting data across two stores. Connection errors are summarised
through a redactor that strips anything URL-shaped.

Artifact bodies live in the `skills_artifacts.body_text` column unless
`HASNA_SKILLS_S3_BUCKET` is set, in which case they go to S3. There is no
local-filesystem artifact backend.

### Private identities and owned storage

Skill names come from the owner's account catalog. The software ships no names,
aliases or default selection. The CLI-owned installed store is resolved through
`getPortableSkillsRoot()`; supported app-home overrides remain available.
Normal reads never merge ~/.skillsrc or copy ~/.skills, flat app-home payloads,
or legacy custom/ folders into that store. Explicit import and storage migration
commands remain the only way to admit reviewed old content.

### Pins, not installs (except the agent-folder sync)

`.skills/project.json` records **metadata-only pins** — name, version, source,
timestamp. `installSkillSource()` and `installSkillManifest()` exist and deliberately
return `success: false`: nothing copies runtime source or a SKILL.md manifest into a
*project*, and the MCP `pin_skill`/`unpin_skill` tools still redirect a `for: <agent>`
argument to `skills mcp --register <agent>`.

CLI-mode integrations install a small Skills CLI bridge and prompt hooks; private
payloads remain in the CLI-owned cache. Legacy native-folder sync is an explicit
compatibility mode and cannot resolve missing skills from the package. Managed
fleet integrations refuse native drift and never silently select that mode.
`.skills/` itself remains output state and is never an
install target:

```
.skills/
├── project.json                  # pins, disabled skills, default export dir
├── runs/<day>/<run-id>/logs/     # run records and logs
├── exports/<skill>/<run-id>/     # sibling of runs/, NOT nested inside it
├── tmp/
└── schedules.json
```

Skills execute from the owned portable store under
`~/.hasna/skills/installed/` (`runPortableSkill()`), or the configured API — never
from `.skills/`.

### Executable vs instruction skills

`kind` in SKILL.md frontmatter, mirrored into `SkillMeta.kind`. `executable` (the
default when absent) means a runnable folder with `package.json` + `src/`.
`instruction` means SKILL.md-primary prose an agent follows, with no standalone
runtime. `runSkill()` refuses instruction skills with an explanatory error rather
than trying to spawn them.

The public package contains the skill-management software and no skill catalog.
Owners publish instruction and executable bundles to their own authenticated
catalogs. Executable dependencies and required secret references belong to those
private bundles; credential values never belong in a bundle or the public tree.
`src/lib/catalog-runnable.test.ts` verifies the empty public corpus and the
explicit-source bundler using synthetic fixtures. Private executable validation
and runtime admission are separate from testing the public package.

### Hermetic tests

`bunfig.toml` sets `root = "./src"` and preloads `src/test-preload.ts`, which points
`$HASNA_SKILLS_DIR` at a throwaway directory before any test file is imported and
re-points it per test. Without it the suite reads and writes the developer's real
`~/.hasna/skills` and fails differently on every machine. Tests that need the `$HOME`
resolution branch opt out with `withHomeDataDir()` / `withTempHome()`; child
processes that must resolve from a given `$HOME` use `withoutDataDirOverrideEnv()`.

The isolation is as wide as `getDataDir()`, which now covers every app-root path
including `auth.json`.

Set `NO_COLOR=1` for deterministic CLI output in tests.

### ESM with `.js` extensions

Relative imports carry `.js` even from `.ts` sources (`from "../lib/registry.js"`).
JSON imports use `with { type: "json" }`. This is a convention, not an invariant —
nothing enforces it, and `src/lib/remote-run-contract.ts` currently imports
`"./pricing"` bare. Follow the convention in new code; do not assume it holds when
reading.

## Skill structure

Operational skills live in private operator storage, outside this checkout.
Instruction bundles contain SKILL.md and metadata; executable bundles also
include their own entrypoint and declared dependencies. The Skills CLI owns
local drafts and verified downloads. Agents load content through that CLI.
Do not restore archived skills into this repository or static registry exports.
Missing owner records never resolve through package-relative paths.

## MCP tool reference

Tools are grouped by registrar; required parameters in **bold**.

**`discovery-tools.ts`** — `list_skills` (category, profile, detail, limit, offset) ·
`list_pinned_skills` (directory) · `search_skills` (**query**, profile, detail, limit,
offset) · `get_skill_info` (**name**) · `get_skill_docs` (**name**) ·
`list_tool_primitives` (query) · `get_tool_primitive` (**name**) ·
`get_skill_tool_dependencies` (**name**) · `validate_tool_primitives` (profile)

**`operation-tools.ts`** — `scaffold_skill` (**name**, description, overwrite) ·
`port_skill` (**path**, name, overwrite, allowShadow) · `pin_skill` (**name**, for,
scope) · `pin_category` (**category**, for, scope) · `unpin_skill` (**name**, for,
scope) · `list_categories` · `list_tags` · `get_requirements` (**name**) ·
`run_skill` (**name**, input, args,
detail) · `get_run_status` (**run_id**, detail) · `export_skills` · `import_skills`
(**skills**, for, scope) · `whoami`

**`schedule-tools.ts`** — `schedule_skill` (**skill**, **cron**, name, args) ·
`list_schedules` (limit, offset) · `remove_schedule` (**id_or_name**) ·
`detect_project_skills` (directory) · `validate_skill` (**name**)

**`storage-tools.ts`** — `storage_status` (directory) · `storage_sync_plan`
(directory, includeSchemaSql)

**`resource-meta-tools.ts`** — `search_tools` (query, detail) · `describe_tools`
(**names**) · `get_mcp_contracts` (names, includeResources) · `register_agent`
(**name**, session_id) · `heartbeat` (**agent_id**) · `set_focus` (**agent_id**,
project_id) · `list_agents` · `send_feedback` (**message**, email, category)

There are no `install_skill` / `remove_skill` tools; they are `pin_skill` /
`unpin_skill`. The agent-session tools keep state in a per-process in-memory `Map`.

**Resources:** `skills://mcp/contracts`, `skills://registry`,
`skills://tool-primitives`, and the template `skills://{name}`.

`src/lib/mcp-contracts.ts` holds a parallel machine-readable contract manifest for the
same tools and resources, served by `get_mcp_contracts` and pinned against a
compatibility fixture in `src/lib/fixtures/`. It lists the registered tools and
4 resources, but **nothing enforces that**: `mcp-contracts.test.ts` compares the
manifest against a hand-picked subset fixture, and `describeMcpToolContracts()` returns
`{ known: false, description: "Unknown tool" }` for anything missing. So adding a tool
without adding its contract fails no test — do both.

`src/lib/cli-mcp-parity.ts` declares a CLI↔MCP mapping table with the same caveat: it
covers only the `portable-skills` and `tool-primitives` domains, only
`portable-skills` entries are cross-checked against the contract manifest, and nothing
checks the reverse direction or that the CLI command strings resolve against commander.

## Testing

`bun test` with `bun:test` (`describe`/`test`/`expect`). Test roots and preload come
from `bunfig.toml`. Tests live beside the code they cover.

Beyond ordinary unit tests, a large share of this suite is **guards** — tests whose
job is to fail when an invariant erodes. Read the file header before changing one;
most explain what they replaced and why the replacement is not weaker.

| Area | Files |
|---|---|
| Registry & catalog | `registry.test.ts`, `validation.test.ts`, `search.test.ts`, `skill-aliases.test.ts`, `renamed-skills.test.ts`, `basic-skills.test.ts`, `catalog-runnable.test.ts` |
| Pins, docs, execution | `installer.test.ts`, `skillinfo.test.ts`, `skillinfo-run.test.ts`, `portable-skills.test.ts`, `scheduler.test.ts` |
| Boundaries & packaging | `public-boundary.test.ts`, `public-package-boundary.test.ts`, `packlist.test.ts`, `api-boundaries.test.ts`, `upstream-boundary.test.ts`, `unconfigured-client-boundary.test.ts`, `no-cloud-boundary.test.ts`, `release-guard.integration.test.ts` |
| Content & infra guards | `content-scan.test.ts`, `infra-identifiers.test.ts` |
| Data dir & migration | `hermetic-data-dir.test.ts`, `installed-skills-layout.test.ts`, `skill-corpus-migration.test.ts`, `config.test.ts` |
| Server | `app.test.ts`, `store-selection.test.ts`, `store-parity.test.ts`, `schema-parity.test.ts`, `sqlite-store.test.ts`, `sqlite-claim.test.ts`, `security.test.ts` |
| CLI | `src/cli/cli.*.test.ts` (auth, discovery, docs-info, import-export, pin, portable-skills, run-core, runtime, storage, tags-brief, tool-primitives) |
| MCP | `src/mcp/mcp.test.ts`, `src/mcp/mcp-http.test.ts`, `src/lib/mcp-contracts.test.ts`, `src/lib/cli-mcp-parity.test.ts` |
| Docs | `claude-md.test.ts` (this file's counts), plus `product-brief.test.ts`, `open-core-saas-pattern.test.ts`, `human-approval-model.test.ts`, and siblings that assert `docs/**` content |

`src/lib/claude-md.test.ts` re-derives the [Derived counts](#derived-counts) table. It
checks only that table — never prose — so rewording this file cannot break it, while
adding a skill, an MCP tool, a bin, or a build step will.

### Timeouts

The per-test timeout is **30s**. `DEFAULT_TEST_TIMEOUT_MS` in
`src/test-preload.ts` is the only place the number lives. **A new test that
spawns a subprocess needs no timeout argument** — bun's 5000ms default is what
made subprocess tests fail at 5001-5003ms on a loaded machine, and the fix is the
default, not an annotation per test.

Every test file opens with two lines:

```ts
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
```

`src/test-timeout.test.ts` fails if a test file omits them, so a new file cannot
quietly run at 5000ms. It looks like boilerplate because bun leaves no
alternative — measured on bun 1.3.14:

- `[test] timeout` in `bunfig.toml` is **accepted and silently ignored**.
- `setDefaultTimeout()` at preload module scope reaches **exactly one test file**.
- `setDefaultTimeout()` from a `beforeEach`, and a `BUN_TEST_TIMEOUT` env var,
  do nothing at all.
- `--timeout` on the command line works globally, and `bun run test` passes it —
  but plain `bun test` is what people and agents actually type.

Use `HASNA_SKILLS_TEST_TIMEOUT_MS` to override for one run, including to *lower*
it when telling a hang apart from a slow test.

### Build before test, locally

One boundary guard (`every declared entry point is packed, read and certified`)
can only read `bin/` and `dist/`, which exist only after a build. On an unbuilt
checkout that one check reports itself as skipped with a one-line reason rather
than failing, so a fresh clone does not open with a red that looks like a
regression. Run `bun run build` first to exercise it locally; CI never skips it,
and a *partial* build still fails it.

## Adding a new skill

Use `skills new <name> --kind instruction` or `--kind executable` to create an
owned draft outside the software checkout. Validate it and publish an explicit
version through the authenticated Skills API. Do not add a skill folder or
static registry entry here. See `docs/architecture/adding-public-skills.md`.

## TypeScript

Strict mode. Target ES2022, module ESNext, `moduleResolution: bundler`, and
`jsx: react-jsx` for Ink. The root tsconfig compiles the software under src/.
Private executable bundles are validated and tested in their own source roots.
