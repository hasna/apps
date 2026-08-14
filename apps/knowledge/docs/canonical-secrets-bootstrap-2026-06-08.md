# Canonical Secrets Bootstrap Evidence: 2026-06-08

Scope: canonical example app secret paths in account `example-infra`
(`000000000000`), region `us-east-1`, mirrored into the local `linux-node-b`
`secrets` vault.

This note records names and migration intent only. It intentionally does not
include secret payloads, passwords, API keys, connection strings, or `.env`
contents.

## Ownership Rule

App-owned runtime/config secrets use:

```txt
example/{app_type}/{app}/prod/{component}
```

Shared infra/admin pointers use an infra-owned path:

```txt
example/infra/{resource_group}/prod/{component}/{role}
```

Legacy master credentials copied for migration are suffixed with
`legacy-master`. They are deprecation inputs for migration jobs, not the clean
runtime secret names new app code should read.

## Open Files

Created or verified in AWS Secrets Manager and the local vault:

```txt
example/files/prod/env
example/files/prod/aws
example/files/prod/s3
example/files/prod/rds
```

Meaning:

- `env`: app environment configuration.
- `aws`: AWS account/profile/region and related app config metadata.
- `s3`: canonical app storage bucket metadata for
  `example-files-prod`.
- `rds`: app runtime database connection fields for database `files` and role
  `files_app`.

The `aws` and `s3` entries are metadata-only. They do not contain access keys or
tokens.

## Open Knowledge

Created or verified in AWS Secrets Manager and the local vault:

```txt
example/knowledge/prod/env
example/knowledge/prod/aws
example/knowledge/prod/s3
```

Meaning:

- `env`: knowledge production app config metadata.
- `aws`: AWS account/profile/region and related app config metadata.
- `s3`: canonical app storage bucket metadata for
  `example-knowledge-prod`.

No `example/knowledge/prod/rds` secret was created in this pass.
The OSS package is local-first and currently uses SQLite for local knowledge
state. If a hosted wrapper later provisions an app database, the app-owned
runtime secret should use:

```txt
example/knowledge/prod/rds
```

## Legacy Secret Mapping

Mapped legacy AWS Secrets Manager names to canonical ownership paths:

| Legacy name | Canonical path | Use |
| --- | --- | --- |
| `prod/microservice/rds/master` | `example/microservices/prod/rds/legacy-master` | Migration-only legacy master alias. |
| `prod/connect/rds/master` | `example/connectors/prod/rds/legacy-master` | Migration-only legacy master alias. |
| `internalapps/prod/rds/master` | `example/infra/apps/prod/postgres/legacy-internalapps-master` | Migration-only legacy shared/admin alias. |
| `internalapps/prod/iapp-news/env` | `example/internalapp/news/prod/env` | Canonical app env path for internalapp `news`. |

The three RDS aliases preserve old master credential payloads under explicit
legacy names so migration jobs can read them without relying on noncanonical
paths. They should not be used as the final runtime credentials for new app
code. Clean app runtime database credentials should be provisioned under
app-owned paths such as:

```txt
example/files/prod/rds
example/internalapp/news/prod/rds
```

The shared canonical Postgres admin pointer remains:

```txt
example/infra/apps/prod/postgres/master
```

## Verification

AWS Secrets Manager name-only verification returned these canonical entries:

```txt
example/infra/apps/prod/postgres/legacy-internalapps-master
example/infra/apps/prod/postgres/master
example/internalapp/news/prod/env
example/connectors/prod/rds/legacy-master
example/files/prod/aws
example/files/prod/env
example/files/prod/rds
example/files/prod/s3
example/knowledge/prod/aws
example/knowledge/prod/env
example/knowledge/prod/s3
example/microservices/prod/rds/legacy-master
```

Local `secrets list` verification returned the same names with redacted values.

No secret values were printed during creation or verification.
