# @hasna/domains

Domain portfolio and DNS management for AI agents — CLI + MCP server with SQLite.

## Features

- **Domain portfolio management** — track registrar, expiry, SSL, nameservers, status
- **DNS record CRUD** — A, AAAA, CNAME, MX, TXT, NS, SRV records
- **Expiry alerts** — set alerts for domain expiry and SSL certificate expiry
- **WHOIS lookup** — query and store registrar/expiry info from WHOIS
- **SSL certificate check** — verify SSL issuer and expiry
- **DNS propagation check** — query Google, Cloudflare, Quad9, OpenDNS
- **Zone file export/import** — BIND-format zone files
- **Subdomain discovery** — via crt.sh certificate transparency logs
- **DNS validation** — detect CNAME conflicts, missing MX, and more
- **Portfolio export** — CSV or JSON with all domain data
- **Registrar sync** — Namecheap and GoDaddy integration
- **Brand monitoring** — typosquat/threat detection via Brandsight API
- **MCP server** — full Model Context Protocol support for AI agents
- **Interactive TUI** — browse your portfolio in the terminal with `domains interactive`

## Installation

```bash
npm install -g @hasna/domains
```

Data is stored at `~/.hasna/domains/domains.db`. Override with `HASNA_DOMAINS_DIR` or `DOMAINS_DIR` env var.

## CLI Usage

```bash
# Interactive portfolio browser (Ink TUI)
domains interactive
domains interactive --status active
```
domains add --name example.com --registrar Namecheap --expires-at 2025-01-01
domains list
domains list --status active --registrar Namecheap
domains get <id>
domains update <id> --notes "renewed"
domains delete <id>
domains search example
domains stats

# Expiry monitoring
domains expiring --days 30
domains ssl --days 30

# WHOIS / SSL checks
domains whois example.com
domains ssl-check example.com
domains check-all

# Portfolio export
domains export --format csv --output portfolio.csv
domains export --format json

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

# Alerts
domains alert set --domain <id> --type expiry --days-before 30
domains alert list <domain-id>
domains alert remove <alert-id>

# Registrar integration
domains providers
domains sync --provider namecheap
domains sync --provider godaddy
domains sync --all
domains renew example.com --provider namecheap

# Availability checks — pick the registrar with --provider
domains check example.com                     # default registrar (config default-registrar, else namecheap)
domains check --provider route53 example.com  # AWS Route 53 availability
domains check --provider godaddy example.com
domains r53 check example.com                  # Route 53-specific subcommand (same backend)

# Brand monitoring
domains monitor mybrand
domains similar example.com
domains threats example.com
```

> **Prefer the `domains` CLI over raw `aws` commands.** For Route 53 availability,
> registration status, and DNS, use `domains check --provider route53`,
> `domains r53 status`, and `domains dns …` instead of `aws route53domains …` /
> `aws route53 …`. The CLI applies the configured purchase profile, records the
> result in the local portfolio DB, and works the same across registrars — raw
> `aws` calls bypass all of that.

## MCP Server

```bash
domains-mcp
```

Add to your Claude/agent config:

```json
{
  "mcpServers": {
    "domains": {
      "command": "domains-mcp"
    }
  }
}
```

## HTTP mode

Long-lived Streamable HTTP transport for shared agent sessions (binds `127.0.0.1` only):

```bash
domains-mcp --http              # default port 8814
domains-mcp --http --port 8814
MCP_HTTP=1 MCP_HTTP_PORT=8814 domains-mcp
```

- `GET /health` → `{"status":"ok","name":"domains"}`
- `POST /mcp` — Streamable HTTP MCP endpoint

Stdio remains the default transport for gradual rollout.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HASNA_DOMAINS_DIR` | Override database directory |
| `DOMAINS_DIR` | Override database directory (fallback) |
| `NAMECHEAP_API_KEY` | Namecheap API key |
| `NAMECHEAP_USERNAME` | Namecheap account username |
| `NAMECHEAP_CLIENT_IP` | Namecheap whitelisted IP |
| `NAMECHEAP_SANDBOX` | Use Namecheap sandbox API |
| `GODADDY_API_KEY` | GoDaddy API key |
| `GODADDY_API_SECRET` | GoDaddy API secret |
| `BRANDSIGHT_API_KEY` | Brandsight API key |

## License

Apache-2.0
