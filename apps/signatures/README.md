# open-signatures

Open source e-signature platform. Sign PDFs locally, manage documents, and integrate with any workflow via MCP, CLI, or REST API.

**npm package:** `@hasna/signatures`

---

## Features

- Sign PDFs with text signatures (rendered via Google Fonts), image signatures, or AI-generated drawings
- Detect existing signature fields in PDF forms
- Manage documents, projects, collections, and tags
- Full-text search across documents and signatures
- Session tracking for local and connector-driven signing
- Connector integration for external signing tools (browseruse, DocuSign, etc.)
- Three interfaces: **MCP server**, **CLI**, and **REST API**
- SQLite database, zero external dependencies at runtime

---

## Installation

```bash
npm install -g @hasna/signatures
# or
bun add -g @hasna/signatures
```

This installs three global binaries:

| Binary | Purpose |
|---|---|
| `open-signatures` | CLI |
| `signatures-mcp` | MCP server (stdio) |
| `signatures-serve` | REST API server |

---

## Quick Start

```bash
# Add a PDF document
open-signatures document add ./contract.pdf --name "Service Agreement"

# Create a text signature
open-signatures signature create --name "Alice Smith" --type text --text "Alice Smith"

# Sign the document
open-signatures document sign <document-id> --signature <signature-id> --page 1 --x 100 --y 700

# Start the REST API server
open-signatures serve

# Start the MCP server
signatures-mcp
```

---

## CLI Commands

### Document

```bash
open-signatures document add <file> [options]
  --name <name>          Document name (defaults to filename)
  --project <id>         Assign to project
  --collection <id>      Assign to collection
  --json                 Output as JSON

open-signatures document list [options]
  --project <id>
  --collection <id>
  --status <status>      draft | pending | completed | cancelled
  --json

open-signatures document sign <id-or-slug> [options]
  --signature <id>       Signature ID to apply (required)
  --page <n>             Page number (default: 1)
  --x <n>                X position in points (default: 10)
  --y <n>                Y position in points (default: 80)
  --width <n>            Width in points
  --height <n>           Height in points
  --signer-name <name>
  --signer-email <email>
  --json

open-signatures document detect <id-or-slug>
  Detect and store signature fields from a PDF form
```

### Signature

```bash
open-signatures signature create [options]
  --name <name>          Display name (required)
  --type <type>          text | image | drawing (required)
  --text <value>         Text to render (for type=text)
  --font <family>        Font family (default: Dancing Script)
  --size <n>             Font size (default: 48)
  --color <hex>          Hex color (default: #000000)
  --description <desc>   Drawing description (for type=drawing)
  --json

open-signatures signature list [--type <type>] [--json]
```

### Project & Collection

```bash
open-signatures project create <name> [--color <hex>] [--description <text>] [--json]
open-signatures project list [--json]

open-signatures collection create <name> [--project <id>] [--description <text>] [--json]
```

### Server & Stats

```bash
open-signatures serve          # Start REST API on port 19440
open-signatures stats          # Show document/signature counts
```

---

## MCP Setup

Add to your `claude_desktop_config.json` (or equivalent MCP client config):

```json
{
  "mcpServers": {
    "signatures": {
      "command": "signatures-mcp"
    }
  }
}
```

### MCP Tools

| Tool | Description |
|---|---|
| `signatures_document_save` | Create or update a document |
| `signatures_document_get` | Get a document by ID or slug |
| `signatures_document_list` | List documents with optional filters |
| `signatures_document_delete` | Delete a document |
| `signatures_document_search` | Full-text search documents |
| `signatures_sign` | Sign a document at a position |
| `signatures_signature_create` | Create a text, image, or drawing signature |
| `signatures_signature_get` | Get a signature by ID |
| `signatures_signature_list` | List all signatures |
| `signatures_project_save` | Create or update a project |
| `signatures_project_list` | List all projects |
| `signatures_collection_save` | Create or update a collection |
| `signatures_collection_list` | List all collections |
| `signatures_tag_save` | Create a tag |
| `signatures_tag_list` | List all tags |
| `signatures_detect_fields` | Detect signature fields in a PDF |
| `signatures_stats` | Get system statistics |
| `signatures_connector_sign` | Initiate a connector-driven signing session (browseruse, etc.) |

