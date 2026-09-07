# Provision an owned domain

`emails provision up` creates a durable run in the shared Emails API. It uses the
server's SES and Cloudflare bindings, then verifies existing SES/S3 receiving
infrastructure before creating the requested addresses. Optional roundtrip
messages carry exact tokens; readiness and delivery evidence are separate.

```sh
emails provision up example.com --provider <ses-id> --dry-run
emails provision up example.com --provider <ses-id> --addresses one,two --no-test
emails provision up example.com --provider <ses-id> --addresses one,two --count 1 --source <source-id>
emails provision run <run-id>
emails provision retry example.com --job <run-id>
emails provision daemon --provider <ses-id> --once
```

The account needs an operator credential, a registered active SES provider,
its matching server credential binding, and the exact tenant/provider/domain
Cloudflare zone binding described in [Domain DNS](DOMAIN_DNS.md). The receiving
bucket, queue, SES receipt rules, SNS subscription and public MX must already be
configured as described in [Address provisioning](ADDRESS_PROVISIONING.md).
`--source` selects an existing server-bound S3 source to poll for test receipts;
`--bucket` asserts the saved server bucket and also enables polling.

The default preserves existing MX. `--add-mx` explicitly requests inbound MX
publication. Replacing another provider's MX additionally requires
`--force-mx-switch` and the exact server-bound expected target. Uncertain DNS
batch acceptance blocks further changes until its original plan is reconciled.
This workflow creates no receiver infrastructure, registrar purchase or new DNS
zone. Legacy `--buy-if-needed` and `--purchase-profile` selectors fail before API
calls; complete registration with the Domains registrar commands first.

A run supports 2–20 distinct local parts and up to 500 total probes. `--count 0`
or `--no-test` skips delivery probes and leaves `delivery_tested` false even when
configuration is ready. The default probe count is one per directed address pair.
`--timeout` bounds client waiting (1–3600 seconds, default 600); the saved run
continues to exist after the client stops waiting.

## Run identity and retries

The default run identity is stable for the resolved provider and domain. Repeating
`up` with unchanged inputs resumes that run. Different inputs conflict with the
saved intent. Use an explicit new `--idempotency-key` only for an intentional new
run; it can authorize another complete set of delivery probes.

Each send is checkpointed as uncertain before calling the normal authenticated
send API. Confirmed acceptance and matching inbound receipts have separate
checkpoints. Timeouts do not prove cancellation. Retrying preserves every send
key and completed receipt; the send API requires reconciliation of an uncertain
provider outcome before any resend. The next probe does not start after an
unconfirmed send. No database transaction remains open during provider calls.

`retry` rechecks DNS/address readiness from the saved inputs and retains previous
errors, child receipts and send identities. If several runs match a domain, supply
`--job`. A current worker's lease prevents retry from taking over its work.
Completed runs remain completed; an explicit new run is required for new probes.

## Daemon

`provision daemon` advances one due step from an existing authorized run per tick.
It does not discover domains to configure or authorize new MX changes. Blocked
runs require `retry`. Its provider selector is an exact registered provider ID;
optional bucket/MX flags filter the previously saved intent. A mismatch advances
nothing. `--once`, `--interval` and `--max-ticks` bound the client loop. Interrupts
stop subsequent ticks; a server step already accepted retains its durable lease
and checkpoint. SES send/readiness calls use a finite abort deadline, and each
step has finite request and recipient budgets.

API routes are `POST /v1/provision/up`, `POST /v1/provision/tick`,
`POST /v1/provision/retry`, `GET /v1/provision/runs/{id}` and
`POST /v1/provision/runs/{id}/run`. All require tenant operator authority. Jobs
use the existing RLS-protected PostgreSQL provisioning ledger; client machines
keep no SQLite job database or cloud credentials. The generated selfhost SDK and
public `runProvisionUp`, `inspectProvisionUp`, `retryProvisionUp` and
`runProvisionDaemon` helpers use these routes.
