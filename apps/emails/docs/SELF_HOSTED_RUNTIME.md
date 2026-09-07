# Self-hosted runtime

Self-hosted means the operator owns the deployment, provider accounts and data.
Emails does not provide or infer a hosted endpoint.

Client configuration (deployment modes are removed — hasna/apps#1566 — so the
API origin and one credential alone select the arm):

```bash
export EMAILS_SELF_HOSTED_URL="https://emails.example.com"
export EMAILS_SELF_HOSTED_API_KEY="..." # or EMAILS_SESSION_TOKEN / EMAILS_IDP_TOKEN
emails inbox list
```

The client chooses `EMAILS_SESSION_TOKEN`, then `EMAILS_IDP_TOKEN`, then
`EMAILS_SELF_HOSTED_API_KEY` when more than one is present. A client-env vault
entry referenced by `EMAILS_CLIENT_ENV_SECRET` may carry the URL and any one of
those credentials. See [AUTHENTICATION.md](AUTHENTICATION.md) for the account,
tenant-key, and optional IdP flows.

For a repeatable read-only client check, run the published smoke from the exact
checked-out release on every client station:

```bash
./scripts/self-hosted-client-smoke.sh
```

It refuses local database selectors, then runs `emails --version`, remote
status, provider-list, and a one-row inbox read. It performs no send or mailbox
mutation and emits only an aggregate pass record; command responses stay in a
private temporary directory. This is the smoke referenced by
[STATION_LOCAL_RETIREMENT.md](STATION_LOCAL_RETIREMENT.md).

