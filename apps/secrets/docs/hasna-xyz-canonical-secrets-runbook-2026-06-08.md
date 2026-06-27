# Hasna XYZ Canonical Secrets Runbook: 2026-06-08

Scope: operator procedure for creating, listing, syncing, rotating, and
verifying Hasna XYZ canonical secrets across local open-secrets vaults and AWS
Secrets Manager.

Do not print secret values in terminal logs, task comments, conversations,
docs, screenshots, or commits. Commands below either operate on metadata only
or keep values inside local files/pipes that must be removed immediately after
use.

## Canonical Naming

App-owned runtime secrets:

```text
hasna/{division}/{app_type}/{app}/{env}/{component}
```

Shared infra/admin secrets:

```text
hasna/{division}/infra/{resource_group}/{env}/{component}/{role}
```

For Hasna XYZ:

- `division`: `xyz`
- app types: `opensource`, `internalapp`, `companywebsite`, `project`
- shared infra owner: `infra`
- app names omit repo prefixes: `open-files` becomes `files`,
  `iapp-news` becomes `news`, `cweb-hasna` becomes `hasna`
- deprecated app-type segments are not canonical: `connector`, `website`,
  `platform`, `apps`, `open-source`, and prefixed app names

Examples:

```text
hasna/xyz/opensource/files/prod/s3
hasna/xyz/opensource/files/prod/rds
hasna/xyz/internalapp/news/prod/env
hasna/xyz/infra/apps/prod/postgres/master
```

## Current Verified Namespace

As of this runbook, AWS Secrets Manager in `hasna-xyz-infra/us-east-1`,
spark02, spark01, and apple03 have 13 matching `hasna/xyz` key names. Values
were not printed during verification.

The namespace currently includes:

```text
hasna/xyz/infra/apps/prod/postgres/legacy-internalapps-master
hasna/xyz/infra/apps/prod/postgres/master
hasna/xyz/infra/tfstate/prod/aws
hasna/xyz/internalapp/news/prod/env
hasna/xyz/opensource/connectors/prod/rds/legacy-master
hasna/xyz/opensource/files/prod/aws
hasna/xyz/opensource/files/prod/env
hasna/xyz/opensource/files/prod/rds
hasna/xyz/opensource/files/prod/s3
hasna/xyz/opensource/knowledge/prod/aws
hasna/xyz/opensource/knowledge/prod/env
hasna/xyz/opensource/knowledge/prod/s3
hasna/xyz/opensource/microservices/prod/rds/legacy-master
```

## Metadata Listing

Use metadata-only list/search for routine inspection:

```bash
secrets list hasna/xyz
secrets search hasna/xyz/opensource/files
```

These commands do not decrypt values after task `eaa22b90`. They are safe for
redacted operator checks, including on machines where KMS decrypt may be slow or
unavailable.

AWS metadata check:

```bash
AWS_PROFILE=hasna-xyz-infra aws secretsmanager list-secrets \
  --region us-east-1 \
  --output json |
  jq -r '[.SecretList[] | select(.Name|startswith("hasna/xyz/")) | .Name] | sort | length, .[]'
```

Local key/type parity checks, without values:

```bash
sqlite3 ~/.hasna/secrets/vault.db \
  "select count(*) from secrets where key like 'hasna/xyz/%';
   select key || ' [' || type || ']' from secrets where key like 'hasna/xyz/%' order by key;"

ssh spark01 'sqlite3 ~/.hasna/secrets/vault.db "select count(*) from secrets where key like '\''hasna/xyz/%'\''; select key || '\'' ['\'' || type || '\'']'\'' from secrets where key like '\''hasna/xyz/%'\'' order by key;"'

ssh apple03 'sqlite3 ~/.hasna/secrets/vault.db "select count(*) from secrets where key like '\''hasna/xyz/%'\''; select key || '\'' ['\'' || type || '\'']'\'' from secrets where key like '\''hasna/xyz/%'\'' order by key;"'
```

## Creating Or Updating A Secret

Prefer importing a temporary JSON bundle over passing secret values directly on
the shell command line.

1. Create a local temporary file with restrictive permissions:

   ```bash
   umask 077
   bundle=$(mktemp)
   ```

2. Write an import bundle with the target canonical key. Keep the value local
   and remove the file immediately after import:

   ```json
   {
     "version": 2,
     "secrets": {
       "hasna/xyz/opensource/files/prod/s3": {
         "key": "hasna/xyz/opensource/files/prod/s3",
         "value": "<fill locally, do not commit>",
         "type": "other",
         "label": "Hasna XYZ open-files production S3 runtime config"
       }
     }
   }
   ```

3. Import and verify metadata:

   ```bash
   secrets import "$bundle"
   rm -f "$bundle"
   secrets list hasna/xyz/opensource/files/prod
   ```

4. Publish or update AWS Secrets Manager without printing the value:

   ```bash
   tmp=$(mktemp)
   secrets get hasna/xyz/opensource/files/prod/s3 > "$tmp"

   AWS_PROFILE=hasna-xyz-infra aws secretsmanager describe-secret \
     --region us-east-1 \
     --secret-id hasna/xyz/opensource/files/prod/s3 >/dev/null 2>&1 &&
   AWS_PROFILE=hasna-xyz-infra aws secretsmanager put-secret-value \
     --region us-east-1 \
     --secret-id hasna/xyz/opensource/files/prod/s3 \
     --secret-string "file://$tmp" ||
   AWS_PROFILE=hasna-xyz-infra aws secretsmanager create-secret \
     --region us-east-1 \
     --name hasna/xyz/opensource/files/prod/s3 \
     --secret-string "file://$tmp" \
     --tags Key=division,Value=xyz Key=app_type,Value=opensource Key=app,Value=files Key=env,Value=prod

   rm -f "$tmp"
   ```

