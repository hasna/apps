# Versioning integrity tests

`versioning.test.ts` is a hermetic, read-mostly suite for the publishable
`apps/*` members. It checks package identity and semver, pending changeset
shape, package-version changes without a changeset, workspace reference
rewrites, changelog/runtime metadata, and Bun quarantine coverage.

The npm parity test is opt-in because it reads the public registry:

```sh
VERSIONING_NPM_PARITY=1 bun test test/versioning
VERSIONING_NPM_PARITY=1 VERSIONING_NPM_SAMPLE=@hasna/access bun test test/versioning
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
changelog headings, two literal runtime version exports, five pre-import
npm/main drift records, and five package names absent from the local Bun
quarantine list. Any changed value or new exception fails the relevant gate.
Member-owned metadata repairs are tracked separately from this test-only PR.

The package-version/change-set check intentionally uses a static diff against
`VERSIONING_BASE_REF` (default `origin/main`), so the test never mutates a
checkout by running `changeset version`. A package manifest version added to a
PR must have a corresponding pending changeset entry.
