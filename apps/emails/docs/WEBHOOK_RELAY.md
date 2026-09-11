# Foreground webhook relay

`emails webhook listen --port 9877 [--provider <id>]` opens a loopback HTTP relay
and uses the normal account/API credentials. Port `0` chooses an available port.
Startup reports the actual bound port; Ctrl-C shuts it down. It does not create a
public tunnel, register a webhook with the provider, or start a background worker.
A tunnel or external callback sender must already reach the local listener.

The relay accepts `/webhook/resend` or `/webhook/ses` for its selected provider
(and the corresponding `-inbound` aliases). It preserves the original callback
body and provider signature headers inside a `{raw_body_base64, signature_headers}`
JSON envelope with strict canonical base64 and bounded decoded bytes, so UTF-8
decoding or SDK serialization cannot alter the forwarded signed bytes. The API performs the existing Svix HMAC or
AWS SNS certificate-signature verification. A Hasna operator credential never
replaces provider proof. Unsigned callbacks, foreign tenant envelopes, inactive
SES sources, ignored events, and uncertain receipts do not receive success.

Configure `EMAILS_WEBHOOK_BINDINGS` on the server as an array of records:

| Field | Meaning |
|---|---|
| `tenant_id`, `provider_id`, `type` | Exact registered tenant/provider; type is `resend` or `ses` |
| Resend `secret_env` | Name of the environment secret containing this webhook's Svix secret |
| Resend `api_key_env` | Name of the environment secret for Receiving API access |
| SES `source_id`, `topic_arn` | Exact active source and topic in `EMAILS_INGEST_BINDINGS`, with matching provider and region |

Each binding has a distinct provider and verification secret reference/topic.
Omitting `--provider` works only when the tenant has exactly one binding. The
capability check validates the registry and server configuration before opening
a port. It returns no credential values. Generic webhook receipt writes require
operator authority because a forged receipt could suppress ingestion.

Resend `email.received` callbacks contain metadata rather than message content.
After verification and envelope authorization, the server retrieves the original
raw MIME using the Receiving API. The fixed API origin receives the provider
credential; the signed Resend/CloudFront CDN download receives no bearer header.
Redirects are refused. The message retains text, HTML, headers, attachment bytes
and CID metadata. A missing raw download URL or unsupported CDN host fails
explicitly without acknowledging a metadata-only copy. Callback bodies are
limited to 1 MiB; Receiving API responses and raw MIME to 10 MiB each; Resend
imports additionally allow at most 100 attachments within 10 MiB total. A shared
25-second provider-operation deadline bounds each relay request.

SES uses only the server-bound bucket/prefix and server AWS credentials, with
raw MIME bounded to 10 MiB. A signed subscription confirmation succeeds only
after AWS accepts the confirmation and its receipt is stored. Deliveries must
match an existing outbound message in the selected tenant/provider. Events and
receipts commit together; inbound Resend copies and receipts also commit together.
Concurrent retries preserve the first copy and do not overwrite user edits or
recreate deleted mail for the same completed event. SES uses the existing atomic
S3 provenance store, then records its webhook receipt before acknowledging.

The existing public `/v1/webhooks/*-inbound` endpoints retain their existing
behavior; this document describes the authenticated relay only. The relay stores
provider outcomes as events and does not claim to update contact suppression.

Provider references: [email.received payload](https://resend.com/docs/webhooks/emails/received),
[retrieve received email and raw content](https://resend.com/docs/api-reference/emails/retrieve-received-email).

Delivery outcomes are authorized against an existing outbound message with the exact tenant, provider, upstream message ID and envelope sender. Sending-only domains do not need an inbound domain route. Signed duplicate deliveries repeat this ownership check before consulting the receipt. An SES delivery-only binding can omit `source_id`; receiving mail still requires the configured, active ingest source.

Inbound persistence locks the active tenant's current recipient routes and the selected provider type in the same transaction as the message and provenance insert. SES also locks and checks the source's receive type, active status and provider identity. A route reassignment, tenant suspension, source retirement or provider type change during the awaited raw-content fetch therefore cannot store mail under the old binding. Provider `active` controls sending and does not disable receive ingestion. The immutable server environment binding remains authoritative when a source has no registry provider assignment.

The authenticated `inbox sync-s3` and `inbox watch` API operations share these persistence fences. They retain the preflight source type, status, provider assignment and provider type and compare them under transaction locks; watch also checks that live sync remains enabled. `--force` allows the initial inactive source for historical recovery, but does not bypass a later configuration or ownership change. Legacy provenance backfill uses the same write fence, and fully provenanced duplicates revalidate the current binding after their canonical bytes have been checked, before the queue delivery is eligible for acknowledgement.
