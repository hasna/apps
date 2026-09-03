# Versioning integrity tests

`versioning.test.ts` is a hermetic, read-mostly suite for the publishable
`apps/*` members. It checks package identity and semver, pending changeset
shape, package-version changes without a changeset, workspace reference
rewrites, changelog/runtime metadata, and Bun quarantine coverage.

The npm parity test is opt-in because it reads the public registry. The full
run queries every member, so it needs a longer per-test timeout than the 5s
default (a single `npm view` spawn carries a 5s fetch timeout of its own):

```sh
VERSIONING_NPM_PARITY=1 bun test --timeout 300000 test/versioning
VERSIONING_NPM_PARITY=1 VERSIONING_NPM_SAMPLE=@hasna/mementos bun test --timeout 300000 test/versioning
```

Network failures produce an explicit `[SKIP versioning]` marker. Set
`VERSIONING_NPM_OFFLINE=1` to make an offline run explicit.
`VERSIONING_STRICT=1` turns missing `minimumReleaseAgeExcludes` entries from
informational output into a failure for the release lane. For a real CLI flag,
use the checked-in runner (Bun consumes custom arguments before test files see
them):

```sh
bun run test/versioning/run.ts --strict
```

The runner rejects unknown options and forwards the exact test exit code.

## The changelog lane is STRICT (f05fe292 design, option b')

`changelog release headings match package versions` asserts
`expect(mismatches).toEqual([])` with no exception map. The release lane writes
the CHANGELOG.md heading for the released version in the same commit that bumps
`package.json`; import PRs fix any carried heading lag in the import commit.
A fresh mismatch is therefore a defect in the landing commit — correctly red,
and owned by the release lane, not by a record editor. The former
`KNOWN_CHANGELOG_MISMATCHES` map is deleted: it was a debt ledger for a step the
release lane did not perform, with a measured record half-life of ~2.5h against
a longer review cycle.

## Changeset-consuming release PRs are exempt from the version-without-changeset check

`a package.json version change is accompanied by a changeset` diffs
`apps/*/package.json` against `VERSIONING_BASE_REF` (default `origin/main`) and
requires every changed member to appear in a PENDING changeset. A
changeset-consuming release PR (the `changeset version` output: version bumps +
CHANGELOG.md headings + the applied `.changeset/*.md` files DELETED) fails that
by construction — the release lane bumps package.json BECAUSE a changeset was
consumed, so no new changeset accompanies the bump. Measured on hasna/apps#277
(@hasna/prompts 0.3.33, 2026-08-17) and hasna/apps#154 (hooks 0.6.4).

The exemption is the changeset-versioning DIFF SHAPE, not a blanket
release-branch carve-out: `consumedChangesetPackages()` reads the
`.changeset/*.md` files deleted in `base...HEAD` from the base ref and treats
the packages they named as accompanied — the changeset that backed the bump is
in the diff, consumed rather than pending. A plain unbacked bump deletes
nothing under `.changeset/` and stays red. Both arms are pinned as synthetic
git-repo tests in the suite (a release-shaped diff is recognized; a plain bump
is not), so the detector cannot silently rot into a pass-everything.

## The parity lane is a REPORTING lane (f05fe292 design, option a)

The npm-parity keyspace has two independent writers (publishes from other repos
vs imports into this one), so no commit in this repo can hold registry==main.
On live drift the lane:

1. finds-or-creates a reconcile task keyed on the exact fingerprint title
   `Reconcile @hasna/<pkg> main <m> vs npm <r>` via
   `todos task upsert --fingerprint <title> --title <title> ...` (idempotent:
   a re-run files nothing new — the same fingerprint resolves to the same task);
2. prints the two-sided report: package, main version, registry version, and
   the reconcile task id;
3. passes — drift never fails the lane.

Reconcile tasks are filed in todos project
`5e44770b-694c-46a3-864f-20a2b9ec1de2` (the release/versioning lane project;
set `VERSIONING_TODOS_PROJECT` to override), assigned to `agent-ea`
(`todos task upsert --assign agent-ea --assign-seat`, the lane's documented
identity — attribution does not depend on an ambient `TODOS_AGENT_ID`; set
`VERSIONING_TODOS_AGENT` to override). If the `todos` CLI is unavailable the
lane reports the drift with `NOT FILED` and still passes — the report is the
deliverable.
The former `KNOWN_NPM_DRIFT` map is deleted: it was always stale within minutes
(5 drifts recorded and 2 stale in one review cycle, measured 2026-08-14).

The two-sided contract lives in the report, not the failure: both sides are
printed for every drift, and the fingerprint embeds both versions, so a drift
whose either side changed is re-filed under its own fingerprint rather than
silently accepted.

The suite keeps one exact, measured baseline in the test source: two literal
runtime version exports (catalog 0.2.0/0.1.0, treasury 0.1.1/0.1.0,
`KNOWN_RUNTIME_MISMATCHES`) — hand-written source constants, a different class
from a release-lane ledger, verified still firing at this change. Any changed
value or new runtime mismatch fails the gate. Five package
names are absent from the local Bun quarantine list (informational by
default). The pre-import drift census entries for
apps/{economy,events,feedback,recordings} (non-members of this repo) and the
@hasna/repos entry (registry == main) were pruned 2026-08-14. The
@hasna/instructions and @hasna/hooks npm-drift records were removed
2026-08-14 when the registry caught up to main (0.4.35 and 0.6.3
respectively, after #119/#117/#121 merged); the @hasna/hooks changelog
heading exception was removed the same day because package 0.6.3 now matches
its changelog heading.
Member-owned metadata repairs are tracked separately from this test-only PR.

The package-version/change-set check intentionally uses a static diff against
`VERSIONING_BASE_REF` (default `origin/main`), so the test never mutates a
checkout by running `changeset version`. A package manifest version added to a
PR must have a corresponding pending changeset entry.
