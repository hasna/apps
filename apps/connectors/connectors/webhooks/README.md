# Webhooks Connector

Generic outbound HTTP webhook utility for sending signed JSON payloads to public HTTPS endpoints.

## Commands

```bash
connect-webhooks send --url https://example.com/hook --body '{"event":"created"}'
connect-webhooks send-json --url https://example.com/hook --payload '{"event":"created"}'
connect-webhooks ping --url https://example.com/hook
connect-webhooks list-incoming
connect-webhooks config set-default-url https://example.com/hook
connect-webhooks config set-signing-secret your-secret
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

## Incoming Webhooks

`list-incoming` documents receiver setup only. The open-source connector does not host an ingress endpoint.
