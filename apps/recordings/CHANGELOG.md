# Changelog

## 0.3.3

### Patch Changes

- fc80bf1: Record the strong reason for the local-only artifact policy (local-only-capability-removal workflow 2026-08-18): ad-hoc / Developer ID signed, non-notarized builds bound to a single approved target machine are a native macOS distribution policy, not a data-backend capability — the signing identity is keychain-held on the build Mac and the machine binding is the capability itself. The release path keeps rejecting the local-only policy fields as a security control; gate comments in release-install-policy.ts now carry the dated evidence chain. No runtime behavior change.
- 55c591a: Rename the macOS app bundle to HasnaRecordings.app per the fleet naming convention (knowledge k_msxd5rz3_jfvl3i): the full app now builds, signs, notarizes, installs, and updates as `/Applications/HasnaRecordings.app` (display name "Hasna Recordings") for both the full and bar variants — the previous bundle name `Recordings.app` is retained only in install/status discovery and journal recovery so legacy installs are found and cleaned up. The bundle identifier stays `com.hasna.recordings` and the executable inside the bundle stays `Recordings`, so TCC grants and update-client wiring keep keying on the same identity.
  
  The release artifact basename follows the bundle name (`HasnaRecordings-<version>-macos-...`), consistent with the bar variant.
  
  Also hardens install-lifecycle tests whose sentinel `sleep 30` children expired naturally during install cycles that run longer than 30 seconds under load (pre-existing ESRCH flake, reproduced on the base checkout), widens one smoke-timeout budget for the same reason, and teaches the install-journal validator to accept the data-dir `HasnaRecordings.app` install site alongside the legacy `Recordings.app` one.
- First release from the hasna/apps monorepo. The package was imported from hasna/recordings with history preserved (import capsule a28d4f0b, import merge bcff7306); the frozen source tip is the 0.3.0 line (deployment-mode removal), which was never published from the source repo — npm latest there was 0.2.14. The delta vs 0.2.14 is that 0.3.0 content, plus the monorepo workspace wiring and the documented absorption fixes (exact registry pins for @hasna/contracts 0.8.4 and @hasna/events 0.1.11, matching the standalone lockfile). This patch establishes version ownership under the monorepo.
- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

All notable changes to `@hasna/recordings` are documented here.

This project is pre-1.0. Following semver's pre-1.0 convention, a **minor** bump
(`0.x.0`) signals a breaking change; patch bumps (`0.x.y`) do not.

## 0.3.2 — unreleased

### macOS bar-only variant (`8a265e51d`)

The macOS app is now a bar-only successor: a `bar` build variant that ships
only the menu-bar app, a windowless launch mode, a runtime variant check that
rejects the wrong launch mode, and Developer ID signing wired into the build
script. The legacy full-bundle app is replaced by this variant.

### Config-driven API base URL (`ea43dd336`)

The vendored HTTP client's default API base URL no longer derives a hostname
from the app name (bug 21a3b267: an internal-infra URL pattern shipped in the
0.3.1 tarball). `defaultApiBaseUrl` now returns the documented local
self-hosted endpoint (`http://localhost:8874`, the `recordings-serve` default
port), and the configured `HASNA_<APP>_API_URL` always wins. The
internal-infra string can no longer reach a published tarball.

## 0.3.0 — unreleased

**This release is breaking.** It is numbered `0.3.0` rather than `0.2.15`
because `0.2.15` would have shipped the removal below under a patch number.
`0.2.15` was written into `package.json` on 2026-07-27 and never published — npm
`latest` is still `0.2.14` — and the breaking commit landed two days later, on
2026-07-29, under that already-bumped number. Nothing is being retracted here;
the number is being corrected before it ships.

### Breaking — deployment modes are removed (`8ef9ed8`)

`local | self_hosted | cloud`, and the surviving `remote` / `hybrid` aliases,
are gone. They described *where* something ran, which is an operational fact
rather than a product variant. Two independent, role-named switches replace all
five words:

| role | variable | values |
| --- | --- | --- |
| server data backend | `HASNA_RECORDINGS_STORAGE_MODE` | `sqlite` \| `postgresql` |
| client store | `HASNA_RECORDINGS_CLIENT_STORE` | `sqlite` \| `http` |

