import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { Buffer } from "node:buffer";
import { captureScreenshot } from "../capture/index.js";
import { shareClipboard } from "../clipboard.js";
import { publicClipRecord, publicClipRecords, publicStorageStatus } from "../public.js";
import { ClipStore } from "../storage.js";
import type { CaptureMode, ClipboardKind, ClipClientOptions, ClipRecord } from "../types.js";
import { extensionForMime, htmlEscape, normalizeLimit } from "../util.js";
import { DEFAULT_PORT } from "../paths.js";
import { resolveBaseUrl } from "../share.js";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

export interface ClipServerOptions {
  host?: string;
  port?: number;
  baseUrl?: string;
  authToken?: string;
  clientOptions?: ClipClientOptions;
  log?: (message: string) => void;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function resolveAuthToken(options: ClipServerOptions): string | undefined {
  return options.authToken ?? process.env["CLIP_AUTH_TOKEN"] ?? undefined;
}

function authorized(req: Request, options: ClipServerOptions): boolean {
  const token = resolveAuthToken(options);
  if (!token) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

// Mime types that are safe to serve inline from the share origin. Anything
// else (notably text/html and image/svg+xml) is forced to a download so an
// uploaded artifact cannot run script in the server's origin. The stored mime
// is never echoed back verbatim; only this normalized allowlisted value is.
const INLINE_SAFE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/apng",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

function normalizeInlineMime(mime: string): string | null {
  const essence = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence)) return null;
  return INLINE_SAFE_MIME.has(essence) ? essence : null;
}

