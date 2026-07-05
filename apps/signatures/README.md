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

Sign at the generated field and create a local evidence certificate:

```bash
open-signatures document sign <document-id> \
  --signature <signature-id> \
  --field <field-id> \
  --signer-name "Ada Lovelace" \
  --signer-email ada@example.com
```

The command writes:

- a signed PDF in `~/.hasna/signatures/signed/`
- a signer-evidence or document-completion certificate in `~/.hasna/signatures/certificates/`
- audit events in the local SQLite database

## Markdown Variables

Variables use double braces:

```markdown
{{ signer.name }}
{{ signer.email }}
{{ company.name }}
{{ signature }}
{{ signature:client }}
{{ signature:review|type=agent|role=Reviewer|order=2|group=1 }}
```

`{{signature}}` and `{{signature:name}}` become signature fields when Markdown is
rendered to PDF. Other variables are replaced from CLI `--var key=value` values or
signer options.

Signature anchors can carry routing metadata:

- `type=human|agent` sets the signer type.
- `role=Reviewer` stores the signer role.
- `order=2` controls signing order.
- `group=1` groups parallel signers.
- `required=false` makes the field optional.

Example:

```markdown
Human approval: {{signature:client|type=human|role=Client|order=1}}
Agent review: {{signature:review|type=agent|role=Reviewer|order=2}}
```

## Sending For Signature

Create a signing session and local URL:

```bash
open-signatures document send <document-id> \
  --signer-name "Ada Lovelace" \
  --signer-email ada@example.com \
  --base-url https://sign.example.com
```

The generated signing URL resolves to `/sign/<token>`, where the signer can type
their name/signature and complete the local signing session. Open Signatures creates a
text signature when the signer does not already have one.

Send with open-emails if the `emails` CLI is configured:

```bash
open-signatures document send <document-id> \
  --person ada@example.com \
  --from contracts@example.com \
  --base-url https://sign.example.com
```

Use `--dry-run-email` to preview the open-emails command without sending.

Attachment sharing is optional. If `@hasna/attachments` is installed and configured,
send/share flows attach a document share link. If it is not installed, local signing
URLs still work and the session records the share-link fallback.

## People

```bash
open-signatures person add "Ada Lovelace" --email ada@example.com --phone "+1..."
open-signatures signer add "Sagan" --type agent --agent-id agent-sagan --agent-provider codewith --role Reviewer
open-signatures person list
open-signatures person list --type agent
open-signatures document send <document-id> --person ada@example.com
```

Signer records can be humans or agents. Agent signatures are recorded as local
agent attestations with agent id, provider/runtime, run id, policy id, reason, hashes,
audit events, and certificate metadata. They are useful for internal approvals between
agents or systems, but they are not human identity proof and are not QES/eIDAS signatures.
For ordered or multi-signer documents, Open Signatures writes signer-evidence certificates
for partial completion and reserves document-completion metadata for the final required
field/session.

Sign as an agent:

```bash
open-signatures document sign <document-id> \
  --field <field-id> \
  --signer-type agent \
  --signer-name "Sagan" \
  --agent-id agent-sagan \
  --agent-provider codewith \
  --agent-run-id run-123 \
  --agent-policy-id internal-agent-approval-v1 \
  --agent-reason "Policy check passed"
```

When `--signer-type agent` is used without `--signature`, the CLI creates a minimal
local attestation signature automatically.

List signing sessions:

```bash
open-signatures sessions list --signer-type agent
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
Provider flows always require an explicit signature level:

- `ses` - simple electronic signature evidence
- `aes` - advanced electronic signature target
- `qes` - qualified electronic signature target through a QTSP/provider
- `eseal` - legal-entity electronic seal target
- `qeseal` - legal-entity qualified eSeal target

Open Signatures does not turn local signatures into QES. QES and qualified eSeals
must be completed by a qualified trust-service/provider flow. The app stores the
request, hashes, provider response, validation status, and audit events as provider
evidence.

Dry-run a PandaDoc QES request:

```bash
open-signatures provider send <document-id> \
  --provider pandadoc \
  --signature-level qes \
  --recipient ada@example.com \
  --recipient-name "Ada Lovelace" \
  --signer-type human \
  --dry-run
