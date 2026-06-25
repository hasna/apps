# Hasna XYZ Secrets Layout Audit: 2026-06-08

Scope: current open-secrets key layout, namespace listing, AWS sync behavior,
env-file bridge behavior, and Hasna XYZ canonical/legacy key visibility across
AWS, spark02, spark01, and apple03.

No secret values were printed or stored in this audit. Evidence was collected
from redacted `secrets list` output, AWS Secrets Manager metadata, code review,
and SSH commands that printed names/counts only.

## CLI Behavior

Current storage behavior:

- `setSecret(key, value, type, label, ttl)` stores the provided slash-delimited
  key exactly as given.
- `listSecrets(namespace)` treats namespace as a slash prefix and redacts
  values in normal CLI output.
- `searchSecrets(query)` searches key, label, and type; normal CLI output is
  redacted.
- `getSecret(key)` returns raw values and should not be used in logs or
  conversations except to pass a value into a command through shell variables.

Current AWS behavior in `src/aws.ts`:

- AWS names preserve slash-delimited local keys.
- An optional AWS prefix is prepended if configured.
- `aws push` creates or updates Secrets Manager entries and tags new secrets
  with `open-secrets-key` and `open-secrets-type`.
- `aws pull` writes the AWS secret string into the local vault.
- `aws sync` pushes all local secrets, then pulls missing AWS secrets matching
  the configured prefix.
- AWS config is stored at `~/.hasna/secrets/aws.json` and contains explicit
  `access_key_id`, `secret_access_key`, `region`, and optional `prefix`.

Current env-file bridge behavior:

- `import-env` maps `~/.secrets/<path>/<env>.env` variables into
  `<path>/<env>/<suffix>` keys.
- `export-env` detects env segments using `KNOWN_ENVS`.
- `KNOWN_ENVS` currently contains `live`, `sandbox`, `test`, and `staging`;
  it does not contain canonical Hasna env names such as `prod`, `dev`,
  `preview`, `local`, or `pr-*`.
- Therefore a canonical key like `hasna/xyz/opensource/files/prod/rds` would
  currently export through the fallback path shape rather than a clean
  `prod.env` bridge. This must be fixed before relying on export-env for
  canonical Hasna XYZ secrets.

Current validation behavior:

- Generic slash-delimited keys are accepted.
- There is no Hasna XYZ-specific validation helper yet for
  `hasna/{division}/{app_type}/{app}/{env}/{component}` or
  `hasna/{division}/infra/{resource_group}/{env}/{component}/{role}`.
- Deprecated Hasna XYZ app types such as `connector`, `website`, and
  `platform` are not rejected yet.

## AWS Secrets Manager Inventory

Profile: `hasna-xyz-infra`, account `789877399345`, region `us-east-1`.

Canonical Hasna XYZ names found:

- `hasna/xyz/infra/apps/prod/postgres/master`
- `hasna/xyz/infra/tfstate/prod/aws`
- `hasna/xyz/internalapp/news/prod/env`
- `hasna/xyz/opensource/files/prod/aws`
- `hasna/xyz/opensource/files/prod/env`
- `hasna/xyz/opensource/files/prod/rds`
- `hasna/xyz/opensource/files/prod/s3`
- `hasna/xyz/opensource/knowledge/prod/aws`
- `hasna/xyz/opensource/knowledge/prod/env`
- `hasna/xyz/opensource/knowledge/prod/s3`

Canonical legacy migration aliases found:

- `hasna/xyz/infra/apps/prod/postgres/legacy-internalapps-master`
- `hasna/xyz/opensource/connectors/prod/rds/legacy-master`
- `hasna/xyz/opensource/microservices/prod/rds/legacy-master`

Older legacy AWS names still present:

- `prod/microservice/rds/master`
- `prod/connect/rds/master`
- `internalapps/prod/rds/master`

Profile: `hasna-xyz-hq`, account `063641675955`, region `us-east-1`.

- `rds!db-7a451ce6-83a9-40fa-b24a-81e5d5943511`

Profile: `hasna-xyz-hq`, region `eu-central-1`.

- `cweb-hasna/DATABASE_URL`
- `cweb-hasna/NEXTAUTH_SECRET`
- `cweb-hasna/GOOGLE_CLIENT_ID`
- `cweb-hasna/GOOGLE_CLIENT_SECRET`

No `hasna/xyz/...` canonical names were found in the HQ account filters.

## Local Vault Inventory

Machine: `spark02`.

- Vault path: `/home/hasna/.hasna/secrets/vault.db`
- `secrets list hasna/xyz` returned the expected canonical namespace for
  current completed work: open-files, open-knowledge, infra tfstate, infra
  Postgres, internalapp news env alias, and RDS legacy aliases.
- Local `~/.hasna/secrets/aws.json` is missing, so open-secrets native
  `secrets aws sync` is not configured on spark02. AWS was queried through the
  AWS CLI profiles for this audit instead.

Machine: `spark01`.

- Vault path command works when using `PATH=$HOME/.bun/bin:$PATH`.
- `secrets list hasna/xyz` returned no secrets in that namespace.
- Non-login SSH sessions do not have `bun` on PATH by default, so `secrets`
  fails unless PATH is adjusted.

Machine: `apple03`.

- Vault path: `/Users/hasna/.hasna/secrets/vault.db`
- `secrets list hasna/xyz` returned no secrets in that namespace.

## Secret Shape Samples

Sample shapes were inspected locally without values:

- `hasna/xyz/infra/apps/prod/postgres/master`: account, region, RDS instance,
  host/port, username, and RDS-managed secret ARN pointer.
- `hasna/xyz/opensource/files/prod/s3`: app metadata, bucket, region,
  canonical object prefix, inventory destination, and legacy import prefix.
- `hasna/xyz/opensource/files/prod/rds`: app metadata, database, runtime user,
  password, host/port, database URL, and SSM tunnel metadata.
- `hasna/xyz/opensource/microservices/prod/rds/legacy-master`: legacy
  username/password/host/port/dbname/engine fields.

## Mismatches And Follow-Ups

1. `spark01` and `apple03` did not have local `hasna/xyz` namespace parity
   with spark02 during the audit. This was fixed in task `8fea5d58`; both
   machines now list the 13 current canonical/legacy Hasna XYZ entries with
   redacted values.
2. spark01 non-login sessions need PATH set to include `~/.bun/bin` before
   `secrets` runs. The backfill command used that explicit PATH.
3. open-secrets native AWS sync is not configured on spark02 because
   `~/.hasna/secrets/aws.json` is missing.
4. `export-env` did not recognize `prod`, `dev`, `preview`, `local`, or
   `pr-*` env segments during the audit. This was fixed in task `8e0e2196`.
5. Hasna XYZ canonical path validation was not implemented during the audit.
   This was fixed in task `0d81385e`.
6. Legacy names and aliases coexist by design; do not delete old names until
   app cutovers and rollback windows complete.

## Required Next Tasks

- Add canonical Hasna XYZ path validation and warnings/rejection for deprecated
  app types. Completed in task `0d81385e`.
- Update the env-file bridge to understand canonical Hasna env tokens.
  Completed in task `8e0e2196`.
- Add or document legacy-to-canonical alias handling for the old RDS names.
- Backfill/sync canonical `hasna/xyz` names to spark01 and apple03 without
  printing values. Completed in task `8fea5d58`.
- Decide whether open-secrets native AWS sync should support AWS profiles/roles
  instead of requiring static access keys in `aws.json`.
