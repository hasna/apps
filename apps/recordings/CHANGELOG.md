# Changelog

## 0.3.13

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.3.12

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.3.11

### Patch Changes

- e9f5c51: Wire the contracts `keyStatus` hook in the /v1 server: `verifyApiKey` no longer throws at construction (contracts 0.9.0+ refuses the deprecated `isRevoked`-only wiring eagerly), so every authenticated read path (GET /recordings, GET /stats, …) stops returning 503 "authentication service unavailable" while /health and /version stayed 200. Denied requests now also emit a `[recordings-serve] auth deny` warn carrying the kid and reason.

## 0.3.10

### Patch Changes

- 50473b8: fix: main CI recovery — regenerate per-app lockfiles after the #856/#923 version waves (frozen-lockfile class), repin projects' dependencies to the published conversations 0.7.4 / mementos 0.14.85 / todos 0.15.41 (the wave-pinned 0.7.5/0.14.86/0.15.43 were never published), sync recordings' Info.plist to 0.3.9 and secrets' runtime version literal to 0.3.4, and clear the publish-guard internal-infra string violations across connectors/emails/skills/secrets/telephony plus the guard's over-broad ARN/domain content patterns.
- 15b6181: Migrate the HTTP storage client to the @hasna/contracts client seam: resolveStorageClient is now imported from @hasna/contracts/client/storage instead of the vendored copy, and the app's own resolver (resolveStoreClient) keeps the partial-pair fail-closed contract on top of the seam's call-time credential chain.

## 0.3.9

### Patch Changes

- 15b6181c: Migrate the HTTP storage client to the @hasna/contracts client seam: resolveStorageClient is now imported from @hasna/contracts/client/storage instead of the vendored copy, and the app's own resolver (resolveStoreClient) keeps the partial-pair fail-closed contract on top of the seam's call-time credential chain (deliberate override, profile, disk, then the deprecated env fallback). The manifest kitVersion is aligned to the pinned @hasna/contracts 0.13.4.
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.3.8

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.
- c5335b7b: Store selection is the environment contract only, with the explicit client-store override retained. The client's store is `sqlite | http`, auto-selected by the presence of BOTH `HASNA_RECORDINGS_API_URL` and `HASNA_RECORDINGS_API_KEY`; a partial hosted setup (one of the two set) fails closed instead of silently reading the wrong dataset. The explicit `HASNA_RECORDINGS_CLIENT_STORE` switch (`sqlite` | `http`) wins over the auto-selection, so an existing configuration with `HASNA_RECORDINGS_CLIENT_STORE=sqlite` keeps reading the local file even when the hosted URL/key pair is present (patch-compatible). `RECORDINGS_API_KEY` remains the OpenAI transcription-key override only and never selects or fails client transport. `defaultApiBaseUrl` is removed: a hosted client is selected only by a configured API URL, never by a defaulted hostname.
  - @hasna/contracts@0.13.3

## 0.3.7

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.3.6

### Patch Changes

- d0ad3a7: fix: generate:sdk passes again at @hasna/contracts 0.13.1 — the query serializer now emits array-aware serialization natively (per-item append, null/undefined skipped), so the script asserts the measured 0.13.1 shape instead of patching the retired 0.8.4 scalar-only output, and v1.generated.ts is regenerated from the current API.
- release-gate remediation (adversarial review of the 0.3.6 candidate): all version sites (src/version.ts, Info.plist) synced to 0.3.6 so the prepack version:check passes and the CLI reports the published version; apps/recordings/bun.lock regenerated to resolve @hasna/contracts 0.13.1 (frozen-lockfile installs in Dockerfile.package and build_companion_cli.sh now accept the tarball); the macOS initial-bootstrap artifact basename is derived from the canonical HasnaRecordings.app identity instead of the retired Recordings-\* form; the release install resolves the root-owned update client from the installed app path so legacy 0.3.2-era /Applications/Recordings.app installs upgrade in place, and the preinstall cohort validation accepts the legacy bundle path.

## 0.3.5

### Patch Changes

- @hasna/contracts@0.13.1

## 0.3.4

### Patch Changes

- b4f0e4d: Make the recordings macOS native CI discoverable: the Swift/C compile gate moved from the nested `apps/recordings/.github/workflows/ci.yml` (a silent dead lane — GitHub Actions only discovers workflows at the repo root, so the native half compiled nowhere in the monorepo) to the root-discoverable `.github/workflows/recordings-macos.yml`, scoped to `apps/recordings/**`. A merged main now provably compiles the macOS app's Swift half, closing the "CI build-and-sign path" gap named by the stale-sweep on todos 1a2ba6ad. App assembly and delivery to the owner's Mac remain the fleet-Mac ship lane (Developer ID signing material tracked separately on todos 63ce6ecc).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

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

### Selection is the environment contract alone

The client's store is `sqlite | http`, auto-selected by the presence of BOTH
`HASNA_RECORDINGS_API_URL` and `HASNA_RECORDINGS_API_KEY`; a partial hosted
setup (one of the two set) fails closed instead of silently reading the
wrong dataset. The explicit `HASNA_RECORDINGS_CLIENT_STORE` switch (`sqlite` |
`http`) wins over the auto-selection. `defaultApiBaseUrl` is removed: a hosted
client is selected only by a configured API URL, never by a defaulted hostname.

## 0.3.0 — unreleased

**This release is breaking.** It is numbered `0.3.0` rather than `0.2.15`
because `0.2.15` would have shipped the removal below under a patch number.
`0.2.15` was written into `package.json` on 2026-07-27 and never published — npm
`latest` is still `0.2.14` — and the breaking commit landed two days later, on
2026-07-29, under that already-bumped number. Nothing is being retracted here;
the number is being corrected before it ships.

### Breaking — deployment modes are removed (`8ef9ed8`)

`local | self_hosted | cloud`, and the surviving `remote` / `hybrid` aliases,
are gone. They described _where_ something ran, which is an operational fact
rather than a product variant. Two independent, role-named switches replace all
five words:

| role                | variable                        | values                   |
| ------------------- | ------------------------------- | ------------------------ |
| server data backend | `HASNA_RECORDINGS_STORAGE_MODE` | `sqlite` \| `postgresql` |
| client store        | `HASNA_RECORDINGS_CLIENT_STORE` | `sqlite` \| `http`       |

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
