# Canonical migration preflight — not an accepted migration

Owner: `/root/prompts_canonical_impl` (implementation role; registered repository identity `fixer`).
Date: 2026-09-02.
Base: verified `origin/main`, `5d2fcfb02cc7a06d3f36c40b9c51141e1bc993dc`.
Branch: `codex/impl/2026-09-02-prompts-canonical-client`.
Worktree: `/Users/hasna/Workspace/50-repositories/_worktrees/hasna/apps/prompts-canonical-client`.

Canonical checkout was clean. Remote metadata was fetched; worktrees, local
branches and open PRs were inventoried before creating this unique worktree.
`apps/prompts/AGENTS.md` does not exist at the base. Workspace and repository
instructions and the owner-directed canonical architecture were read.

## Reconciliation and capability decision

Open PR #265 (`feat/prompts-storage-core`) is the only direct Prompts storage
implementation found. Its two-backend contract is not the target: it explicitly
selects SQLite/local markdown without an API URL and defaults its server to
SQLite without a DSN. It cannot be adopted wholesale.

| Surface | Base behavior | PR #265 established HTTP coverage | Remaining migration |
| --- | --- | --- | --- |
| CLI | Direct synchronous SQLite CRUD; local imports, dispatch and config writes | Core prompt operations only | Convert existing commands or explicitly deprecate unsupported capabilities |
| MCP | Many direct database and filesystem tools | Partial transport interception | Preserve tool schemas and migrate each operation; do not silently delete tools |
| Root and `./sdk` | Both export direct DB CRUD and filesystem dispatch/integration helpers | Additional two-backend SDK; broad legacy exports remain | Remove local authority without silently withdrawing the public feature set |
| HTTP server | Unversioned authenticated `/api` over SQLite | Core `/v1` CRUD, render, use, search, collections, status | PostgreSQL-only store, transactional writes, scoped counts and canonical auth |
| Integrations | Dynamically imports owning app roots for todos/channels/knowledge/mementos/files | No complete canonical integration boundary | Use proven HTTPS APIs, or document unsupported remote operations explicitly |
| Paths | `@hasna/paths` with legacy-data adoption and automatic legacy copy | Old local-first paths remain | Limit local state to nonauthoritative XDG config/cache/state; leave legacy data untouched |

Missing established HTTP feature contracts include projects, agents/focus,
schedules, versions/restore, labels, dependency-aware rendering, receipts,
dispatch/runtime capture, and cross-app integration resolution. Replacing the
whole public surface with PR #265's core subset would withdraw many existing
capabilities. That product/API choice requires direction before broad edits.
No existing public entry point has been changed in this preflight.

PR #265's candidate PostgreSQL implementation also needs correction before
reuse: empty SQL aliases yield `.tenant_id`; storage status counts all tenants;
version and usage writes lack a transaction. Its server mixes `/v1` and legacy
SQLite operations, including body registry calls. These are source findings,
not a live-database verification.

## Preparatory code

`src/canonical-client.ts` is a new, currently unexported HTTPS-only client
prototype. It has explicit URL-plus-key validation, retired-selector and alias
rejection, an immutable URL/key pair, strict `redirect: error`, no retries or
local fallback, and non-echoing transport errors. Credentials rotate by
constructing a new pair. It does not yet migrate the existing public package.
Two reasoned credential-seam waivers are visible to the existing validator:
constructor pair snapshot and rejection-only legacy-key presence detection.
They require independent review, not an assumed exemption.

The independently reviewed Contracts source at
`2b15c73f949729a001d5dc88509650f61e58ee41` remains unpublished; this preflight
does not invent a released version or generated provenance.

## Verification and outstanding gates

- Pinned `npx -y bun@1.3.14 install --frozen-lockfile --ignore-scripts`: passed.
- Regression first: new test failed on missing implementation, then passed.
- New client plus existing conformance-register tests: 7 passed, 0 failed.
- Package typecheck: passed.
- Full suite after waivers: 443 passed, 4 failed across 36 files (18.50s).
  The four unchanged path tests independently reproduce on macOS.
- Isolated existing path tests: 17 passed, 4 failed. Three assume Linux XDG
  locations on macOS; one compares `/var` against canonical `/private/var`.
- Install-induced executable permission on the worktree's Contracts launcher
  was identified as mode-only and restored; no Contracts source changed.
- No complete migration build, frozen artifact comparison, exact-commit review,
  staged secret scan or publication acceptance is claimed.
- No live database, cloud operation, real credential access, push, PR write,
  merge, publication or deployment occurred. No todos were filed (NOT FILED).

## Fixer re-verification (2026-09-03, rebased onto origin/main 85c3dee35)

- Rebased cleanly (prior base 5d2fcfb02; no apps/prompts changes on main in
  between, so no conflicts). Re-verified against the current Contracts
  resolver (merge 29222c5; fixes 41fc753 own-data snapshot, 7ab022d request
  binding + auth-body discard, 22572ae canonical authenticated clients):
  this prototype now snapshots own-data without invoking getters and rejects
  accessor-backed keys, matching 41fc753; it remains constructor-scoped
  (explicit pair, reconstruct to rotate) rather than the Contracts
  per-request provider chain — a prototype boundary, not a rotation story.
- New client tests: 6 passed, 0 failed (boundary + accessor + snapshot +
  authority normalization + get/create/update/delete error paths +
  pagination bounds + invalid JSON). Package typecheck: passed.
- Full suite from apps/prompts: 447 passed, 4 failed — the same 4
  pre-existing macOS path failures (repro: `cd apps/prompts && bun test`;
  running `bun test apps/prompts` from the repo root instead yields ~34
  spurious CLI failures because CLI tests spawn `bun run src/cli/index.tsx`
  relative to cwd). Three assume Linux XDG locations on macOS; one compares
  `/var` against canonical `/private/var`. Unrelated to this change (this
  branch touches only the 3 new prototype files).
- `apps/prompts/dist/canonical-client.d.ts(.map)` build leftovers are
  git-ignored (`apps/prompts/.gitignore: dist/`) and untracked — left in
  place, not committed.
- Prototype status: new client stays UNEXPORTED from src/index.ts (no public
  entry point changed). PR #265's two-backend contract is not the target and
  is not adopted here; broad migration (withdrawing SQLite/local
  capabilities) needs product/API approval before any export or migration.

The worktree and uncommitted preparation are retained. Nothing is ready for
publication or acceptance as a migrated package.
