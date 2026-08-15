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
than weakening the comparison generally. The current exceptions are five
changelog headings (calendar 0.3.1/0.3.0, instructions 0.4.35/0.4.33 —
release-lane mismatch from #119, reconcile task 1bb8cf0a, loops 0.4.42/0.4.41,
secrets 0.2.22/0.2.21, signatures 0.1.14/0.1.12), two literal runtime version
exports (catalog 0.2.0/0.1.0, treasury 0.1.1/0.1.0), four npm/main drift
records (the @hasna/loops release-lane drift, reconcile task
69e8b5dd-15cd-4f45-8739-c0edf6720773, the @hasna/emails release-lane
drift, reconcile task 78c66e3c-baba-4ba6-9295-99b4df7ebc25, the
@hasna/contracts import drift 0.11.0/0.10.6, reconcile task
48a6ef7f-0919-470d-99f4-59817a01c647, and the @hasna/secrets
release-lane drift 0.3.0/0.2.22, reconcile task
3ab02291-58b0-40c7-b96f-958ee1ef4a61), and five package
names absent from the local Bun quarantine list. Any changed value or new
exception fails the relevant gate. The pre-import drift census entries for
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
