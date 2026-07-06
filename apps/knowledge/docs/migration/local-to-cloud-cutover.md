# Knowledge local → cloud cutover runbook (PURE REMOTE, Amendment A1)

Cut the `@hasna/knowledge` catalog over from the local store to the shared cloud
Postgres + S3, and (later) flip a machine's default storage mode to `cloud`.

PURE REMOTE (Amendment A1): in `cloud` mode reads **and** writes go straight to
the cloud Postgres — no cache, no local mirror, no sync/merge. The local SQLite
(`knowledge.db`) and JSON catalog (`db.json`) remain authoritative in `local`
mode and are preserved as `*.pre-cloud-<date>.bak` after a cutover.

## Storage layout

| Concern | `local` mode | `cloud` mode |
| --- | --- | --- |
| Catalog items (`add`/`list`/`get`) | JSON store `~/.hasna/knowledge/db.json` | Postgres table `knowledge_items` |
| Relational schema (sources/wiki/chunks/…) | SQLite `~/.hasna/knowledge/knowledge.db` | Postgres (same tables) |
| Artifacts | local artifact dir | S3 bucket |

## Preconditions

- DSN secrets in AWS account `789877399345` (never echo):
  - `hasna/oss/knowledge/database-url-owner` — schema/migrations (owner role).
  - `hasna/oss/knowledge/database-url` — app runtime (least-privilege role).
- S3 secret `hasna/xyz/opensource/knowledge/prod/s3` (bucket + region + prefixes).
- RDS `hasna-xyz-infra-apps-prod-postgres…` is private — reach it via the SSM
  port-forward through jump host `i-086c334559bec7e0f`.

### Open the tunnel

```bash
aws ssm start-session --target i-086c334559bec7e0f \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["15433"]}'
```

### Build the connection env (never echo the DSN)

```bash
export HASNA_KNOWLEDGE_STORAGE_MODE=cloud
# Fetch owner DSN into a var, rewrite host->127.0.0.1:15433. Because a tunnel
# terminates at localhost, add uselibpqcompat=true so pg-connection-string keeps
# libpq `sslmode=require` semantics (encrypt, no hostname verify) instead of the
# new default that aliases require->verify-full (which fails cert altname on localhost).
RAW="$(aws secretsmanager get-secret-value --secret-id hasna/oss/knowledge/database-url-owner --query SecretString --output text)"
export HASNA_KNOWLEDGE_DATABASE_URL="$(RAW="$RAW" bun -e 'const u=new URL(process.env.RAW);u.hostname="127.0.0.1";u.port="15433";u.searchParams.set("uselibpqcompat","true");process.stdout.write(u.toString())')"
unset RAW
```

## Cutover steps

1. **Apply schema (owner DSN).** Idempotent via the storage-kit MigrationLedger.
   ```bash
   bun scripts/apply-cloud-migrations.mjs --dry-run --json   # plan
   bun scripts/apply-cloud-migrations.mjs --json             # apply
   bun scripts/apply-cloud-migrations.mjs --dry-run --json   # re-run => alreadyApplied == total
   ```
2. **Import the catalog.** Export the local catalog to JSONL (one KnowledgeItem
   per line — the format under `~/.hasna/knowledge/migration-exports/`) then:
   ```bash
   bun scripts/import-cloud-catalog.mjs <catalog.jsonl> --dry-run --json
   bun scripts/import-cloud-catalog.mjs <catalog.jsonl> --json   # upsert by id
   ```
3. **Verify through the real code path** (switch to the least-privilege app DSN
   `hasna/oss/knowledge/database-url` for this step):
   ```bash
   knowledge list --json --include-archived   # total == imported count
   knowledge get --id <some-id> --json         # round-trips from Postgres
   ```
4. **Verify S3** — a write/read/delete round-trip through `S3ArtifactStore`.
5. **Back up local stores** (copy, do not delete — `local` mode stays usable):
   ```bash
   cp -p ~/.hasna/knowledge/knowledge.db ~/.hasna/knowledge/knowledge.db.pre-cloud-<date>.bak
   cp -p ~/.hasna/knowledge/db.json      ~/.hasna/knowledge/db.json.pre-cloud-<date>.bak
   ```
6. **Close the tunnel** and remove any temp files.

## The flip step (default mode → cloud)

The cutover above **populates and verifies** the cloud DB but does **not** change
any machine's default. Machines keep `local` as the default until the fleet flip
mechanism exists. To flip:

- **Per process / smoke test (today):** export `HASNA_KNOWLEDGE_STORAGE_MODE=cloud`
  and `HASNA_KNOWLEDGE_DATABASE_URL` (app role) in that shell only.
- **Per machine (fleet flip, when the mechanism lands):** set those two env vars
  in the machine's managed environment (the fleet config/secrets injector), roll
  it to the target machines, and confirm `knowledge storage status --json` reports
  `"mode":"cloud"`. Roll back by removing the vars (falls back to `local`).
- Default resolution lives in `getStorageMode()` (`src/db/storage-sync.ts`): with
  no env override the default is `local`. Do **not** hard-code `cloud` as the
  in-code default — the flip is an environment/fleet-config action, reversible
  without a code release.

## Cloud CLI wiring status (as of 2026-07-06)

- Wired to cloud: `add`, `list`, `get` (catalog reads/writes hit `knowledge_items`).
- Guarded in cloud mode (error, never touch local JSON): `update`, `archive`,
  `restore`, `untag`, `delete`, `upsert`, `prune`, `dedupe`, `export`, `stats`,
  `inventory`. Wiring these to Postgres is the remaining follow-up
  (knowledge-cutover task) — run them in `local` mode until then.
