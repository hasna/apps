# Roundtrip delivery checks

`emails provision roundtrip` sends a bounded set of plain-text messages around a ring of addresses and checks the shared API inbox for each exact sender, subject and body marker. It uses the saved Emails API URL and credentials; provider secrets and S3 credentials stay on the server. It does not create a local database, provision addresses, change DNS or start an ingest worker.

Explicitly invoking the command sends real test mail through the selected provider:

```sh
emails provision roundtrip --domain example.com --provider provider-id \
  --addresses one,two --count 1 --idempotency-key acceptance-001
```

Two local parts and count 1 send two messages, one in each direction. Defaults are `one,two,three` and count 16 (48 messages total), 1100 ms between sends, and 12 receipt polls spaced 10 seconds apart. A run allows 2–20 distinct local parts, 1–100 rounds and at most 500 messages.

The selected server provider must already allow sending from these addresses. Inbound delivery into the same account must work through its configured receiver or worker. To poll an existing server-bound S3 source explicitly, add `--source source-id`; `--bucket bucket-name` can assert the existing bound bucket. These options submit authenticated S3 ingest batches and require the service's operator permission. Without them, roundtrip only sends and reads the shared inbox. The historical `--profile` AWS selector is rejected before network activity: choose the server source rather than client AWS credentials.

The client verifies provider-aware send capability and inbox access before sending. Optional S3 synchronization also runs before the first send. A send counts as confirmed only when the API returns a durably finalized sent receipt. Pending or uncertain sends stop the run and return a nonzero status; they are never counted as successful delivery. Inbound receipt checks require exact markers and exclude outbound copies.

Use `--json` for item-level states, confirmed send and received counts, a run ID and an optional S3 continuation cursor. Exit status 0 means every expected receipt was found; 1 means incomplete or failed; interruption after the run starts returns 130. This is evidence about this run, not a guarantee of future delivery or provider configuration readiness.

Retain the run ID before retrying. Resume with the same `--idempotency-key` and the same domain, provider, address list and count so each send retains its original API idempotency identity. Include `--sync-cursor` with `--source` or `--bucket` if the result reports an incomplete S3 page walk. Reusing a run ID with changed content can produce a send-intent conflict; choosing a new run ID intentionally sends a new test set. An S3 cursor returning to null starts a fresh scan on the next poll, allowing newly delivered objects to be discovered.
