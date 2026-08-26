# Fleet env-flip mechanism

Coordinated push that flips an `@hasna` OSS app's runtime storage mode across the
fleet from **local** (on-box sqlite/json) to **self_hosted** (the app's cloud API
at `https://<app>.<fleet-domain>`) — and back — with a canary → batch → all rollout (or
one atomic `--all-machines` wave), per-machine verification, and one-command
revert.

Built into `@hasna/machines` because fleet responsibility (manifest, remote
command routing, service topology) lives here. `open-configs` owns *AI-coding*
config files (CLAUDE.md, etc.), not fleet runtime env — so it is not the home for
this.

## Architecture (LOCKED)

The only sanctioned cloud path for a **client** machine (CLI / MCP / SDK) is the
app's HTTPS API:

```
client -> https://<app>.<fleet-domain>/v1   (bearer HASNA_<APP>_API_KEY)
```

This is the **self_hosted** mode. The raw RDS DSN is **NEVER** distributed to a
machine. `STORAGE_MODE=remote` + `DATABASE_URL` on a client is **FORBIDDEN** — the
shared prod Postgres instance is reachable only by the in-VPC ECS services and the
admin tunnel (operator-specific account/region — not published here).
The flip therefore writes exactly **two vars** per app:

```
HASNA_<APP>_API_URL=https://<app>.<fleet-domain>
HASNA_<APP>_API_KEY=<key from Secrets Manager hasna/oss/<app>/api-key>
```

`<fleet-domain>` is **REQUIRED** for a real deployment: set
`HASNA_FLEET_API_DOMAIN` to the operator's own private root domain. This package
never ships a real internal hostname — absent that env var, the default falls
back to a neutral, non-resolving placeholder.

## What it does per machine

1. Writes a per-app fleet env file `~/.hasna/fleet-env/<app>.env` (mode `0600`) —
   the PRIMARY fleet credential location. The legacy `~/.hasna/cloud/<app>.env`
   location is no longer written by flips (deprecated, removed after 2026-10-01).
   - **api**: `HASNA_<APP>_API_URL=https://<app>.<fleet-domain>` +
     `HASNA_<APP>_API_KEY=<key>` (+ any non-secret extras).
   - **local** (revert): the env file is **removed entirely** so both vars are
     unset and the app falls back to its untouched local original.
2. Wires that env file into the service manager and restarts:
   - **systemd** (linux): drop-in `~/.config/systemd/user/<unit>.service.d/10-cloud-flip.conf`
     with `EnvironmentFile=…`, then `daemon-reload` + `restart`. Revert removes the
     drop-in.
   - **launchd** (macOS): `setenv`s each var from the env file into the user
     launchd domain and `kickstart -k`s the label. Revert `unsetenv`s both vars.
3. Verifies with `<app> storage status --json` — requires `mode=self_hosted` and
   `api_enabled!=false` (for revert: `mode=local`). Legacy `remote_enabled` is
   still accepted for back-compat.
4. **Provenance gates (api mode)**: the flip only passes when the app's status
   proves the freshly written `~/.hasna/fleet-env/<app>.env` supplied the
   connection. It rejects:
   - `apiKeyTier=legacy-env` (the key came from a process env var, not the file);
   - any reported `transportSource`/`apiUrlSource`/`apiKeySource` under
     `~/.hasna/cloud` (still resolving from the legacy dir);
   - api mode whose exact source cannot be reported (no source fields, or a tier
     that is not a fleet/disk tier).
   The flip script also reports `FLIP_SHA256=<hash>` of the env file it wrote, so
   the ledger records the exact file hash — a sterile probe, no values.
5. **Per-run ledger**: every flip writes one JSONL row per machine to
   `~/.hasna/machines/flip-ledger.jsonl` — `ts, machine, app, wave, mode, result,
   sourceOfValue, envSha256, provenanceOk`. Dry-runs return the rows in the report
   but never write the file. No credential value ever appears in a ledger row.
