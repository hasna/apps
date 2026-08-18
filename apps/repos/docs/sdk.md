# TypeScript SDK

The package root is ESM and publishes declarations:

```typescript
import {
  scanRepos,
  listRepos,
  searchAll,
  getGlobalStats,
} from "@hasna/repos";

await scanRepos(["/home/me/workspace"]);
const repos = listRepos({ org: "example", limit: 50 });
const matches = searchAll("authentication", 20);
const stats = getGlobalStats();
```

Functions use the same database/configuration selection as the CLI. Read
[Configuration and storage](configuration.md) before using the SDK inside a
long-lived or multi-database process.

## Public value exports

The following values are exported from `@hasna/repos`; internal module exports
not listed here are not part of the package-root API.

| Area | Exports |
|---|---|
| Database | `getDb`, `getDbPath`, `migrateDb`, `closeDb`, `openNonMigratingDb`, `applyPostgresMigrations` |
| Remote safety | `sanitizeRemoteIdentity`, `sanitizeRemoteOutput`, `sanitizeGitRemoteUrl` |
| Scanning and hooks | `discoverRepos`, `scanRepoPaths`, `scanRepos`, `watchRepos`, `ensureWorkspaceBootstrap`, `startAutoIndexWorker`, `installPostCommitHook`, `installPostCommitHooks`, `drainHookQueue` |
| Catalog synchronization | `syncRepoCatalog`, `cleanupRemoteIdentities`, `getSourceMachineId` |
| Repository reads | `listRepos`, `listAllRepos`, `countRepos`, `getRepo`, `getRepoByRemote`, `listReposByRemote`, `searchRepos`, `listCommits`, `searchCommits`, `listBranches`, `listTags`, `listPullRequests`, `listPullRequestsWithRepo`, `countPullRequests`, `searchAll`, `getRepoStats`, `getGlobalStats`, `getReposStatus` |
| Repository read errors | `AmbiguousRepoNameError`, `AmbiguousRemoteError` |
| GitHub | `syncGithubPRs`, `syncAllGithubPRs`, `syncRemotePullRequests`, `fetchRepoMetadata`, `parseGithubRemote` |
| GitHub catalog | `getDefaultGithubCatalogCachePath`, `loadGithubRepoCatalog`, `syncGithubRepoCatalog`, `enumerateGithubRepoCatalog`, `iterateGithubRepoCatalog`, `applyGithubCatalogFilter`, `extractGithubFullNameFromRemote` |
| Worktrees | `WORKTREE_LEASE_SCHEMA`, `WORKTREE_LIST_SCHEMA`, `WORKTREE_ADOPT_SCHEMA`, `WorktreeError`, `worktreeRootDir`, `assertWorktreeName`, `computeWorktreePath`, `parseWorktreeRef`, `addWorktree`, `listWorktrees`, `removeWorktree`, `adoptWorktrees`, `releaseWorktree`, `redactGitDiagnostics` |
| Repository lifecycle | `REPO_CREATE_SCHEMA`, `REPO_CLONE_SCHEMA`, `REPO_ARCHIVE_SCHEMA`, `RepoLifecycleError`, `parseRepoSpec`, `isRepoSpec`, `createRepository`, `cloneRepository`, `archiveRepository`, `redactRepoLifecycleText` |
| Registry relocation | `PrimaryRelocationError`, `relocatePrimaryRepo` |
| Branch adjudication | `BranchAdjudicationError`, `adjudicateBranches` |
| Local ops | `getPackageHealth`, `getPackageDrift`, `getManifestDependents`, `resolvePackageBin`, `scanPorts`, `triageBranches`, `triagePullRequests`, `getDocsDrift`, `getReleaseHealth`, `getReleasePipelineParity`, `withTodos` |
| Loop producers | `buildPrQueue`, `runGlobalCliSmoke`, `inspectPackageHygiene`, `buildReleaseCandidates`, `buildDocsRulesDrift`, `buildDependencyRefresh`, `buildWorkspaceWorktreeHygiene`, `buildTaskRouteHealth`, `buildProtectedRelease`, `buildReleasePipelineParity` |
| Loop artifacts | `upsertTaskSeeds`, `writeLoopReport` |
| Account path | `resolveTrustedAccountHome` |
| PR monitor | `PR_MONITOR_SCHEMA`, `DEFAULT_MONITOR_LIMIT`, `runPrMonitor`, `watchStateKey`, `normalizePrKey`, `readWatchState`, `readWatchStateByPr`, `listWatchState`, `upsertWatchState`, `readCommentCursor`, `advanceCommentCursor`, `computeEventFingerprint`, `readLastEmittedFingerprint`, `markEventEmitted`, `pruneWatchState`, `DEFAULT_PRUNE_OLDER_THAN_DAYS`, `parseVerdictLine`, `parseVerdictsFromBody`, `resolveVerdictAtHead`, `leaseMatchesPr`, `classifyPullRequest`, `probeMergeTree`, `emitMonitorDelta` |

Core entity types (`Repo`, `Commit`, `Branch`, `Tag`, `Remote`, `PullRequest`,
`PullRequestRecord`, `Agent`, `ScanResult`, `SearchResult`, `RepoStats`, and
`ListOptions`) plus request/result/error types for the typed APIs are exported
from the same entry point.

