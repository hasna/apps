# @hasna/domains

Domain portfolio, registrar, marketplace, and DNS management for AI agents. The package ships a CLI, MCP server, authenticated HTTP API, generated SDK, and library exports. Every client surface resolves its credential and authority through the one shared `@hasna/contracts` resolver (macOS Keychain, `~/.hasna/domains/config/credentials`, or `HASNA_DOMAINS_API_KEY`, with the fleet gateway `https://api.hasna.com/domains` as the default authority), and data commands fail closed when no credential resolves: local SQLite is reachable only through an explicit path opt-in — never as a silent default; `domains-serve` connects directly to cloud Postgres.

## Features

- **Domain portfolio management** — track registrar, expiry, SSL, nameservers, pricing, lifecycle status, and notes
- **Registrar sync and purchase flows** — direct Route 53 and Namecheap registration plus GoDaddy and Brandsight provider surfaces through a shared provider registry
- **Nameserver delegation** — Route 53 and Namecheap adapters can update registrar nameservers when the provider API supports it
- **DNS provider management** — create or reuse Cloudflare or Route 53 zones and manage DNS records through the DNS provider layer
- **DNS record CRUD** — A, AAAA, CNAME, MX, TXT, NS, SRV records
- **DNS desired state** — plan/diff/apply provider DNS records from JSON with explicit delete opt-in and post-apply verification
- **Sedo marketplace tools** — optional search, portfolio/listing management, blacklist checks, and recorded Sedo purchases
- **AWS diagnostics** — sync Route 53 registered domains and hosted zones without printing secret values
- **Credential diagnostics** — redacted checks for Route 53, Cloudflare, Namecheap, GoDaddy, Brandsight, and Sedo
- **Expiry alerts** — set alerts for domain expiry and SSL certificate expiry
- **WHOIS lookup** — query and store registrar/expiry info from WHOIS
- **SSL certificate check** — verify SSL issuer and expiry
- **DNS propagation check** — query Google, Cloudflare, Quad9, OpenDNS
- **Zone file export/import** — BIND-format zone files
- **Subdomain discovery** — via crt.sh certificate transparency logs
- **DNS validation** — detect CNAME conflicts, missing MX, and more
- **Portfolio export** — CSV or JSON with all domain data
- **Brand monitoring** — optional typosquat/threat detection via Brandsight API
- **MCP server** — Model Context Protocol support for AI agents
- **MCP safe mode** — expose read-only tools only with `DOMAINS_MCP_SAFE_MODE=1`
- **HTTP API + SDK** — authenticated `/v1` API through `domains-serve` and a typed `@hasna/domains/sdk` client
- **Interactive TUI** — optional portfolio browser in the terminal with `domains interactive`

## Installation

```bash
npm install -g @hasna/domains
```