```

Dry-run a Yousign QES request:

```bash
open-signatures provider send <document-id> \
  --provider yousign \
  --signature-level qes \
  --recipient ada@example.com \
  --recipient-name "Ada Lovelace" \
  --signer-type human \
  --dry-run
```

List stored provider evidence:

```bash
open-signatures provider evidence <document-id>
```

For live connector-backed provider execution, configure either a hosted or local
Hasna connectors endpoint:

```bash
open-signatures config set connectors_api_url "https://connectors.example"
open-signatures config set connectors_api_key "$CONNECTORS_API_KEY"
```

or:

```bash
open-signatures config set connectors_server_url "http://localhost:9876"
```

The provider layer uses `@hasna/connectors-sdk` and can route to `pandadoc` or
`yousign` connector operations when those connectors and credentials are available.
Without provider credentials, use `--dry-run` to verify requests and evidence locally.

For direct PandaDoc API calls without connectors:

```bash
open-signatures config set pandadoc_api_key "$PANDADOC_API_KEY"
open-signatures provider send <document-id> \
  --provider pandadoc \
  --signature-level qes \
  --recipient ada@example.com \
  --recipient-name "Ada Lovelace"
```

PandaDoc documents may require asynchronous readiness polling before send in production
integrations. Connector-backed execution should own that provider-specific behavior.

## REST API

```bash
export OPEN_SIGNATURES_ADMIN_TOKEN="$(openssl rand -hex 32)"
signatures-serve
```

Selected endpoints:

- `POST /api/documents/from-markdown`
- `POST /api/documents/:id/sign`
- `POST /api/documents/:id/send`
- `POST /api/documents/:id/provider-send`
- `GET /api/sessions`
- `GET /api/sessions/:id/certificate`
- `GET /api/provider-evidence`
- `GET /sign/:token`
- `POST /api/sign/:token`
- `GET /api/people`

All `/api/*` endpoints except `POST /api/sign/:token` require an admin token:

```bash
curl http://localhost:19440/api/config \
  -H "Authorization: Bearer $OPEN_SIGNATURES_ADMIN_TOKEN"
```

Signing links remain token-scoped and public at `GET /sign/:token` and
`POST /api/sign/:token`. Same-origin signing requests are accepted. Other
cross-origin API access is disabled unless the origin is explicitly allowed:

```bash
export OPEN_SIGNATURES_ALLOWED_ORIGINS="http://localhost:5173"
signatures-serve
```

The server is designed for trusted local or private deployments by default. If you expose
it publicly, use authentication, TLS, request logging, and a file access policy.

## Dashboard

The dashboard is a separate Vite app for local operations:

```bash
export OPEN_SIGNATURES_ADMIN_TOKEN="$(openssl rand -hex 32)"
export OPEN_SIGNATURES_ALLOWED_ORIGINS="http://localhost:5173"
signatures-serve
cd dashboard
bun install
OPEN_SIGNATURES_ADMIN_TOKEN="$OPEN_SIGNATURES_ADMIN_TOKEN" bun run dev
```

The dashboard dev proxy injects the admin token server-side and is bound to loopback;
do not expose it with `--host` or a public reverse proxy.

It includes overview, agreement, signing session, people, signature, certificate,
provider, and domain setup views.

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

When `SIGNATURES_DB_PATH` or `HASNA_SIGNATURES_DB_PATH` is set, that file is
used as the SQLite database. Otherwise, a git checkout uses the repo-local
`.signatures/signatures.db`; outside a git checkout, data is stored under:

```text
~/.hasna/signatures/
```

## Security Model

Open Signatures stores signing evidence locally. A certificate includes signer metadata,
document hashes, session id, audit summary, and metadata that distinguishes `signer_evidence`
from `document_completion`. This provides useful evidence for ordinary electronic signature
workflows, but does not provide regulated digital signature, qualified electronic signature,
or eIDAS/QTSP guarantees.

Provider evidence records are not validation reports by themselves. A QES/eSeal workflow is
only considered externally validated after a provider/QTSP signed output, proof/audit file,
and validation report are attached and recorded as valid.

Do not publish local `.hasna/`, `.signatures/`, `.env`, or `.claude/` directories.

## License

Apache-2.0 - see [LICENSE](LICENSE).