## PR monitor

`runPrMonitor` runs one monitor pass — the same build half as the
`repos pr-monitor` CLI verb — and returns the `open-repos.pr-monitor.v1`
envelope: `summary` counts, `events[]` (new state only, fingerprint-deduped),
a full per-PR `state` view, and explicit `errors`. Sync is on by default; pass
`sync: false` to read the last synced registry only. `org`/`repo` scope the
run; `baseline: true` records watch state without emitting per-PR NEW events.
GitHub reads go through the injectable `MonitorClient` seam, so the engine is
driven entirely from fixtures in tests.

```typescript
import { runPrMonitor } from "@hasna/repos";

const envelope = runPrMonitor({ sync: false, org: "hasna", limit: 200 });
console.log(envelope.summary.by_class);
for (const event of envelope.events) console.log(`${event.class} ${event.owner}/${event.repo}#${event.number}`);
```

The state accessors (`readWatchState`, `upsertWatchState`, `listWatchState`,
`advanceCommentCursor`, `computeEventFingerprint`, `markEventEmitted`,
`pruneWatchState`, …) operate on the `pr_monitor_state` table — the monitor's
per-machine watch state (comment cursors, last emitted fingerprint, verdict
history). The table is local-only by design and is never synced to the shared
Postgres mirror. `pruneWatchState` deletes rows whose PR is terminal and older
than `DEFAULT_PRUNE_OLDER_THAN_DAYS` (30).

The classification surface (`classifyPullRequest`, `leaseMatchesPr`,
`probeMergeTree`) and the verdict parser (`parseVerdictsFromBody`,
`resolveVerdictAtHead`) implement the design's §2.4 decision table: one class
per PR per run with precedence NEW > NO_GO_OPEN > CI_FAILING > BASE_MOVED >
READY_TO_MERGE > REVIEW_NEEDED > NEW_COMMENT, plus the STALE_WORKTREE
merged-domain class. `emitMonitorDelta` applies baseline mode and the event
fingerprint dedupe; a re-run against unchanged state emits `events: []`.

## Database lifetime

`getDb()` owns a process-wide SQLite singleton. Opening a different path while
it is live throws; call `closeDb()` first. Normal opens run migrations.

`openNonMigratingDb(path)` is for exact inspection/planning. It requires an
explicit existing non-default file and opens it read-only without changing the
singleton. An already-open in-memory singleton can be reused, but a new
non-migrating in-memory database cannot be opened.

```typescript
import { closeDb, getDb } from "@hasna/repos";

const db = getDb("/var/lib/repos/index.db");
// Query through exported repository functions while this singleton is active.
closeDb();
```

## Scanning and automatic indexing

`scanRepos(roots?, options?)` discovers checkouts and indexes commits, branches,
tags, and sanitized remotes. `scanRepoPaths` skips discovery when the caller
already has exact checkout paths. Incremental scans cap newly read commits;
`full: true` uses the configured full limit.

`ensureWorkspaceBootstrap` additionally installs post-commit hooks and can pull
and push the optional Postgres catalog mirror. `startAutoIndexWorker` returns a
`stop()` handle and watches roots, the hook queue, and periodic discovery.
`watchRepos` is the lower-level filesystem watcher and does not itself index a
change unless callbacks do so.

## GitHub catalog

```typescript
import {
  enumerateGithubRepoCatalog,
  iterateGithubRepoCatalog,
  syncGithubRepoCatalog,
} from "@hasna/repos";

syncGithubRepoCatalog({ maxPages: 1, resume: true });

const firstPage = enumerateGithubRepoCatalog({
  limit: 25,
  filter: { org: "hasna", packageScope: "@hasna", tags: ["loops"] },
});

for (const repo of iterateGithubRepoCatalog({
  filter: { language: "TypeScript", includeArchived: false },
})) {
  console.log(repo.full_name);
}
```

Synchronization shells out to authenticated `gh`; ordinary enumeration reads
the cache. Catalog envelopes use `repos.github-catalog.v1` and include
cache completion/cursor/rate-limit metadata.

## Guarded mutation APIs

Worktree, repository lifecycle, primary relocation, branch adjudication, remote
identity cleanup, todos upsert, and loop report functions mutate state. Their
request and result types are exported. Prefer their typed error classes/codes
over matching message text.

- Worktree destinations are computed below the trusted account root. Removal
  accepts only a lease ID or `<repo>/<worktree>` reference.
- Repository lifecycle functions use station-owned GitHub credentials just like
  their CLI equivalents.
- `relocatePrimaryRepo` and `adjudicateBranches` are dry-run/apply APIs that
  require reviewed plan hashes for apply and persist audit receipts.
- `cleanupRemoteIdentities` requires an explicit remote database, actor, and
  idempotency key; apply also requires its reviewed plan hash.
- `upsertTaskSeeds` is an explicit todos write. Producer builders only return
  task suggestions until the caller invokes it.

## Operational reports

Local ops functions return compact `schema_version: "1.0"` reports with a
status, bounded issues, artifacts, summary, and truncation flag. `withTodos`
adds either a dry-run comment preview or an explicitly requested todos write.

Loop producers return domain-specific versioned envelopes and deterministic
`task_suggestions`. `writeLoopReport` writes a private report file only when a
report directory is supplied.