6. Halts before the next wave if any machine in the current wave fails.

### Secret safety

The API key is **never** transported in cleartext. The generated remote script
fetches it on the target machine via `secrets get hasna/oss/<app>/api-key` and
writes it into the `0600` env file. The orchestrator only ever handles the secret
*path* — nothing logs a value. If the secret cannot be resolved the script aborts
(`exit 3`) before writing a half-configured env file. No RDS DSN is ever fetched,
transported, or written.

## Registered apps

`machines flip apps` lists the per-app profile. All **25** `@hasna` OSS apps are
registered:

```
accounts attachments calendar contacts conversations domains economy emails
files identities instructions knowledge logs loops machines mementos projects
recordings sandboxes secrets sessions shortlinks telephony testers todos
```

(`mailery` was retired from the registry 2026-08-19 — it is a separate, unrelated
SaaS product and never exposed a hosted API on the client flips route — and
replaced by `emails`, the hosted mailbox app.)

Most apps follow the shared conventions:

| field | value |
|-------|-------|
| API URL env | `HASNA_<APP>_API_URL` |
| API URL | `https://<app>.<fleet-domain>` (set via `HASNA_FLEET_API_DOMAIN`) |
| API key env | `HASNA_<APP>_API_KEY` |
| API key secret | `hasna/oss/<app>/api-key` |
| service unit | `hasna-<app>-mcp` |
| verify | `<app> storage status --json` |

### Email exception

`emails` does not read `HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY`. Its
client routes to the hosted API via `EMAILS_SELF_HOSTED_URL` plus
`EMAILS_CLIENT_ENV_SECRET` — a Vault **pointer** the `emails` CLI resolves itself
(`secrets get <path>`) at runtime. Its flip profile therefore pins
`apiUrlEnv=EMAILS_SELF_HOSTED_URL` and uses the `keyViaSecretPointer` mode: the
fleet env file carries the URL plus the non-secret Vault path — **no literal API
key is ever written to disk**. Its status reports the runtime mode at
`mode.current`, which the verifier reads via `verifyModePath`.

**The Vault entry is authoritative, not the flip-written env.** Whenever
`EMAILS_CLIENT_ENV_SECRET` resolves, `loadEmailsClientEnvSecret` overwrites
`EMAILS_SELF_HOSTED_URL` (and `EMAILS_MODE`) with the values inside the Vault
entry — the flip-written URL is effectively inert, and the entry's contract
(`CLIENT_ENV_REQUIRED_KEYS`) mandates `EMAILS_SELF_HOSTED_URL` inside it.
The Vault entry must therefore carry the fleet-hosted URL; the flip verify only
checks hosted mode via `mode.current`, never host identity, so a correct entry
is what pins the routing host.

**Fail-closed prerequisite.** `emails` flip verify fails closed on any target
missing the Vault entry at `EMAILS_CLIENT_ENV_SECRET` or a working `secrets`
CLI — that failure is the expected behavior when the prerequisite is absent,
not a defect of the flip.

Add a new app by adding its id to `ALL_APPS` in `src/commands/flip.ts` (and, when
the app's consumer contract deviates from the generic `HASNA_<APP>_API_URL` /
`HASNA_<APP>_API_KEY` convention, an entry in `APP_SPEC_OVERRIDES`).

**Freeze-required (coordination hot stores):** `todos`, `loops`, `mementos`,
`conversations`. These dual-write to a shadow and must pass a freeze check
(drain shadow to divergence==0) before the atomic `--all-machines` cutover, so
machines never split-brain. See below.

## Commands

```
machines flip apps [--json]                         # list registered apps
machines flip plan <app> [opts]                     # waves + generated script, no execution
machines flip script <app> --mode self_hosted       # print the remote script only
machines flip apply <app> [opts] --execute          # roll out (dry-run without --execute)
machines flip revert <app> [opts] --execute         # revert to local
```

