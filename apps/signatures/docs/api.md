# REST API Reference

Start the server with an admin token:

```bash
export OPEN_SIGNATURES_ADMIN_TOKEN="$(openssl rand -hex 32)"
signatures-serve
```

The default port is `19440`; set `PORT` or use `signatures serve --port`.
`SIGNATURES_ADMIN_TOKEN` is accepted as a legacy admin-token variable.

## Authentication and Requests

Every non-preflight `/api/*` route requires the admin token except
`POST /api/sign/:token`. Send the token with `Authorization: Bearer <token>` or
`X-Open-Signatures-Admin-Token`. If no admin token is configured, protected API
routes fail closed with `503`.

`POST` and `PUT` API requests require `Content-Type: application/json`.
Cross-origin requests are rejected unless their origin is same-origin or listed
in the comma-separated `OPEN_SIGNATURES_ALLOWED_ORIGINS` (or legacy
`SIGNATURES_ALLOWED_ORIGINS`) value.

## Public Routes

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health` | Server status, package version, and port |
| `GET` | `/sign/:token` | Token-scoped browser signing page |
| `POST` | `/api/sign/:token` | Complete a token-scoped signing session |

## Admin Routes

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/stats` | Aggregate local statistics |
| `GET` | `/api/search?q=` | Search documents and signatures |
| `GET`, `POST` | `/api/people` | List or create people/agents |
| `GET` | `/api/people/:id-or-email` | Get a person by ID or email |
| `GET` | `/api/sessions` | List sessions with optional status, document, signer, and recipient filters |
| `GET`, `POST` | `/api/documents` | List or add documents |
| `POST` | `/api/documents/from-markdown` | Render a Markdown file and create its document/fields |
| `GET`, `PUT`, `DELETE` | `/api/documents/:id` | Read, update, or delete a document |
| `POST` | `/api/documents/:id/sign` | Apply a local signature and optionally create a certificate |
| `POST` | `/api/documents/:id/send` | Create a local signing session and optional email/share handoff |
| `POST` | `/api/documents/:id/provider-send` | Create a provider session and evidence record |
| `POST` | `/api/documents/:id/connector-sign` | Register a connector-driven signing session |
| `POST` | `/api/documents/:id/detect` | Detect signature fields, optionally on one page |
| `POST` | `/api/documents/:id/share` | Upload through the optional attachments integration |
| `GET` | `/api/sessions/:id/certificate` | Get a session certificate |
| `GET` | `/api/sessions/:id/link` | Get a session share link |
| `POST` | `/api/sessions/:id/receive` | Receive a signed attachment and complete the session |
| `GET` | `/api/certificates` | List certificates, optionally by document |
| `GET` | `/api/provider-evidence` | List evidence by document, session, or provider |
| `POST` | `/api/domains/setup` | Run or preview domain setup |
| `GET`, `POST` | `/api/signatures` | List or create signatures |
| `GET` | `/api/signatures/:id` | Get a signature |
| `GET`, `POST` | `/api/projects` | List or create projects |
| `GET`, `POST` | `/api/collections` | List or create collections |
| `GET`, `POST` | `/api/tags` | List or create tags |
| `GET` | `/api/config` | Read settings with sensitive values masked |
| `PUT` | `/api/config` | Set one configuration key/value pair |

Configuration responses mask values whose keys contain `key` or `secret`. The
server is intended for trusted local or private deployments; use TLS, access
controls, request logging, and a file access policy if exposed.
