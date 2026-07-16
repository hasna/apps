# Private GitHub Packages release process

Version 0.2.0 is prepared for the private `hasna/cli` GitHub repository and the private GitHub
Packages npm package `@hasna/cli` under the `internal` dist-tag. Package metadata pins publication
to `https://npm.pkg.github.com`. This repository intentionally does not set `private:true`, because
that field prevents publication entirely; privacy is enforced by GitHub package visibility and
repository access.

The public npmjs package with the same name is a separate registry object. Its historical version
`@hasna/cli@0.1.0` is public and deprecated in favor of `@hasna/agency`. Never publish version 0.2.0
to npmjs, and never fall back to npmjs when GitHub Packages authentication or authorization fails.

## Readiness checks

1. Start from a clean, reviewed commit on the protected release branch.
2. Confirm `bunfig.toml` still enforces the seven-day quarantine and excludes only the exact
   supervised package name `@hasna/cli` for this release.
3. Run `bun install --frozen-lockfile --ignore-scripts`, `bun run check`, `bun run test:coverage`, and `bun run build`.
4. Run `bun run package:smoke`. It creates an npm tarball, installs it with lifecycle scripts disabled into an isolated temporary directory, executes version and help using Node, and writes local SHA-256 evidence.
5. Run `node scripts/verify-package-artifact.mjs hasna-cli-0.2.0.tgz` to reject unexpected files,
   credential patterns, absolute user paths, or source maps with embedded source content.
6. Run the repository secret scan and inspect staged names/diff.
7. Verify `npm pack --dry-run` contains only `dist`, documentation, package metadata, and `LICENSE`.
8. Record the exact reviewed main commit and tarball SHA-256 before authorizing publication.

## Manual workflow

Only `.github/workflows/private-release.yml` may publish version 0.2.0. Dispatch it from `main`
with the exact version, reviewed 40-character main commit, and reviewed tarball SHA-256. The job has
only `contents:read` and `packages:write`; it uses `secrets.GITHUB_TOKEN` as `NODE_AUTH_TOKEN` and
never persists the token.

Before the first dispatch, repository administrators must configure the `private-release` GitHub
environment with at least one required human reviewer and restrict deployment branches to `main`
only. Do not dispatch if either protection is absent. The workflow still verifies the selected ref,
exact commit, and current remote `main` after environment approval and fails closed on drift.

The workflow fails closed unless the selected ref is current `main`, package metadata targets
GitHub Packages, the version is absent with an authenticated `E404`, all tests and package checks
pass, and the rebuilt tarball matches the supplied SHA-256. It publishes that tarball with:

```bash
npm publish "$TARBALL" --registry=https://npm.pkg.github.com --access restricted --tag internal --ignore-scripts
```

There is no npmjs fallback. Authentication, authorization, duplicate-version, ref, version, hash,
privacy, repository-link, install, or tag mismatches fail the workflow. A failed post-publication
verification requires incident handling; it does not authorize a retry with another registry or
version.

Both the pre-publication local-tarball install and post-publication registry install use an isolated
npm user configuration. The default registry remains npmjs for unscoped dependencies, while only
the `@hasna` scope is routed to `https://npm.pkg.github.com`. This prevents an explicit GitHub
Packages `--registry` flag from incorrectly routing ordinary dependencies away from npmjs.

## Installation and privacy verification

Authorized consumers must route the scope to GitHub Packages and inject a classic GitHub token
with `read:packages` through `NODE_AUTH_TOKEN`:

```ini
@hasna:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

After publication, require all of the following before creating a Git tag or GitHub release:

- the GitHub Packages API reports `visibility: private` and repository `hasna/cli`;
- `internal` resolves to exactly version 0.2.0 and no `latest` dist-tag was created;
- an authenticated tarball download has the reviewed SHA-256;
- an authenticated isolated install executes `hasna --json version` successfully; and
- an anonymous metadata request is denied.

Anonymous denial is not proof of private visibility: GitHub Packages requires authentication for
public npm packages too. The authenticated GitHub API visibility result is the privacy authority;
denial for a separate authenticated identity without package access is additional access-control
evidence when such an identity is available.

## Provenance statement

Private GitHub CI uploads a build-evidence artifact containing the source commit, dirty-state flag, package name/version, tarball SHA-256, and Node/Bun versions. This is useful release evidence, not a public transparency-log attestation. Do not claim npm Sigstore provenance for this private workflow. Public npm provenance may be introduced only after the package and GitHub workflow satisfy npm's supported public provenance model.

The tarball is never committed. Evidence must refer to an exact clean commit and the exact tarball selected for publication. Git tags and GitHub releases are separate, later operations and must not be created until registry verification succeeds.
