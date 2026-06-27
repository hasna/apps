# Hasna XYZ Legacy Secret Aliases: 2026-06-08

Scope: migration aliases for old Hasna XYZ secret names that must remain
available during S3/RDS/app cutover.

No secret values were printed or stored in this document. Verification used
AWS Secrets Manager metadata and local redacted `secrets list` output.

## Alias Rules

- App-owned runtime secrets stay under
  `hasna/xyz/{app_type}/{app}/{env}/{component}`.
- Shared infra/admin secrets stay under
  `hasna/xyz/infra/{resource_group}/{env}/{component}/{role}`.
- Explicit migration aliases may add `/legacy-master` for old RDS master
  credentials, but app-owned runtime credentials should not be collapsed into
  `infra/apps`.
- Deprecated app type segments such as `connector`, `website`, and `platform`
  are not canonical Hasna XYZ app types.

## Verified RDS Alias Map

| Legacy name | Canonical migration alias | Owner |
| --- | --- | --- |
| `prod/microservice/rds/master` | `hasna/xyz/opensource/microservices/prod/rds/legacy-master` | `opensource/microservices` migration source |
| `prod/connect/rds/master` | `hasna/xyz/opensource/connectors/prod/rds/legacy-master` | `opensource/connectors` migration source |
| `internalapps/prod/rds/master` | `hasna/xyz/infra/apps/prod/postgres/legacy-internalapps-master` | infra/shared internalapps source |

The canonical aliases above exist in both:

- AWS Secrets Manager, `hasna-xyz-infra/us-east-1`;
- local `spark02` open-secrets vault.

The older legacy names also still exist in AWS Secrets Manager. Keep them until
the relevant app cutovers and rollback windows complete.

## Company Website Legacy Names

Current company website legacy names are not canonicalized yet:

- AWS `hasna-xyz-hq/eu-central-1`: `cweb-hasna/DATABASE_URL`,
  `cweb-hasna/NEXTAUTH_SECRET`, `cweb-hasna/GOOGLE_CLIENT_ID`, and
  `cweb-hasna/GOOGLE_CLIENT_SECRET`
- local vault: `hasnaxyz/companywebsite/rds/live/{database,host,password,port,url,username}`

Do not create a canonical company website alias until task `4d30764f` decides
whether `prod-companywebsite` gets a network path, snapshot/export path, or
formal retirement approval. If retained, use:

```txt
hasna/xyz/companywebsite/hasna/prod/rds/legacy-master
```

or a component-specific canonical path agreed by the company website owner.

## Validation Coverage

The Hasna XYZ path validator added in task `0d81385e` accepts these explicit
`legacy-master` aliases while still rejecting deprecated app-type taxonomy and
repo-prefixed app segments.

## Follow-Up

- Backfill these canonical alias names to spark01 and apple03 through task
  `8fea5d58`.
- Keep the parity source secrets available until RDS restore verification and
  rollback windows complete.
