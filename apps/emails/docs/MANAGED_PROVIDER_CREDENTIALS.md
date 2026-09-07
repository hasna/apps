# Managed provider credential foundation

This follow-up introduces PostgreSQL tenant roots, encrypted provider envelopes
and resumable key lifecycle jobs (migration `0036_managed_provider_credentials`).
Operator API credential installation and lifecycle mutation routes are enabled
when the deployment KMS backend is configured. Sender resolution consumes existing
managed envelopes asynchronously at each operation boundary, including sends,
health probes, delivery sync and domain operations. An unreadable managed
envelope fails closed without substituting an external identity. SES uses the
region from the same tenant provider record. Status reads only redacted metadata
and never decrypts or probes managed credentials.
Externally injected credentials and workload roles continue operating as before.

A deployment can configure `EMAILS_PROVIDER_KMS_KEY_ID` and
`EMAILS_PROVIDER_KMS_REGION`. Prefer a stable symmetric KMS key ID/ARN; retargeting
an alias can make old blobs unreadable until the original binding is restored.
The workload role needs only `kms:GenerateDataKey` and `kms:Decrypt` on that key,
with policies restricting the application encryption context. Tenant requests do
not choose key IDs, regions, credentials, endpoints or filesystem paths.

KMS generates a random 256-bit tenant root and encrypts it under the deployment
key. The application encrypts each provider payload with a separate random data
key, then wraps that data key with the tenant root. Root blobs, wrapped data keys
and payload ciphertext are stored in PostgreSQL; plaintext roots and provider
credentials are not. KMS encryption context contains only opaque app, tenant,
root and purpose identifiers. Payload and wrapped-key AEAD additionally bind the
tenant, provider, revision and purpose, preventing ciphertext substitution.
See the AWS [GenerateDataKey contract](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html)
and [Decrypt contract](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html).

Each tenant has its own active root and revision-fenced credential envelopes.
Credential writes and lifecycle jobs retain opaque authenticated actor IDs for
audit; secret values are excluded. Active-tenant locks fence suspension during
key operations.
Rotation stages a new root and durable job atomically, then future credential
writes use that root. Rewrap batches process at most 20 envelopes, changing only
the wrapped data key; payload ciphertext stays unchanged. Concurrent workers
serialize under the tenant lifecycle lock. KMS or SQL failure rolls back a batch;
a job receipt can be read and advanced again using its stable identity. A pending
job prevents a second rotation/revocation from invalidating its target root.

Old roots remain available until their envelopes have been rewrapped. A retired
root has a seven-day recovery retention window before it can be revoked. Revocation
refuses the active or a referenced root and serializes with credential unwraps.
It removes an inactive wrapped-root blob and leaves a revocation tombstone.
This revokes application access to that tenant encryption root; it does not
revoke upstream provider API credentials, erase backups, or rotate/delete the
shared deployment KMS key. Already decrypted in-flight provider operations are
not retroactively revoked. Retain protected database backups and the original
KMS key/access policy for the intended recovery window before revoking old roots.

Key operations have a ten-second KMS/statement budget and a five-second database
lock-wait limit. KMS calls use the workload identity, destroy their SDK clients
and clear returned plaintext key buffers. JavaScript credential strings can
remain in process memory; this is protection against database disclosure, not
against a compromised process authorized to send mail.

Validation uses an isolated synthetic KMS implementation and disposable
PostgreSQL, including unprivileged row-level security, concurrent rotation/update,
retry identity, ciphertext preservation and failure rollback. No live KMS key or
provider credential was mutated during development.

## Operator workflow

Register the provider metadata first (including the SES region), then install its
credentials using `emails provider secrets install <provider-id>
--credentials-file <path> --expected-revision none`. The JSON file contains either
`type: resend` plus `api_key`, or `type: ses` plus `access_key` and `secret_key`.
Keep that input file protected; the command does not delete it. The response
confirms encrypted storage, not upstream credential validity (`checked: false`).
Use the server provider live health probe to check validity without a mail send.
For replacement, supply the current revision reported by secret status. If an
installation response is lost, inspect that revision before retrying; a stale
revision cannot overwrite a newer credential update.

`provider secrets rotate-root`, `rewrap`, and `revoke-root <key-id>` require an
explicit `--idempotency-key <uuid>`. Reuse it after an uncertain response. Rotation
and rewrap return a durable job and the CLI advances one batch. If work remains,
it prints the job ID and exits unsuccessfully: run `provider secrets job <id>
--advance` until complete. `provider secrets job <id>` inspects without changing
anything. Revocation preserves the existing confirmation prompt (`--yes` skips
it). A deployment KMS key cannot be selected or revoked by these tenant commands.

The direct API uses operator-authorized `PUT /v1/providers/{id}/credentials`,
`POST /v1/providers/secrets/{rewrap,rotate-root,revoke-root}`, and
`GET /v1/providers/secrets/jobs/{id}` / `POST .../{id}/advance`. All results are
secret-free. Externally managed credentials are never silently imported or
rotated. The existing `provider add --api-key` / `--access-key --secret-key` flags and
`provider update` credential flags use an atomic server metadata/envelope write.
Validation runs on the server before commit unless `--skip-validation` is given;
a failed validation rolls back metadata and credentials together. Partial SES
key updates merge with the prior encrypted server credentials and use the current
revision as a compare-and-swap fence. Metadata-only registration makes no
credential validity claim. Add accepts `--id <uuid>` so an uncertain create can be
inspected and retried without inventing a new provider identity. Managed sender
instances expose only their numeric credential revision for tenant/provider
scoped stale-binding checks; they never expose a secret fingerprint.
