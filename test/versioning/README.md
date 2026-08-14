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
VERSIONING_NPM_PARITY=1 VERSIONING_NPM_SAMPLE=@hasna/access bun test --timeout 300000 test/versioning
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

The suite keeps exact, measured baseline exceptions in the test source rather
than weakening the comparison generally. The current exceptions are four
changelog headings, two literal runtime version exports, one npm/main drift
record (the @hasna/loops release-lane drift, reconcile task
69e8b5dd-15cd-4f45-8739-c0edf6720773), and five package names absent from the
local Bun quarantine list. Any changed value or new exception fails the
relevant gate. The pre-import drift census entries for
apps/{economy,events,feedback,recordings} (non-members of this repo) and the
@hasna/repos entry (registry == main) were pruned 2026-08-14.
Member-owned metadata repairs are tracked separately from this test-only PR.

The package-version/change-set check intentionally uses a static diff against
`VERSIONING_BASE_REF` (default `origin/main`), so the test never mutates a
checkout by running `changeset version`. A package manifest version added to a
PR must have a corresponding pending changeset entry.
