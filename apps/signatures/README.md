# Open Signatures

Open Signatures is an open-source agreement workflow toolkit for local-first document
signing. It can render Markdown agreements to clean PDFs, place signatures at detected
fields or explicit coordinates, generate completion certificates, manage signers, send
signing requests through open-emails, and prepare domain setup through open-domains.

The current package name stays focused on signatures, but the product surface is broader:
agreements, people, signing sessions, provider handoff, evidence, and completion records.

Open Signatures is not a qualified trust service or a substitute for regulated digital
signature infrastructure. It is intended for regular electronic signatures, internal
workflows, and developer-owned signing flows where local audit evidence is sufficient.

## Install

```bash
npm install -g @hasna/signatures
```

Local development:

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Quick Start

Create a text signature:

```bash
open-signatures signature create --name "Ada Lovelace" --type text --text "Ada Lovelace"
```

Render a Markdown agreement with variables and a signature anchor:

```markdown
# Consulting Agreement

Client: {{ signer.name }}

Please sign here: {{signature:client}}
```

```bash
open-signatures document from-markdown ./agreement.md \
  --signer-name "Ada Lovelace" \
  --signer-email ada@example.com
```

Sign at the generated field and create a certificate:

```bash
open-signatures document sign <document-id> \
  --signature <signature-id> \
  --field <field-id> \
  --signer-name "Ada Lovelace" \
  --signer-email ada@example.com
```

The command writes:

- a signed PDF in `~/.hasna/signatures/signed/`
- a completion certificate in `~/.hasna/signatures/certificates/`
- audit events in the local SQLite database

## Markdown Variables

Variables use double braces:

```markdown
{{ signer.name }}
{{ signer.email }}
{{ company.name }}
{{ signature }}
{{ signature:client }}
```

`{{signature}}` and `{{signature:name}}` become signature fields when Markdown is
rendered to PDF. Other variables are replaced from CLI `--var key=value` values or
signer options.

## Sending For Signature

Create a signing session and local URL:

```bash
open-signatures document send <document-id> \
  --signer-name "Ada Lovelace" \
  --signer-email ada@example.com \
  --base-url https://sign.example.com
```

Send with open-emails if the `emails` CLI is configured:

```bash
open-signatures document send <document-id> \
  --person ada@example.com \
  --from contracts@example.com \
  --base-url https://sign.example.com
```

Use `--dry-run-email` to preview the open-emails command without sending.

## People

```bash
open-signatures person add "Ada Lovelace" --email ada@example.com --phone "+1..."
open-signatures person list
open-signatures document send <document-id> --person ada@example.com
```

## Domains

Open Signatures delegates domain setup to open-domains through the `domains` CLI.

Preview commands:

```bash
open-signatures domain setup example.com --subdomain sign --target cname.example.net --dry-run
```

Run setup:

```bash
open-signatures domain setup example.com --subdomain sign --target cname.example.net
```

Use `--buy` to ask open-domains to run its full domain setup flow.

## Provider Integrations

The built-in local signing flow is first-class. Provider adapters are optional.
The PandaDoc adapter can prepare a create/send request and use the PandaDoc API when
`pandadoc_api_key` is configured:

```bash
open-signatures config set pandadoc_api_key "$PANDADOC_API_KEY"
open-signatures provider send <document-id> \
  --provider pandadoc \
  --recipient ada@example.com \
  --recipient-name "Ada Lovelace"
```

Use `--dry-run` to inspect the provider request without making API calls.

## REST API

```bash
signatures-serve
```

Selected endpoints:

- `POST /api/documents/from-markdown`
- `POST /api/documents/:id/sign`
- `POST /api/documents/:id/send`
- `POST /api/documents/:id/provider-send`
- `GET /api/sessions/:id/certificate`
- `GET /api/people`

The server is designed for trusted local or private deployments by default. If you expose
it publicly, put it behind authentication, TLS, request logging, and a file access policy.

## MCP Server

```bash
signatures-mcp
```

Workflow tools include:

- `signatures_document_from_markdown`
- `signatures_sign`
- `signatures_send_for_signature`
- `signatures_person_create`
- `signatures_certificate_get`

Configuration values containing `key`, `secret`, or `token` are masked in MCP responses.

## Data Directory

Data is stored under:

```text
~/.hasna/signatures/
```

Set `SIGNATURES_DB_PATH` or `HASNA_SIGNATURES_DB_PATH` to override the SQLite database path.

## Security Model

Open Signatures stores signing evidence locally. A completion certificate includes signer
metadata, document hashes, session id, and audit summary. This provides useful evidence for
ordinary electronic signature workflows, but does not provide regulated digital signature,
qualified electronic signature, or eIDAS/QTSP guarantees.

Do not publish local `.hasna/`, `.signatures/`, `.env`, or `.claude/` directories.

## License

Apache-2.0 - see [LICENSE](LICENSE).
