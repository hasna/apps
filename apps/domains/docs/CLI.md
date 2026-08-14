# CLI Reference

`domains` manages the local or cloud-backed portfolio, registrar integrations,
DNS providers, and related diagnostics. Run `domains <command> --help` for the
full option list for any command.

## Command loading

Core commands load on every invocation. Optional groups load only when selected:

```bash
domains extras
DOMAINS_COMMAND_GROUPS=marketplace,owner domains --help
DOMAINS_ENABLE_EXTRAS=1 domains --help
```

`DOMAINS_COMMAND_GROUPS=all` is equivalent to
`DOMAINS_ENABLE_EXTRAS=1`. Unknown group names are ignored.

## Core commands

| Command | Subcommands | Purpose |
|---|---|---|
| `domains domain` | `list`, `get`, `add`, `update`, `delete`, `search`, `expiring`, `stats`, `whois`, `export`, `check`, `sync`, `premium`, `offer`, `status`, `emails`, `link-email`, `renew`, `buy`, `setup` | Portfolio lifecycle, registrar actions, acquisition tracking, and email links |
| `domains dns` | `plan`, `diff`, `apply`, `list`, `add`, `update`, `remove`, `check-propagation`, `export`, `import`, `discover-subdomains`, `validate`, `pull`, `push` | Local and provider DNS records, desired state, and diagnostics |
| `domains zone` | `list`, `create`, `info`, `delete` | Provider-agnostic hosted zones |
| `domains ssl` | `check`, `expiring` | Certificate inspection and expiry tracking |
| `domains alert` | `set`, `list`, `remove` | Expiry, SSL-expiry, and DNS-change alerts |
| `domains provider` | `list`, `test` | Provider capability and credential checks |
| `domains providers` | — | Provider configuration summary |
| `domains sync` | — | Sync one inventory provider or all configured inventory providers |
| `domains renew` | — | Renew through an explicit or auto-detected registrar |
| `domains check` | — | Check availability through a registrar provider |
| `domains config` | `show`, `set`, `unset` | Defaults and registrant contact configuration |
| `domains doctor` | — | Redacted database and provider diagnostics |
| `domains mcp` | `install`, `uninstall`, `status` | Claude Code MCP configuration |
| `domains serve` | — | Unauthenticated local-development HTTP server |
| `domains db` | `migrate`, `status` | Owner-role cloud Postgres migrations |
| `domains r53` | `check`, `buy`, `status`, `domains`, `domain-info`, `zone-create`, `zones`, `zone-info`, `zone-delete`, `records`, `record-set`, `record-rm`, `records-import`, `sync`, `full-setup` | Explicit AWS Route 53 Domains and hosted-zone operations |
| `domains extras` | — | Show available and enabled optional groups |

## Optional commands

| Group | Commands | Additional dependency or service |
|---|---|---|
| `brandsight` | `domains monitor watch`, `domains monitor similar`, `domains monitor threats` | Brandsight credentials |
| `events` | `domains events`, `domains webhooks` | Optional `@hasna/events` package |
| `history` | `domains history list`, `timeline`, `range`, `delete`, `purge` | None |
| `interactive` | `domains interactive` | Interactive TTY |
| `marketplace` | `domains sedo search`, `status`, `portfolio`, `add`, `edit`, `remove`, `blacklist`, `buy` | Sedo credentials for API operations |
| `outreach` | `domains outreach sms`, `whatsapp`, `email` | `connect-telephony` for SMS/WhatsApp and `connect-emails` for email |
| `owner` | `domains owner list`, `get`, `info`, `add`, `update`, `delete`, `extract`, `link`, `whois` | Optional `@hasna/contacts` for contact linking |
| `provision` | `domains provision status`, `daemon` | Registrar and Cloudflare configuration |
| `research` | `domains research exa`, `answer`, `reputation`, `blacklisted`, `threats` | `connect-exa` for Exa operations; DNS access for blacklist checks |
| `wallet` | `domains wallet cards`, `buy`, `renew` | Module selected by `DOMAINS_WALLET_MODULE` |

The `events` group is registered by `@hasna/events/commander`; its exact
subcommands follow that installed package. If the group is enabled but the
package cannot load, the CLI prints an error and continues without those commands.

## Output controls

List-style human output is compact by default. Commands that support gradual
disclosure use these flags:

- `--limit <n>` and `--offset <n>` select a page where supported.
- `--all` removes the compact default limit.
- `--verbose` adds detail to human-readable output where supported.
- `--json` emits machine-readable output and generally preserves full records.

Options are command-specific. Check help before relying on a flag:

```bash
domains domain list --help
domains dns apply --help
DOMAINS_COMMAND_GROUPS=marketplace domains sedo search --help
```

## Safety-sensitive operations

- `domains dns apply` requires `--yes`; delete plans additionally require
  `--allow-delete` and can still be refused if safe convergence is unavailable.
- `domains zone delete` and `domains r53 zone-delete` require `--force`.
- `domains domain delete` requires `--force`.
- Gated registrar purchases require `--allow-gated`.
- `domains domain buy --registrar sedo --price <amount>` records an external
  purchase; it does not perform Sedo checkout.

## Executables

The package installs three binaries:

- `domains` — the CLI documented on this page.
- `domains-mcp` — MCP over Streamable HTTP by default or stdio with `--stdio`.
- `domains-serve` — authenticated cloud Postgres HTTP API.
