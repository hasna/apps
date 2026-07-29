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
2. Rerun the gate on a clean release-candidate commit. Resolve all secret-scan,
   legal, package-content, and dependency-notice findings before exposing Git
   history.
3. Make the repository public only as the approved visibility operation, then
   rerun the online gate so the public package links and GitHub visibility
   agree.
4. Publish from an npm trusted-publishing environment with provenance. The
   checked-in `publishConfig.provenance` setting requests an attestation; after
   publication, verify that npm exposes `dist.attestations`. If trusted
   publishing cannot be used, record and approve alternate evidence containing
   the immutable source commit and package SHA-512 before setting `GO`.
5. Record the final `GO` or `HOLD` decision, reviewer, release version, commit,
   visibility observation, provenance evidence, and scan results. A registry
   signature or checksum alone is not alternate source provenance.

## Commands

```bash
bun run release:oss:audit
gitleaks git --redact --no-banner
bun run build
bun run typecheck
bun test
bun pm pack --dry-run
bun run release:oss:check
```

`release:oss:audit` succeeds when the recorded state is accurate, including a
recorded `HOLD`. `release:oss:check` succeeds only for an approved, clean,
public, provenance-backed `GO` candidate. It is also part of `prepublishOnly`,
so the current `HOLD` blocks ordinary npm publishing.
