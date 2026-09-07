# @hasna/files

Agent-first file management — index local folders and S3 buckets, sync Google Drive, tag, search, and retrieve files via CLI + MCP

[![npm](https://img.shields.io/npm/v/@hasna/files)](https://www.npmjs.com/package/@hasna/files)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/files
```

The published executables use Bun. The client talks to the hosted files
service through the ONE `@hasna/contracts` credential resolver, resolved fresh
on every request: the macOS Keychain item
`hasna.credentials.files.api-key` (account `HASNA_STATION`, else the short
hostname, else `$USER`), the disk credential file
`~/.hasna/files/config/credentials` (owner-only 0400/0600), or
`HASNA_FILES_API_KEY`. The service authority follows the same ladder —
`HASNA_FILES_API_URL`, the Keychain `api-url` item, the credentials file — and
**defaults to the fleet gateway `https://api.hasna.com/files`** once a
credential resolves, so a key alone is a complete configuration. The
unprefixed `FILES_API_URL` / `FILES_API_KEY` names survive only as a silent
alias inside the resolver for one release; the canonical `HASNA_FILES_*` names
work and win.

Without any resolvable credential the CLI **fails closed** — non-zero exit, no
SQLite, no `*-local-fallback` event. Local SQLite mode is an explicit opt-in:
set `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`), and no credential or
PostgreSQL/S3 configuration is required for local folders. Every local run
prints one `files: LOCAL mode — ...` line on stderr so an unhosted run is never
mistaken for an empty hosted one. The retired `HASNA_FILES_LOCAL_MODE` /
`FILES_LOCAL_MODE` / `*_STORAGE_MODE` switches are gone, and nothing reads
`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` or
`$XDG_CONFIG_HOME`.

```bash
export HASNA_FILES_LOCAL=1   # explicit opt-in for the local SQLite store
files sources add ~/Documents --name documents
files index
files search "quarterly plan"
```

## Documentation

- [CLI reference](docs/cli-reference.md)
- [MCP server and tool catalog](docs/mcp.md)
- [HTTP service, client modes, migrations, and SDK](docs/service-and-sdk.md)
- [Evidence storage contract](docs/evidence-storage.md)
- [Knowledge source contract](docs/knowledge-source-contract.md)

## CLI Usage

```bash
files --help
files sources --help
files knowledge manifest --help
```

The CLI supports local SQLite mode (explicit opt-in: `HASNA_FILES_LOCAL=1`
/ `FILES_LOCAL=1`) and a hosted HTTP API mode. With neither a resolvable
credential nor the local opt-in set, commands fail closed with an error naming
every credential tier the resolver consulted — never a silent local session.
Commands that need on-box bytes or ingestion state fail explicitly in API
mode; the complete command and availability matrix is in the [CLI
reference](docs/cli-reference.md).

Build bounded agent context packs with citations instead of dumping full files:

```bash
files context-pack f_abc123 --max-total-chars 6000
files context-pack --source-ref open-files://source/src_abc/path/Notes%2Fbrief.md
files search-pack "supplier renewal" --max-files 5 --max-excerpts 12
files search-pack "loop receipt" --out ./context-pack.json --dry-run
```

Context packs print compact deterministic JSON with `attachment_refs`, `citations`,
bounded `excerpts`, and omitted counts. Secret-like values are redacted by
default; repeat `--redact <regex>` for local policy patterns. Use `--out` to
write the bounded pack as a local artifact and print a compact pointer.

## Google Drive Sync

Google Drive sync uses profiles configured through the connectors CLI:

```bash
connectors auth googledrive
```

Add or repair your S3 destination once. This stores the AWS named profile on
the source and sets it as the default Google Drive destination. This package
ships no default bucket or AWS profile — set `HASNA_FILES_S3_BUCKET` (and
optionally `HASNA_FILES_AWS_PROFILE`) or pass `--bucket`/`--aws-profile`
explicitly:

```bash
export HASNA_FILES_S3_BUCKET=<your-bucket>
files sources bootstrap-prod-files
files sources add-google-drive --all-profiles --all
files sources sync-google-drive --dry-run
files sources sync-google-drive
```

`bootstrap-prod-files` (aliased `bootstrap-prod-emails`) creates or updates a
single canonical S3 source rooted at `s3://<bucket>/imports/google-drive/live`
and sets it as the default Google Drive destination; new imports land below
that root under `<profile>/...`. The `--aws-profile` flag defaults to the
standard AWS SDK `default` profile (or `HASNA_FILES_AWS_PROFILE` if set) —
never a hardcoded profile name. Operator-specific bucket names, legacy bucket
aliases, and migration runbooks are internal evidence and are not shipped in
the public package.

For a custom S3 destination, pass the shared AWS profile explicitly:

```bash
files sources add s3://my-files-bucket/google-drive --region us-east-1 --aws-profile files-sync
```

To sync into local storage instead, add a local source and pass it as the
destination:

```bash
files sources add ~/Files/google-drive-imports --name drive-local
files sources add-google-drive --profile personal --all --destination-source <local-source-id>
```

Google Drive rows retain their Drive source identity while the resolver follows
the configured S3 or local destination for bytes. Use `files resolve` or
`files download` for those stored copies. `files where` is limited to files
whose source itself is local.

To organize the migrated Google Drive corpus into the unified files
taxonomy, run the policy command as a dry-run first:

```bash
files organize apply-drive-policy --json
files organize apply-drive-policy --apply
```

This updates review metadata only: owner, normalized virtual target path,
duplicate status, and broad additive permission metadata. Canonical S3 objects
stay under `objects/sha256/`, and legacy/import buckets stay readable until the
final retirement audit.

## MCP Server

```bash
files-mcp
```

Includes file, source, Google Drive, project, collection, agent activity, and
evidence-vault tools. Tools in the MCP capability map fail closed unless their
required mutation, destructive, import, signed URL, download, or indexing
capabilities are explicitly enabled:

```bash
OPEN_FILES_MCP_ALLOW_MUTATIONS=1 files-mcp
OPEN_FILES_MCP_ALLOW_IMPORTS=1 files-mcp
OPEN_FILES_MCP_ALLOW_SIGNED_URLS=1 files-mcp
OPEN_FILES_MCP_ALLOW_DOWNLOADS=1 files-mcp
OPEN_FILES_MCP_ALLOW_INDEXING=1 files-mcp
OPEN_FILES_MCP_ALLOW_DESTRUCTIVE=1 files-mcp
```

`OPEN_FILES_ALLOW_<CAPABILITY>=1` or `OPEN_FILES_MCP_ALLOW_ALL=1` may be used
for controlled local operator sessions.

The current default server is not strictly read-only: agent registration and
focus, feedback, and organization bootstrap/review updates are not in the
capability map. See [docs/mcp.md](docs/mcp.md) for the exact behavior.

The MCP server also exposes read-only `build_context_pack` and
`search_context_pack` tools for bounded excerpts, citations, attachment refs,
and omitted counts in agent loops.

See [docs/mcp.md](docs/mcp.md) for the complete tool catalog, local/API-mode
availability, and capability mapping.

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
files-mcp --http              # default port 8863
files-mcp --http --port 8863
MCP_HTTP=1 files-mcp
```

- Health: `GET http://127.0.0.1:8863/health`
- MCP: `POST http://127.0.0.1:8863/mcp`

Stdio remains the default when no `--http` flag is passed.

## SDK-Safe Path Helpers

Application runtimes that only need file-path normalization can import the
pure path subpath. It does not import the files database, CLI, server, MCP, or
cloud sync surfaces.

```ts
import {
  normalizeFolderPathSegments,
  normalizeSafeRelativePath,
  sanitizePathSegment,
} from "@hasna/files/path";

const folderSegments = normalizeFolderPathSegments("Reports/Q1", {
  fallback: "Downloads",
});
const sandboxPath = normalizeSafeRelativePath("src/index.ts");
const safeName = sanitizePathSegment("../report.pdf");
```

## SDK-Safe S3 Object Store

Application runtimes that need S3-compatible object storage can import the
pure S3 subpath. It does not import the files database, CLI, server, MCP, or
cloud sync surfaces; callers own tenant keys, billing, audit, and policy.

```ts
import { createS3ObjectStore } from "@hasna/files/s3";

const store = createS3ObjectStore({ region: "us-east-1" });
await store.putObject({
  bucket: "my-bucket",
  key: "orgs/org-1/files/report.txt",
  body: Buffer.from("hello"),
  contentType: "text/plain",
});
const buffer = await store.getObjectBodyBuffer({
  bucket: "my-bucket",
  key: "orgs/org-1/files/report.txt",
});
```

## REST API

```bash
files-serve --port 19432
```

`files-serve` exposes unauthenticated health endpoints, a legacy unversioned
local API, and the authenticated PostgreSQL-backed `/v1` API. Capability flags
such as `OPEN_FILES_REST_ALLOW_MUTATIONS=1` gate unsafe unversioned routes. The
`/v1` API instead requires an API key with `files:read` or `files:write` scope.

The server binds to `127.0.0.1` by default and tries the next free port when the
requested port is occupied. Browser requests are accepted only from the same
origin or from exact origins in `OPEN_FILES_REST_ALLOWED_ORIGINS`
(comma-separated). Set `OPEN_FILES_REST_HOST` only for an intentional
non-loopback deployment.

For cloud service startup, migrations, API-key configuration, endpoint
boundaries, and SDK usage, see [docs/service-and-sdk.md](docs/service-and-sdk.md).

## Evidence Vault

`@hasna/files` is the immutable evidence authority for other apps. Accounting,
Invoices, Monthly Filing, and other consumers store the returned asset ID and
stable references—never file bytes. This package owns the immutable object ID,
content hash, byte size, media type, provenance, metadata version, access and
retention classifications, external references, durable storage, upload
intents, checksum verification, quarantine promotion, signed downloads, and
access audit.

An `idempotency_key` is scoped by organization and app and makes duplicate
writes deterministic. Replaying the same immutable envelope returns the
original asset and upload intent; changing its bytes or metadata is rejected.
`canonical_ref` is derived as
`open-files://evidence/<asset-id>/versions/<version>`.

This package ships no default evidence bucket. Configure one via
`HASNA_FILES_S3_BUCKET` (or `HASNA_FILES_EVIDENCE_BUCKET`) and inspect the
effective configuration with:

```bash
export HASNA_FILES_S3_BUCKET=<your-bucket>
files evidence configure-prod
```

For local development and tests:

```bash
files evidence upload ./receipt.pdf \
  --org org_hasna \
  --company co_us \
  --app app-accounting \
  --kind receipt \
  --provenance-type accounting \
  --provenance-id journal-entry-123 \
  --evidence-version 1 \
  --external-ref accounting://journal/journal-entry-123 \
  --idempotency-key accounting:journal-entry-123:v1 \
  --storage local \
  --local-root ./.tmp/evidence
```

The web interface uses the REST endpoints under `/evidence/*`. Programmatic
clients use the same Store/API contract in local and API transports.

See [docs/evidence-storage.md](docs/evidence-storage.md) for the storage
boundary and object layout.

## Storage

The client has exactly two transports, and the selection is the credential
resolver's to make — the client never reads a raw database DSN:

- Hosted HTTP API: the `@hasna/contracts` chain resolves the credential (an
  explicit `--api-key`/`--profile` argument, a vault pointer, the macOS
  Keychain item `hasna.credentials.files.api-key`,
  `~/.hasna/files/config/credentials`, or `HASNA_FILES_API_KEY`) and the
  authority (`HASNA_FILES_API_URL`, the Keychain `api-url` item, the
  credentials file, else the fleet gateway `https://api.hasna.com/files`),
  and supported data-plane reads and writes go to `<origin>/v1`. Resolved
  fresh per request: a rotation heals a long-lived shell, MCP server or agent
  loop without a restart.
- Local: the on-box SQLite store at `~/.hasna/files/files.db` (the
  resolver-resolved data root — see the [Data Directory](#data-directory)
  section below), reachable ONLY under the explicit opt-in
  `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`). It never reads or updates the
  local SQLite index in hosted mode.

Hosted mode with no credential fails closed — non-zero exit, no SQLite, no
`*-local-fallback` event. A URL without a key (or a key with no URL and no
resolvable authority) is a misconfiguration and fails closed — the client
never silently switches datasets.

```bash
# A key alone is a complete hosted configuration (fleet gateway default):
export HASNA_FILES_API_KEY=<scoped-api-key>
files list --json

# Or pin an explicit authority (canonical URL + key together):
export HASNA_FILES_API_URL=https://files.example.test
export HASNA_FILES_API_KEY=<scoped-api-key>
files list --json
```

On the hosted transport, `files upload <local-path> --project <prj-id> --tag <tag>`
ingests a document into the files service (server-owned S3 storage) as a tagged,
project-linked resource — the supported way to store e.g. partner contract PDFs
to a Hasna Projects project. This works because project-resource linking
(`files projects add`) and file tags are data-plane operations supported on both
transports; the missing half was ingestion, which `files upload` now performs
against the hosted `/v1` surface instead of refusing.

The service is different from the client: `files-serve` uses PostgreSQL when
`HASNA_FILES_DATABASE_URL` is set, and must also be configured with
`HASNA_FILES_API_SIGNING_KEY`. Run `files-migrate --check`, then
`files-migrate`, before starting the service. `files-migrate` is the only
shipped PostgreSQL migration command; there is no `files storage` command
group.

Do not store static S3 access keys in `files sources`. S3 source config accepts
named profiles, endpoints, and path-style settings only. Use platform secret
injection, AWS environment provider chain, or a named AWS profile for
credentials.

## Knowledge Source Contract

`@hasna/files` is the source-of-truth file layer for `@hasna/knowledge`.
Knowledge stores derived chunks, embeddings, wiki pages, citations, and agent
logs; files owns original bytes, source sync state, file identity, revisions,
and read-only access. Stable refs use `open-files://file/<id>` and
`open-files://source/<id>/path/<path>`.

See [docs/knowledge-source-contract.md](docs/knowledge-source-contract.md) for
the URI, resolver, manifest export, and change outbox plan.

Private fleet manifests should be passed by source ref, not copied into public
packages or logs. Use `buildOpenFilesFleetManifestRef(sourceId, path)` and
`describeOpenFilesSourceRef(ref, { private: true })` when a caller needs a
public-safe descriptor.

## Data Directory

Local data resolves through the `@hasna/paths` resolver (XDG/macOS home
layout, XDG home-migration plan `0f49f56a`): `~/.local/share/hasna/files/`
on Linux, `~/Library/Application Support/Hasna/files` on macOS. The legacy
`~/.hasna/files/` stays the effective data root until the store has been
migrated to the XDG data home or the operator sets the data-kind override
`HASNA_DATA_HOME` — an existing local store never becomes invisible on
upgrade.

Override the data root with `HASNA_FILES_DATA_DIR`, `FILES_DATA_DIR`,
`HASNA_FILES_HOME`, or `FILES_HOME` (first-nonblank wins, in that order); or
only the SQLite path with `HASNA_FILES_DB_PATH`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
