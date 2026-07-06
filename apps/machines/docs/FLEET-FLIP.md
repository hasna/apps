# Fleet env-flip mechanism

Coordinated push that flips an `@hasna` OSS app's runtime storage mode across the
fleet from **local** (sqlite) to **cloud** (remote Postgres) — and back — with a
canary → batch → all rollout, per-machine verification, and one-command revert.

Built into `@hasna/machines` because fleet responsibility (manifest, remote
command routing, service topology) lives here. `open-configs` owns *AI-coding*
config files (CLAUDE.md, etc.), not fleet runtime env — so it is not the home for
this.

## What it does per machine

1. Writes a per-app fleet env file `~/.hasna/cloud/<app>.env` (mode `0600`).
   - **remote**: `HASNA_<APP>_STORAGE_MODE=remote` + `HASNA_<APP>_DATABASE_URL=<dsn>`
     (+ any non-secret extras, e.g. `HASNA_KNOWLEDGE_S3_BUCKET`, `HASNA_TODOS_SHADOW`).
   - **local** (revert): `HASNA_<APP>_STORAGE_MODE=local`, DSN dropped.
2. Wires that env file into the service manager and restarts:
   - **systemd** (linux): drop-in `~/.config/systemd/user/<unit>.service.d/10-cloud-flip.conf`
     with `EnvironmentFile=…`, then `daemon-reload` + `restart`.
   - **launchd** (macOS): sources the env file into the user launchd domain and
     `kickstart -k` the label.
3. Verifies with `<app> storage status --json` — requires `mode=remote` and
   `remote_enabled=true` (for revert: `mode=local`).
4. Halts before the next wave if any machine in the current wave fails.

### Secret safety

The database DSN is **never** transported in cleartext. The generated remote
script fetches it on the target machine via `secrets get hasna/oss/<app>/database-url`
and writes it into the `0600` env file. The orchestrator only ever handles the
secret *path* — nothing logs a value. If the secret cannot be resolved the script
aborts (`exit 3`) before writing a half-configured env file.

## Registered apps

`machines flip apps` lists the per-app profile. Add a new app by adding an entry
to `FLIP_APPS` in `src/commands/flip.ts`.

| app | mode env | dsn secret path | service unit | freeze? |
|-----|----------|-----------------|--------------|---------|
| knowledge | `HASNA_KNOWLEDGE_STORAGE_MODE` | `hasna/oss/knowledge/database-url` | `hasna-knowledge-mcp` | no |
| mementos | `HASNA_MEMENTOS_STORAGE_MODE` | `hasna/oss/mementos/database-url` | `hasna-mementos-mcp` | no |
| loops | `HASNA_LOOPS_STORAGE_MODE` | `hasna/oss/loops/database-url` | `hasna-loops-mcp` | no |
| conversations | `HASNA_CONVERSATIONS_STORAGE_MODE` | `hasna/oss/conversations/database-url` | `hasna-conversations-mcp` | no |
| todos | `HASNA_TODOS_STORAGE_MODE` | `hasna/oss/todos/database-url` | `hasna-todos-mcp` | **yes** |

`knowledge` additionally sets its S3 bucket (`hasna-oss-knowledge-prod-789877399345`).

`todos` is special (Amendment A1 sanctioned exception): it runs a **dual-write
shadow** (`HASNA_TODOS_SHADOW=1`, async mirror local→cloud, reads stay local)
until the **single-writer cutover**, which is **freeze-gated** — see below.

## Commands

```
machines flip apps [--json]                 # list registered apps
machines flip plan <app> [opts]             # waves + generated script, no execution
machines flip script <app> --mode remote    # print the remote script only
machines flip apply <app> [opts] --execute  # roll out (dry-run without --execute)
machines flip revert <app> [opts] --execute # revert to local
```

Selection / rollout options (apply, plan, revert):

