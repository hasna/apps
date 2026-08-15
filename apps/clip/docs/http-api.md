# Open Clip HTTP API

The HTTP server exposes the same local SQLite and artifact store used by the
CLI and SDK. It is self-hosted software; there is no hosted or SaaS endpoint.

## Start the Server

```bash
clip serve
clip serve --host 0.0.0.0 --port 3741 --base-url http://192.168.1.20:3741
clip-serve --host 127.0.0.1 --port 3741
```

Both entry points default to `127.0.0.1:3741`.

`clip serve` accepts `--host`, `--port`, `--base-url`, and `--auth-token`.
The global `clip` options can override the home, database, and artifact paths.
The standalone `clip-serve` binary accepts all of these options directly:

```text
--host <host>
--port <port>
--base-url <url>
--auth-token <token>
--home <path>
--db <path>
--artifact-dir <path>
```

Environment defaults are `HOST`, `PORT`, `CLIP_BASE_URL`, and
`CLIP_AUTH_TOKEN`, plus the storage variables described in the
[README](../README.md#configuration). Set `base-url` to the URL clients can
actually reach; a wildcard bind such as `0.0.0.0` is not normally a useful
share URL.

## Server Authentication

By default, all routes are available to clients that can reach the bind
address. When `CLIP_AUTH_TOKEN` or `--auth-token` is set, every `POST` and
`DELETE` request must include the matching bearer token:

```bash
curl \
  -H "Authorization: Bearer $CLIP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"hello"}' \
  http://127.0.0.1:3741/api/shares
```

This server token does not protect `GET` routes. Use per-share protection for
read access, and use a TLS reverse proxy before sending credentials over an
untrusted network.

## Routes

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/` | Health response with service name and base URL. |
| `GET` | `/health` | Same health response as `/`. |
| `GET` | `/api/status` | Public storage counts and base URL. |
| `GET` | `/api/shares?limit=25` | Recent non-deleted, non-expired public share records. |
| `POST` | `/api/shares` | Create a text or uploaded-file share. |
| `POST` | `/api/capture` | Capture a screenshot on the server host. |
| `POST` | `/api/clipboard` | Share clipboard content from the server host. |
| `GET` | `/api/shares/:idOrSlug` | Get one public share record. |
| `DELETE` | `/api/shares/:idOrSlug` | Soft-delete one share. |
| `GET` | `/s/:slug` | Render the share preview page. |
| `GET` | `/s/:slug/raw` | Return text or artifact content. |

The `limit` query value must contain decimal digits. Values are normalized to
`1` through `500`; the default is `25`.

### Create a Text Share

```http
POST /api/shares
Content-Type: application/json

{
  "text": "hello",
  "title": "Greeting"
}
```

`text` is required for a text share; `title` is optional. A successful create
returns `201`.

### Upload a File

```http
POST /api/shares
Content-Type: application/json

{
  "dataBase64": "iVBORw0KGgo=",
  "mimeType": "image/png",
  "title": "Screenshot"
}
```

`mimeType` defaults to `application/octet-stream`. HTTP requests cannot import
a path from the server filesystem: a `filePath` field is rejected with `400`.
Use `clip share file` for a local path or send `dataBase64`.

The HTTP create route does not currently expose share TTL or absolute-expiry
fields. Use the CLI or SDK when expiry is required.

### Capture a Screenshot

```http
POST /api/capture
Content-Type: application/json

{
  "mode": "region",
  "title": "Issue detail",
  "annotations": [
    { "type": "box", "x": 20, "y": 20, "width": 300, "height": 120 }
  ]
}
```

`mode` defaults to `full` and may be `full`, `window`, or `region`.
`annotations` uses the operation schema documented in the
[CLI reference](cli.md#capture). Capture runs on the server host and therefore
depends on that host's display session and platform tools.

### Share the Server Clipboard

```http
POST /api/clipboard
Content-Type: application/json

{
  "kind": "auto",
  "title": "Clipboard"
}
```

`kind` defaults to `auto` and may be `auto`, `text`, `image`, or `file`.
Clipboard access is to the server process's host and session.

## Per-Share Read Protection

`POST /api/shares` accepts exactly one of `accessToken` or `password` alongside
the text or upload fields:

```json
{
  "text": "private note",
  "accessToken": "replace-with-a-share-secret"
}
```

Protected `GET /api/shares/:ref`, `/s/:slug`, and `/s/:slug/raw` requests must
supply the matching credential:

- Token: `X-Clip-Access-Token` or `Authorization: Bearer <token>`
- Password: `X-Clip-Password`
- Explicit browser link: `?token=...`, `?accessToken=...`,
  `?access_token=...`, or `?password=...`

Prefer headers. Query credentials can be retained in browser history or
external proxy/access logs. The server stores salted verification material,
not the raw credential. List responses identify protected shares but omit
protected text and hashes.

The HTML preview does not forward its own query credential to the embedded
`/s/:slug/raw` request. For a protected image, the raw request must therefore
receive its own header or query credential; visiting only
`/s/:slug?token=...` does not transparently authorize the embedded image.

## Public Responses and Artifacts

HTTP responses never expose local artifact paths. Path-like and
credential-bearing metadata is recursively removed or redacted. Unexpected
server errors return `{"error":"Internal server error"}` while details are sent
only to the configured server log callback.

Raw artifacts are served inline only for this allowlist:

- PNG, JPEG, GIF, WebP, AVIF, and APNG images
- plain text, Markdown, and JSON
- PDF
- MP4 and WebM video
- MPEG, Ogg, and WAV audio

Other MIME types, including HTML and SVG, are returned as
`application/octet-stream` attachments. Raw responses include
`X-Content-Type-Options: nosniff`.
