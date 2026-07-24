# Changelog

## 0.3.6 — 2026-07-24

Reconciliation release. Realigns `main` with the published npm line (`@hasna/files@0.3.5`,
git tag `npm/files/v0.3.5`), whose code had been shipped to the registry ahead of `main`
(which still read `0.2.49`). `main` was a strict ancestor of the published tag with **zero**
`main`-only commits, so this brings the 11 published commits onto `main` without dropping or
rewriting any history, then bumps the version above the published `0.3.5` so the next release
does not collide with the registry.

Published commits now reflected on `main` (0.2.49 → 0.3.5 line):

- feat(mcp): route files MCP reads/writes to cloud in self_hosted mode
- build(dist): bundle @hasna/contracts + mcp-harness into cli/mcp for self-contained fleet tarball
- refactor(store): route CLI + MCP data plane through a single Store seam
- fix(mcp): route every MCP tool through the Store seam
- fix(mcp): route agent registry + activity through the Store seam
- fix(store): close evidence + organization split-brain via the Store seam
- fix(store,cli,mcp): truthful api-mode deletes, graceful errors, on-box byte-resolution guards
- fix(cli,mcp,store): drop broken /machines/current preflight from source create+list
- chore: bump to 0.3.3
- fix(cli,evidence): guard context/search packs to on-box mode + persist local evidence root
- fix(cli): bound ops db-integrity with wall-clock budget + per-DB busy_timeout

Not included (left on `flip/mcp-cloud-routing` for separate review, **not dropped**): 4
post-0.3.5 unreleased commits (evidence/S3 presign header signing, cloud 404 guards, docker
dev-dep tolerance, cloud `/v1/files/recent` 404 guard).