5. Backfill local machine vaults:

   ```bash
   secrets export |
     jq '{version:.version,secrets:(.secrets | with_entries(select(.key | startswith("hasna/xyz/"))))}' |
     ssh spark01 'export PATH="$HOME/.bun/bin:$PATH"; tmp=$(mktemp); cat > "$tmp"; secrets import "$tmp"; rm -f "$tmp"; secrets list hasna/xyz'

   secrets export |
     jq '{version:.version,secrets:(.secrets | with_entries(select(.key | startswith("hasna/xyz/"))))}' |
     ssh apple03 'tmp=$(mktemp); cat > "$tmp"; ~/.bun/bin/secrets import "$tmp"; rm -f "$tmp"; ~/.bun/bin/secrets list hasna/xyz'
   ```

## App-Owned S3 Secrets

Each app bucket uses:

```text
hasna/xyz/{app_type}/{app}/prod/s3
```

The secret should identify at minimum:

- AWS account/profile ownership
- region
- bucket name
- app-owned prefixes
- inventory destination, if applicable
- legacy bucket/prefix reference during transition

Cutover gates before an app is marked migrated:

- canonical bucket exists with public access blocked, versioning enabled, and
  encryption enabled
- app runtime resolves the canonical secret path
- write/read smoke test uses the canonical bucket
- legacy bucket remains available for rollback but is not used for new writes
- app-local task is completed or explicitly marked blocked with evidence

## App-Owned RDS Secrets

Each app runtime database secret uses:

```text
hasna/xyz/{app_type}/{app}/prod/rds
```

The secret should identify at minimum:

- canonical RDS instance host/port
- database name
- app runtime username
- password or password pointer
- SSL/SSM requirements
- legacy source database during transition

The shared admin/master pointer belongs under infra, not under any app:

```text
hasna/xyz/infra/apps/prod/postgres/master
```

That shared pointer stores metadata and the RDS-managed master secret ARN
pointer. Do not duplicate the master password into app-owned runtime secrets.

Cutover gates before an app is marked migrated:

- canonical database and runtime role exist
- runtime secret exists in local vault and AWS Secrets Manager
- source dump/import is complete
- table counts and app smoke tests pass
- legacy DB remains available until rollback window expires

## Legacy Aliases

Keep these aliases until all app cutovers and rollback windows complete:

```text
hasna/xyz/opensource/microservices/prod/rds/legacy-master
hasna/xyz/opensource/connectors/prod/rds/legacy-master
hasna/xyz/infra/apps/prod/postgres/legacy-internalapps-master
```

Old AWS names such as `prod/microservice/rds/master`,
`prod/connect/rds/master`, and `internalapps/prod/rds/master` remain legacy
sources. Do not delete them until RDS import verification, app cutover, and
rollback approval are complete.

Company website aliases are intentionally deferred until the
`prod-companywebsite` source decision is complete.

## Rotation

App runtime secret rotation:

1. Create the new app runtime credential in the backing service, such as a new
   Postgres password or a new access key.
2. Update the app-owned canonical local secret.
3. Publish the new version to AWS Secrets Manager.
4. Backfill spark01 and apple03.
5. Deploy or restart the app so it reads the canonical secret path.
6. Run app smoke tests and metadata-only parity checks.
7. Revoke the old runtime credential after the rollback window expires.

Shared RDS master rotation:

- Use RDS/Secrets Manager managed rotation for the RDS-managed master secret.
- Update `hasna/xyz/infra/apps/prod/postgres/master` only if the pointer
  metadata or ARN changes.
- Do not store the RDS master password in task comments, local docs, or app
  runtime secrets.

## Native Sync

`secrets aws` supports the legacy `~/.hasna/secrets/aws.json` static-key
configuration and AWS profile/default-chain credentials. Credential source
precedence is:

1. command flags such as `--profile`, `--role-arn`, `--region`, and `--prefix`
2. `HASNA_SECRETS_AWS_*` environment variables
3. `~/.hasna/secrets/aws.json`
4. the standard AWS provider chain, including `AWS_PROFILE`

If `aws.json` contains static keys and there is no explicit profile/role/default
override, static-key behavior is preserved for compatibility.

Use `--dry-run` or `--plan` before live publication:

```bash
AWS_PROFILE=hasna-xyz-infra secrets aws sync --dry-run
secrets aws push hasna/xyz/opensource/files/prod/s3 --profile hasna-xyz-infra --dry-run
```

Plan output is metadata-only JSON. It may list AWS secret names through
`ListSecrets`, but it must not print secret values or mutate AWS/local vault
state. Use the pipe-based export/import commands above for local machine parity
until the final rollout evidence task confirms live profile sync behavior across
spark02, spark01, and apple03.

## Completion Checklist

For each app or shared resource secret:

- canonical key follows the owner taxonomy
- value was never printed in logs or comments
- local spark02 metadata list shows the key
- AWS `hasna-xyz-infra/us-east-1` metadata list shows the key
- spark01 and apple03 metadata lists show the key
- app code reads the canonical key
- app smoke test passes against the canonical S3 bucket or RDS database
- legacy key/bucket/database remains available until the recorded rollback
  window expires
