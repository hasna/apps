# CLI API closure status

This is a source implementation matrix, not a claim that the public service or npm package already contains these changes. The original September 7 audit enumerated 261 command nodes, 229 actionable commands and 40 known hard-failure paths. Service changes must be deployed before a dependent client is shipped.

| Command or family | Source closure | Remaining acceptance/dependency |
| --- | --- | --- |
| `test`, `batch` | Authenticated send composition, templates/CSV validation, retry identities and partial-failure receipts | Provider selector requires provider-aware send service; no production test messages authorized |
| `email list`, `log --from/--status` | Filters implemented before paging; bounded reads fail explicitly on an incomplete scan | Provider provenance/filter support is a separate integration |
| `doctor delivery`, `inbox explain` | API registry/message diagnostics; optional public MX inspection | Registry evidence does not establish provider credentials or worker health |
| `inbox realtime-status` | Registered sources and last-sync metadata, paginated beyond 500 | Worker heartbeat/queue health remains unmeasured until a service endpoint exposes it |
| `schedule run`, `scheduler` | `/v1/scheduled/run`, atomic tenant-scoped claims, expiring leases, fenced completion, stable send-intent identity; `--once`, `--limit`, interval polling | Deploy route, then exercise installed client; sequence enrollment execution is separate |
| `send --schedule` | Validated `/v1/scheduled/enqueue` with immutable tenant-scoped identity, preserved attachments/options, explicit queued receipts | Deploy migration 0028 and API routes; operator credentials required; scheduler must run |
| `stats`, `analytics`, `monitor` | Assigned separate statistics integration | Verify exact/provider-scoped counts and installed CLI |
| `provider sync`, `pull` | Service ingestion work remains | Transactional provider event/counter updates and an authenticated trigger |
| `provider status/check`, `doctor --live` | Service credential probe remains | Probe server-held credentials without exporting them to clients |
| `forwarding run` | CRUD exists; execution remains | Service claim/dedupe/send operation |
| `inbox sync-s3/watch/listen/setup-realtime`, `webhook listen` | Ingestion/lifecycle work remains | Real server worker operations or explicit API adapters, with observable results |
| `provision status` | Reads domain/address provisioning state from the shared API registry | No local registration or orchestration implied |
| `address provision`, remaining `provision *` | Orchestration remains | Domain/address jobs, retry state and effect/audit records |
| `domain/domains connect/verify/status/enable-*/disable-outbound/setup*` | Some read/library building blocks exist | Finish lifecycle wiring; do not just change refusal wording |
| `provider secrets *`, `daemon restart`, server logs | Operator service actions remain | Privileged operations and actual supervisor/log access |
| `self-hosted key/idp-principal`, `db`, `serve` | Operator surfaces need neutral naming/consolidation | Keep infrastructure privileges distinct from ordinary mailbox actions |

## Scheduled execution boundaries

Only due scheduled-email rows are executed; the result explicitly carries `sequence_execution: "not_requested"`. Sequence rows are not interpreted as an empty queue. Failed jobs remain failed until deliberately requeued; replay always uses the same scheduled row identity. Transport ambiguity or an in-progress send leaves processing work recoverable after lease expiry. Existing send-intent reconciliation governs uncertain provider outcomes.

Queue writes and execution require tenant operator authority because historical scheduled rows do not store the submitting principal. This prevents a data-only writer enqueueing a message that an operator later sends with elevated authority. In-flight rows cannot be edited, cancelled or deleted through generic CRUD. Later principal-bound scheduling can support narrower user permissions without granting a worker broader sender authority implicitly.

Concurrency, stale lease fencing, tenant separation, future/cancelled exclusion and in-flight mutation protection were exercised against a disposable loopback Postgres instance. Synthetic handler/CLI tests exercise authentication, limits, retries, pending outcomes and partial failures. No real email was sent. This does not establish production worker deployment or provider acceptance.