Selection / rollout options (apply, plan, revert):

- `--machines <ids>` restrict to explicit machine ids (comma/space separated).
- `--tags <tags>` restrict to machines carrying ALL tags.
- `--exclude <ids>` exclude machines.
- `--all-machines` flip the ENTIRE fleet in one **atomic** wave (ignores
  `--machines`; used for the coordination-store cutover so the fleet flips
  together and is never half-flipped).
- `--canary <n>` canary wave size (default `1`).
- `--batch <n>` batch size after the canary (default `4`).
- `--freeze-check <cmd>` freeze command (required for freeze-required apps).
- `--execute` actually run (default is dry-run).
- `--json` machine-readable output.

`--mode` accepts `self_hosted` (default; aliases `remote`/`cloud`/`api`/`on`) or
`local` (aliases `revert`/`off`).

Machine list comes from the fleet manifest (`machines manifest list`), which is
kept in sync with `tailscale status`.

## Procedure per app (example: knowledge)

Always dry-run first, canary next, verify, then widen.

```bash
# 0. See the plan and the exact script that will run.
machines flip plan knowledge --json

# 1. CANARY — one machine. Dry-run, then execute.
machines flip apply knowledge --machines <canary-id>
machines flip apply knowledge --machines <canary-id> --execute
#    -> verifies `knowledge storage status --json` reports mode=self_hosted on that box.

# 2. BATCH — a handful. Halts automatically if any machine fails verification.
machines flip apply knowledge --exclude <canary-id> --batch 4 --execute

# 3. ALL — remainder (canary + batches already cover the fleet in one apply too):
machines flip apply knowledge --execute
```

Revert any time (one command):

```bash
machines flip revert knowledge --execute            # whole fleet back to local
machines flip revert knowledge --machines <id> --execute
```

Revert removes the two vars (`HASNA_KNOWLEDGE_API_URL` + `HASNA_KNOWLEDGE_API_KEY`),
restarts the service, and verifies `mode=local`. The local original store is never
touched, so the app returns to exactly its pre-flip behaviour.

## Coordination-store cutover (freeze-gated, atomic)

`todos`, `loops`, `mementos`, and `conversations` refuse to flip to `self_hosted`
without a passing freeze check. Supply a freeze command that pauses writers /
drains the dual-write shadow to `divergence==0` and exits `0` only when it is safe
to cut over. Use `--all-machines` so the whole fleet flips in one atomic wave (no
split-brain):

```bash
# Dry-run shows freeze-required and the single atomic wave.
machines flip plan todos --all-machines

# Atomic cutover: freeze-check runs per-machine BEFORE any mutation; a non-zero
# exit aborts the flip for that machine and halts the wave.
machines flip apply todos \
  --all-machines \
  --freeze-check '<freeze-and-drain-command>' \
  --execute
```

Without `--freeze-check`, `flip apply todos --execute` aborts immediately with
`app "todos" requires --freeze-check <command> before flip`.

## Failure & rollback semantics

- Verification failure or non-zero exit on any machine marks that machine `FAIL`.
- A wave with any failure **halts the rollout** before the next wave (a bad
  canary never cascades to the fleet). `flip apply` exits non-zero.
- To roll back what already flipped: `machines flip revert <app> --execute`
  (or `--all-machines` for the coordination stores).
- The env file is written atomically (`mktemp` + `mv`); a failed secret fetch
  leaves the previous state untouched.

## Pre-flip requirements

Flipping only changes runtime env; it does **not** migrate data. Flip an app on a
machine only **after**:

- the app's cloud DB is provisioned and reconciled (cloud parity == local),
- the local original is backed up (`<name>.db.pre-cloud-2026-07-07.bak`) and left
  in place (never deleted),
- rollback has been tested once, and
- (for coordination stores) the dual-write shadow is caught up to
  `divergence==0`.

Because revert simply unsets the two vars, every flip is fully reversible back to
the untouched local original.
