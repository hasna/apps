# Publish law — public @hasna/* releases from this repo

This repo is the PRODUCER of public `@hasna/*` packages. Releases here are the
inverse of the platform's: public scope, public access, and the `hasna` org
token.

## Versioning

- Changesets, **independent** versions (`fixed: []` — each member versions on
  its own cadence). `bunx changeset` to add, `bunx changeset version` to apply,
  via worktree + PR. Access is `public` (`.changeset/config.json`).
- Patch-level discipline unless the task says otherwise.

## Publish (per-package npm publish — never `bun publish`)

`bun publish` has no workspace filter, and the changesets+bun combination has a
measured `workspace:*` tarball-leak defect. The fleet form is per-package `npm
publish` from the package directory:

```bash
NPMRC="$(mktemp)"; chmod 600 "$NPMRC"
printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "$NPMRC"
secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- \
  npm publish --userconfig "$NPMRC" --access public
rm -f "$NPMRC"
```

Run from the package directory (`apps/<name>`). Never `VAR=$(secrets get …)`
(assigns a redacted/empty string); never print the token; never rely on an
ambient `~/.npmrc`. Token key: `hasna/npm/live/publish-token` (presence probe:
`secrets get <key> --check`).

## Sequence

1. **Version** (above), commit via worktree+PR.
2. **Announce intent** on `git-publishing`: `<pkg>@<version>` + one-line
   changelog, BEFORE publishing.
3. **Publish** with the form above.
4. **Verify two-sided:** `npm view @hasna/<pkg> version` prints the NEW
   version; `npm view @hasna/<pkg> time --json` timestamp is fresh. Negative
   control before publishing: the same `npm view` did NOT already show that
   version — if it did, someone else published; stop and reconcile, don't
   republish.
5. **Confirm in-thread** on `git-publishing`; comment the todos task with
   `<pkg>@<version>` + the verify output line.

## Guardrails

- **Never publish `@hasna-internal/*` from this repo** — that scope is the
  platform's.
- The CI `publish-guard` job blocks internal-infra strings in packed
  tarballs (`*.hasna.xyz`, ARNs, AWS account ids) — placeholder until member
  packages land; keep it honest, never make it a check that cannot fail.
- Cross-member deps: prefer published versions. `workspace:*` deps leak into
  tarballs under the changesets+bun publish path.
- A just-published package is quarantined from `bun install -g` for 7 days
  unless its EXACT name is added to `minimumReleaseAgeExcludes`
  (`~/.bunfig.toml`, exact names only, no wildcards). Never lower the
  quarantine itself.
- An auth error here is evidence about the DELIVERY PATH (npmrc pairing)
  before it is evidence about the token — re-check the pairing first.