A retired mode word is now a **hard error** naming the variable to set and the
exact value to set it to — it is not silently normalized. That silent
normalization was the actual defect: the client rewrote `self_hosted | remote |
hybrid` to `cloud` without a word, and the server treated only `remote | hybrid`
as Postgres while every other value — including `self_hosted`, including a typo
— fell through to "is a `DATABASE_URL` set?", discarding the operator's stated
intent. The same variable was also read by two entrypoints with opposite
meanings.

Specific incompatibilities:

- `HASNA_RECORDINGS_STORAGE_MODE` / `RECORDINGS_STORAGE_MODE` now take
  `sqlite` | `postgresql`. A retired mode word throws.
- Client routing moved to `HASNA_RECORDINGS_CLIENT_STORE` /
  `RECORDINGS_CLIENT_STORE` (`sqlite` | `http`). The `API_URL` + `API_KEY`
  auto-flip is unchanged.
- `Store.mode`: `"local" | "cloud-http"` → `"sqlite" | "http"`. Same for
  `TransportResolution.transport` and `describeActiveStore().transport`.
- `TransportResolution.mode` → `.requested`; `.deprecatedAlias` removed — it
  existed only to carry the silently-normalized word.
- Exported type `StorageMode` → `ClientStore`; `defaultCloudBaseUrl` →
  `defaultApiBaseUrl`.
- `isCloudModeEnabled` → `isPostgresBackendEnabled` (plus `resolveDataBackend`,
  `configuredDataBackend`, `DataBackend`).
- `/health`, `/ready`, `/version` report `mode: "sqlite" | "postgresql"` (was
  `"local" | "remote"`). Field names are unchanged.
- An explicit `STORAGE_MODE=sqlite` now wins over a present `DATABASE_URL`.
  Previously `local` there was ignored entirely and the DSN decided.

The client still keeps exactly two stores and still never opens Postgres: there
is no client-side `PostgresStore` and none is added. The shared Postgres dataset
is reachable only through the server's `/v1` API.

`hasna.contract.json` `storage.mode` was deliberately unchanged **by `8ef9ed8`
itself** — that enum belongs to `hasna/contracts`, which was mid-change — and
that commit bumped no dependency, touching only the manifest's free-text
`description`. Both statements are true of `8ef9ed8` and **neither is true of
this release as a whole**: a later commit, `ed94357`, changed both. See the
next section.

### Dependency — `@hasna/contracts` `^0.4.2` → `^0.8.4` (`ed94357`)

`@hasna/contracts` is a runtime `dependencies` entry, so **this bump reaches
every consumer tree**. Installing `@hasna/recordings` `0.3.0` resolves
`@hasna/contracts` at `^0.8.4`, where `0.2.14` resolved it at `^0.4.2`. A
consumer that pins, dedupes, or shares a single `@hasna/contracts` instance
across packages should expect that resolution to move, and should check it
against the other packages in its tree before upgrading.

The same commit migrated `hasna.contract.json` to the matching manifest schema:
`kitVersion` `0.4.2` → `0.8.4`, `storage.mode` `local` → `sqlite`, an explicit
`storage.engines: ["sqlite", "postgres"]` and `storage.pgTestGate`, the removal
of `storage.databaseUrlSecretRef`, and new `hosting` and `serviceSurfaces`
blocks. `hasna.contract.json` is **not** listed in `package.json` `files`, so
none of those manifest changes ship to npm consumers — the dependency range
above is the part of `ed94357` that does.

### Also in this release

`0.3.0` carries 164 commits since the `0.2.15` version bump and 39 user-visible
`feat`/`fix` commits since the published `0.2.14`, including the macOS updater
and paste-coordinator work, the local-station Developer ID signing fix so TCC
grants survive, `noUncheckedIndexedAccess` type strictness, declared `engines`,
and the manual desktop snapshot export command.

## 0.2.14 and earlier

Not documented here; this file starts at `0.3.0`. See the git history and the
GitHub release notes for prior versions.
