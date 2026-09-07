# SMTP listener

`emails inbox listen --port 2525 [--provider <id>]` starts a foreground listener
on `127.0.0.1`. Port `0` requests an available port; startup reports the actual
bound port. Ctrl-C stops the listener. It uses the normal Emails account/API
credential resolver and requires a tenant operator, admin or owner. The API must
include migration `0034_smtp_submission_receipts` and the `/v1/inbox/smtp` endpoint.
A capability and provider check completes before any socket opens.

Messages are imported into shared PostgreSQL through the API. No SQLite database
or local mail spool is created. Every SMTP envelope recipient must resolve through
the server inbound-domain registry exclusively to the caller's active tenant.
MIME To/Cc headers cannot choose the destination tenant. The API parses the original
raw bytes, retains HTML, text, attachment bytes and CID metadata, and associates the
selected tenant provider. SMTP imports use their own provenance, never fake S3 keys.

The listener is intended for trusted local development/import processes. It has no
SMTP AUTH or STARTTLS and does not expose a public relay. A tenant operator is
explicitly importing mail: this path does not claim provider authentication, SPF,
DKIM verification, or remote delivery. The envelope and MIME sender may differ.

Limits: 10 MiB raw MIME, 100 recipients, 100 attachments within the same aggregate
10 MiB bound, 16 concurrent connections, 1000-byte SMTP lines, and a 120-second
idle timeout. Unsupported ESMTP parameters are rejected. No background process is
started and no provider resources are created.

A DATA transaction receives `250` only after an explicit durable API receipt. One
transport retry preserves the original transaction UUID and bytes; the database
atomically stores the receipt and message, and changed content under the same UUID
conflicts. Receipt replay cannot overwrite edits or recreate a deleted message.
An uncertain or failed API result receives `451`; shutdown closes active sockets
without a success acknowledgment. Separate SMTP DATA submissions receive distinct
UUIDs, so a client retry after losing its SMTP acknowledgment can produce another
message. This is normal at-least-once SMTP behavior, not cross-session deduplication.
