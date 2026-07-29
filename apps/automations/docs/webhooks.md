# Webhook Ingress

Webhook routes bind one stored automation to one HTTP path and normalize JSON
requests into the same event materialization path used by SDK events.

## Create A Route

```sh
automations --json webhooks create tickets.escalate-critical \
  --id tickets \
  --path /webhooks/tickets \
  --source open-events \
  --type ticket.created \
  --data-path data \
  --dedupe-key-header X-Hasna-Event-Id \
  --secret-ref secret://automations/webhooks/tickets
```

The automation must already exist. Route ids use letters, numbers, dots,
underscores, colons, and dashes; paths are normalized to a leading slash.
Without `--id`, a random id is generated. Without `--path`, the route uses
`/webhooks/<id>`.

Mapping options select static or JSON-path values for subject, data, id, time,
and dedupe key. Dot-separated paths traverse JSON objects. The normalized event
id uses `--id-path` when present or a generated id. Its dedupe key uses, in
order, the configured header, configured body path, mapped id, then a SHA-256
body hash. If `--data-path` is omitted, event data is `{}`; the raw payload is
not copied into durable records. The normalized envelope exposes the body hash
and route context in `metadata.webhook`; persisted run/action metadata retains
only the event identity and dedupe context needed by the control plane.

## Route Lifecycle

```text
automations webhooks list
automations webhooks show <id-or-path>
automations webhooks enable <id-or-path>
automations webhooks disable <id-or-path>
automations webhooks archive <id-or-path>
automations webhooks rotate-secret <id-or-path> --secret-ref <secret://ref>
```

Only active routes accept or normalize deliveries. Route records persist a
secret reference, never the secret value. Rotating a secret updates the
reference while preserving the signature algorithm and other settings.

## Local Commands

`webhooks test` normalizes and materializes a request. `webhooks event` prints
only the normalized envelope for explicit handoff. Both default the body to
`{}` and accept repeated `--header name:value` or `--header name=value`
options. They deliberately do not verify HMAC signatures.

## Signed HTTP Ingress

Start the server with:

```sh
automations-daemon --json serve --host 127.0.0.1 --port 7391
```

`GET /healthz` returns service health. Webhook paths accept `POST` only. A
signed route verifies HMAC SHA-256 over the exact raw request bytes before JSON
parsing. Configure `--signature-header`, `--signature-prefix`, and
`--signature-encoding hex|base64` when creating the route; defaults are
`x-hasna-signature`, no prefix, and hex.

At runtime the daemon resolves the first populated variable from:

```text
HASNA_AUTOMATIONS_WEBHOOK_SECRET_<ROUTE_ID>
AUTOMATIONS_WEBHOOK_SECRET_<ROUTE_ID>
HASNA_AUTOMATIONS_SECRET_<SECRET_REF_WITHOUT_SECRET_SCHEME>
```

Names are uppercased and non-alphanumeric runs become underscores. The daemon
returns deterministic JSON errors: `404` for unknown routes, `403` for inactive
routes, `405` for non-POST methods, `401` for missing or invalid signatures,
`503` when a referenced secret is unavailable, `400` for malformed JSON or
invalid content length, `413` for oversized bodies, and `422` for other
materialization failures. Accepted deliveries return `202` with route, event,
run, and action identifiers.
