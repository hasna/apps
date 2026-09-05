---
"@hasna/contracts": patch
---

Declare the `@hasna/secrets` peer as `^0.3.10` rather than an exact `0.3.10`.

`@hasna/secrets` is at 0.3.13, so the exact peer pin no longer matched any
`@hasna/secrets` that exists — every install printed
`warn: incorrect peer dependency "@hasna/secrets@0.3.x"`, and inside this
workspace it was worse than cosmetic: the moment a member exact-pins the in-tree
`@hasna/contracts` version, bun links the workspace member, the unsatisfiable
peer closes a `secrets -> contracts -> peer @hasna/secrets` cycle, and
`bun install --frozen-lockfile` at the repo root fails with "lockfile had
changes, but lockfile is frozen" on a lockfile that `bun install` calls
unchanged (measured on bun 1.3.14, from a clean `node_modules` and from a
lockfile regenerated from scratch). hasna/apps#1720 is the first pin to hit
it.

The peer is only reached by the lazily-required secrets-vault pointer tier
(`HASNA_<APP>_API_KEY_REF`), which works against any 0.3.x vault SDK, so the
range is what the dependency actually is. No code changes.

Widened again to `^0.3.10 || ^0.4.0` by the 2026-09-04 credential-resolver
release train, which ships `@hasna/secrets` 0.4.0 while `@hasna/contracts`
stays at 1.0.1 in-tree: measured on that train's tree with the pinned bun
1.3.14, the `^0.3.10` range alone re-closed the cycle above the moment the
workspace `@hasna/secrets` became 0.4.0 (`bun install` rewrote the root
lockfile and `bun install --frozen-lockfile` failed with "lockfile had
changes, but lockfile is frozen"). The seam the pointer tier loads
(`createSecretsClientFromEnv` + `getSecret`) is unchanged in 0.4.0. Still no
code changes.
