# Publish law — public @hasna/* releases from this repo

This repo is the PRODUCER of public `@hasna/*` packages. Releases here are the
inverse of the platform's: public scope, public access.

There are exactly two publish paths. **OIDC trusted publishing is the default
for a tagged release** (Path A). The **vault-token per-package `npm publish`
remains the documented fallback** (Path B), and is the only path for packages
that are not yet bound as trusted publishers. Neither path is a way around the
release gate; both publish one package at a time, and never `bun publish`.

## Versioning

- Changesets, **independent** versions (`fixed: []` — each member versions on
  its own cadence). `bunx changeset` to add, `bunx changeset version` to apply,
  via worktree + PR. Access is `public` (`.changeset/config.json`).
- Patch-level discipline unless the task says otherwise.

## Path A — OIDC trusted publishing (DEFAULT for a tagged release)

An annotated tag `npm/<app>/v<semver>` on a commit that is on protected `main`
(or a `workflow_dispatch` run) drives `.github/workflows/release-app.yml` — job
`publish`, GitHub environment `npm-release`, `permissions: contents: read` +
`id-token: write`. The job resolves the tag through the checked-in allowlist
inside its own resolver step (`RELEASE_PACKAGES`: `packagePath` / `manifestPath`
/ `packageName` / `tagPrefix` / `authority`), reads the manifest **at the tagged
commit** (`git show <sha>:<manifestPath>`), never the working tree, then
publishes:

```text
npm publish --provenance --access public
```

No npm token of any kind is present on this path — no vault lane key, no
`secrets exec`, no temp npmrc. The trust comes from the OIDC identity token
exchanged with the registry.

**The workflow FILENAME and the environment are CONTRACT, not implementation
detail.** npm binds a trusted publisher to `owner/repo` + workflow **filename**
+ environment. Renaming `.github/workflows/release-app.yml`, changing the
environment, or moving the publish step into another workflow silently
unbinds every package and must be handled as a release-infrastructure change
(re-point the npm trusted-publisher config for every bound package in the same
change).

Toolchain: trusted publishing needs npm >= 11.5.1 and the workflow pins it;
the ambient laptop npm is not the release toolchain. Provenance requires a
public repository — true for `hasna/apps`.

The lane fails closed. It has no soft-skip branch, and a failure means nothing
was published:

- unknown tag prefix (no allowlist entry) — refuse, never guess;
- ambiguous tag prefix — more than one allowlist entry matches, so no single
  package is identified;
- version absent from the resolved manifest, a mismatch between the tag version
  and the manifest version, or a version string containing whitespace or `/`;
- the resolved manifest's `name` disagreeing with the allowlist's
  `packageName`;
- `publishConfig.registry` that is not `https://registry.npmjs.org`;
- the release commit is not the tagged commit, or is not an ancestor of
  `origin/main`;
- the version already exists on the registry (negative control before publish);
- **no `prepublishOnly` gate on the resolved manifest** — npm only runs a hook
  that exists, so a missing one is a silent ungated publish;
- on a `workflow_dispatch` run, an absent `scripts["verify:release"]` — a manual
  run exists to exercise the package's own release checks, and a package with
  none must not report success;
- a resolved `authority` that no publish step claims — a tag push that matched
  no publish step would otherwise end green having published nothing;
- **`repository.url` that is not this repository** (below).

**Blast radius while the precedents are still live.** Path A is added ALONGSIDE
`release.yml` (`npm/secrets/v*`) and `release-todos.yml` (`npm/todos/v*`), which
this change does not modify or decommission: `@hasna/secrets` and `@hasna/todos`
therefore each have two workflows that can trigger on the same tag. Once those
two members are bound to Path A, the precedents must be decommissioned — a
decommission is a separate change with its own review.

### The `repository.url` binding — and which packages still need the token

The OIDC lane binds a package to this repo by the identity its manifest
declares, so the declared identity IS the gate:

```json
"repository": { "type": "git", "url": "https://github.com/hasna/apps.git", "directory": "apps/<name>" }
```

A package whose `repository.url` is anything else cannot be bound as a trusted
publisher. Four of those values are refused under ORG LAW (owner ruling
2026-09-10 — the `hasnaxyz` org no longer exists and neither do the
pre-monorepo per-app repos), and the lane refuses all of them:

- a bare per-app name, `github.com/hasna/<app>.git`, that is not literally
  `hasna/apps` — the pre-monorepo shape;
- `github.com/hasnaxyz/*` (org deleted) or `hasna-products/*`;
- a URL whose app name does not match the package;
- no `repository` field at all — nothing to bind.

Measured 2026-09-10 at `4138908db`, over the 45 member manifests
(`apps/*/package.json` + `apps/todos/ai/package.json`):

