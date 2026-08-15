# Open Clip MCP Server

`clip-mcp` exposes the local Clip store and local capture/clipboard capabilities
over MCP. It does not connect to a hosted service.

## Transports

Stdio is the default:

```bash
clip-mcp
```

Streamable HTTP is opt-in:

```bash
clip-mcp --http
clip-mcp --http --port 8874
MCP_HTTP=1 MCP_HTTP_PORT=8874 clip-mcp
```

HTTP always binds to loopback. Its endpoints are:

- `GET http://127.0.0.1:8874/health`
- `POST http://127.0.0.1:8874/mcp`

`-p` is an alias for `--port`. An invalid port falls back to `8874`. The MCP
HTTP transport has no authentication option and is not exposed beyond
`127.0.0.1`.

The normal storage environment variables (`HASNA_CLIP_HOME`,
`HASNA_CLIP_DB_PATH`, `CLIP_DB_PATH`, and `HASNA_CLIP_ARTIFACT_DIR`) apply to
the MCP process.

## Tools

All successful tools return both JSON text content and structured content.

| Tool | Input | Behavior |
| --- | --- | --- |
| `clip_status` | `{}` | Return public storage counts, base URL, capture capabilities, and clipboard capabilities. |
| `clip_capture` | Optional `mode`, `title`, `annotations` | Capture a screenshot. `mode` is `full`, `window`, or `region` and defaults to `full`. |
| `clip_share_clipboard` | Optional `kind`, `title` | Share clipboard content. `kind` is `auto`, `text`, `image`, or `file` and defaults to `auto`. |
| `clip_share_text` | Required string `text`; optional `title` | Create a local text share. |
| `clip_list` | Optional integer `limit` from `1` through `500` | Return recent public share records. |
| `clip_get` | Required non-whitespace string `ref` | Get a share by id or slug. |
| `clip_delete` | Required non-whitespace string `ref` | Soft-delete a share by id or slug. |

`clip_capture.annotations` is an array of the same `crop`, `box`, `blur`, and
`arrow` operation objects described in the
[CLI capture reference](cli.md#capture).

The MCP surface intentionally does not expose clipboard history, file import,
expiry/pruning, QR output, opening local targets, or server administration.
Use the CLI or SDK for those operations.

## Resources

| URI | Contents |
| --- | --- |
| `clip://status` | Public local storage and platform capability context. |
| `clip://shares` | The 25 most recent non-deleted, non-expired public shares and the equivalent `clip list --json` command. |

Public MCP records do not expose local artifact paths. Storage paths are
replaced with public storage descriptors, and path-like or credential-bearing
metadata is redacted.

## Errors

Tool failures use MCP `isError: true` and a structured payload:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_input",
    "message": "ref must not be empty",
    "details": {
      "field": "ref"
    }
  }
}
```

Current error codes are `invalid_input`, `not_found`, and `internal_error`.
Malformed arguments and unexpected fields produce `invalid_input`; missing
shares produce `not_found`; unexpected tool failures return a generic
`internal_error` without leaking the underlying exception.
