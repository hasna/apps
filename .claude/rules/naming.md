# Naming — public producer tree

- **Package names:** every member package is `@hasna/<name>` — PUBLIC, npm
  `access: public`. Kebab-case name; the package name suffix MUST equal its
  directory (`apps/<name>` ↔ `@hasna/<name>`). Enforced by the CI
  name-conformance gate (`tooling/ci/check-names.ts`).
- **No `@hasna-internal/*` in this tree, ever.** This repo PRODUCES public
  packages; the private scope belongs to `hasna-internal/platform`. A
  `@hasna-internal/*` name here is a naming-gate violation.
- **No internal-infra strings** anywhere a published tarball could carry them:
  `*.hasna.xyz`, `arn:aws:*`, 12-digit AWS account ids. Enforced by the CI
  publish-guard (placeholder until member packages land).
- **Four surfaces per member** (see `apps/README.md`): CLI bin, MCP bin,
  `-serve` server bin, `./sdk` importable module. One package owns one domain;
  no duplicate abstractions across members.
- Directories follow the tree: kebab-case package dirs, per-package
  `tsconfig.json` extending `../../tsconfig.base.json`, per-package `AGENTS.md`
  when the package has laws beyond the repo's.
- Consult `knowledge` tag=convention before naming anything new (fleet rule).
