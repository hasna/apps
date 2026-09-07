---
id: contracts-1-0-2-source-reconciliation
title: Contracts 1.0.2 published source reconciliation
type: release-report
owner: codex
created_at: 2026-09-06
status: verified
---

# Published artifact and source

`@hasna/contracts@1.0.2` was published at `2026-09-06T09:31:01.120Z` while
[PR #1810](https://github.com/hasna/apps/pull/1810) remained open. This change
separates its Contracts release and required consumer dependency pins from
the unrelated Switcher implementation and consumer version releases. It does
not publish another package.

The Contracts files come from reviewed candidate commit
`8f8e888713329fdef4e03ef8098e504bcb759f88`. The registry archive has SHA-1
`8dface63212fb4dd234e38b86567c1923f6eb473` and SHA-512
`Wq6ma5qR+ozmMabPZ1EyHb3TVRi37jYkrjiEmIpd6ZpTQY5H2gRept/e8kxlA/xOyxFN6bPhKcFQ7FmhuCpnwQ==`.
Both digests were independently recomputed from the
[published archive](https://registry.npmjs.org/@hasna/contracts/-/contracts-1.0.2.tgz).
The registry metadata does not include a Git head or provenance attestation.

All 238 tracked package files match that archive exactly. An isolated Bun
1.3.14 build also reproduced its three untracked generated declarations:
`dist/cli/check-signing-secret.d.ts`, `dist/deployment-envelope-fixtures.d.ts`,
and `dist/deployment-envelope.d.ts`. All 241 published files therefore match
the rebuilt package byte for byte.

# Dependency and validation boundaries

The Secrets peer becomes optional; its existing `^0.3.10 || ^0.4.0` range is
preserved. The package version, kit version, source constant, and bundled
version constants agree at 1.0.2. Credential resolution behavior is unchanged.

The existing versioning gate rejects six exact consumer pins one patch behind
Contracts. Knowledge, Projects, Secrets, Skills, Switcher, and Todos therefore
pin published Contracts 1.0.2; the three corresponding explicit validator kit
versions also align. A pending six-package patch Changeset records the changes.
Consumer package versions and application source remain unchanged.
Knowledge's four committed bundles are regenerated from its unchanged source
because they embed its package dependency metadata; its own version stays
0.3.0. The unminified bundle changes are only the Contracts pin, and the
minified CLI is rebuilt with the required Bun 1.3.14 compiler.

Bun 1.3.14 regenerated the root lock and each consumer lock. Each standalone
consumer was installed frozen in an isolated directory against the real npm
registry; both installed Contracts CLI aliases report 1.0.2 in all six. The
Todos fixture includes its declared `ai` workspace. No temporary registry URL
or candidate archive path is committed in the locks.

Local verification passed the package build, typecheck, conformance, frozen
root install, and registry-backed frozen-lock gate. Package tests passed
1,555 tests and 15,643 assertions; eight PostgreSQL checks and one
credential-backed hosted check were skipped in the isolated environment.
The ordinary npm packed-consumer smoke passed without installing Secrets or
Events; ordinary credentials resolve, and an unavailable vault pointer fails
closed without falling back to an ambient credential.
