---
id: "contracts-release-1-0-2"
title: "Contracts 1.0.2 optional secrets peer release evidence"
type: "release-report"
owner: "codex-fixer"
created_at: "2026-09-06T08:05:24Z"
updated_at: "2026-09-06T09:46:58.620668+00:00"
status: "published"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Scope and provenance

Patch release preparation for `@hasna/contracts` 1.0.2. The consumed Changeset
`.changeset/contracts-optional-secrets-peer.md` marks `@hasna/secrets` as an
optional peer while preserving the `^0.3.10 || ^0.4.0` range. The package
manifest and generated changelog carry the resulting 1.0.2 release metadata.

The Changesets front matter is intentionally limited to package/bump pairs by
the parser contract. This report carries the required artifact metadata for
that machine-consumed entry. Unrelated pending Changesets were isolated during
versioning and restored unchanged.

# Verification state

- The npm registry negative control for `@hasna/contracts@1.0.2` returned E404
  before preparation.
- Root `bun.lock` records Contracts 1.0.2 and its optional peer metadata.
- `apps/contracts/bun.lock` records the union peer range and `optionalPeers`.
- Published 2026-09-06T09:31:01.120Z through the independently reviewed PR #1810 dependency wave. Registry bytes exactly match the candidate digests below. The source PR remains open until all required checks pass.
- Independent ordinary npm installation passed with four packages and no Secrets/Events/Paths. Both CLI aliases report 1.0.2 and list all 47 schemas; all 19 JavaScript exports import under Bun 1.3.14 and Node 26.8.1. Missing optional-peer credential pointers fail closed with zero network calls and no ambient fallback.
- Publication intent and confirmation were recorded in the required publishing channel and tracking task. No global install or quarantine change was needed.

# Candidate lock provenance

The six dependent app locks were regenerated in a temporary loopback registry
fixture from the exact reviewed npm-packed candidate. The fixture forwarded
normal npm metadata and added only the unpublished 1.0.2 version, whose
measured tarball digests were:

- SHA512: `Wq6ma5qR+ozmMabPZ1EyHb3TVRi37jYkrjiEmIpd6ZpTQY5H2gRept/e8kxlA/xOyxFN6bPhKcFQ7FmhuCpnwQ==`
- SHA1 shasum: `8dface63212fb4dd234e38b86567c1923f6eb473`

Bun 1.3.14 generated each lock with the supported registry option. The
committed entries contain the measured SHA512 and no loopback URL. Fresh
frozen installs against the fixture resolved `@hasna/contracts@1.0.2` in all
six apps; the optional `@hasna/secrets` peer was not installed unless another
declared dependency required it.

The dependent wave Changeset `.changeset/contracts-dependent-wave.md` uses the
standard Changesets front matter required by its parser; its release metadata
and candidate lock provenance are recorded in this report because that format
cannot accept the repository-wide metadata fields.

# Independent review corrections

The initial candidate was rejected because its runtime version remained 1.0.1 and the temporary registry metadata omitted CLI bins. The corrected archive aligns the source version, package manifest, service kitVersion and packed CLI at 1.0.2. Full release verification passes 1,561 tests and 15,662 assertions, including real PostgreSQL; the credential-dependent hosted-service test remains skipped.

The replacement fixture derives all candidate metadata from the actual archive package.json, including both CLI bins, and binds only to loopback. All six clean frozen consumers resolve the measured archive, link both contracts and contracts-cli to this package, and report CLI version 1.0.2. Existing successful installs were retained while the Todos fixture was completed with its declared ai workspace. Evidence is retained in the task scratch release-candidate/locks-F0iy7Q directory.

The producer conformance gate now invokes the canonical source validator only for a literal version equal to the in-tree Contracts version. Older versions, ranges and latest retain registry resolution. Real valid/invalid manifest tests and a missing-source negative probe verify that this allows prepublication conformance without waiving any validator result.
