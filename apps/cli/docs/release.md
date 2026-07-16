# Private release process

Version 0.2.0 is prepared for the private `hasna/cli` GitHub repository and the restricted npm package `@hasna/cli` under the `internal` dist-tag. This repository intentionally does not set `private:true`, because restricted publication is the release mechanism.

## Readiness checks

1. Start from a clean, reviewed commit on the protected release branch.
2. Run `bun install --frozen-lockfile`, `bun run check`, `bun run test`, and `bun run build`.
3. Run `bun run package:smoke`. It creates an npm tarball, installs it into an isolated temporary directory, executes `hasna --json version` with Node, and writes local SHA-256 evidence.
4. Run the repository secret scan and inspect staged names/diff.
5. Verify `npm pack --dry-run` contains only `dist`, documentation, package metadata, and `LICENSE`.
6. Publish only after an explicit release authorization: `npm publish --access restricted --tag internal`.

The current task does not authorize pushing, tagging, publishing, or deploying.

## Provenance statement

Private GitHub CI uploads a build-evidence artifact containing the source commit, dirty-state flag, package name/version, tarball SHA-256, and Node/Bun versions. This is useful release evidence, not a public transparency-log attestation. Do not claim npm Sigstore provenance for this private workflow. Public npm provenance may be introduced only after the package and GitHub workflow satisfy npm's supported public provenance model.

The tarball is never committed. Evidence must refer to an exact clean commit and the exact tarball selected for publication.
