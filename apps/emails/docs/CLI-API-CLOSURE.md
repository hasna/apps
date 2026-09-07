# CLI API closure status

This is a source implementation matrix, not a claim that the public service or npm package already contains these changes. The original September 7 audit enumerated 261 command nodes, 229 actionable commands and 40 known hard-failure paths. Service changes must be deployed before a dependent client is shipped.

| Command or family | Source closure | Remaining acceptance/dependency |
| --- | --- | --- |
| `test`, `batch` | Authenticated send composition, templates/CSV validation, retry identities and partial-failure receipts | Provider selector requires provider-aware send service; no production test messages authorized |
| `email list`, `log --from/--status` | Filters implemented before paging; bounded reads fail explicitly on an incomplete scan | Provider provenance/filter support is a separate integration |
| `doctor delivery`, `inbox explain` | API registry/message diagnostics; optional public MX inspection | Registry evidence does not establish provider credentials or worker health |
| `inbox realtime-status` | Registered sources and last-sync metadata, paginated beyond 500 | Worker heartbeat/queue health remains unmeasured until a service endpoint exposes it |
| `schedule run`, `scheduler` | `/v1/scheduled/run`, atomic tenant-scoped claims, expiring leases, fenced completion, stable send-intent identity; `--once`, `--limit`, interval polling | Deploy routes and migration0029, then exercise installed client; sequences have independent limits and measured results |
| `send --schedule` | Validated `/v1/scheduled/enqueue` with immutable tenant-scoped identity, preserved attachments/options, explicit queued receipts | Deploy migration 0028 and API routes; operator credentials required; scheduler must run |
| `stats`, `analytics`, `monitor` | API aggregates, analytics and interruptible monitor implemented | Verify exact/provider-scoped counts and installed CLI |
| `provider sync`, `pull` | Authenticated server-bound SES/Resend observations, transactional event deduplication/counters/suppression, resumable paging and interruptible watch | Deploy route and migration 0031; configure tenant provider bindings; Resend current status is not a historical event feed |
| `provider status/check`, `doctor --live` | Server-bound SES/Resend read-only probes; configured, unhealthy and unconfigured states distinguished | Deploy health route and configure tenant provider bindings; installed client verification pending |
| `forwarding run` | Operator-authorized execution with tenant claims, leases, immutable content snapshots, retry identities and confirmed-send receipts; HTML-only content and stored attachments preserved | Deploy route and migration 0030; unavailable attachment content fails visibly before sending |
| `inbox sync-s3`, `inbox watch` | Real server-bound S3 imports and SQS polling, resumable pages, tenant-only recipient routing and acknowledgement after durable ingestion of every notification record | Deploy routes and configure `EMAILS_INGEST_BINDINGS`, IAM and dedicated queues; source registry CLI migration is in progress |
| `inbox listen/setup-realtime`, `webhook listen` | Lifecycle work remains | Real server worker operations or explicit API adapters, with observable results |
| `provision status` | Reads domain/address provisioning state from the shared API registry | No local registration or orchestration implied |
| `address provision`, remaining `provision *` | Orchestration remains | Domain/address jobs, retry state and effect/audit records |
| `domain/domains connect/verify/status/enable-*/disable-outbound/setup*` | Verify, status and inbound/outbound lifecycle operations implemented; pending-to-inbound and outbound-disable preserve routing | Connect/setup orchestration remains; lifecycle routes and bindings require deployment |
| `provider secrets *`, `daemon restart`, server logs | Operator service actions remain | Privileged operations and actual supervisor/log access |
| `self-hosted key/idp-principal`, `db`, `serve` | Canonical `server key/idp-principal/db` operator namespace; `self-hosted` and root `db` compatibility aliases | Server database/signing credentials remain required for bootstrap actions; ordinary account API keys use `keys` |

## Scheduled execution boundaries

Due scheduled messages and active sequence enrollments are executed. Sequence work defaults to 10 steps per tick; `--sequence-limit 0` explicitly skips it. Results report both families separately. Failed jobs remain failed until deliberately requeued; replay always uses the same scheduled row identity. Transport ambiguity or an in-progress send leaves processing work recoverable after lease expiry. Existing send-intent reconciliation governs uncertain provider outcomes.

Queue writes and execution require tenant operator authority because historical scheduled rows do not store the submitting principal. This prevents a data-only writer enqueueing a message that an operator later sends with elevated authority. In-flight rows cannot be edited, cancelled or deleted through generic CRUD. Later principal-bound scheduling can support narrower user permissions without granting a worker broader sender authority implicitly.

Concurrency, stale lease fencing, tenant separation, future/cancelled exclusion and in-flight mutation protection were exercised against a disposable loopback Postgres instance. Synthetic handler/CLI tests exercise authentication, limits, retries, pending outcomes and partial failures. No real email was sent. This does not establish production worker deployment or provider acceptance.

## Sequence execution

Sequence, step, enrollment and template writes require tenant operator authority because they become worker send inputs. Read access remains available to readers. Each enrollment claim persists a rendered payload snapshot before sending, so template edits and crash recovery cannot change an existing send identity. Only confirmed delivery advances the step; missing templates/senders and suppression errors remain visible with a five-minute retry delay. Ambiguous provider outcomes retain the lease and use the existing send-intent reconciliation path. Cancellation is permitted between attempts, and an active lease fences edits/cancellation/deletion. Started enrollment content and identity cannot be rewritten or deleted; this prevents replaying earlier steps with a new payload. When From is omitted, execution requires exactly one active matching sender, otherwise it reports the ambiguity. Duplicate active enrollments for one recipient are refused before first execution and must be resolved by cancelling the duplicate.