Service configuration. The service has NO deployment mode: setting
`EMAILS_DATABASE_URL` is what makes `emails-serve` the operator `/v1` API over your
own PostgreSQL, and leaving it unset is what makes it the local SQLite dashboard API.
Deployment modes are removed (hasna/apps#1566): the deployment-mode environment
variable and the `emails_mode` config key are retired, and an environment or
config file that still carries one is refused with an error naming the
offending key — delete any carried-forward value everywhere, including this
service environment. (The variable name is deliberately not spelled here: the
retirement is enforced by name, and the refusal message prints the exact key
to delete.)

```bash
export EMAILS_DATABASE_URL="postgresql://..."
export EMAILS_API_SIGNING_KEY="..." # 32+ characters
export EMAILS_SEND_PROVIDER=ses     # or resend
export EMAILS_AUTH_ALLOWED_EMAIL_DOMAINS="example.com"   # required; your own domains
export EMAILS_AUTH_FROM="no-reply@example.com"           # required; a verified sender identity
export EMAILS_IDP_JWKS_URL="https://id.example.com/v1/.well-known/jwks.json" # optional IdP verifier
export EMAILS_AWS_REGION=us-east-1
# SES identity — pick ONE:
#   (a) nothing: sign with the deployment IAM role of the account the service runs in
#   (b) an explicit SES key pair, injected from your secret store:
# export EMAILS_SES_ACCESS_KEY_ID="..."
# export EMAILS_SES_SECRET_ACCESS_KEY="..."
# export EMAILS_SES_CONFIGURATION_SET="..."  # optional; makes SES metrics attributable
# export RESEND_API_KEY="..."       # required for Resend
#
# SES credentials are resolved from the SERVER environment, never per provider:
# `emails provider add --access-key/--secret-key` does not reach a self-hosted
# server, and `emails send --provider` is ignored by the send route. When the
# host has an instance/task role for a production-access SES account, set
# nothing more. When production-access SES lives in a different account, supply
# the sending IAM user's scoped credentials to the server process:
#
#   export EMAILS_SES_ACCESS_KEY_ID="..."
#   export EMAILS_SES_SECRET_ACCESS_KEY="..."
#
# On AWS these must be injected from a secret store by reference (see
# deploy/aws/README.md, "Sending through SES in a different account"), never
# written into a plaintext container `environment` block, a shell profile, or
# the repository.
emails db migrate
emails self-hosted key create
emails-serve
```

The current migration ledger ends at `0021_idp_principal_tenants`. A release
image used after that migration must recognize 0021; an older image fails
readiness on the unknown applied ledger row and is not a rollback target.

## Auth: signup domain allowlist and sender identity

Two auth variables are **required** and have **no defaults** — the service refuses
to boot without them, naming the missing one:

| Variable | Purpose |
| --- | --- |
| `EMAILS_AUTH_ALLOWED_EMAIL_DOMAINS` | Comma- or space-separated allowlist of email domains permitted to sign up, log in, or be invited. `*` matches exactly one DNS label, so `example.*` allows `example.com` and `example.org` but not `sub.example.com`. |
| `EMAILS_AUTH_FROM` | Sender identity for confirmation / password-reset / invite mail. Must be verified in the provider account the service actually signs into. |

Neither ships a default on purpose. A built-in allowlist would pin every install
to one organisation's domains and reject the operator's own staff with a
deliberately opaque 403 (the gate never reveals whether an account exists, so a
wrong allowlist looks like a broken login); a permit-all fallback would silently
open signup on upgrade. Likewise, a default `EMAILS_AUTH_FROM` would only be
sendable by whoever published the build.

`*` matches exactly one DNS label, never a dot, so a subdomain can never sneak in
through a wildcard. Two consequences worth stating: a single bare `*` is rejected
(one label would allow `root@localhost`), and `*.*`, while accepted, is effectively
**permit-all** — if that is what you want, say so deliberately.

Related optional auth variables: `EMAILS_AUTH_PRODUCT_NAME` (name shown in the
email copy) and `EMAILS_AUTH_VERIFY_URL_BASE` / `EMAILS_AUTH_RESET_URL_BASE` /
`EMAILS_AUTH_INVITE_URL_BASE` (override the links, which otherwise derive from
`EMAILS_PUBLIC_BASE_URL`).

## Outbound SES credentials

The service signs outbound SES calls with **one** identity, resolved at boot:

1. `EMAILS_SES_ACCESS_KEY_ID` + `EMAILS_SES_SECRET_ACCESS_KEY` when both are set;
2. otherwise a complete, externally managed `AWS_ACCESS_KEY_ID` +
   `AWS_SECRET_ACCESS_KEY` pair (and optional `AWS_SESSION_TOKEN`) is retained as
   a legacy provider fallback for existing deployments;
3. otherwise the AWS SDK default chain, normally the deployment task/instance
   role.

Setting only one scoped variable is a hard startup error — half a key pair
would otherwise be completed from the ambient chain and sign with a mixed
identity. A legacy generic pair must likewise be complete to act as the
provider fallback.

The names are deliberately scoped rather than the generic `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`: the service's task/instance role may hold unrelated
grants (S3 for inbound, SQS for the ingest worker), and the generic names would
re-point every AWS client in the process, not just SES. The AWS deployment
module therefore injects only the scoped names. Do not set the generic names
merely to enable cross-account SES: use the scoped pair so unrelated AWS
clients continue using the task/instance-role default chain.

Inject the values as **secret references** (AWS Secrets Manager / SSM / your
secret store), never as plaintext deployment config, and never in the
repository.

The self-hosted `providers` resource stores non-secret metadata only
(`name`, `type`, `region`, `active`). `emails provider add --access-key …`
against a self-hosted server therefore **fails with an explicit error** naming
these variables, instead of accepting the flags and dropping the values.

## Reconciling an unknown send outcome

If a provider call fails without a definitive answer (network error, provider
5xx), the ledger row is marked `send_state = 'uncertain'`: the message may or
may not have gone out. Those rows must be closed out against real provider
evidence, one at a time:

```bash
emails send-intent uncertain
emails send-intent reconcile <message-id> --outcome not-sent \
  --evidence "no SES Send datapoint for this window"
emails send-intent reconcile <message-id> --outcome sent \
  --provider-message-id <ses-message-id> \
  --evidence "SES delivery event for this MessageId"
```

Reconciliation only ever transitions an `uncertain` row; a proven outcome is
never overwritten, and the evidence plus the resolving principal are persisted
on the row.

Run key management on the operator host with the same database and signing-key
environment. `key create` persists only a token hash and metadata and displays
the plaintext token once. `emails self-hosted key list` never shows tokens or
hashes; `emails self-hosted key revoke <kid>` disables a key immediately. The
service rejects signed keys that are absent from its database.

For a rename cutover, run `emails self-hosted key rotate`. It creates a new
Emails application key but deliberately retains the active Mailery-era key.
Move clients, verify reads and sends, keep the old key for the agreed rollback
window, and revoke it explicitly only after rollback is no longer required.

Postgres is authoritative. Local mode uses SQLite. There is no remote, hybrid,
dual-write or synchronization mode between them.

The AWS reference path remains direct and user-owned: SES for sending, S3 for
raw inbound mail and attachments, SNS/SQS with a DLQ for ingestion, Route53 for
DNS, and RDS Postgres for application state. Cloudflare and Resend are optional
direct integrations using credentials supplied by the user. No additional
mailbox-provider import backend is included in this OSS package.

## Production boundary

- Put `emails-serve` behind an HTTPS ALB/reverse proxy. Apply per-key/IP rate
  limits, a 1 MiB request cap, bounded timeouts, and firewall rules; do not
  expose the container or Postgres directly to the internet.
- Use an AWS task/instance role with only the required SES, S3, SQS and SNS
  actions. Local operators should prefer `AWS_PROFILE`; long-lived access keys
  are discouraged.
- Use separate database roles. `emails-migrate` owns DDL; `emails-serve` uses
  the runtime role with table/sequence DML only. The provided Compose init
  script establishes those grants on a new database.
- Self-hosted sends require a durable idempotency key. Inline attachments are
  limited to five, 512 KiB each and 768 KiB total. Scheduled sends are not
  supported by the self-hosted API. Explicit-id bulk mailbox mutations are.
- Resend webhook signatures are mandatory. SES inbound requires a verified AWS
  SNS signature plus exact topic ARN and AWS account allowlists.

### Trusted proxy depth (`EMAILS_TRUSTED_PROXY_HOPS`)

The per-IP auth rate limits — login brute-force, signup/forgot throttles, and
the throttle in front of the argon2id password-reset path — are keyed on the
client address. `X-Forwarded-For` is **appended to** by each proxy, so its
leftmost entry is whatever the client sent and is never trustworthy; only an
entry counted from the right was written by a proxy you control.

`EMAILS_TRUSTED_PROXY_HOPS` states how many appending proxies sit in front of
`emails-serve`:

| Value | Meaning |
| --- | --- |
| `0` (default) | Trust nothing. Forwarding headers are ignored and the socket peer address is used. |
| `1` | One appending proxy — an AWS ALB, or a single Caddy/nginx. The client IP is the **last** `X-Forwarded-For` entry. |
| `n` | `n` chained proxies. The client IP is the `n`th entry from the right. |

**Set this to match your topology.** The default is deliberately the safe one, but
it is not the accurate one for the canonical ALB deployment: leaving it at `0`
behind an ALB collapses every client into the ALB's own address, so one shared
bucket throttles all of them. The AWS module sets `EMAILS_TRUSTED_PROXY_HOPS=1`
on the API task for exactly this reason.

If the header carries fewer entries than the configured chain, it did not
traverse that chain, so it is discarded and the socket peer address is used —
stripping the header cannot buy an attacker a fresh rate-limit bucket. `X-Real-IP`
is never trusted: it is a single-value header with no position a proxy is known to
own. An operator whose proxy sets only `X-Real-IP` should leave the hop count at
`0` and accept per-proxy granularity.

## Reproducible dependency pins

The Dockerfile, Compose database image, and CI actions use immutable digests or
commit SHAs. Refresh them in a reviewed dependency update: verify the upstream
tag/release, resolve its current digest/SHA, run the full isolated suite and
Postgres integration job, then record the change in the changelog. Never
silently retag a deployment.

### Binding registry providers to senders

The provider registry stores metadata. Sending credentials remain on the server.
A client can select `emails send --provider <id>` after the server operator binds
that active registry ID to a sender in `EMAILS_SENDER_BINDINGS`. Bindings are keyed
by both tenant ID and provider ID, so another tenant cannot select your sender.

The JSON array contains secret **environment variable names**, never secret
values. Inject those variables through your deployment's secret manager:

```json
[
  { "tenant_id": "tenant-id", "provider_id": "primary-provider-id", "sender": "default" },
  { "tenant_id": "tenant-id", "provider_id": "resend-provider-id", "type": "resend", "api_key_env": "TRANSACTIONAL_RESEND_TOKEN" },
  { "tenant_id": "tenant-id", "provider_id": "ses-provider-id", "type": "ses", "region": "us-east-1", "access_key_env": "TRANSACTIONAL_SES_ACCESS", "secret_key_env": "TRANSACTIONAL_SES_SECRET" }
]
```

`sender: "default"` explicitly binds the existing `EMAILS_SEND_PROVIDER` sender,
including its deployment role when configured. Additional SES bindings require
both named credential variables and a region. Additional Resend bindings require
the named API key variable. Unknown fields, missing variables, or duplicate
bindings prevent startup. Restart the API after updating these settings.

Omitting `--provider` keeps the existing default sender. An explicit provider
without a binding fails before sending; it never falls back to the default.
The selected provider is recorded on the message and included in the idempotency
payload. Changing providers while reusing an idempotency key is a conflict.

`--unsubscribe-url https://example.com/unsubscribe` passes an HTTP(S) URL to the
provider adapters, which emit the List-Unsubscribe headers. The URL participates
in idempotency checking. Clients check the advertised send API contract before
using provider selection or unsubscribe URLs; an older API must be upgraded
first so these options cannot be silently dropped.


### Domain lifecycle commands

`emails domain status` and `emails domains status [domain]` read the tenant's
server registry. `domains verify`, `enable-outbound`, `disable-outbound`, and
`enable-inbound` call authenticated operator-only domain lifecycle routes.
Verification and enablement use the domain's tenant provider binding described
above; they never read provider credentials from the CLI machine. An optional
`--provider` selects and persists a verified tenant provider association.

Disabling outbound immediately denies sends even for previously ready addresses.
Verification alone does not undo that disable. Enabling outbound requires the
bound provider to confirm identity/DKIM readiness. SES identity verification is
reported separately from SPF/DMARC DNS observations; neither a missing DMARC
observation nor a provider transport error is reported as successful DNS proof.

Enabling inbound requires the server ingest bucket/queue configuration, regional
SES MX, and an enabled SES receipt action delivering to that bucket. It does not
modify DNS, receipt rules, or S3 notifications and does not prove end-to-end queue
delivery. Both directions survive lifecycle ordering: an inbound-only state is
`inbound_ready`, and verified sending plus inbound readiness is
`verified_inbound_ready`. Disabling outbound preserves the inbound tenant route. Full DNS provisioning/connect/setup remains
separate from these readiness operations. Readiness checks cannot be forced off.


### Provider health command coverage

| Command | Server operation | Deployment prerequisite |
| --- | --- | --- |
| `provider status`, `provider check` | `GET /v1/providers/{id}/health?live=true` for every registered provider | API with this route; explicit tenant/provider sender bindings |
| `doctor --live` | Same server credential probes | Same; absent bindings are unknown/unconfigured, not invalid client credentials |
| Domain status | Read tenant registry readiness | Existing domains API |
| Domain verify / outbound enable | Bound SES identity or Resend verification API | Tenant provider binding with domain-read permissions |
| Domain inbound enable | Provider verification, regional MX and active SES receipt/S3 route checks | Server ingest config and existing receiving infrastructure |

The provider health endpoint without `live=true` only reports binding metadata.
Live SES checks call `GetAccount` using server credentials and report sending and
production-access flags. Resend checks read the domain list; the binding needs
permission to read domains. Failure means the read-only probe failed, not proof
that the key itself is invalid. Provider error payloads and secret values are
never returned. Probes abort after five seconds; the CLI bounds its transport too.
An older API produces an explicit update error. No provider registration or mail
send occurs during health checks. Inactive and unsupported/unbound registry rows
remain visible. DNS provisioning, purchase, and inbox end-to-end delivery are not
claimed by these checks.

### Provider delivery sync

`emails provider sync [--provider <id>]` and `emails pull` call the operator-only
`POST /v1/providers/{id}/sync` route. `pull --watch --interval 5m` repeats the API
operation and exits on Ctrl+C. The API processes at most ten known messages per
request; the client follows its cursor, preserves failures, and exits nonzero
for incomplete results. Provider credentials stay in the server bindings.
Migration `0031_provider_status_observations` must be deployed before syncing.

SES uses [GetMessageInsights](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetMessageInsights.html)
for recorded provider message IDs, with one-second spacing within each batch.
The binding needs insights permission and provider-retained data. Throttling,
expired history, unavailable insights, and authentication errors are reported as
partial failures; they are never zero-event successes.

Resend uses [Retrieve Sent Email](https://resend.com/docs/api-reference/emails/retrieve-email)
for each known message. Its current-status response does not supply an event
timestamp: the app records `status_observed` with `observed_status` metadata,
updates the message state, and does not misdate it as a new delivery/bounce event
in period analytics. Multiple-recipient snapshots do not identify an affected
recipient, so contact counters are left unchanged and the report names the
unattributed count. No complete provider event history is claimed.

Each message's observations, monotonic delivery status, and attributable contact
effects commit atomically. Repeated/concurrent syncs do not count a recipient's
bounce or complaint twice for the same message. A matching timestamped webhook
event is reused. Complaints, proven permanent bounces, and three distinct bounced
messages suppress the contact; absent contacts are created within the transaction.
Only messages carrying the selected tenant/provider provenance are queried.
Messages sent outside this app, old rows without provenance, and inbox/Gmail/S3
imports require their own ingestion paths; this command does not imply they were
pulled. The existing webhook ingestion remains active independently of sync.

### Tenant-bound inbox imports and queue watch

`emails inbox sync-s3` and `emails inbox watch` call operator-authorized API
operations. They use the same saved API credentials as the other CLI commands.
`watch` polls SQS on the server and acknowledges a notification only after every
referenced object is imported or already present. `--once` performs one poll;
otherwise Ctrl-C stops the client polling loop. This does not install a background
worker. API responses include imported/duplicate/error counts, queue counts when
available, the check time and the S3 continuation cursor. Queue counts are
approximate. A partial S3 page retains its starting cursor (or reports
`retry_from_start`) so a retry does not skip failed objects.

Use `emails inbox source add-s3 --bucket inbound-mail-bucket --prefix inbound/example.com/`
to register the tenant-owned API source. `inbox source list` (alias `status`)
reads the same registry from every authenticated client. Registration records
metadata and returns the source ID; it does not create cloud infrastructure.
The service operator must then configure
`EMAILS_INGEST_BINDINGS` on the API service. This configuration contains resource
identifiers, not AWS secrets. Example with placeholder IDs:

```json
[
  {
    "tenant_id": "TENANT_UUID",
    "source_id": "SOURCE_ID",
    "provider_id": "OPTIONAL_REGISTERED_PROVIDER_ID",
    "bucket": "inbound-mail-bucket",
    "prefix": "inbound/example.com/",
    "domain": "example.com",
    "region": "us-east-1",
    "queue_url": "https://sqs.us-east-1.amazonaws.com/123456789012/tenant-inbound"
  }
]
```

`provider_id` and `queue_url` are optional for S3 import; watching requires a
queue. Each queue must be dedicated to its binding. Bucket prefixes must not
overlap across bindings. The domain must already route inbound email to the
bound tenant. For S3 notifications without envelope recipients, this operator
configured prefix/domain mapping supplies the routing evidence; MIME headers are
never routing authority. New messages retain the configured provider ID. Existing
immutable source provenance is checked on retries.

The server AWS credential chain needs S3 ListBucket/GetObject and, for queue
watch, SQS ReceiveMessage/DeleteMessage/GetQueueAttributes on those bound resources.
No client AWS credentials are accepted. `--bucket`, `--region`, `--provider` and
`--queue-url` validate the corresponding binding; `--prefix` can narrow it.
`--profile` reports a configuration error because profiles belong to the server.
`--all-buckets` polls every bound queue in this tenant, at most ten per request.
Each request shares a 25-second cloud deadline; S3 batches contain at most ten
objects and queue batches contain at most ten notifications per source.

SES receipt rules, SNS/SQS delivery permissions, dedicated queues, domain routing
and IAM credentials must be provisioned before these operations can run.
`setup-realtime` and a network SMTP listener still require separate infrastructure
work; these commands do not create that infrastructure. Historical machine-local
source entries are not imported automatically; register their bucket/prefix through
`inbox source add-s3` and bind the returned API source ID. Repeating registration
for a unique bucket/prefix updates that source without replacing its ID.
`--status import` permits manual sync without queue watch; `--no-live-sync` also
disables watch while retaining manual recovery. `inbox source retire ID` retires
the API source and preserves its metadata and mail. Registry lifecycle settings
are distinct from worker health or verified cloud configuration.