#### Example MCP usage

```
signatures_document_save { "file_path": "/docs/contract.pdf", "name": "Service Agreement" }
signatures_sign { "document_id": "doc-abc123", "signature_id": "sig-xyz789", "page": 1, "x": 100, "y": 700 }
signatures_connector_sign { "document_id": "doc-abc123", "connector_name": "browseruse", "url": "https://sign.example.com/doc/abc", "signer_name": "Alice" }
```

---

## REST API

Default port: **19440** (override with `PORT` env var)

### Health

```
GET /health
```

### Documents

```
GET    /api/documents                         List documents
POST   /api/documents                         Create document (body: { file_path, name?, ... })
GET    /api/documents/:id                     Get document by ID or slug
PUT    /api/documents/:id                     Update document
DELETE /api/documents/:id                     Delete document
POST   /api/documents/:id/sign                Sign a document
POST   /api/documents/:id/detect              Detect PDF signature fields
POST   /api/documents/:id/connector-sign      Initiate connector signing session
```

### Signatures

```
GET  /api/signatures         List signatures
POST /api/signatures         Create signature
GET  /api/signatures/:id     Get signature by ID
```

### Projects, Collections, Tags

```
GET  /api/projects
POST /api/projects
GET  /api/collections[?project_id=]
POST /api/collections
GET  /api/tags
POST /api/tags
```

### Stats & Search

```
GET /api/stats
GET /api/search?q=<query>
```

### Example: Sign a document via REST

```bash
# 1. Add a document
curl -X POST http://localhost:19440/api/documents \
  -H "Content-Type: application/json" \
  -d '{"file_path": "/docs/contract.pdf", "name": "Service Agreement"}'

# 2. Create a text signature
curl -X POST http://localhost:19440/api/signatures \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Smith", "type": "text", "text_value": "Alice Smith"}'

# 3. Sign the document
curl -X POST http://localhost:19440/api/documents/<doc-id>/sign \
  -H "Content-Type: application/json" \
  -d '{"signature_id": "<sig-id>", "page": 1, "x": 100, "y": 700}'
```

### Example: Connector signing session (browseruse)

```bash
curl -X POST http://localhost:19440/api/documents/<doc-id>/connector-sign \
  -H "Content-Type: application/json" \
  -d '{
    "connector_name": "browseruse",
    "url": "https://sign.example.com/doc/abc",
    "signer_name": "Alice Smith",
    "signer_email": "alice@example.com"
  }'
```

---

## Signature Types

| Type | Description | Required fields |
|---|---|---|
| `text` | Name rendered as a cursive font (SVG, via Google Fonts) | `text_value` or `name`, optional `font_family`, `font_size`, `color` |
| `image` | Reference to an existing image file | `image_path` |
| `drawing` | AI-generated signature image from a description | `drawing_description` (requires OpenAI API key) |

---

## Connector Integration

The `connector-integration` module (`src/lib/connector-integration.ts`) provides a programmatic API for external connectors to record signing sessions without depending on any connector SDK.

```typescript
import {
  signWithBrowseruse,
  registerSigningSession,
  completeSigningSession,
} from "@hasna/signatures";

// Start a browseruse signing session
const session = signWithBrowseruse("doc-abc123", "https://sign.example.com/abc", {
  signer_name: "Alice Smith",
  signer_email: "alice@example.com",
});
// session.token can be passed to the browser automation layer

// Register a session from any connector
const session2 = registerSigningSession({
  document_id: "doc-abc123",
  connector_name: "docusign",
  signer_name: "Bob Jones",
  signing_url: "https://docusign.net/sign/...",
});

// Mark a session complete (also marks the document as completed)
completeSigningSession(session.id);
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `19440` | REST API server port |
| `SIGNATURES_DB_PATH` | `~/.local/share/open-signatures/db.sqlite` | SQLite database path |
| `SIGNATURES_DATA_DIR` | `~/.local/share/open-signatures` | Base data directory |

---

## License

MIT
