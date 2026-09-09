# Hasna previews

`servers preview` gives every product/app/environment/preview a stable, protected
`workers.dev` URL while its development process runs on your current workstation.
The URL belongs to the app identity; moving it does not synchronize source code,
databases, sessions or files. Keep the active workstation awake.

This first release uses Cloudflare Workers Paid, Workers VPC (currently beta),
Cloudflare Tunnel and hostname-based Cloudflare Access. No purchased domain is
required. One tiny Worker per preview forwards through a shared router and one
loopback gateway/tunnel per station. A Durable Object coordinates ownership.

## Account setup

Before setup, configure the account's `workers.dev` subdomain, complete Cloudflare
Zero Trust onboarding, enable Access, and configure a login method. Workers Paid
alone does not enable Access. Setup checks the organization before creating a
Worker. Hostname-based Access supports WebSocket upgrades; Worker-level Access
policies do not. Version preview URLs are disabled and alias Workers also verify
Access JWT signatures, audience and issuer. The app's own OAuth login is separate.

Install Bun, `cloudflared`, `lsof` and `ps` on each Linux/macOS workstation.
Owned process/listener verification fails closed if these tools are unavailable. Provide credentials through an
environment or your secrets vault's `exec` command. The CLI never accepts secret
values as command arguments or writes them into manifests, settings or SQLite:

| Environment reference | Use |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier; alternatively `--account-id` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare provisioning API token |
| `SERVERS_PREVIEW_CONTROL_TOKEN` | Shared registry/local administration secret |
| `SERVERS_PREVIEW_ROUTER_TOKEN` | Alias-to-router secret |
| `SERVERS_PREVIEW_GATEWAY_TOKEN` | Router-to-station secret |

Create three independent random secrets with at least 32 characters and store them
in your vault. Supply the same references on participating stations. The API token
needs account-scoped Workers Scripts Edit, Workers Subdomain Read, Workers Durable
Objects Edit, Cloudflare Tunnel Edit, Access Organizations Read, Access Apps and
Policies Edit, and Connectivity Directory Admin permissions. Cloudflare may label
VPC permissions differently while that product is beta. No DNS zone permission is
needed. A workstation gets its tunnel token in memory from the API and supplies it
to `cloudflared` through `TUNNEL_TOKEN`, never through argv or a config file.

```bash
servers preview setup --provider cloudflare \
  --subdomain your-workers-subdomain \
  --access-team https://your-team.cloudflareaccess.com \
  --access-email developer@example.com \
  --dry-run

# Repeat without --dry-run to provision infrastructure.
servers preview station register --name laptop
```

Setup saves nonsecret settings and station resource identifiers in the existing
servers data root's `preview` directory. `SERVERS_PREVIEW_STATE_DIR` overrides that
location. Each station has its own enrollment; do not copy `station.json` to another
machine. Keep the account/router settings and secret references consistent.

The quota preflight counts all Workers in the account, including unrelated apps.
The default cap is 500 scripts (standard Workers Paid); the shared router consumes
one slot. Preview names include a stable 12-character identity hash to prevent
collisions after truncation. Removing exposure does not delete the alias or Access
application, so the permanent address remains reserved and continues to count.

## Portable product manifests

Put `servers.config.json` in each repository. A product can span repositories;
app names must be unique across the product. A repository manifest declares only
the apps and relative directories it owns. Commands execute locally with the
selected `PORT`, `HOST=127.0.0.1` and configured public URL variables.

```json
{
  "version": 1,
  "product": "studio",
  "apps": [
    {
      "name": "api",
      "directory": "apps/api",
      "command": "bun run dev",
      "port": 4000,
      "readinessPath": "/health",
      "environments": ["dev", "qa"],
      "envRefs": { "DATABASE_URL": "STUDIO_DEV_DATABASE_URL" }
    },
    {
      "name": "web",
      "directory": "apps/web",
      "command": "bun run dev",
      "port": 3000,
      "dependencies": ["api"],
      "publicUrlEnv": ["SERVERS_PUBLIC_URL", "AUTH_URL"],
      "oauth": {
        "callbackPaths": ["/api/auth/callback/google"],
        "javascriptOrigin": true
      }
    }
  ]
}
```

Only declared environments may be exposed. Dependencies within the manifest start
in order; cycles and unknown apps fail. Cross-repository dependencies are started
separately. `envRefs` maps process variables to environment names; literal `env`
objects and unknown manifest properties are rejected. Never place credentials in
start commands. Infrastructure credentials are removed from the spawned app's
inherited environment, and resolved app references are transient runtime values.