- `--machines <ids>` restrict to explicit machine ids (comma/space separated).
- `--tags <tags>` restrict to machines carrying ALL tags.
- `--exclude <ids>` exclude machines.
- `--canary <n>` canary wave size (default `1`).
- `--batch <n>` batch size after the canary (default `4`).
- `--freeze-check <cmd>` freeze command (required for freeze-required apps).
- `--execute` actually run (default is dry-run).
- `--json` machine-readable output.

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
#    -> verifies `knowledge storage status --json` reports mode=remote on that box.

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

Revert restores `mode=local`, drops the DSN, restarts the service, and verifies
`mode=local`.

## todos single-writer cutover (freeze-gated)

`todos` refuses to flip to `remote` without a passing freeze check. Supply a
freeze command that pauses writers / drains the shadow mirror queue and exits `0`
only when it is safe to cut over to a single (cloud) writer:

```bash
# Dry-run shows freeze-required and the plan.
machines flip plan todos

# Cutover: freeze-check runs per-machine BEFORE any mutation; a non-zero exit
# aborts the flip for that machine and halts the wave.
machines flip apply todos \
  --freeze-check '<freeze-and-drain-command>' \
  --execute
```

Without `--freeze-check`, `flip apply todos --execute` aborts immediately with
`app "todos" requires --freeze-check <command> before flip`.

## Failure & rollback semantics

- Verification failure or non-zero exit on any machine marks that machine `FAIL`.
- A wave with any failure **halts the rollout** before the next wave (a bad
  canary never cascades to the fleet). `flip apply` exits non-zero.
- To roll back what already flipped: `machines flip revert <app> --execute`.
- The env file is written atomically (`mktemp` + `mv`); a failed secret fetch
  leaves the previous state untouched.

## Interim RDS access — per-machine tunnel (until the Tailscale router)

The shared prod Postgres is **private**. Until the Tailscale subnet router
(task `129be116`) lands, every machine must run the durable SSM port-forward
service **before** it can be flipped to `cloud`. That tunnel exposes the RDS at
the same loopback endpoint on every machine — `127.0.0.1:15439` — so a single
DSN routed through it works fleet-wide.

**Per-machine rollout step (do this first, per target machine):**

1. Install + enable `hasna-rds-tunnel.service` and `hasna-rds-tunnel-health.timer`
   (see the infra repo `docs/RDS-TUNNEL.md`). Verify `127.0.0.1:15439` accepts TCP.
2. Point the flip DSN at the loopback endpoint. Two options:
   - **secret-ref (preferred):** seed the on-target secret store so
     `secrets get hasna/oss/<app>/database-url` returns the loopback-routed DSN
     (`…@127.0.0.1:15439/<db>?sslmode=require&uselibpqcompat=true`).
   - **env-file fallback:** write `~/.hasna/<app>/cloud.env` `0600` with
     `HASNA_<APP>_STORAGE_MODE=cloud` + the loopback `HASNA_<APP>_DATABASE_URL`;
     wire it into the service. Note DSN rotation (RDS-managed in AWS SM).
3. Then run `machines flip apply <app> --machines <id> --execute`.

When the router lands, retire the tunnel units and switch DSNs back to the
canonical real-host `hasna/oss/<app>/database-url` (no host rewrite).

> Contract note (spark01 first-flip finding, 2026-07-06): `verifyStorageMode`
> currently requires `mode=remote` + `remote_enabled=true`, but the storage-kit
> apps emit `mode` ∈ `{local,cloud}` (A1) and no `remote_enabled` field. Align
> the verifier to accept `mode=cloud` (and drop/optionalize `remote_enabled`)
> before relying on `flip apply` verification for these apps.

## Pre-migration backup (Amendment A1)

Flipping only changes runtime env; it does **not** migrate data. Data migration
+ local sqlite retirement (`<name>.db.pre-cloud-2026-07-06.bak`) is handled by
each app's own cutover lane. Flip the mode **after** the app's cloud DB is
provisioned and reconciled, and (for todos) after the shadow mirror is caught up.
