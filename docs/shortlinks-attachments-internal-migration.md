# Shortlinks and Attachments production-source migration

**Prepared:** September 17, 2026
**Status:** blocked from merge until the internal source, restricted packages, production services, and public-link acceptance are independently verified.

`shortlinks` and `attachments` are transitioning to internal hosted application ownership. This public change removes their producer sources only after the reviewed handoff receipt below is complete.

## Continuity contract

The move changes source ownership, not the public service authorities:

- Shortlinks remains available through `https://api.hasna.com/shortlinks/v1`.
- Attachments remains available through `https://api.hasna.com/attachments/v1`.
- Existing fleet authentication and drift checks remain registered in
  `tooling/fleet/hosted-apps.json`; both entries are now `source: "external"`.
- Live databases, object storage, gateway routing, credentials, and deployed
  services are not migrated or mutated by this public-repository change.

The public package sources, package-local CI/deploy files, generated artifacts,
and package lockfiles leave this workspace together. Existing npm releases are
historical artifacts; no new release of either package is produced from this
repository.

## Deployment handoff

Attachments previously carried a nested standalone-repository deploy workflow.
That workflow was not discoverable by GitHub Actions in this monorepo and was
tracked as an unported exception. The workflow and its exception leave with the
package. Shortlinks had no root deployment lane in this repository. Future builds and deployments for both applications must be proven from the reviewed internal authority before this retirement merges.

## Public-repository verification

The focused retirement checks use Bun 1.3.14:

```bash
bun install --frozen-lockfile --ignore-scripts
bun tooling/ci/check-names.ts
bun tooling/ci/check-deploy-lanes.ts --self-test
bun tooling/ci/check-deploy-lanes.ts
bun test test/versioning
bun test tooling/ci/tests/standard/fleet-key-provisioning.test.ts
bun run check:manifests
bun tooling/ci/check-frozen-locks.ts
```

The full CI sequence additionally builds the affected graph before running the
repository-wide pack checks:

```bash
bunx turbo run build --affected
bun run check
```

The fleet inventory deliberately keeps both services after the workspace members
are removed. This preserves monitoring of the canonical gateway and credential
boundary while making it explicit that production artifacts are built elsewhere.

## Required handoff receipt before merge

Record the exact internal source PR and merge SHA, restricted package versions and install verification, ECS task definitions and image digests, API acceptance, `has.na` redirect acceptance, and rollback preimages here. Until every field is concrete, this public retirement remains a draft and must not merge.