Data is stored in the local domains data directory when the local store is opted into. The default home is `~/.hasna/domains` and follows `HASNA_HOME` (the shared root override) when set; `HASNA_DOMAINS_HOME` / `HASNA_DOMAINS_DIR` (and the legacy `DOMAINS_HOME` / `DOMAINS_DIR` aliases) are exact-app overrides that win unconditionally; override the db file itself with `HASNA_DOMAINS_DB_PATH` / `DOMAINS_DB_PATH`. The XDG layout and `~/.config/hasna` are never consulted (hasna/apps#1720).

## Optional Command Groups

The default CLI keeps core portfolio, registrar, DNS, provider, Route 53, doctor, MCP, and server commands loaded. Optional groups are enabled per invocation:

```bash
domains extras
DOMAINS_COMMAND_GROUPS=marketplace,owner domains --help
DOMAINS_ENABLE_EXTRAS=1 domains --help
```

Available groups: `brandsight`, `events`, `history`, `interactive`, `marketplace`, `outreach`, `owner`, `provision`, `research`, `wallet`.

## Quick Start

```bash
# Set defaults used by availability, buy, setup, DNS, and doctor commands
domains config set default-registrar route53
domains config set default-dns cloudflare
domains config set purchase-aws-profile production-domains

# Add registrant contact defaults used by registrar purchase APIs
domains config set contact.first_name Jane
domains config set contact.last_name Example
domains config set contact.email jane@example.com
domains config set contact.phone +1.5555555555
domains config set contact.address_line_1 "1 Main St"
domains config set contact.city "New York"
domains config set contact.state NY
domains config set contact.country_code US
domains config set contact.zip_code 10001

# Check local health without printing secrets
domains doctor
```

## Provider Matrix

| Provider | Type | Availability | Buy/Register | Renew | Nameservers/DNS | Notes |
|----------|------|--------------|--------------|-------|-----------------|-------|
| `route53` | registrar + DNS | yes | yes | no | nameservers + Route 53 hosted zones | Primary self-serve registration path. Use `AWS_PROFILE` or AWS keys. |
| `namecheap` | registrar + DNS | yes | yes | yes | nameservers + Namecheap DNS records | Requires Namecheap API access and whitelisted client IP. |
| `godaddy` | registrar + DNS | gated | no direct CLI purchase | gated | DNS records when API access qualifies | Availability remains threshold-gated; DNS/domain management is available for qualifying accounts. |
| `brandsight` | registrar + DNS | yes | gated by contract | yes when contract allows | nameservers + DNS records | GoDaddy Corporate Domains / Brandsight v2 API; enterprise-contract-only. |
| `cloudflare` | DNS + inventory | no | no | no | DNS zones and records | Preferred DNS provider; zone inventory syncs domains but does not prove registrar ownership. |
| `sedo` | marketplace | marketplace search/status | recorded purchase only | no | no | Sedo is marketplace/listing/portfolio, not registrar DNS in this CLI. |

## CLI Usage

```bash
# Portfolio management
domains domain add --name example.com --registrar Namecheap --expires-at 2027-01-01
domains domain list
domains domain list --status active --registrar Namecheap
domains domain get example.com
domains domain update <id> --notes "renewed"
domains domain delete <id>
domains domain search example
domains domain stats

# Expiry monitoring
domains domain expiring --days 30
domains ssl expiring --days 30

# WHOIS / SSL checks
domains domain whois example.com
domains ssl check example.com
domains domain check example.com example.net

# Portfolio export
domains domain export --format csv > portfolio.csv
domains domain export --format json

# Provider registry and diagnostics
domains providers
domains provider list
domains provider test route53
domains provider test cloudflare
domains doctor

# Registrar sync
domains sync --provider route53
domains sync --provider cloudflare
domains sync --provider namecheap
domains sync --provider godaddy
domains sync --provider brandsight
domains sync --all

# Availability and renewals
domains check example.com
domains check --provider route53 example.com
domains check --provider namecheap example.com
domains renew example.com --provider namecheap --years 1

# Purchases and setup
domains domain buy example.com --provider route53 --wait
domains domain buy example.com --provider namecheap --wait
domains domain buy premium.example --registrar sedo --price 2500 --expires 2027-01-01
domains domain setup example.com --registrar route53 --dns cloudflare --wait

# DNS record management
domains dns list <domain-id>
domains dns add --domain <id> --type A --name @ --value 1.2.3.4
domains dns update <record-id> --value 5.6.7.8
domains dns remove <record-id>
domains dns check-propagation example.com --record A
domains dns export <domain-id>
domains dns import <domain-id> --file zone.txt
domains dns discover-subdomains example.com
domains dns validate <domain-id>
domains dns pull example.com --provider cloudflare
domains dns push <domain-id> --provider cloudflare

# Desired DNS state against a provider zone
domains dns plan example.com --provider cloudflare --file dns.example.json
domains dns diff example.com --provider cloudflare --file dns.example.json
domains dns apply example.com --provider cloudflare --file dns.example.json --yes
# Delete plans require --allow-delete and may still be refused before writes
# when the provider path cannot guarantee safe convergence.

# Optional Sedo marketplace
DOMAINS_COMMAND_GROUPS=marketplace domains sedo search example
DOMAINS_COMMAND_GROUPS=marketplace domains sedo status example.com
DOMAINS_COMMAND_GROUPS=marketplace domains sedo portfolio --limit 25
DOMAINS_COMMAND_GROUPS=marketplace domains sedo add example.com --price 2500
DOMAINS_COMMAND_GROUPS=marketplace domains sedo edit example.com --price 3000
DOMAINS_COMMAND_GROUPS=marketplace domains sedo remove example.com
DOMAINS_COMMAND_GROUPS=marketplace domains sedo buy example.com --price 2500 --order-id SEDO-ORDER-ID

# Optional brand monitoring
DOMAINS_COMMAND_GROUPS=brandsight domains monitor watch mybrand
DOMAINS_COMMAND_GROUPS=brandsight domains monitor similar example.com
DOMAINS_COMMAND_GROUPS=brandsight domains monitor threats example.com

# Optional interactive portfolio browser
DOMAINS_COMMAND_GROUPS=interactive domains interactive
DOMAINS_COMMAND_GROUPS=interactive domains interactive --status active
```

## Compact Output For Agents

List, search, status, history, discovery, and portfolio commands are compact by default. Human output shows essential fields, caps the first page to 20 rows unless a command already has a smaller explicit limit, truncates long notes/record values, and prints a hint for the next detail path.

Use these flags to disclose more when needed:

```bash
domains domain list --limit 50 --offset 50
domains domain list --all
domains domain list --verbose
domains domain get example.com
domains domain list --json
```

`--verbose` adds human-readable detail columns such as registrar, notes, owner contact fields, or provider metadata. `get`, `info`, and other detail commands show one record at a time. `--json` remains the machine-readable detail path and preserves full records for existing automation unless a command already documents an explicit API/provider limit.

MCP list-style tools follow the same gradual disclosure model. Defaults return compact JSON with `count`, `total`, `limit`, `offset`, `has_more`, `next_offset`, `compact`, and `hint`. Pass `limit`/`offset` for paging, `all: true` for all returned matches, or `verbose: true` for full records:

```json
{ "name": "list_domains", "arguments": { "limit": 50, "offset": 50 } }
{ "name": "list_domains", "arguments": { "verbose": true, "limit": 5 } }
{ "name": "get_domain", "arguments": { "id": "example.com" } }
```

MCP provider sync tools return count/error summaries by default; pass `verbose: true` only when an agent needs provider-specific arrays or full sync diagnostics.

Prefer the `domains` CLI over raw registrar CLIs for Route 53 availability, registration status, local portfolio updates, and DNS delegation. The CLI applies configured defaults, records outcomes in the local portfolio DB, and keeps behavior consistent across providers.

Desired DNS state files are JSON:

```json
{
  "domain": "example.com",
  "records": [
    { "type": "A", "name": "@", "value": "192.0.2.10", "ttl": 300 },
    { "type": "MX", "name": "@", "value": "mail.example.com", "ttl": 300, "priority": 10 },
    { "type": "TXT", "name": "@", "value": "v=spf1 -all", "ttl": 300 }
  ]
}
```

`dns apply` refuses to run without `--yes`. If the plan includes deletes, it also requires `--allow-delete`, then refuses before writing unless the provider path can guarantee delete convergence without partial mutation. Non-delete applies re-read provider records after writing and fail if the live zone still differs from the desired file.

## AWS Domain Discovery

```bash
# Sync registered domains and hosted zones from specific AWS profiles
AWS_PROFILE=production-domains domains sync --provider route53
AWS_PROFILE=shared-dns domains sync --provider route53

# Check all configured providers and redacted credential status
domains providers --json
domains doctor --json
```

Route 53 sync imports registered domains when the selected AWS account permits `route53domains:ListDomains`, and hosted zones when the account permits Route 53 hosted-zone reads. Domain-looking names from unrelated systems such as SSM parameters or Secrets Manager should only be imported after review because they do not prove registrar ownership.

## Storage

Every client surface — the CLI, the MCP server and the `./sdk` — resolves its credential and authority through the ONE shared `@hasna/contracts` resolver, fresh on every call:

1. an explicit `--api-key` / `--profile` argument (code-level)
2. a deliberate env pointer — `HASNA_DOMAINS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_DOMAINS_API_KEY_REF`
3. the macOS Keychain — item `hasna.credentials.domains.api-key` / `.api-url`, account `HASNA_STATION`, else the short hostname, else `$USER`
4. disk, read at call time — `~/.hasna/domains/config/credentials` (owner-only 0600; `HASNA_HOME` / `HASNA_CONFIG_HOME` override the root)
5. `HASNA_DOMAINS_API_KEY` in the process env — a legitimate tier

The authority follows the same ladder — `HASNA_DOMAINS_API_URL`, the Keychain `api-url` item, the credentials file — and **defaults to the fleet gateway `https://api.hasna.com/domains`** once a credential resolves, so a key alone is a complete configuration. The unprefixed `DOMAINS_API_URL` / `DOMAINS_API_KEY` aliases are accepted by the resolver for one release; the canonical `HASNA_DOMAINS_*` names always win. Retired locations (`~/.hasna/fleet-env`, the cloud dirs under `~/.hasna`, `~/.config/hasna`, `$XDG_CONFIG_HOME`) are never read, and no `*_MODE` / `*_STORAGE_MODE` variable selects anything.

**Fail closed.** A hosted run with no credential exits non-zero naming the canonical env pair — never a silent fallback to SQLite, never a `*-local-fallback` event. A database DSN is never exposed to clients.

**Local SQLite is available only as an explicit opt-in**: set one of `HASNA_DOMAINS_DB_PATH`, `DOMAINS_DB_PATH`, `HASNA_DOMAINS_DIR`, `DOMAINS_DIR` or `HASNA_DOMAINS_HOME` to name the database you mean, and only when the environment configures no authority and no credential. Every local run prints one line on stderr saying it is local. Without a resolvable credential and without such an opt-in, `getStore()` throws and CLI data commands fail — `~/.hasna/domains/domains.db` is never opened implicitly.

The standalone `domains-serve` process is the server side: it connects directly to PostgreSQL using `HASNA_DOMAINS_DATABASE_URL` (SQLite when unset) and requires `HASNA_DOMAINS_API_SIGNING_KEY`. Apply owner-role migrations first with `domains db migrate`.

## MCP Server

```bash
domains-mcp
```

MCP list/search tools are compact by default for agent context safety; use `limit`, `offset`, `all`, and `verbose` arguments, or one-record detail tools such as `get_domain`, when more detail is needed.

Add to your Claude/agent config:

```json
{
  "mcpServers": {
    "domains": {
      "command": "domains-mcp",
      "args": ["--stdio"]
    }
  }
}
```

## MCP Transports

Streamable HTTP is the default transport for shared agent sessions and binds to `127.0.0.1`:

```bash
domains-mcp                     # default port 8859
domains-mcp --port 9000
MCP_HTTP_PORT=9000 domains-mcp
```

- `GET /health` returns `{"status":"ok","name":"domains"}`
- `POST /mcp` is the Streamable HTTP MCP endpoint

Use stdio for clients that launch one MCP child process per session:

```bash
domains-mcp --stdio
```

For read-only agent sessions:

```bash
DOMAINS_MCP_SAFE_MODE=1 domains-mcp
DOMAINS_MCP_SAFE_MODE=1 domains-mcp --http
```

Safe mode registers only read-only/list/check/export tools. Mutating tools such as domain creation, DNS writes, provider sync, and Route 53 registration are withheld.

## HTTP API And SDK

`domains-serve` exposes public health, readiness, version, and OpenAPI endpoints plus API-key-authenticated `/v1` portfolio routes. Read operations require the `domains:read` scope; writes require `domains:write`. Send keys through `x-api-key` or `Authorization: Bearer`.

```bash
domains-serve --host 0.0.0.0 --port 8080
curl http://127.0.0.1:8080/health
curl -H "x-api-key: $HASNA_DOMAINS_API_KEY" http://127.0.0.1:8080/v1/domains
```

The package also exports the generated client, wired to the same shared
resolver the CLI and MCP server use — fresh on every request, so a key rotation
heals a long-lived client:

```ts
import { createDomainsClientFromEnv } from "@hasna/domains/sdk";

const domains = createDomainsClientFromEnv();
const portfolio = await domains.listDomains({ status: "active" });
```

An explicit `baseUrl` with no `apiKey` builds a client pinned to that authority
that never picks up an ambient fleet key; without a resolvable credential the
SDK throws — it never degrades to an anonymous client or to local data.

`domains serve` is a separate, unauthenticated local-development server over the local store. Use `domains-serve` for the cloud Postgres API.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HASNA_DOMAINS_API_KEY` | Hosted API key (canonical env tier of the shared resolver; below the Keychain and the credential file) |
| `HASNA_DOMAINS_API_URL` | Optional hosted API base URL — defaults to the fleet gateway `https://api.hasna.com/domains` once a key resolves |
| `HASNA_DOMAINS_API_KEY_OVERRIDE` | Deliberate per-run key override that outranks every other tier |
| `HASNA_DOMAINS_API_KEY_REF` | Deliberate secrets-vault pointer resolved through the `@hasna/secrets` SDK at request time |
| `HASNA_PROFILE` | Global identity profile pointer (`credentials-<profile>` beside the credential file) |
| `HASNA_HOME` | Shared root override — `<HASNA_HOME>/domains/` for local data, `<HASNA_HOME>/domains/config/credentials` for the credential file |
| `HASNA_CONFIG_HOME` | Config-root override for the resolver's credential file |
| `HASNA_DOMAINS_DB_PATH` | Explicit local-sqlite opt-in: override database file path |
| `DOMAINS_DB_PATH` | Legacy alias for `HASNA_DOMAINS_DB_PATH` (explicit local-sqlite opt-in) |
| `HASNA_DOMAINS_DIR` | Explicit local-sqlite opt-in: override database directory |
| `DOMAINS_DIR` | Legacy alias for `HASNA_DOMAINS_DIR` (explicit local-sqlite opt-in) |
| `HASNA_DOMAINS_HOME`, `DOMAINS_HOME` | Exact-app home overrides (canonical name wins over the alias) |
| `HASNA_DOMAINS_CONFIG_PATH`, `DOMAINS_CONFIG_PATH` | Override the settings config file path |
| `DOMAINS_CONFIG_DIR` | Override the settings config directory |
| `DOMAINS_COMMAND_GROUPS` | Comma-separated optional command groups to load, or `all` |
| `DOMAINS_ENABLE_EXTRAS` | Set to `1` to load all optional command groups |
| `DOMAINS_MCP_SAFE_MODE` | Set to `1` to expose only read-only MCP tools |
| `HASNA_DOMAINS_DATABASE_URL` | Server-side PostgreSQL DSN used by `domains-serve` and DB migrations; SQLite backend when unset |
| `HASNA_DOMAINS_API_SIGNING_KEY` | HMAC signing secret used by `domains-serve` to verify API keys |
| `AWS_PROFILE` | AWS profile for Route 53 Domains and hosted zones |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | AWS credential fallback |
| `DOMAINS_PURCHASE_AWS_PROFILE` | Purchase profile fallback when config has no `purchase_aws_profile` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token |
| `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL` | Cloudflare global key fallback |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for zone creation |
| `NAMECHEAP_API_KEY` | Namecheap API key |
| `NAMECHEAP_USERNAME` | Namecheap account username |
| `NAMECHEAP_CLIENT_IP` | Namecheap whitelisted IP |
| `NAMECHEAP_SANDBOX` | Use Namecheap sandbox API |
| `GODADDY_API_KEY`, `GODADDY_API_SECRET` | GoDaddy API credentials |
| `BRANDSIGHT_API_KEY`, `BRANDSIGHT_API_SECRET`, `BRANDSIGHT_CUSTOMER_ID` | Brandsight / GoDaddy Corporate Domains credentials |
| `BRANDSIGHT_DEMO_STUBS`, `BRANDSIGHT_ALLOW_STUBS` | Set either to `1` to allow demo stub responses when the Brandsight API is unreachable |
| `SEDO_PARTNER_ID`, `SEDO_API_KEY`, `SEDO_USERNAME`, `SEDO_PASSWORD` | Sedo marketplace API credentials |

### Picking a store: a local path and a configured credential are mutually exclusive

`HASNA_DOMAINS_DB_PATH`, `DOMAINS_DB_PATH`, `HASNA_DOMAINS_DIR`, `DOMAINS_DIR` and
`HASNA_DOMAINS_HOME` all name a **local sqlite file or directory**. Only the local store
has one. So setting any of them while the environment also configures a hosted
authority or credential (`HASNA_DOMAINS_API_URL`, `HASNA_DOMAINS_API_KEY`, the
deliberate pointers, `HASNA_PROFILE`, or a Keychain / credential-file entry)
asks for two different stores at once, and **`getStore()` refuses to start**
rather than pick one for you. Local mode applies only when the environment
configures nothing at all.

This is deliberate. Before it, the combination silently resolved to the cloud
store: a script that set `DOMAINS_DB_PATH` created no sqlite file, wrote to the
remote portfolio, and printed success. Nothing on any surface said which store
it had used.

To resolve it, say which you meant:

```sh
unset HASNA_DOMAINS_DB_PATH DOMAINS_DB_PATH HASNA_DOMAINS_DIR DOMAINS_DIR HASNA_DOMAINS_HOME   # use the hosted store
unset HASNA_DOMAINS_API_URL HASNA_DOMAINS_API_KEY HASNA_DOMAINS_API_KEY_OVERRIDE HASNA_DOMAINS_API_KEY_REF HASNA_PROFILE   # use the sqlite file the path variable names
```

`domains doctor` names the store it resolved, in its `Store` section — including
where the URL and key came from and which tier supplied the key — before any
other check runs. Run it whenever you are unsure which dataset a command is
about to touch.

## License

Apache-2.0
