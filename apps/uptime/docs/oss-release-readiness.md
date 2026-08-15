# Public OSS Release Decision

## Decision: HOLD

Do not make `hasna/uptime` public and do not publish another public npm release.
No explicit approval to change the GitHub repository visibility has been
recorded. The machine-readable decision is in `oss-release-decision.json`.

This is a release gate, not authorization to change repository visibility. A
maintainer must record explicit approval separately before changing this
decision to `GO`; editing the decision file is not itself approval.

## Evidence reviewed on 2026-07-29

- `gh repo view hasna/uptime --json visibility,isPrivate` reported `PRIVATE`.
- `@hasna/uptime@0.1.69` is publicly readable from npm and its `repository`,
  `homepage`, and `bugs` metadata point to `hasna/uptime`. Users therefore see
  public package links to a repository they cannot access.
- npm reports the SHA-512 integrity value and a registry signature for 0.1.69,
  but no `dist.attestations` and no `gitHead`. Those values protect registry
  distribution; they do not prove which source commit produced the package.
  No alternate source-to-package evidence has been approved.
- `package.json` declares Apache-2.0 and includes `LICENSE`, `NOTICE`, and
  `THIRD_PARTY_NOTICES.md` in the package. The release audit checks the Apache
  license and notice markers and verifies that the third-party notice table
  matches the runtime dependency closure in `bun.lock`.
- The tracked worktree and complete local Git history passed the release audit's
  high-confidence credential scan and Gitleaks 8.30.1 with no findings. This
  result is point-in-time evidence only; both scans must be rerun for the
  approved release candidate.

## Required path to GO

1. Obtain explicit approval from a repository owner to make
   `hasna/uptime` public and record the approved release commit in
   `oss-release-decision.json`. Do not infer approval from an npm release or
   from a `GO` edit.

   The approved commit is recorded inside the tree it approves, so the recording
   commit is necessarily a child of it. The gate accounts for that: it requires
   `releaseCandidateCommit` to be a full 40-character SHA that is HEAD or an
   ancestor of HEAD, and it requires HEAD to change nothing since that commit
   except `docs/oss-release-decision.json` and this file. So the flow is: pick
   the candidate commit, write its SHA into the decision record, commit only the
   decision record, and publish from there. Any other change after the approved
   commit means the tree being published is not the approved one, and the gate
   names the offending paths.
2. Rerun the gate on a clean release-candidate commit. Resolve all secret-scan,
   legal, package-content, and dependency-notice findings before exposing Git
   history.
3. Make the repository public only as the approved visibility operation, then
   rerun the online gate so the public package links and GitHub visibility
   agree.
4. Publish from the trusted-publishing workflow in
   `.github/workflows/release.yml`, which runs `npm publish --provenance` with
   `id-token: write`. The `--provenance` request deliberately lives in that
   workflow and not in `publishConfig`: npm only generates an attestation from a
   supported CI provider and refuses to publish at all when `provenance` is set
   outside one, which would break local and patch releases. If trusted
   publishing cannot be used, record and approve alternate evidence containing
   the immutable source commit — the same commit recorded as
   `releaseCandidateCommit` — and the package SHA-512 before setting `GO`.
5. Verify the attestation the publish minted with `bun run release:oss:verify`,
   which the release workflow runs immediately after `npm publish`.
6. Record the final `GO` or `HOLD` decision, reviewer, release version, commit,
   visibility observation, provenance evidence, and scan results. A registry
   signature or checksum alone is not alternate source provenance.

## The gate runs in two phases

A publish gate cannot demand evidence that only the publish it gates can create.
Before publication npm holds no integrity, `gitHead`, or `dist.attestations` for
the version being published, and `npm view` answers E404 for it. Requiring that
evidence up front would make `GO` unreachable and would block every later
release, including a security patch, so the gate splits the requirement:

- **Pre-publish** (`release:oss:check`, and `prepublishOnly`): an absent version
  is the expected state, not an audit error. The recorded `provenance` block is
  compared against the registry only when the recorded version is already
  published. `provenance.status: VERIFIED` is satisfied by the *capability* to
  mint an attestation — the `id-token: write` plus `npm publish --provenance`
  workflow audited by the gate — or by approved alternate evidence.
- **Post-publish** (`release:oss:verify`, run by the release workflow straight
  after `npm publish`): the version must be on the registry, carry a registry
  signature, carry an SLSA provenance attestation or approved alternate
  evidence, and report a `gitHead` that is the approved release candidate
  commit.

The gate reads repository visibility with `gh`, which needs a token. Every
workflow step that runs it is given `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, and
the gate fails its own static audit if a gate-running step lacks one.

## Commands

```bash
bun run release:oss:audit
gitleaks git --redact --no-banner
bun run build
bun run typecheck
bun test
bun pm pack --dry-run
bun run release:oss:check
bun run release:oss:verify   # after `npm publish`, not before
```

`release:oss:audit` succeeds when the recorded state is accurate, including a
recorded `HOLD`. `release:oss:check` succeeds only for an approved, clean,
public, provenance-backed `GO` candidate. It is also part of `prepublishOnly`,
so the current `HOLD` blocks ordinary npm publishing.
