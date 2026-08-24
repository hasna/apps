---
"@hasna/attachments": patch
---

`attachments link <id> --regenerate` returns HTTP 500 "Could not load credentials from any providers" when the host's only working AWS route is a named profile (e.g. `hasna-xyz-infra`): the S3 client fell back to the SDK default credential chain, which cannot select a non-default profile, while `aws s3 presign --profile <name>` works.

- S3 credential resolution now supports a named AWS profile exactly like `aws --profile <name>`: new `ATTACHMENTS_S3_PROFILE` server env var and `attachments config set --profile <name>` client config; `S3Client`, `status`, `doctor`, and `config test` all resolve through `@aws-sdk/credential-provider-ini` when a profile is set and no static keys are configured.
- The default credential chain (env vars, default profile, ECS/IMDS role) remains the fallback when neither static keys nor a profile is configured.
- Regression tests cover profile resolution from shared credentials/config files (positive), a missing profile (negative control), default-chain preservation, and static-key precedence.
