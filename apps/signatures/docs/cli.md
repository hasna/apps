# CLI Reference

The package exposes the CLI through `signatures`. The package shim starts
the Bun-based CLI, so Bun 1.0 or newer must be available on `PATH`.

```bash
signatures --help
signatures --version
```

Most data-producing commands support `--json`. IDs shown below may also accept
a document slug where the argument is named `<id-or-slug>`.

## Documents

| Command | Options |
| --- | --- |
| `document add <file>` | `--name`, `--project`, `--collection`, `--json` |
| `document from-markdown <file>` | `--name`, repeatable `--var key=value`, `--signer-name`, `--signer-email`, `--signer-type human\|agent`, `--json` |
| `document list` | `--project`, `--status`, `--json` |
| `document sign <id-or-slug>` | `--signature`, `--field`, `--page`, `--x`, `--y`, `--width`, `--height`, signer and agent evidence options, routing options, `--session`, `--no-certificate`, `--json` |
| `document send <id-or-slug>` | person/signer and agent evidence options, routing options, `--from`, `--base-url`, `--expiry`, `--dry-run-email`, `--json` |
| `document detect <id-or-slug>` | `--page`, `--json` |
| `document share <id-or-slug>` | `--expiry`, `--signer-name`, `--signer-email`, `--json` |

`document sign` defaults to page 1 at 10% x and 80% y when no field is
selected. If the signer is an agent and no signature ID is supplied, the CLI
creates a local text attestation. Human signing requires an existing signature.

`document send` always creates a local token-scoped signing URL. It attempts an
attachment share, but a missing optional `@hasna/attachments` integration does
not prevent session creation. Email is attempted only when `--from` and a
signer email are present.

## Signatures and People

| Command | Options |
| --- | --- |
| `signature create` | `--name`, `--type text\|drawing\|image`, `--font`, `--font-size`, `--color`, `--text`, `--image`, `--drawing`, `--json` |
| `signature list` | `--json` |
| `person add <name>` | `--email`, `--phone`, `--company`, `--role`, `--type`, `--signer-type`, `--agent-id`, `--agent-provider`, `--json` |
| `person list` | `--query`, `--type human\|agent`, `--json` |
| `person get <id-or-email>` | `--json` |

`people`, `signer`, and `signers` are aliases for `person`. Drawing signature
generation requires `OPENAI_API_KEY`; image signatures require `--image`.

## Sessions and Certificates

| Command | Options |
| --- | --- |
| `session list` | `--document`, `--status`, `--signer-type`, `--recipient-status`, `--json` |
| `certificate get <session-id>` | `--json` |

`sessions` is an alias for `session`. Certificates are local signer-evidence
records until every required field/session is complete; the final certificate
is marked as document completion.

## Providers and Domains

| Command | Options |
| --- | --- |
| `provider send <id-or-slug>` | `--provider`, `--api-key`, required `--recipient`, `--recipient-name`, `--signer-type`, required `--signature-level`, document/message/connector options, `--silent`, `--dry-run`, `--json` |
| `provider evidence <id-or-slug>` | `--json` |
| `domain setup <domain>` | `--subdomain`, `--target`, `--buy`, `--dry-run`, `--json` |

Valid signature levels are `ses`, `aes`, `qes`, `eseal`, and `qeseal`.
Provider dry runs create durable local sessions and evidence without sending.
Domain setup invokes the external `domains` CLI.

## Organization and Operations

| Command | Options |
| --- | --- |
| `project create <name>` | `--description`, `--color`, `--json` |
| `project list` | `--json` |
| `collection create <name>` | `--project`, `--description`, `--json` |
| `serve` | `--port` (default `19440`) |
| `stats` | `--json` |
| `config set <key> <value>` | none |
| `config get <key>` | none |

The standalone `signatures-serve` binary also starts the server. CLI config
output masks keys whose names contain `key` or `secret`.
