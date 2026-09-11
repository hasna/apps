# Preview Workers

These entry points are bundled by the servers package and provisioned by `servers preview`.
They are optional infrastructure owned by the operator's Cloudflare account.

| Entry | Bindings |
| --- | --- |
| `router.ts` | `PREVIEWS` Durable Object namespace; one `STATION_*` VPC Service binding per workstation; `CONTROL_TOKEN`, `ROUTER_TOKEN`, and `GATEWAY_TOKEN` secrets |
| `alias.ts` | `ROUTER` Worker service binding; `ROUTER_TOKEN` secret; `PREVIEW_KEY`, `PREVIEW_HOST`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` variables |

Exported `PreviewRegistry` uses a SQLite-backed Durable Object migration (`new_sqlite_classes`).
The router addresses one registry object using `idFromName("registry")`. Stored records contain
identities, routing metadata, and lease expiration times; credentials stay in Worker secret bindings.
Control requests use `POST /__servers/control`, JSON, and a bearer control token. Successful
responses contain the resulting record; failures contain `{ "error": "...", "code": "..." }`.

| Action | JSON fields | Result |
| --- | --- | --- |
| `register-station` | `station: { id, binding }` | Station record |
| `register-preview` | `preview: { key, hostname }` | Preview record |
| `claim` | `key, stationId, instanceId, takeover?` | Preview with a 60-second lease and fence |
| `heartbeat`, `release` | `key, stationId, instanceId, fence` | Updated preview |
| `status` | `key` | Preview record |
| `list` | `product?` | Preview records |
| `station-status` | `stationId` | Station record |
| `probe-station` | `stationId` | `{ "ready": true }` after a successful VPC probe |
| `acquire-setup` | `operationId` | Infrastructure lock with a 120-second lease; the same operation can renew |
| `release-setup` | `operationId` | `{ "released": true }` |

Registration is idempotent and rejects changed identities. Claim, heartbeat, release, and setup
lock changes execute in storage transactions. An expired lease cannot be revived by a heartbeat.
New owners receive a higher fence; stale owners cannot release or renew the new lease.

Public aliases require a hostname-based Cloudflare Access application for their permanent
`workers.dev` hostname. Do not use Worker-level Access for these apps: hot reload requires
WebSockets. Deployment preview URLs must be disabled in provisioning. The alias also rejects
any host other than `PREVIEW_HOST` and independently verifies the Access JWT's RS256 signature,
issuer, audience, and validity times against the configured team's JWKS endpoint.
JWKS requests use the Workers-compatible `manual` redirect mode and reject redirect responses,
so signing keys are never loaded from a redirected endpoint.

Alias-to-router requests require a separate shared secret. The alias and router replace client
routing headers. The router authenticates the gateway using `x-servers-gateway-token`, leaving
the application's `Authorization` header intact. Gateway requests also include:

```text
x-servers-preview: product/app/environment/name
x-servers-instance: instance-id
x-servers-fence: current-fence
x-servers-expires-at: lease-expiration-in-milliseconds
x-forwarded-host: public-preview-hostname
x-forwarded-proto: https
```

The VPC Service controls the actual destination and port. The request uses HTTP to the local
gateway while preserving the public hostname. The gateway must allow only registered loopback
targets and validate the current instance, fence, and expiration before forwarding. Public
requests to `/__servers` and `/__servers/*` are denied; the router probes the gateway's reserved
`/__servers/ready` path only through the authenticated control API.

Responses pass through without buffering, rebuilding, or following redirects. Unit tests verify
stream and WebSocket response preservation, but a live Cloudflare deployment is still required
to verify transport behavior across VPC, cloudflared, the gateway, and an actual dev server.

```bash
bun test workers
bunx tsc --noEmit --skipLibCheck --strict --target ESNext --moduleResolution bundler --module ESNext --types bun workers/*.ts
```

Provider references:

- [VPC Service bindings and fixed destinations](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)
- [Worker service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
- [Durable Object storage transactions](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
