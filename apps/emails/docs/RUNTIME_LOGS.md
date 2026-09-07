# Runtime operation logs

`emails logs tail --component scheduler --lines 80` reads the configured API using the same saved credentials as other commands. It requires a tenant operator credential. Components remain `daemon`, `sync`, `inbound`, `scheduler`, and `nightly`; limits must be integers from 1 to 500. Records are newest first.

Migration `0037_runtime_logs` adds an append-only, tenant-isolated log. The API records actual operation entry and return/throw events for scheduled/sequence batches, forwarding, S3 sync/watch, provider sync, SMTP import, webhook relay and address provisioning jobs. Records contain generated request IDs, fixed component/operation/event names, timestamps and HTTP status codes. They do not contain mail bodies, subjects, recipients, attachments, credential values, arbitrary request metadata or provider error strings.

`returned HTTP 200` means the API operation returned that status. It does not claim that every item succeeded or that a background process is alive; inspect the operation's original receipt for partial failures and pending work. A `started` entry without a terminal entry may indicate interruption or a log-write failure. It is not a heartbeat.

An empty result means there are no retained records for that component. Historical activity is not reconstructed from job snapshots. No nightly worker is instrumented yet, so its log is normally empty. These logs are not container stdout or stderr, and the command no longer reads obsolete local log files. Raw service logs remain under the deployment operator's control.

The log's start record must commit before work begins. If the final log append fails after work completes, the API preserves the original response and adds `X-Emails-Runtime-Log: incomplete`; it must not turn a durable send/import receipt into an error that encourages duplicate retries. Unexpected exception text is never written into the log. Tail queries cannot mutate records, and PostgreSQL rejects updates/deletes. Retention/archival is not implemented; capacity monitoring and a separately reviewed archival procedure are required for long-running deployments.

The generated SDK method is `tailRuntimeLogs`. The endpoint is `GET /v1/runtime/logs?component=scheduler&lines=80`. Deployment requires the new migration and API image; an older API returns an explicit upgrade requirement. Logs do not control ECS or establish worker liveness. The separate [foreground supervisor](WORKER_SUPERVISOR_DESIGN.md) provides authenticated generation, heartbeat and cooperative restart evidence.
