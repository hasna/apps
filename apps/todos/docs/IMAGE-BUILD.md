# Container image build — how a todos image actually gets made

This file exists because the answer used to live only in one person's shell
history. Read this before assuming any release has produced a shippable image.

## What ships to npm and what ships as a container are two different pipelines

Publishing `@hasna/todos` to npm (`npm publish`, gated by
`scripts/verify-public-release.ts` via `prepublishOnly`) does **not** build or
push a container image. Nothing in `.github/workflows/ci.yml` touches Docker,
ECR, or CodeBuild — CI only type-checks, tests, and builds the npm artifact.

Before this change, the only way a container image reached ECR was:

1. Zip the repo by hand and upload it to
   `s3://hasna-xyz-opensource-todos-prod/_build/todos-src.zip`.
2. Invoke the `todos-prod-image-builder` CodeBuild project by hand, which reads
   its **inline** buildspec (`aws codebuild batch-get-projects
   --names todos-prod-image-builder`) — a bare `docker build --platform
   linux/arm64 ... && docker push`, with no SBOM, no vulnerability gate, no
   smoke test, and no automated trigger. That inline buildspec is *not* the
   `buildspec.container-candidate.yml` file in this repo (see below).

That is the packaging gap this change closes: a candidate image now gets
built, scanned, and pushed from `.github/workflows/ecr-candidate.yml` on an
explicit, confirmed `workflow_dispatch`, mirroring the identical
already-proven pattern in `hasna/loops`
(`.github/workflows/ecr-candidate.yml`, role `loops-ecr-candidate-github`,
last used 2026-07-29). This is not a new design — it is the fleet's
established shape for "build, scan, push a candidate image" applied to this
repo.

## `buildspec.container-candidate.yml` is real, thorough, and NOT what runs today

This repository already contains a second, far more rigorous CodeBuild
buildspec: SBOM (Syft), a hard `grype --fail-on high` vulnerability gate, a
pinned/verified Bun base image loaded from a private S3 archive (because the
`todos-prod-image-builder-role` IAM role is push-only on ECR and cannot pull
its own mirror), full Postgres TLS smoke tests (verify-full, wrong CA, wrong
host), an HTTP smoke test against a running container, and OCI 1.1
provenance/evidence attached via `oras`. It matches, nearly line for line, the
seven-point acceptance checklist in `docs/CUTOVER-RUNBOOK.md` under "Cloud
container runtime boundary."

**It is registered nowhere.** The live `todos-prod-image-builder` CodeBuild
project's `source.buildspec` is a separate, inline, bare spec — confirmed via
`aws codebuild batch-get-projects --names todos-prod-image-builder`. Nothing
points CodeBuild at `buildspec.container-candidate.yml`. It is invoked, if at
all, by someone running `aws codebuild start-build` with a `buildspecOverride`
by hand — there is no evidence in this repo of when that last happened.

**This PR does not wire it in**, and that is a deliberate scope decision, not
an oversight. Promoting `buildspec.container-candidate.yml` to be what
`todos-prod-image-builder` actually runs is a real decision with real
consequences that a packaging-gap fix should not make unilaterally:

- It would make the existing 30-minute CodeBuild timeout tight (SBOM + Grype +
  full Postgres/HTTP smoke suite is meaningfully slower than a bare build).
- It hard-fails the entire build if Grype finds a single HIGH or CRITICAL
  finding — turning every release into a security gate that nobody has
  exercised end-to-end recently, without anyone having decided that a build
  should block on it.
- The pinned base-image archive metadata it verifies against
  (`_build/base/oven-bun-1.3.14-alpine-arm64-3c9ab1a5-9c9690c0.docker.tar` in
  the same S3 bucket) needs to be confirmed still current before trusting it.

**Recommendation, not a decision made here:** file a follow-up to either (a)
retire the CodeBuild candidate path in favor of the GitHub Actions
`ecr-candidate.yml` workflow added by this PR (which already carries an
equivalent scan gate via Trivy, both locally and via ECR scan-on-push), or (b)
deliberately promote `buildspec.container-candidate.yml` into
`todos-prod-image-builder` with its timeout and gate consequences reviewed and
accepted. Running both indefinitely just recreates the "which one is real"
confusion this document exists to resolve.

## What `.github/workflows/ecr-candidate.yml` actually does

- Triggered only by `workflow_dispatch`, requiring a full 40-character commit
  SHA that is confirmed as an ancestor of `origin/main`, plus a typed
  `push <sha>` confirmation string — an accidental or automatic build cannot
  happen.
- Builds natively for `linux/arm64` on GitHub's own `ubuntu-24.04-arm`
  runners (no QEMU, no cross-compilation emulation) using the existing
  `runner` stage in this repo's `Dockerfile` — no changes to the Dockerfile
  were needed.
