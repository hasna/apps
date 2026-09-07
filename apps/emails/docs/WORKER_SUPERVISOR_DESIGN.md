# Foreground worker supervisor

`emails daemon start` owns an actual foreground scheduler and sequence loop. It uses saved API credentials and requires tenant operator authority. It does not restart the API service, change ECS, launch a hidden process, or use local SQLite/PID state.

```sh
emails daemon start --worker <uuid> --interval 60
emails daemon status
emails daemon restart --worker <uuid> --idempotency-key <uuid> --timeout 60
emails daemon start --once
```

A batch claims at most one scheduled message and one sequence enrollment. Existing job leases, suppression checks and stable send identities remain authoritative. Other components, including inbox watch and provisioning, retain their explicit commands; this supervisor does not own those loops yet.

## Ownership and restart evidence

Migration `0038_worker_supervisor` stores tenant-scoped worker registrations, restart requests and operation receipts in PostgreSQL with forced row-level security. All control requests require an operator, including status. Registration creates a random memory-only owner token; only its SHA-256 hash is persisted. Status and receipts never expose the token or hash.

The owner renews a 30-second lease independently while an API operation is running. Before every dispatch it obtains fresh ownership evidence. Transient heartbeat failures retry within the existing lease; an expired lease or rejected owner cannot dispatch. SQL guards lock and validate the current worker generation inside both scheduled-message and sequence-enrollment claims. Restart changes the desired state under the same row lock, preventing new claims from the old generation.

A restart request has a reusable UUID. The owner stops dispatching, waits for its durable server operation receipt, and asks the server to drain. A running operation prevents this transition. The server then advances the generation to `starting`; only the replacement loop's authenticated start acknowledgement completes the restart receipt. Repeated requests return the same old/new generation evidence. An omitted worker selector is accepted only for one complete registry entry.

HTTP cancellation is not evidence of completion. A timed-out tick is reconciled by its original operation UUID, without substituting another request. The owner continues heartbeating while it waits. If the operation remains unknown, the process reports its IDs and exits unsuccessfully without marking it drained. Completed server execution can drain even when a job has an uncertain delivery receipt: the existing job lease and send identity are preserved. Operation completion and batch success are separate; iteration output includes sanitized counters, and `--once` exits unsuccessfully after safe shutdown when execution failed or work remains pending.

SIGINT/SIGTERM requests the same bounded drain and marks the generation stopped only after server confirmation. A cleanly stopped registration can be reused with a new owner and generation. An expired `starting` generation with no running operations can be claimed by a replacement token without skipping its generation or losing its pending restart request. An expired `running` owner remains visibly unreachable: automatic takeover is deliberately unavailable until its possible execution is reconciled. Starting a separate worker does not clear that owner's operation records or job leases.

## Logs and limits

Scheduler and sequence operations use the existing append-only runtime log sink. Worker ownership, desired state, generation and restart outcomes come from the dedicated control records; they are not inferred from logs. No new lifecycle log enum is introduced. Receipts contain fixed counters and execution classification, never mail bodies, provider errors or credentials.

The API routes are `GET /v1/workers` and `POST /v1/workers/{id}/control`. Old APIs return an explicit compatibility failure. Read-only and data-writer principals cannot acquire worker execution authority. Registry lists are bounded at 500 entries with a completeness flag.

Synthetic tests cover concurrent restart replay, tenant and owner isolation, stale SQL claim fences, pending operations, heartbeat retries, safe failure reporting, stopped/starting recovery, and two actual CLI processes completing a generation change. They use disposable PostgreSQL and never send real email.