Apps must honor the selected port; an explicit `--port` fails if busy. The preferred
port can advance to a free port for concurrent previews. Each checkout/preview has
a distinct local server record. The station monitors each route using its own
repository database path, so project-scoped databases can coexist. Configure dev server allowed hosts and HMR to use
the generated public hostname and `wss` on port 443. For example, derive Vite's
`server.allowedHosts` and HMR host from `SERVERS_PUBLIC_URL`. Framework-specific
trusted proxy/base URL settings still belong to the app. The gateway preserves
public Host, forwarded host/protocol, application cookies and Authorization,
redirect responses, streaming uploads/responses, SSE and WebSocket subprotocols.

## Daily commands

```bash
servers preview up studio/web
servers preview up --product studio
servers preview up studio/web --name checkout
servers preview up studio/web --takeover
servers preview list --product studio
servers preview status studio/web
servers preview doctor studio/web
servers preview oauth studio/web
servers preview down studio/web
servers preview down studio/web --name checkout --stop
```

`up` starts the station gateway and `cloudflared` automatically in the background.
Use `servers preview station start` for foreground diagnostics. Only registered
loopback app targets are routable. The `/__servers` namespace is reserved and is
unreachable through public app URLs.

Apps and the station's remote VPC connection must be ready before a claim changes.
A different current owner requires `--takeover`. Ownership expires after 60 seconds
and the station renews every 20 seconds while its managed process is healthy.
Failed renewal removes the local route; a disconnected or sleeping station cannot
keep claiming an old fence. Restart `up` after a connection failure. Existing
WebSocket sessions close when the old route is removed or its lease expires, at
most one lease after a handoff. New connections immediately use the new owner.

`down` removes routing and releases ownership. It stops the process only with
`--stop`. Product commands apply to the selected environment/name (default
`dev/main`). A named preview can run beside another preview of the same checkout.
A second checkout on the same station must use a different name or explicitly
stop the existing local preview. Product starts report failure at the failed app;
previously started product apps remain running and their status is inspectable.

Bootstrap the shared router once before enrolling other workstations. Later setup
updates and station/alias provisioning are serialized through an expiring registry lock. An
interrupted enrollment reports nonsecret tunnel/service IDs for manual cleanup;
it does not silently create a public fallback. Existing independently owned Worker
or Access names are never overwritten. Changes to the managed Access allowlist
must be reconciled before that preview can be exposed again.

## Google OAuth

Declare the actual callback path used by each app and run `servers preview oauth`.
Register the exact returned redirect URI and, where applicable, JavaScript origin
in separate development Google OAuth credentials. Set the consent configuration
to Testing and add test users. Configure the app's external base URL and secure
cookies for its HTTPS preview address. Credentials and callback settings remain
with the app/auth provider; this feature does not create OAuth clients or relay
OAuth credentials. No request falls back to a production destination.

The permanent `dev/main` callback stays constant across stations. Google does not
accept wildcard callback URIs. Named previews therefore need their own registered
callbacks or a supported auth-library proxy integration. Auth.js/Better Auth proxy
adapters and cross-service dependency URL injection are follow-up work.

## SDK and MCP

The existing `@hasna/servers` SDK exports `setupPreviews`,
`registerPreviewStation`, `ensurePreviewStationRunning`, `runPreviewStation`,
`upPreviews`, `downPreviews`, `listPreviews`, `previewStatus`, `doctorPreview`,
`previewOAuth`, and identity/manifest types. MCP exposes matching `setup_previews`,
`register_preview_station`, `start_preview_station`, `up_previews`,
`down_previews`, `list_previews`, `get_preview_status`, `doctor_preview`, and
`get_preview_oauth` tools. Dry-run setup/up plans perform no infrastructure changes.

## Verification and rollout

Run `bun run test:previews` and `bun run build` in `apps/servers`. Tests cover
ownership races/fencing, JWT signatures, protected routes, API contracts, local
streaming/WebSockets, product identities, and credential persistence boundaries.
Cloudflare VPC is beta: before relying on a real account, complete a transport
smoke test with two enrolled workstations, an actual HMR app, streaming, cookies,
OAuth round trip, sleep/reconnect and simultaneous takeover. Local tests cannot
establish provider/account behavior or create Google credentials.

References: [Workers VPC](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/),
[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[Workers Access behavior](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[Google redirect validation](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri-validation-rules).