- Verifies the built image reports Bun 1.3.14 and the `package.json` version
  before doing anything else with it.
- Runs Trivy locally (CRITICAL/HIGH gate) before ever touching AWS credentials,
  then authenticates to AWS via GitHub OIDC (no long-lived AWS keys stored in
  GitHub), asserts the ECR repository is `IMMUTABLE` + `scanOnPush`, pushes
  under a `candidate-<short-sha>-<full-sha>` tag, and refuses to overwrite an
  existing tag.
- Waits for and enforces the ECR scan-on-push result (CRITICAL/HIGH gate) —
  a second, independent scan of the pushed layers, not just the local build.
- Emits an SBOM (CycloneDX) and an in-toto/SLSA provenance statement as
  workflow artifacts (30-day retention) and a run summary.
- **Never deploys.** It does not touch ECS, does not move a `latest` tag, and
  has no path to production traffic. Deploying the resulting candidate is a
  separate, later decision by whoever owns that rollout.

## Adopting `ecr-candidate.yml` for another repository

A fleet-wide sweep (`agent-chief-operations`, 2026-08-02) found 18 of 23
hosted services have an npm version ahead of their container image — this is
not a `hasna/todos`-specific gap, it is the fleet's default state, and todos
is simply the instance someone looked at first. This workflow was written so
a second repository can adopt it by changing configuration, not by
reverse-engineering and rewriting the step bodies:

- **Repository name, local build tag, and the SLSA `buildType` URL** are all
  derived at runtime from `GITHUB_REPOSITORY` — nothing in the step bodies
  hardcodes `todos`.
- **The expected Bun version** is read directly off the target repo's own
  `Dockerfile` (the `oven/bun:<version>-alpine` pin), so the check can never
  drift from what that Dockerfile actually builds.
- **ECR repository, AWS region, and the IAM role ARN** come from three GitHub
  Actions repository variables (`ECR_REPOSITORY`, `AWS_REGION`,
  `AWS_ROLE_ARN`) on an Environment named `ecr-candidate` — set once per repo,
  never edited into the workflow file itself.

To adopt it: copy `.github/workflows/ecr-candidate.yml` unchanged into the
target repo, confirm that repo's Dockerfile has a build stage literally named
`runner` (or edit the one `--target runner` reference if it doesn't), create
that repo's own narrowly-scoped IAM role (see "Provisioned alongside this PR"
above for the exact shape — **do not reuse the `todos` role's ARN**, ECR push
access must stay scoped to one repository per role), flip that repo's ECR
image tag mutability to `IMMUTABLE` if it isn't already, and set the three
Environment variables.

**What this PR does not do:** build a shared, centrally-maintained reusable
workflow (`workflow_call`) that every repo references instead of copying.
That is a real option and probably the right end state once a few repos have
adopted the copy-paste version and the shape has proven stable — but it is a
different, larger change (a new home for the shared workflow, a version/pinning
policy for it, and a blast radius of "every repo using it" instead of one),
and it belongs to whoever owns the fleet-wide image-build convention, not to
a fix scoped to `hasna/todos`.

## Why `workflow_dispatch` only, not "on every merge to main"

This is the first automation of a pipeline that has been entirely hand-run
since it existed. An automatic trigger on every push to `main` would start
pushing a scanned candidate image to ECR for every merged PR, whether or not
anyone intended that commit to become a release candidate — a bigger change
than "stop hand-zipping the repo." Once this path has been exercised a few
times and someone decides the fleet wants an image built on every release
(tag-based, or tied to the npm `prepublishOnly` gate), that is a follow-up
change to the `on:` block, not part of closing today's gap.

## What still needs to be provisioned before this workflow can run

This PR adds the workflow file only. Per this task's scope ("do not deploy
anything"), the following AWS/GitHub configuration was set up alongside it —
see the PR description for exactly what was created, so it can be reviewed
rather than discovered later:

- IAM role `todos-ecr-candidate-github` (OIDC trust scoped to
  `repo:hasna/todos:environment:ecr-candidate`, permissions scoped to
  `ecr:GetAuthorizationToken` plus push/pull/scan-read on the `todos`
  repository only — mirrors `loops-ecr-candidate-github` exactly).
- ECR repository `todos`: `imageTagMutability` changed from `MUTABLE` to
  `IMMUTABLE` (required by the workflow's own preflight check, matches the
  `loops` repository's setting; `scanOnPush` was already `true`).
- GitHub repository environment `ecr-candidate` on `hasna/todos` with
  variables `AWS_REGION`, `AWS_ROLE_ARN`, `ECR_REPOSITORY`.
