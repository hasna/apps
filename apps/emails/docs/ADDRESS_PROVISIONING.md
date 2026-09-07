# Address provisioning through the Emails API

`emails address provision` and `emails provision address` create or reconcile an
address on an already-configured domain. Both use the authenticated Emails API;
they never create a local database or use the client machine's cloud credentials.
The caller must be a tenant operator with write permission. Reading job receipts
also requires tenant operator access.

```bash
emails address provision hello@example.com --provider <provider-id> --dry-run
emails provision address hello@example.com --provider <provider-id> \
  --owner <human-id> --administrator <agent-id> --wait --timeout 120
emails provision job <job-id>
emails provision job <job-id> --retry
```

The current ready path is `--receive ses-s3`. It requires a registered, active
SES provider and matching domain in the same tenant; an authenticated server SES
binding; and server `EMAILS_INGEST_S3_BUCKET` and `EMAILS_INGEST_QUEUE_URL`
configuration. An optional `--bucket` asserts the server's configured bucket,
and cannot redirect checks to another bucket. `--domain` selects a registered
domain ID, unique prefix, or exact domain name. Explicit empty selectors fail.

Each attempt reads the provider's domain verification, public SES MX, active SES
receipt rules targeting the configured S3 bucket, and the receipt action's SNS
topic subscription to the configured SQS queue. The queue must allow that topic,
and the subscription must not filter out notifications. Other receive adapters,
missing bindings, conflicting MX, and incomplete delivery wiring return blocked
receipts. Provisioning does not create DNS, receipt rules, queues, buckets, or
provider identities. The checked topology is SES S3 receipt action → SNS → SQS;
bare S3 event notifications are not sufficient for this workflow.

All published MX endpoints must target the selected SES region; mixed or backup
SES MX records do not prove this mailbox reaches Emails. Receipt rules are
evaluated for the exact mailbox, in order, including address labels and earlier
mailbox-specific stop/bounce actions. An earlier synchronous Lambda is blocked
because its runtime routing decision cannot be established by these checks.

After those checks pass, one PostgreSQL transaction rechecks tenant bindings and
current provider/address/owner state, reserves the inbound domain route, creates
or reconciles the address, records ownership and a provisioning audit event, and
stores the ready receipt. A concurrent provider disable, ownership conflict,
foreign tenant route, or audit failure prevents the transaction from committing.
Existing inactive addresses are not reactivated. Existing owners or administrators
must be transferred explicitly before requesting a different assignment. Human
owners need an agent administrator; an agent owner defaults to administering itself.

`--dry-run` performs the read-only checks and returns the plan and evidence. It
does not write jobs, address records, ownership, domain readiness, or audit events.
A successful plan is not a created address.

Normal requests persist a job with immutable normalized inputs. API callers supply
an idempotency key; CLI and library callers receive a generated one by default.
Reusing a key with different inputs fails. Concurrent attempts use an expiring
lease, and stale workers cannot complete or block a newer attempt. A ready job
replays its stored receipt; its `checked_at` timestamp describes when evidence
was collected. Start a new job to check a previously ready address again.

`--wait` retries the same job until ready or its deadline (1–300 seconds). A timeout
returns the known blocked/processing receipt and job ID with a nonzero CLI status.
Use `provision job <id> --retry` after correcting server configuration. There is
no background provisioning reconciler; polling is driven by the client or an
explicit job retry.

Ready means these configuration checks passed and the address records committed.
It does not prove a running ingest worker or successful end-to-end mail delivery.
No test message is sent. Domain purchase/setup, `provision up`, the domain-level
retry command, daemon, and roundtrip acceptance remain separate unimplemented
workflows.

API routes: `POST /v1/provision/address`, `GET /v1/provision/jobs/{id}`, and
`POST /v1/provision/jobs/{id}/run`. SDK methods are `provisionAddress`,
`getProvisioningJob`, and `runProvisioningJob`; the `provision_address` MCP tool
uses the same API orchestration.
