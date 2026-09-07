# Server forwarding

`emails forwarding run` executes `POST /v1/forwarding/run` on the configured authenticated Emails API. It does not create a local database, inspect a machine-local inbox, or use a local provider callback. Existing explicit local database callers retain their separate local pipeline.

Creating, changing, deleting, and running forwarding rules require a tenant owner, admin, or operator API key. A general data-write key cannot authorize automatic copies of inbound mail. Normal sender authorization, the selected provider, suppression policy, and send-intent checks still apply to each copy.

The service matches canonical, exact To/Cc recipients against enabled `app-copy` rules in the current tenant. By default, only inbound mail received at or after rule creation qualifies. `--backfill` includes earlier inbound mail. `--limit` bounds a run to 1–1000 rule/message pairs (default 100).

Migration `0030_forwarding_delivery_jobs` adds a tenant-isolated PostgreSQL delivery ledger. Concurrent runners claim work atomically. Each rule/message pair retains its first quoted message, recipient, sender/provider overrides, and stable send idempotency key across retries. Successful and skipped pairs are never offered again. Editing a rule does not rewrite an existing delivery snapshot.

A provider acknowledgement with a durable sent receipt completes a delivery, including HTTP 202 responses that explicitly confirm it was sent. An interrupted request or uncertain provider outcome stays `processing`; after five minutes a run can revisit it using the same send identity. The normal send ledger requires reconciliation before an uncertain provider call can be repeated. An old worker cannot complete a newer worker's lease.

Disabling a rule prevents new claims and retries, including failed and expired processing deliveries. Copies already admitted to a running batch may finish. An operator can re-enable a paused rule to resume those same immutable deliveries. While a delivery is processing, content edits and rule deletion are blocked. Reconcile uncertain send intents and run the enabled rule to record their outcome before changing or deleting it.

Copies use escaped plain text in the HTML part and carry `X-Hasna-Forwarded-For`, `X-Hasna-Inbound-Id`, and `Auto-Submitted: auto-generated`. Messages already carrying forwarding markers or an automatic-submission marker are skipped to prevent loops. These headers come from server-owned forwarding metadata; ordinary HTTP send fields cannot inject them. HTML-only messages are converted to escaped plain text; original HTML markup is not executed or copied. Stored attachments are copied from the immutable delivery snapshot within the send limits (5 files, 10 MiB each, 20 MiB total). Missing, malformed, or oversized attachment content fails the whole copy visibly before sending; repair unavailable stored attachments before creating a new forwarding delivery.

The run result reports `sent`, `failed`, `skipped`, and `pending` counts and a receipt per attempted pair. An older server without this endpoint fails visibly; the client never substitutes an empty local result.
