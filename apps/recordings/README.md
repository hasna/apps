# @hasna/recordings

Speech-to-text recording tool with MCP and CLI — records, transcribes, and optionally enhances text using AI

[![npm](https://img.shields.io/npm/v/@hasna/recordings)](https://www.npmjs.com/package/@hasna/recordings)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/recordings
```

## macOS App

**Hasna Recordings** is a native macOS 26 app with a companion menu bar control.
The app opens a compact glass recorder with a microphone/stop/play control and timer.
The clock opens a separate searchable history panel; the gear opens Settings.
A floating transcription bar shows live words, the microphone waveform, pause/resume,
playback, and an Auto-paste switch. Recent pastes show delivery evidence from this session.
There is no sidebar or project UI. New app recordings are unassigned; existing recordings and their metadata
are preserved.

- Click Record, or hold the global shortcut (F5 by default).
- Click the clock or press **⌘L** for recordings; select a row to read its transcript.
  Audio playback is available when its file is retained on this Mac.
- Press **⇧⌘B** for the floating transcription bar, or choose **Keep bar visible** from
  the menu bar’s More menu. Its play control opens Recent pastes.
- Pause/resume from the bar or the recorder’s context menu. Paused microphone samples
  are excluded from the transcript and recording duration.
- Turn **Auto-paste** off to keep transcripts available without typing into another app.
  Recordings still save through the configured API. Clearing Recent pastes only clears
  this session’s delivery list; it does not delete recordings.
- Open **Settings** (⌘,), then **API & Advanced…** to configure the service connection,
  transcription cleanup, shortcuts, and permissions. The input follows the macOS default
  microphone; audio remains uncompressed 24 kHz PCM.

New installations default to dictation. Question and edit-command detection is
optional in Settings; enabling it can add a model request before delivery. For
verbatim dictation with the shortest delivery path, keep intent detection off and
set Transcription Cleanup to Raw (Off). Settled realtime text can paste while the API save
continues in the background. Capture shutdown runs off the UI thread, and the
recording panel avoids animated glass so rendering does not stall live transcription.

In **Settings → API & Advanced… → General → Recordings API**, enter your API URL and service key,
then choose **Save Connection** and **Test Connection**. There is no compiled-in API
hostname. Both a service prefix such as `https://api.example.com/recordings` and its
versioned form `https://api.example.com/recordings/v1/` work; requests append the
resource to exactly one `/v1`. The service key stays in macOS Keychain, scoped to the
normalized endpoint, and is separate from the OpenAI transcription key.

An explicitly configured launch environment takes precedence over saved connection
settings: `HASNA_RECORDINGS_API_URL` plus the existing Hasna credential chain, or
`HASNA_RECORDINGS_CLIENT_STORE=sqlite` for an intentional local store. The native app
passes the connection to its embedded CLI, so recording persistence, history, and
deletion use the same API client as the CLI and MCP. No local fallback is selected
when an API connection is missing or fails.

The bundle filename is **Hasna Recordings.app** for both full and menu bar builds.
Older unspaced bundles remain discoverable as legacy installations. The managed
updater's canonical path is part of its immutable cohort; an existing cohort bound
to the old filename requires managed reprovisioning before receiving bundles under
the new name. This change does not rename an already installed managed app.

The app embeds a same-version `recordings` CLI as its data layer, so the CLI, MCP, and app
share one store without depending on a possibly stale global CLI installation. Production
release installs use a one-time managed bootstrap at `/Applications/Hasna Recordings.app`; later
release updates replace only that app through the installed root-owned broker.

```bash
# One-time production bootstrap, run by MDM/root with independently authenticated values:
# The three input files must use canonical paths beneath root-owned, non-writable directories.
sudo packaging/macos/managed_bootstrap.sh \
  --artifact /path/to/Recordings-0.2.13-macos-initial-bootstrap-updater.pkg \
  --manifest /path/to/Recordings-0.2.13-macos-initial-bootstrap.manifest.json \
  --envelope /path/to/Recordings-0.2.13-macos-initial-bootstrap-updater.bootstrap-envelope.json \
  --expected-package-sha256 AUTHENTICATED_PACKAGE_SHA256 \
  --expected-installer-team-id TEAMID1234 \
  --expected-installer-certificate-sha256 AUTHENTICATED_INSTALLER_CERTIFICATE_SHA256

# After bootstrap, install only a signed app artifact through the immutable cohort:
recordings app install \
  --artifact /path/to/Recordings-0.2.13-macos-app-update.zip \
  --manifest /path/to/Recordings-0.2.13-macos-app-update.manifest.json \
  --envelope /path/to/Recordings-0.2.13-macos-app-update.update-envelope.json \
  --manifest-sha256 AUTHENTICATED_MANIFEST_SHA256 \
  --expected-source-sha APPROVED_40_CHARACTER_COMMIT_SHA \
  --expected-version 0.2.13 \
  --expected-hostname station03 \
  --expected-team-id TEAMID1234

recordings app open           # launch it
recordings app status         # show install state
recordings app snapshot       # write ./desktop-snapshot.png for local UI debugging
# From this repository, optionally choosing another output path:
bun run desktop:snapshot -- /tmp/recordings-desktop.png
"/Applications/Hasna Recordings.app/Contents/Helpers/recordings-update-client" status

# Release builds run only as the isolated _recordingsbuild account. Provision these first:
# - /private/var/recordings-build owned by _recordingsbuild, mode 0700, beneath a
#   root-owned non-writable parent;
# - /Library/Application Support/Hasna/Recordings/BuildTrust/isolated-builder-v1
#   as a root-owned non-linked mode-0444 file containing recordings-isolated-builder-v1;
# - an absolute Bun executable, clean source commit, locked dependencies, Swift/Xcode,
#   universal native guard, unlocked Developer ID Application identity, notarytool profile,
#   and 32-byte Ed25519 public/private release-envelope keys (private key owner-only).
cd src/native/Recordings
# Fresh source checkouts must install the locked JavaScript dependencies first:
(cd ../../.. && /absolute/path/to/bun install --frozen-lockfile)

# One-time initial bootstrap. This is the only subtype that accepts an Installer identity;
# it does not accept RECORDINGS_RELEASE_COMPATIBLE_COHORT_MANIFEST and emits no update envelope.
HOME="/private/var/recordings-build/home" \
BUN_EXECUTABLE="/absolute/path/to/bun" \
RECORDINGS_CODESIGN_IDENTITY="Developer ID Application: ..." \
RECORDINGS_INSTALLER_CODESIGN_IDENTITY="Developer ID Installer: ..." \
RECORDINGS_EXPECTED_TEAM_IDENTIFIER="TEAMID1234" \
RECORDINGS_NOTARY_KEYCHAIN_PROFILE="recordings-notary" \
RECORDINGS_RELEASE_SEQUENCE="1" \
RECORDINGS_RELEASE_KEY_EPOCH="1" \
RECORDINGS_RELEASE_ENVELOPE_EXPIRES_AT_UTC="2026-08-01T00:00:00.000Z" \
RECORDINGS_RELEASE_ENVELOPE_PRIVATE_KEY="<path to your private envelope key>" \
RECORDINGS_RELEASE_ENVELOPE_PUBLIC_KEY="/absolute/public/envelope-key.raw" \
  ./build.sh release initial-bootstrap

# After independent review, root-preauthorize the exact emitted cohort for later updates.
COHORT_MANIFEST="/private/var/recordings-build/release-output/Recordings-0.2.13-macos-initial-bootstrap-updater.compatible-cohort.json"
COHORT_DIGEST="$(/usr/bin/awk 'NR == 1 { print $1 }' "${COHORT_MANIFEST}.sha256")"
test "$(/usr/bin/shasum -a 256 "${COHORT_MANIFEST}" | /usr/bin/awk '{ print $1 }')" = "${COHORT_DIGEST}"
sudo /usr/bin/install -d -o root -g wheel -m 0755 \
  "/Library/Application Support/Hasna/Recordings/BuildTrust/compatible-cohorts"
sudo /usr/bin/install -o root -g wheel -m 0444 "${COHORT_MANIFEST}" \
  "/Library/Application Support/Hasna/Recordings/BuildTrust/compatible-cohorts/${COHORT_DIGEST}.json"

# App-only update. Copy the reviewed bootstrap cohort manifest into the root-owned
# compatible-cohorts directory under its exact SHA-256 filename before invoking this.
# No Installer identity, PKG, broker, verifier, bootstrap preflight, marker, or bootstrap
# envelope is used or emitted by this subtype.
HOME="/private/var/recordings-build/home" \
BUN_EXECUTABLE="/absolute/path/to/bun" \
RECORDINGS_CODESIGN_IDENTITY="Developer ID Application: ..." \
RECORDINGS_EXPECTED_TEAM_IDENTIFIER="TEAMID1234" \
RECORDINGS_NOTARY_KEYCHAIN_PROFILE="recordings-notary" \
RECORDINGS_RELEASE_SEQUENCE="2" \
RECORDINGS_RELEASE_KEY_EPOCH="1" \
RECORDINGS_RELEASE_ENVELOPE_EXPIRES_AT_UTC="2026-08-15T00:00:00.000Z" \
RECORDINGS_RELEASE_ENVELOPE_PRIVATE_KEY="<path to your private envelope key>" \
RECORDINGS_RELEASE_ENVELOPE_PUBLIC_KEY="/absolute/public/envelope-key.raw" \
RECORDINGS_RELEASE_COMPATIBLE_COHORT_MANIFEST="/Library/Application Support/Hasna/Recordings/BuildTrust/compatible-cohorts/AUTHENTICATED_COHORT_SHA256.json" \
  ./build.sh release app-update

# Explicit local-only alternative when Developer ID credentials are unavailable.
# Build on a Mac other than the approved target; this does not replace a release.
# The approved targets are declared once in
# scripts/policy/local-only-approved-targets.txt, which the builder, the installer,
# and the artifact tool all read; add a Mac there rather than in any guard:
RECORDINGS_LOCAL_APPROVED_TARGET="station06" \
RECORDINGS_LOCAL_APPROVED_TARGET_IDENTITY_KIND="tailscale_node_id_sha256" \
RECORDINGS_LOCAL_APPROVED_TARGET_IDENTITY_SHA256="AUTHENTICATED_TAILSCALE_NODE_ID_SHA256" \
  BUN_EXECUTABLE="/absolute/path/to/bun" \
  ./build.sh local

# Install only on that exact target, with the immutable manifest digest recorded separately:
recordings app install \
  --artifact /path/to/Recordings-0.2.13-macos-station06-local-only.zip \
  --manifest /path/to/Recordings-0.2.13-macos-station06-local-only.manifest.json \
  --manifest-sha256 AUTHENTICATED_MANIFEST_SHA256 \
  --expected-source-sha APPROVED_40_CHARACTER_COMMIT_SHA \
  --expected-version 0.2.13 \
  --artifact-policy local-only \
  --approved-target station06 \
  --approved-target-identity-kind tailscale_node_id_sha256 \
  --approved-target-identity-sha256 AUTHENTICATED_TAILSCALE_NODE_ID_SHA256 \
  --acknowledge-local-signing-and-permissions \
  --launch

# Reinstalling or repairing an already-installed local-only app additionally needs
# --allow-adhoc-identity-migration. Local-only builds are ad-hoc signed, so every rebuild
# produces a new CDHash; replacing the installed app is therefore a real identity migration
# and the installer refuses it with exit 1 until you approve it once, explicitly. Approving
# it voids the Microphone and Accessibility grants held by the replaced app -- macOS keys
# those to code identity and the installer cannot restore them -- so expect to grant both
# again afterwards. Run `scripts/install_macos_app.sh --help` for the full argument list.
recordings app install \
  --artifact /path/to/Recordings-0.2.13-macos-station06-local-only.zip \
  --manifest /path/to/Recordings-0.2.13-macos-station06-local-only.manifest.json \
  --manifest-sha256 AUTHENTICATED_MANIFEST_SHA256 \
  --expected-source-sha APPROVED_40_CHARACTER_COMMIT_SHA \
  --expected-version 0.2.13 \
  --artifact-policy local-only \
  --approved-target station06 \
  --approved-target-identity-kind tailscale_node_id_sha256 \
  --approved-target-identity-sha256 AUTHENTICATED_TAILSCALE_NODE_ID_SHA256 \
  --acknowledge-local-signing-and-permissions \
  --allow-adhoc-identity-migration \
  --launch
swift test                    # run the native test suite
```

The production release location is `/Applications/Hasna Recordings.app`. The managed bootstrap installs
one signed/notarized PKG exactly once, including the root broker, no-login verifier, launchd policy,
release key, and initial app. That root cohort is intentionally immutable:
`lifecycle=bootstrap-v1-app-updates-only`,
`root_maintenance_supported=false`, and `key_rotation_supported=false`. Subsequent release
envelopes must bind the exact installed broker/verifier cohort, protocol version, and pinned key
epoch, and may replace only `/Applications/Hasna Recordings.app`. A second bootstrap PKG, a broker or
verifier mismatch, a broker-protocol incompatibility, or a key-epoch change fails before app
activation with `unsupported_lifecycle`. Root updater maintenance and release-key rotation require a
separate managed reprovisioning lifecycle; the current tooling does not run Installer or overwrite
root trust as an update fallback.

Managed deployments should prefer a root-owned, `root:wheel` `/Applications` directory with mode
`0755`. The updater intentionally also accepts the macOS-compatible `root:admin` mode `0775`, but
that compatibility permits local admin-group actors to race application-namespace operations and
force fail-closed recovery or another availability loss. It does not authorize an update or bypass
the signed release, code-signing, or audit-token peer checks.

Before Installer runs, the managed bootstrap copies all three release inputs into a root-private
snapshot, verifies the out-of-band PKG digest, Gatekeeper decision, Installer certificate and Team
ID, expands that exact PKG without installing it, and runs its separately Developer-ID-signed
`recordings-bootstrap-preflight` executable. The preflight validates the Ed25519 signature and
expiry plus the package, manifest, app tree, code requirements, protected components, bootstrap
marker, key epoch, and installer-certificate bindings. Installer is never used when preflight
fails. A retry after a crash may skip Installer only when the complete immutable cohort is already
present and the absent, highest-seen, or committed release state exactly matches the same signed
bootstrap; partial or conflicting cohort evidence fails closed.

An `initial-bootstrap` release emits the stapled PKG, its digest and notary evidence, the
bootstrap envelope, and a schema-v2 compatible-cohort manifest plus its digest. The release
operator must retain that complete bootstrap set as the canonical onboarding artifact for the
cohort. New machines are onboarded only with that retained PKG set; a later `app-update` must
never be substituted for it, and rebuilding the same version is not a recovery mechanism.
Replacing any root component, Installer certificate, or release key requires a separately
approved managed-reprovisioning lifecycle.

Each `app-update` build requires
`RECORDINGS_RELEASE_COMPATIBLE_COHORT_MANIFEST` to name a root-owned, mode-0444,
content-addressed JSON file under
`/Library/Application Support/Hasna/Recordings/BuildTrust/compatible-cohorts/`. Its schema must
be exactly version `2` with no additional or missing keys. It authorizes exactly lifecycle
`bootstrap-v1-app-updates-only`, protocol version `1`, the current pinned key epoch,
`root_maintenance_supported=false`, and `key_rotation_supported=false`, together with the
finalized stapled cohort PKG, bootstrap marker, Installer certificate, exact release-envelope
public-key SHA-256, broker and verifier digests and designated requirements, Team ID, and minimum
broker version. Every source-directory ancestor must be canonical, root-owned, and non-writable;
the builder validates the content-addressed source once, copies it into its private build
directory, and reads only that stable snapshot. The builder refuses a mutable, misnamed, broader,
schema-mismatched, key-mismatched, or otherwise incompatible cohort manifest.

Release installation accepts only a finalized ZIP plus its manifest, signed update envelope, and
operator-supplied authenticated provenance. The manifest binds the bundle identifier, version,
source commit, architectures, pinned Team ID, designated-requirement digest, companion version and
hash, complete app-tree hash, archive hash, and trusted signing timestamps. The root broker verifies
the signed envelope, immutable cohort, monotonic release state, isolated verifier result, and
candidate code identity before transactional activation. Compatible app-only updates preserve the
stable signing identity and do not reset Microphone or Accessibility permissions. The updater never
calls `tccutil reset`, clears quarantine, re-signs an artifact, or builds on the target machine. A
private, fsynced root journal and anti-rollback state recover interrupted app replacement before the
next install attempt.

The explicit `local-only` development path remains separate and installs
`~/Applications/Hasna Recordings.app`; it never provisions or imitates the production root cohort.
For a station-specific deployment, pass `--expected-hostname` so the installer proves the live
short hostname before taking a lock or mutating state while the release artifact itself remains
fleet-distributable. Obtain `AUTHENTICATED_MANIFEST_SHA256` from independently authenticated
release evidence (for example, signed release metadata or the reviewed release ledger), never by
hashing the co-delivered manifest on the target. The release build prints the manifest digest for
that separate recording step. Release mode runs the native Swift test suite before compiling and
rechecks the clean pinned source commit before provenance and finalization.

An unattended build is valid only when the Developer ID private key and notarization profile are
already provisioned, unlocked, and authorized on the non-target builder. Tooling does not bypass a
Keychain approval prompt or manufacture credential authority. Likewise, SSH runtime smoke binds
evidence to the exact executable path but cannot prove foreground/key-window behavior; final UI
acceptance requires a logged-in console session or equivalent trusted GUI automation.

The `local` build mode is an explicit, target-scoped exception. It still requires a clean source
commit, an immutable ZIP and manifest, matching app/helper architectures and hashes, consistent
ad-hoc signatures, transactional state backup and rollback, and exact-path postactivation probes.
It is intentionally marked `local_only` and `non_notarized`, binds only SHA-256 digests of the
approved target and non-target builder identities, never runs notarization or Gatekeeper release
checks, and cannot be installed without matching the live Mac name and acknowledging that the
changed signing identity can require manual Microphone or Accessibility reauthorization. For new
artifacts, use `tailscale_node_id_sha256`: the authenticated operator input is the SHA-256 of the
exact target's Tailscale node ID. The non-target builder separately reads and hashes its own live
online `Self.ID`, records `builder_identity_kind=tailscale_node_id_sha256`, and requires that
same-namespace digest to differ from the target digest. Before locking or mutating local state, the
installer ignores caller `PATH` and accepts only the canonical standard app at
`/Applications/Tailscale.app`. Using pinned macOS system tools and a clean environment, it
cryptographically verifies the complete app and its CLI against Tailscale's official
`TeamIdentifier` (`W5364U7YZB`) and bundle identifier (`io.tailscale.ipn.macsys`). It then copies
the complete app into a mode-700 installer-owned temporary directory, re-verifies the copied app
and CLI, and reads `tailscale status --json` only from that private snapshot after one final
signature check. The mutable `/Applications` path is never executed, caller status environment is
not inherited, and all snapshot paths are removed by normal installer cleanup. The builder applies
the same checks in its private build directory and removes the snapshot with the rest of the build
workspace. The status parser then
requires online `Self` whose hostname equals the caller's `--expected-hostname` — the
approved target when the installer verifies the target, and the builder's own host when
the builder verifies itself, which `build.sh` requires to differ from the target —
requires the single nonempty `Self.ID` to contain no whitespace or NUL, hashes its exact decoded
bytes without a newline, and compares the digest. Neither raw node ID is written to the manifest,
build log, or installer log. Older schema-v3 artifacts without an
identity-kind field remain compatible as `hardware_uuid_sha256`; that kind is retained only for
backward compatibility. The installer never resets or inspects TCC and never clears quarantine in
either policy.

Requires macOS 26+; source builds also require a Swift toolchain (Xcode or Command Line Tools).
Release packaging also requires the universal descriptor-guard prebuild at
`scripts/native/prebuilds/darwin-universal/recordings_fs_guard.node`. Build it on a trusted Mac
with `bun run build:native-fs-guard`; target installers never compile native recovery code and
fail before creating install state when the pinned prebuild is missing or unsafe.
Set the OpenAI API key in **Settings** or via `recordings` config;
transcription/enhancement use it.

The app's **Transcription Cleanup** setting controls the same post-processing pipeline as
the CLI and MCP server. Use **Raw** to keep verbatim text only, **Auto** to clean up only
when trigger phrases or instruction patterns are detected, or **Always** to run the
transcriber cleanup prompt for every recording. Global cleanup instructions can be set in
Settings. The native app applies only those global instructions.

The native app uses OpenAI realtime transcription for the stop-and-paste path: settled
`gpt-realtime-whisper` text is saved and pasted immediately, while full-file
`gpt-4o-transcribe` remains the bounded quality fallback when realtime is empty,
unsettled, or cannot be saved. Raw and processed transcript fields are still stored
separately, so cleanup instructions never replace the verbatim transcript.

### What the app reads to confirm a paste

Posting a Cmd-V keystroke returns no delivery receipt — `CGEvent.post` returns `Void` — so
the only way to know whether a transcript actually landed is to look. Around each paste the
app therefore **reads the text value of whatever field is focused in the target app**, via
Accessibility, once before the keystroke and once after, and compares them.

State this plainly because it is a real change in what a dictation app can see:

- The read covers the focused field's full value and its current selection, not only the
  pasted fragment, so text you did not dictate is inside the app's process during the
  comparison.
- It is **never logged and never persisted.** The comparison happens in memory and only its
  verdict (`pasted` / `not observed` / `unverified` plus a reason) reaches the log.
- Fields longer than 20,000 characters are reported unverifiable rather than copied and
  scanned.
- A field that publishes no Accessibility value — terminals, canvas editors, some Electron
  apps — is reported as unverified, never as a success.
- Reading requires the Accessibility permission the app already needs to post the keystroke.
  No additional permission is requested, which is exactly why this is worth writing down.

One known limit, in the safe direction: pasting text identical to the selection it replaces
leaves the field's value and the occurrence count unchanged, so a genuinely successful paste
is reported as **not observed**. The app under-claims rather than over-claims.

## CLI Usage

```bash
recordings --help
```

- `recordings record`
- `recordings transcribe <file>`
- `recordings transcribe <file> --stream`
- `recordings transcribe <file> --prompt "DALL-E, Hasna, gpt-4o"`
- `recordings transcribe <file> --transcriber-prompt "Clean up punctuation only" --post-processing always`
- `recordings save-text --text-file transcript.txt --source realtime_fast_path`
- `recordings rewrite <text> --instruction "<instruction>"`
- `recordings list --limit 20 --cursor 0`
- `recordings list --verbose`
- `recordings show <id>` / `recordings inspect <id>`
- `recordings search <query> --limit 20 --cursor 0`
- `recordings delete <id>`
- `recordings stats`

### Compact Output

Agent-facing list commands are compact by default. Terminal output shows bounded
rows, short text previews, totals, pagination cursors, and the next detail command
instead of dumping full recording objects.

```bash
recordings list                 # compact rows, default limit 20
recordings list --cursor 20     # next page
recordings list --verbose       # more metadata, still no full transcript dump
recordings show <id>            # full recording detail
recordings inspect <id>         # alias for show
recordings --json list -n 100   # machine-readable records for integrations
```

Terminal list output is capped at 50 rows. JSON list output preserves complete
recording objects and accepts up to 500 rows per page.

### Transcription Prompts

Recordings separates speech-to-text context from post-transcription cleanup:

- `--prompt` / `transcription_prompt` is passed to the OpenAI audio transcription
  request as vocabulary or context. Use it for names, acronyms, technical terms, or
  preceding segment context.
- `--transcriber-prompt` / `transcriber_prompt` is used after raw transcription by the
  text transcriber pipeline. Use it for cleanup, formatting, tone, summaries, or
  transformations.
- `--post-processing off|auto|always` controls whether cleanup runs. `--no-enhance` is a
  compatibility alias for `off`.

Examples:

```bash
# Verbatim dictation, no cleanup
recordings transcribe meeting.wav --post-processing off

# Better STT recognition for names and acronyms, still verbatim
recordings transcribe demo.wav --prompt "Hasna, Alumia, DALL-E, gpt-4o"

# Always clean up punctuation and paragraphs after raw transcription
recordings transcribe note.wav \
  --post-processing always \
  --transcriber-prompt "Fix punctuation and paragraph breaks. Preserve the speaker's meaning."

# Auto mode only cleans up when the transcript asks for it, such as "say it better"
recordings transcribe draft.wav --post-processing auto
```

Persistent config can be stored in `~/.hasna/recordings/config.json` or a project-local
`.recordings/config.json`:

```json
{
  "transcription_prompt": "Hasna, Alumia, gpt-4o",
  "transcriber_prompt": "Clean up grammar and format as concise Markdown notes.",
  "post_processing_mode": "always",
  "enhancement_model": "gpt-4o"
}
```

Environment overrides are also supported:

```bash
export RECORDINGS_TRANSCRIPTION_PROMPT="Hasna, DALL-E, gpt-4o"
export RECORDINGS_TRANSCRIBER_PROMPT="Format as polished meeting notes"
export RECORDINGS_POST_PROCESSING_MODE=always
export RECORDINGS_TRANSCRIBER_MODEL=gpt-4o
export RECORDINGS_MODEL=gpt-4o-transcribe
export RECORDINGS_REALTIME_SESSION_MODEL=gpt-realtime
export RECORDINGS_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper
```

`RECORDINGS_MODEL` is the bounded file-transcription model. Realtime session and realtime
transcription models are separate slots; `recordings check --json` reports all three and
includes `config_warnings` if a model is placed in the wrong slot.

## MCP Server

```bash
recordings-mcp
```

## HTTP mode

```bash
recordings-mcp --http              # default port 8873
MCP_HTTP=1 MCP_HTTP_PORT=8873 recordings-mcp
```

Endpoints: `GET /health` → `{"status":"ok","name":"recordings"}`, MCP at `/mcp`.

## HTTP API (`recordings-serve`)

`recordings-serve` is the HTTP API. Its data backend is selected by the
environment: a `HASNA_RECORDINGS_DATABASE_URL` (or `RECORDINGS_DATABASE_URL`,
or `DATABASE_URL`) selects `postgresql`; any other environment serves from the
on-box `sqlite` file. On `postgresql` the process reads/writes that database
directly with API-key auth via
[`@hasna/contracts`](https://www.npmjs.com/package/@hasna/contracts).

The CLI and MCP client have exactly two stores and never open Postgres — they
read the on-box `sqlite` file only when explicitly opted in, or call the
server's `/v1` HTTP API. The presence of BOTH `HASNA_RECORDINGS_API_URL` and
`HASNA_RECORDINGS_API_KEY` selects the API; an environment that configures
neither FAILS CLOSED with an error naming the required variables — the on-box
file is never a silent default and is read only through the explicit
`HASNA_RECORDINGS_CLIENT_STORE=sqlite` override. A partial setup (one of the
two variables set) fails closed too rather than silently reading the wrong
dataset. The explicit `HASNA_RECORDINGS_CLIENT_STORE` switch (`sqlite` |
`http`) wins over the auto-selection, so a configuration that sets it to
`sqlite` keeps reading the local file even when the hosted pair is present.
Run the CLI through the `recordings` station wrapper (or set both variables)
for the hosted API; run local-only workflows with the explicit
`HASNA_RECORDINGS_CLIENT_STORE=sqlite` opt-in. Use `RECORDINGS_OPENAI_API_KEY`
for an explicit OpenAI transcription-key override, separate from the Hasna
service credential. Native Settings saves new OpenAI keys in macOS Keychain
under service `hasna.credentials.openai.api-key`, account `openai/api_key`;
Finder launches read that entry and pass it to the embedded helper in memory.

```bash
recordings-serve --port 8874          # start the API
recordings-serve migrate              # apply the cloud schema, then exit
```

Service surface (unauthenticated): `GET /health`, `GET /ready`, `GET /version`
(each returns `{status, version, mode}`), and `GET /openapi.json` (the OpenAPI
3.1 document the SDK is generated from).

Versioned API (`/v1/*`, API-key auth via `x-api-key` or `Authorization: Bearer`):

| Method | Path | Scope |
| ------ | ---- | ----- |
| GET/POST | `/v1/recordings` | `recordings:read` / `recordings:write` |
| GET/DELETE | `/v1/recordings/:id` | `recordings:read` / `recordings:write` |
| GET | `/v1/stats` | `recordings:read` |
| GET/POST | `/v1/agents` · GET `/v1/agents/:id` | `recordings:read` / `recordings:write` |
| GET/POST | `/v1/projects` · GET `/v1/projects/:id` | `recordings:read` / `recordings:write` |

Env: `HASNA_RECORDINGS_DATABASE_URL` (PostgreSQL DSN — selects the
`postgresql` backend) and `HASNA_RECORDINGS_API_SIGNING_KEY` (HMAC signing
secret for API-key auth).

### Production two-role deploy contract

The ECS deploy uses TWO database roles and TWO DSNs (the `migrate` one-shot
resolves `HASNA_RECORDINGS_MIGRATE_DATABASE_URL` /
`RECORDINGS_MIGRATE_DATABASE_URL`, falling back to the runtime DSN):

- **Migration / owner role** (e.g. `recordings_owner`) — runs the one-shot
  `migrate` task and OWNS the schema. The task definition's
  `HASNA_RECORDINGS_MIGRATE_DATABASE_URL` secret must point at this role's
  DSN; the ECS execution role needs `secretsmanager:GetSecretValue` on that
  secret.
- **Runtime role** (e.g. `recordings_app`) — the `DATABASE_URL` the serve
  process reads. It must be STRICTLY DML-only; `recordings-serve` `/ready`
  (and the migrate verb, when a dedicated migration DSN is configured)
  enforce the least-privilege posture contract: no table/sequence ownership,
  no `CREATE` on any schema, no `TEMPORARY` on the database, and exactly
  these grants on the `public` schema:

  | table | grants |
  | --- | --- |
  | `recordings` | SELECT, INSERT, DELETE |
  | `recording_tags` | SELECT, INSERT |
  | `agents` | SELECT, INSERT, UPDATE |
  | `projects` | SELECT, INSERT, UPDATE |
  | `feedback` | INSERT |
  | `api_keys` | SELECT |
  | `recording_idempotency` | SELECT, INSERT |

  plus `USAGE` on schema `public`. A runtime role that owns tables (for
  example because the migrate task ran DDL with the runtime DSN) makes
  `/ready` return `503 {"error":"dependency unavailable"}` — the database is
  healthy; the role posture is not. Remediate by re-owning the tables and
  sequences to the owner role and granting the DML set above.

The table owner must also retain the privileges used by PostgreSQL's foreign
key cleanup: SELECT/UPDATE on `recording_idempotency.recording_id` and
SELECT/DELETE on `recording_tags`. Revoking the owner's DML privileges can
make recording deletion fail even when the runtime grants are correct.
Readiness checks both owner cleanup permissions. Restore these grants to the
affected table's owner; the runtime role remains SELECT/INSERT on both tables.

## SDK

The typed `/v1` client is generated from the serve OpenAPI document
(`bun run generate:sdk`):

```ts
import { RecordingsV1Client } from "@hasna/recordings/sdk";

const client = new RecordingsV1Client({
  baseUrl: process.env.HASNA_RECORDINGS_API_URL!,
  apiKey: process.env.HASNA_RECORDINGS_API_KEY!,
});
const { recordings } = await client.listRecordings({ limit: 20 });
```

Useful agent tools include `recordings_status` for safe service/config diagnostics,
`transcribe_audio`, `save_recording`, `list_recordings`, `search_recordings`,
`register_agent`, `heartbeat`, and `set_focus`.

MCP `list_recordings` and `search_recordings` are compact by default. Compact output
is capped at 50 rows, `full=true` metadata rows are capped at 10, previews remain
bounded, and results include next-cursor hints. Use `get_recording { id }` for full
transcript details.

For MCP, `transcribe_audio` accepts `transcription_prompt` (or legacy `prompt`) for STT
context, `transcriber_prompt` for cleanup instructions, and `post_processing_mode` with
`off`, `auto`, or `always`. Tool results preserve `raw_text` and return `processed_text`
only when post-processing actually produced enhanced output.

## Releasing

The release version is hand-maintained in four places: `package.json`, `src/version.ts`, and both
`CFBundleShortVersionString` and `CFBundleVersion` in
`src/native/Recordings/RecordingsLib/Info.plist`. Bump them together, never by hand:

```bash
bun run version:set 0.3.0   # rewrites every hand-maintained site
bun run generate:sdk        # restamps the generated SDK's header
bun run version:check       # exits 1 if any site disagrees with package.json
```

A fifth copy is **generated**, not written: `src/server/openapi.ts` stamps `VERSION` into the
OpenAPI document and `bun run generate:sdk` bakes it into the `// Source: …` header of
`src/sdk/v1.generated.ts`. `version:set` leaves that file alone — the generator owns it, and
patching the stamp by hand would hide real regeneration drift — so regenerate after every bump.
`src/__tests__/version-site-guard.test.ts` fails when the committed header disagrees with
`package.json`.

`package.json` is the authority because `scripts/build_companion_cli.sh` compares the
compiled CLI's `--version` against it and exits 1 on a mismatch. That abort propagates
through `src/native/Recordings/build.sh` (`set -euo pipefail`), so a partial bump does
not just fail an assertion -- the native app cannot be built at all, and the whole
`native-app-companion-contract` suite aborts on its first test.

Three things enforce it. The repo-root `.github/workflows/ci.yml` runs the whole TypeScript
suite on every push through the turbo `build-test` job (this app's `test` script), which is
what makes the two guards below actually block a branch rather than wait for someone to run
them locally. `prepack` runs `build:native-fs-guard` first (the
fail-closed macOS gate), then `version:check`, so a partial bump stops before the build
rather than deep inside it. And `prepublishOnly` runs `bun test`, which covers the sites
through `src/__tests__/native-bundle-version.test.ts` and
`src/__tests__/version-site-guard.test.ts`.

The Swift side compiles in CI on every push through the repo-root
`.github/workflows/recordings-macos.yml` (the native compile gate, `bun run verify:ci-native`).
Runtime behaviour of the Swift half is not covered on the headless runner: no reachable
machine currently runs the Swift suite with TCC grants, so a version claim about the app
bundle is only as verified as the last macOS build.

## Data Directory

Data is stored in `~/.hasna/recordings/`.

## Audio artifact upload (S3 via the artifact kit)

On `recordings record` / `recordings transcribe`, the audio is uploaded at
creation as a content-addressed object and the row records
`audio_object_key`, `audio_sha256` and `audio_bytes` (the local `audio_path`
stays as provenance). Without configuration, nothing changes: audio remains
local-only.

Environment:

- `HASNA_RECORDINGS_S3_BUCKET` (fallback `RECORDINGS_S3_BUCKET`) — the bucket
  to upload into; unset/empty keeps the historical local-only behaviour.
- `HASNA_RECORDINGS_S3_PREFIX` (fallback `RECORDINGS_S3_PREFIX`) — object-key
  prefix inside the bucket; defaults to `recordings`, so keys look like
  `recordings/<recording_id>/<sha256>.<ext>`.
- `RECORDINGS_S3_REGION` (fallback `AWS_REGION`, then `us-east-1`) — the
  region for the S3 client. Credentials are never read by the app: the AWS SDK
  resolves them from the ambient environment or instance role at send time.

Upload failures never lose a recording: the row is still created and the
warning is logged, matching the fail-soft contract of the app-side fix.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