function rawContentHeaders(mime: string, filename: string): Record<string, string> {
  const safeMime = normalizeInlineMime(mime);
  const charset = safeMime && (safeMime.startsWith("text/") || safeMime === "application/json") ? "; charset=utf-8" : "";
  return {
    "Content-Type": safeMime ? `${safeMime}${charset}` : "application/octet-stream",
    "Content-Disposition": safeMime ? "inline" : `attachment; filename="${filename.replaceAll('"', "")}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
}

async function requestJson(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) return {};
  const parsed = await req.json().catch(() => ({})) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseLimitParam(value: string | null): { ok: true; limit: number } | { ok: false; response: Response } {
  if (value === null) return { ok: true, limit: normalizeLimit(undefined) };
  if (!/^\d+$/.test(value.trim())) return { ok: false, response: jsonResponse({ error: "limit must be a positive integer" }, 400) };
  return { ok: true, limit: normalizeLimit(Number.parseInt(value, 10)) };
}

function storeOptions(options: ClipServerOptions): ClipClientOptions {
  return {
    ...(options.clientOptions ?? {}),
    baseUrl: options.baseUrl ?? options.clientOptions?.baseUrl,
    host: options.host ?? options.clientOptions?.host,
    port: options.port ?? options.clientOptions?.port,
  };
}

function getRecord(ref: string, options: ClipServerOptions): ClipRecord | null {
  const store = new ClipStore(storeOptions(options));
  try {
    return store.getClip(ref, { baseUrl: options.baseUrl });
  } finally {
    store.close();
  }
}

function previewHtml(record: ClipRecord): Response {
  const title = record.title ?? record.slug;
  const body = record.text !== null
    ? `<pre>${htmlEscape(record.text)}</pre>`
    : record.mimeType.startsWith("image/")
      ? `<img src="/s/${encodeURIComponent(record.slug)}/raw" alt="${htmlEscape(title)}">`
      : `<p><a href="/s/${encodeURIComponent(record.slug)}/raw">Download ${htmlEscape(title)}</a></p>`;
  return new Response(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 32px auto; max-width: 960px; padding: 0 20px; font-family: ui-sans-serif, system-ui, sans-serif; color: #171717; background: #fafafa; }
    img { max-width: 100%; height: auto; border: 1px solid #d4d4d4; }
    pre { white-space: pre-wrap; word-break: break-word; background: #fff; border: 1px solid #d4d4d4; padding: 16px; }
    .meta { color: #525252; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <p class="meta">${htmlEscape(record.kind)} · ${htmlEscape(record.createdAt)} · ${record.sizeBytes} bytes</p>
  ${body}
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'",
    },
  });
}

function rawResponse(record: ClipRecord): Response {
  if (record.text !== null) {
    return new Response(record.text, {
      headers: rawContentHeaders(record.mimeType, `${record.slug}.txt`),
    });
  }
  if (!record.artifactPath || !existsSync(record.artifactPath)) {
    return jsonResponse({ error: "Artifact not found" }, 404);
  }
  const ext = extname(record.artifactPath);
  const mime = record.mimeType || MIME_TYPES[ext] || "application/octet-stream";
  return new Response(readFileSync(record.artifactPath), {
    headers: rawContentHeaders(mime, `${record.slug}${ext}`),
  });
}

export async function handleClipHttpRequest(req: Request, options: ClipServerOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const parts = path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  try {
    const isMutation = req.method === "POST" || req.method === "DELETE";
    if (isMutation && !authorized(req, options)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return jsonResponse({ status: "ok", name: "clip", baseUrl: resolveBaseUrl(storeOptions(options)) });
    }

    if (req.method === "GET" && path === "/api/status") {
      const store = new ClipStore(storeOptions(options));
      try {
        return jsonResponse({ storage: publicStorageStatus(store.status()), baseUrl: resolveBaseUrl(storeOptions(options)) });
      } finally {
        store.close();
      }
    }

    if (req.method === "GET" && path === "/api/shares") {
      const parsedLimit = parseLimitParam(url.searchParams.get("limit"));
      if (!parsedLimit.ok) return parsedLimit.response;
      const store = new ClipStore(storeOptions(options));
      try {
        return jsonResponse({ shares: publicClipRecords(store.listClips({ limit: parsedLimit.limit, baseUrl: options.baseUrl })) });
      } finally {
        store.close();
      }
    }

    if (req.method === "POST" && path === "/api/shares") {
      const body = await requestJson(req);
      const store = new ClipStore(storeOptions(options));
      try {
        if (typeof body["filePath"] === "string") {
          return jsonResponse({
            error: "HTTP filePath imports are not allowed. Use the local CLI for local paths or send dataBase64.",
          }, 400);
        }
        if (typeof body["dataBase64"] === "string") {
          const mimeType = typeof body["mimeType"] === "string" ? body["mimeType"] : "application/octet-stream";
          const buffer = Buffer.from(body["dataBase64"], "base64");
          if (buffer.byteLength === 0 && body["dataBase64"] !== "") {
            return jsonResponse({ error: "dataBase64 did not decode to content" }, 400);
          }
          return jsonResponse(publicClipRecord(store.createBufferClip({
            buffer,
            kind: "file",
            title: typeof body["title"] === "string" ? body["title"] : undefined,
            mimeType,
            source: "server:upload",
            extension: extensionForMime(mimeType),
            metadata: { upload: true },
            baseUrl: options.baseUrl,
          })), 201);
        }
        if (typeof body["text"] === "string") {
          return jsonResponse(publicClipRecord(store.createTextClip({
            text: body["text"],
            title: typeof body["title"] === "string" ? body["title"] : undefined,
            source: "server:text",
            baseUrl: options.baseUrl,
          })), 201);
        }
        return jsonResponse({ error: "Expected text or dataBase64" }, 400);
      } finally {
        store.close();
      }
    }

    if (req.method === "POST" && path === "/api/capture") {
      const body = await requestJson(req);
      const mode = typeof body["mode"] === "string" ? body["mode"] as CaptureMode : "full";
      const record = await captureScreenshot(mode, {
        ...storeOptions(options),
        title: typeof body["title"] === "string" ? body["title"] : undefined,
      });
      return jsonResponse(publicClipRecord(record), 201);
    }

    if (req.method === "POST" && path === "/api/clipboard") {
      const body = await requestJson(req);
      const kind = typeof body["kind"] === "string" ? body["kind"] as ClipboardKind : "auto";
      const record = await shareClipboard(kind, {
        ...storeOptions(options),
        title: typeof body["title"] === "string" ? body["title"] : undefined,
      });
      return jsonResponse(publicClipRecord(record), 201);
    }

    if (parts[0] === "api" && parts[1] === "shares" && parts[2]) {
      const ref = parts[2];
      if (req.method === "GET") {
        const record = getRecord(ref, options);
        return record ? jsonResponse(publicClipRecord(record)) : jsonResponse({ error: "Share not found" }, 404);
      }
      if (req.method === "DELETE") {
        const store = new ClipStore(storeOptions(options));
        try {
          return jsonResponse({ deleted: store.deleteClip(ref), ref });
        } finally {
          store.close();
        }
      }
    }

    if (parts[0] === "s" && parts[1]) {
      const record = getRecord(parts[1], options);
      if (!record) return jsonResponse({ error: "Share not found" }, 404);
      if (parts[2] === "raw") return rawResponse(record);
      return previewHtml(record);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log?.(`clip server request failed: ${message}`);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

export function startClipServer(options: ClipServerOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "127.0.0.1";
  let boundPort = port;
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port,
    hostname: host,
    fetch: (req: Request): Promise<Response> => handleClipHttpRequest(req, { ...options, host, port: boundPort }),
  });
  boundPort = server.port ?? port;
  options.log?.(`clip server listening on http://${host}:${server.port}`);
  return server;
}