| `repository.url` state | count | OIDC |
|---|---|---|
| byte-exact `https://github.com/hasna/apps.git` — `@hasna/messages`, `@hasna/todos` | 2 | bindable as-is |
| right repo, written `git+…` and/or without `.git` — connectors, emails, notes, prompts, recordings, secrets, skills, switcher, workflows | 9 | bindable — the lane normalises these spellings explicitly (below) |
| dead per-app name — every other allowlist row, incl. `@hasna/attachments`, `@hasna/contracts` and `@hasna/todos-ai` (which lives at `apps/todos/ai`, not `apps/*`) | 34 | refused — vault token required |

The counts are a snapshot; the LIVE list is the printed set of this command (run
from the repo root). It reads the allowlist out of the workflow and applies the
lane's own normalizer, so the list cannot drift from the lane. It requires
`.github/workflows/release-app.yml` to be in the tree, i.e. it applies once the
workflow change lands:

```bash
node -e 'const fs=require("fs");const C="https://github.com/hasna/apps";const n=u=>typeof u!=="string"?"":u.trim().toLowerCase().replace(/^git\+/,"").replace(/^ssh:\/\/git@github\.com\//,"https://github.com/").replace(/^git@github\.com:/,"https://github.com/").replace(/\/+$/,"").replace(/\.git$/,"").replace(/\/+$/,"");const w=fs.readFileSync(".github/workflows/release-app.yml","utf8");for(const m of w.matchAll(/manifestPath: "([^"]+)", packageName: "([^"]+)"/g)){const j=JSON.parse(fs.readFileSync(m[1],"utf8"));if(n(j.repository?.url)!==n(C))console.log(m[2],j.repository?.url??"(none)");}'
```

**Which packages still require the vault token, and why.** Every package that
command prints. The reason is one of two, and both are manifest-lane work, not
publish-time exceptions:

- the manifest names a dead repository identity (a pre-monorepo per-app repo, a
  deleted org, a mismatched app name) — the fix is `repository.url` →
  `https://github.com/hasna/apps.git` (plus `repository.directory` →
  `apps/<name>`);
- the manifest declares no `repository` field at all — same fix.

A package becomes eligible for Path A the moment its manifest declares this repo;
it does not need a new release, only a manifest fix and a fresh tag.

**The lane's normalization is explicit, never silent.** npm treats
`git+https://github.com/hasna/apps.git`, the same URL without `.git`, a trailing
slash and the ssh spellings as one repository, and the resolver in
`.github/workflows/release-app.yml` documents and applies exactly that
normalization (`normaliseRepository`) — so the 9 packages in the table's middle
row ARE bindable, and the command above (which uses the same normalizer) does
not list them. A dead name still normalises to a different repository and is
still refused. A quiet loosening would be forbidden; this one is stated in the
file that implements it.

`repository.directory` is set on 5 of the 45 manifests. It is not needed for the
OIDC binding, but it is our own identity claim; add `apps/<name>` whenever the
manifest is next touched.

## Path B — vault token, per-package npm publish (documented FALLBACK)

`bun publish` has no workspace filter, and the changesets+bun combination has a
measured `workspace:*` tarball-leak defect. The fallback form is per-package
`npm publish` from the package directory:

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

The fallback exists for exactly three situations:

1. **The package is not bindable as a trusted publisher** — the
   `repository.url` list above. This is the common case today.
2. **A re-cut after a failed or unsupported tag run**, where the release commit
   cannot be re-tagged (the tag lane publishes only from a tag; if the tag
   cannot move, the same commit is published by hand).
3. **An operator-driven `workflow_dispatch` publish** for a package whose
   binding is not yet configured on npm.

It is a delivery path, never a gate bypass: a package the tag lane refuses for a
version, receipt, provenance or gate reason is refused here too. When the
fallback is used, say why in the `git-publishing` announcement (findings 1-3
above).

## Sequence

1. **Version** (above), commit via worktree+PR.
2. **Announce intent** on `git-publishing`: `<pkg>@<version>` + one-line
   changelog, BEFORE publishing. Say which path (A or B) and, for B, which of
   the three fallback reasons applies.
3. **Publish** — push the `npm/<app>/v<semver>` tag and let the OIDC lane run
   (A), or run the vault-token form (B).
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
- **The OIDC lane is the default; the token path is the fallback.** Do not use
  the token path for a package that is bindable, and do not add a package to the
  release table to work around a manifest defect — fix the manifest.
- The CI `publish-guard` job blocks internal-infra strings in packed
  tarballs (`*.hasna.xyz`, ARNs, AWS account ids) — placeholder until member
  packages land; keep it honest, never make it a check that cannot fail.
- Cross-member deps: prefer published versions. `workspace:*` deps leak into
  tarballs under the changesets+bun publish path.
- A just-published package is quarantined from `bun install -g` for 7 days
  unless its EXACT name is added to `minimumReleaseAgeExcludes`
  (`~/.bunfig.toml`, exact names only, no wildcards). Never lower the
  quarantine itself.
- An auth error on Path B is evidence about the DELIVERY PATH (npmrc pairing)
  before it is evidence about the token — re-check the pairing first. An auth
  error on Path A is a trusted-publisher binding problem (filename, environment,
  or `repository.url`); there is no token to re-check.
