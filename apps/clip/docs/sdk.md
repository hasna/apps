# Open Clip SDK

The `@hasna/clip` SDK operates directly on the local SQLite database and
artifact directory. It is not an HTTP client. A configured `baseUrl` changes
generated share URLs but does not send requests to that URL.

## Create a Client

```ts
import { createClipClient } from "@hasna/clip";

const clip = createClipClient({
  homeDir: "/srv/clip",
  baseUrl: "https://clip.example.test",
});
```

`ClipClientOptions` supports:

| Option | Behavior |
| --- | --- |
| `homeDir` | Local data and config directory. |
| `dbPath` | SQLite database path, including `:memory:` for in-memory use. |
| `artifactDir` | Managed artifact directory. |
| `baseUrl` | Base used to generate share URLs. |
| `host` | Generated share URL host when `baseUrl` is absent. |
| `port` | Generated share URL port when `baseUrl` is absent. |

The normal environment variables remain fallback defaults. Values passed to
the client override config-file values, and explicit `baseUrl`, `host`, and
`port` values override their environment defaults.

## Client Methods

| Method | Return mode | Behavior |
| --- | --- | --- |
| `createTextShare(text, options?)` | Synchronous | Create a text share. |
| `importFile(path, options?)` | Synchronous | Copy a local file into the managed store and create a share. |
| `captureScreenshot(mode?, options?)` | Async | Capture `full`, `window`, or `region`; accepts a title and annotations. |
| `shareClipboard(kind?, options?)` | Async | Share `auto`, `text`, `image`, or `file` clipboard content. |
| `captureClipboardHistory(kind?, options?)` | Async | Add one opt-in history item with optional title and retention limit. |
| `listClipboardHistory(options?)` | Synchronous | List clipboard history. |
| `getClipboardHistory(ref)` | Synchronous | Get a history item by id or slug. |
| `shareClipboardHistory(ref, options?)` | Synchronous | Create a normal share from a history item. |
| `listShares(options?)` | Synchronous | List shares with optional limit and deleted/expired-row inclusion. |
| `getShare(ref, options?)` | Synchronous | Get a share by id or slug, optionally including deleted or expired rows. |
| `deleteShare(ref)` | Synchronous | Soft-delete a share and return whether a row changed. |
| `pruneExpiredShares(options?)` | Synchronous | Preview or apply expiry and managed-artifact cleanup. |
| `copyLink(ref)` | Async | Copy a share URL with a local platform tool. |
| `openShare(ref)` | Async | Open a local artifact or share URL with a local platform tool. |
| `status()` | Async | Return storage, share URL, capture, and clipboard status. |

`createTextShare` and `importFile` accept `title`, `metadata`, and one of
`expiresAt`, `ttl`, or `ttlSeconds`:

```ts
const temporary = clip.createTextShare("temporary note", {
  title: "Handoff",
  ttl: "2h",
});

const scheduled = clip.importFile("./report.pdf", {
  expiresAt: "2030-01-01T00:00:00Z",
});
```

The expiry forms are mutually exclusive. `ttl` accepts integer `s`, `m`, `h`,
`d`, or `w` durations. `ttlSeconds` must be a positive integer.

Pruning previews by default:

```ts
const preview = clip.pruneExpiredShares();
const applied = clip.pruneExpiredShares({ dryRun: false });
```

Applying a prune soft-deletes expired shares and removes eligible generated
expired or orphaned artifacts inside the configured artifact directory.

## Capture Annotations

```ts
const screenshot = await clip.captureScreenshot("region", {
  title: "Issue detail",
  annotations: [
    { type: "crop", x: 0, y: 0, width: 1200, height: 800 },
    { type: "box", x: 40, y: 60, width: 300, height: 120, color: "#ff3b30" },
    { type: "blur", x: 500, y: 80, width: 200, height: 60, radius: 10 },
    {
      type: "arrow",
      from: { x: 100, y: 500 },
      to: { x: 400, y: 300 },
      lineWidth: 5,
    },
  ],
});
```

See [CLI capture reference](cli.md#capture) for operation fields and PNG
constraints.

## Helper Exports

The root package exports:

- `ClipClient`, `createClipClient`, `ClipStore`, and `ensureSchema`
- capture, clipboard, config, annotation, share URL, expiry, and QR helpers
- `buildClipEvidenceRef`, `buildClipResourceRefs`, and
  `buildClipRecordContracts`
- the public record, status, option, annotation, expiry, and prune TypeScript
  types

Contract helpers convert a `ClipRecord` into `@hasna/contracts` evidence and
resource references:

```ts
import { buildClipRecordContracts } from "@hasna/clip";

const contracts = buildClipRecordContracts(temporary);
```

QR helpers generate or render an existing share URL:

```ts
import { renderShareQrCode } from "@hasna/clip";

const qr = await renderShareQrCode(temporary.shareUrl!);
console.log(qr.terminal);
```

Additional package entry points are available for lower-level integrations:

- `@hasna/clip/storage`
- `@hasna/clip/server`

The server entry point exposes the in-process request handler and Bun server
startup functions used by `clip-serve`. Applications embedding these
low-level modules are responsible for lifecycle and access controls.
