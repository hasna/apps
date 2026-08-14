# Webhooks Connector

Generic outbound HTTP webhook utility for sending signed JSON payloads to public HTTPS endpoints.

## Commands

```bash
connect-webhooks send --url https://example.com/hook --body '{"event":"created"}'
connect-webhooks send-json --url https://example.com/hook --payload '{"event":"created"}'
connect-webhooks ping --url https://example.com/hook
connect-webhooks list-incoming
connect-webhooks config set-default-url https://example.com/hook
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBHOOKS_DEFAULT_URL` | Default destination URL |
| `WEBHOOKS_SIGNING_SECRET` | HMAC signing secret |

## Signing

When a signing secret is configured, requests include:

- `X-Webhook-Signature: sha256=<hex>`
- `X-Webhook-Timestamp: <unix-seconds>`

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw-body>")`.

Prefer `WEBHOOKS_SIGNING_SECRET` supplied by your process environment or secret manager for automation and shared shells so the secret is not written into command history or process listings. Profile configuration is still supported for local development.

## Outbound URL Safety

Outbound destinations must be public HTTP or HTTPS URLs. The connector rejects local hostnames, private IP literals, loopback, link-local, unique-local IPv6, metadata, carrier-grade NAT, and hostnames whose DNS answers resolve to those ranges immediately before sending. Fetch is called with redirects disabled, so a public endpoint cannot silently redirect the connector into a private or metadata URL.

DNS is still validated in userspace before the runtime opens the network connection. If an attacker controls the destination hostname and can rebind DNS between validation and connection, this package should be treated as defense in depth, not the only SSRF boundary. Use fixed allow-lists and network egress controls for high-risk webhook destinations.

## Incoming Webhooks

`list-incoming` documents receiver setup only. The open-source connector does not host an ingress endpoint.
