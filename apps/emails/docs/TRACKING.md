# Server-backed email tracking

`emails send --track-opens --track-clicks` requests first-party tracking through
the Emails API. Both switches default off. `--tracking-url https://track.example`
selects an approved tenant base and requires at least one tracking switch.
Older APIs fail the advertised-contract check before a send or enqueue request.
Tracking requires server configuration; it never uses provider credentials on
the client or the legacy local tracking routes.

Set the server secret reference for `EMAILS_TRACKING_CONFIG` to a JSON object:
`active_key` names an entry in `keys`; each key value is a base64-encoded,
cryptographically random 32-byte key. `tenants` maps tenant UUIDs to arrays of
approved HTTPS base URLs; the first is the default. Optional `ttl_seconds`
defaults to 7776000 (90 days), with a supported range of 60 to 31536000 seconds.
Generate keys in the deployment secret manager; do not reuse API signing keys.
Configuration values and keys must not appear in logs or source control.

Every approved base must route public `GET /v1/tracking/{token}` requests to
this service over HTTPS, accounting for any configured base path. Configure the
gateway to avoid logging token paths. Do not put an authentication challenge in
front of this route: the opaque, authenticated AES-256-GCM capability is its
narrow authorization. Send/enqueue remain authenticated. Configuration alone
does not prove DNS, TLS or public gateway reachability; validate those separately
before relying on tracking in delivered mail.

The server stores original content and a separate prepared HTML document. Link
identities and encrypted tokens persist with the send intent so retries use the
same URLs. Scheduled sends persist tracking choices and prepare links when the
worker sends. Plain text gains an escaped HTML alternative, retaining the text
alternative unchanged. Only HTTP(S) anchor links are rewritten. Unsubscribe URL
matches, `rel=unsubscribe`, non-web links and credential-bearing URLs are skipped.
The server redirects only to a stored destination; it never fetches it.

Rotation: add a new key, select it as `active_key`, and retain all prior keys
until every issued token using them has expired. Existing prepared documents
retain their original tokens and expiration. Removing a key revokes those links
immediately and blocks unsent prepared documents until the key is restored or a
new send intent is created. Expired links return 404. These tokens authorize only
an engagement observation and a fixed redirect, never mailbox reads or writes.

A pixel request is evidence of a request, not proof a human read the email.
Privacy proxies and link scanners can trigger observations. Each message gets
at most one first-party `opened` and one `clicked` event, even under concurrent
requests. Shared To/CC/BCC bodies cannot identify an individual recipient, so
recipient is null. Requests do not alter delivery status, contacts or suppression.
IP addresses and user agents are not recorded. Existing stats count event rows:
independent provider events remain separate evidence and can increase those raw
counts. Those totals are not unique people or deduplicated cross-provider opens.
