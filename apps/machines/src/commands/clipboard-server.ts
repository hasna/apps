import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getClipboardKeyPath } from "../paths.js";
import { computeHash, sanitizeClipboardForRead, readClipboardConfig, addClipboardEntry } from "./clipboard.js";
import type { ClipboardConfig, ClipboardEntry } from "../types.js";

// -- Clipboard reading (local clipboard) -------------------------------------------

function readLocalClipboardSync(): string {
  const platform = process.platform;

  if (platform === "darwin") {
    const result = Bun.spawnSync(["pbpaste"], { stdout: "pipe", stderr: "pipe" });
    return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
  }

  if (platform === "linux") {
    // Try wl-clipboard first (Wayland), then xclip (X11)
    if (hasCommand("wl-paste")) {
      const result = Bun.spawnSync(["wl-paste"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
    }
    if (hasCommand("xclip")) {
      const result = Bun.spawnSync(["xclip", "-selection", "clipboard", "-o"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "";
    }
    return "";
  }

  return "";
}

function writeLocalClipboardSync(content: string): boolean {
  const platform = process.platform;

  if (platform === "darwin") {
    const result = Bun.spawnSync(["pbcopy"], { stdin: new TextEncoder().encode(content), stdout: "ignore", stderr: "ignore" });
    return result.exitCode === 0;
  }

  if (platform === "linux") {
    if (hasCommand("wl-copy")) {
      const result = Bun.spawnSync(["wl-copy"], { stdin: new TextEncoder().encode(content), stdout: "ignore", stderr: "ignore" });
      return result.exitCode === 0;
    }
    if (hasCommand("xclip")) {
      const result = Bun.spawnSync(["xclip", "-selection", "clipboard"], { stdin: new TextEncoder().encode(content), stdout: "ignore", stderr: "ignore" });
      return result.exitCode === 0;
    }
    return false;
  }

  return false;
}

function hasCommand(binary: string): boolean {
  const result = Bun.spawnSync(["bash", "-lc", `command -v ${binary} >/dev/null 2>&1`], { stdout: "ignore", stderr: "ignore", env: process.env });
  return result.exitCode === 0;
}

// -- Auth --------------------------------------------------------------------------

function loadSharedSecret(): string {
  const keyPath = getClipboardKeyPath();
  try {
    return readFileSync(keyPath, "utf8").trim();
  } catch {
    return "";
  }
}

function authenticate(request: IncomingMessage): boolean {
  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7);
  const secret = loadSharedSecret();
  if (!secret) return false;
  return createHash("sha256").update(token).digest("hex") === createHash("sha256").update(secret).digest("hex");
}

// -- JSON helpers ------------------------------------------------------------------

function jsonResponse(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(data));
}

// -- Server ------------------------------------------------------------------------

export interface ClipboardServerOptions {
  port?: number;
  config?: ClipboardConfig;
}

export interface ClipboardServerHandle {
  server: ReturnType<typeof createServer>;
  port: number;
  close: () => Promise<void>;
}

let currentContentHash: string | null = null;

export function startClipboardServer(options: ClipboardServerOptions = {}): ClipboardServerHandle {
  const config = options.config || readClipboardConfig();
  const port = options.port || config.port;

  const server = createServer(async (request, response) => {
    // Auth required for all routes
    if (!authenticate(request)) {
      return jsonResponse(response, 401, { error: "unauthorized" });
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    // POST /clipboard - receive clipboard content from another machine
    if (url.pathname === "/clipboard" && request.method === "POST") {
      return handleReceiveClipboard(request, response, config);
    }

    // GET /clipboard - get current local clipboard content
    if (url.pathname === "/clipboard" && request.method === "GET") {
      return handleGetClipboard(response, config);
    }

    // GET /health - check if server is alive
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(response, 200, { ok: true, machineId: process.env["HASNA_MACHINES_MACHINE_ID"] || "unknown" });
    }

    jsonResponse(response, 404, { error: "not found" });
  });

  server.listen(port, "0.0.0.0", () => {
    // server started
  });

  server.on("error", (error) => {
    console.error(`clipboard server error: ${error.message}`);
  });

  return {
    server,
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function handleReceiveClipboard(request: IncomingMessage, response: ServerResponse, config: ClipboardConfig): void {
  let body = "";
  request.on("data", (chunk: string) => { body += chunk; });
  request.on("end", () => {
    try {
      const parsed = JSON.parse(body) as { content?: string; contentType?: string; sourceMachine?: string };
      const content = parsed.content || "";
      const contentType = (parsed.contentType || "text") as ClipboardEntry["contentType"];
      const sourceMachine = parsed.sourceMachine || "unknown";

      if (!content) {
        return jsonResponse(response, 400, { error: "empty content" });
      }

      const hash = computeHash(content);

      // Loop prevention: skip if we already have this hash locally
      if (hash === currentContentHash) {
        return jsonResponse(response, 200, { received: false, reason: "loop detected" });
      }

      // Content filtering
      const check = sanitizeClipboardForRead(content, config.maxSizeBytes, config.skipPatterns);
      if (!check.ok) {
        return jsonResponse(response, 200, { received: false, reason: check.reason });
      }

      // Write to local clipboard
      writeLocalClipboardSync(content);
      currentContentHash = hash;

      // Record in history
      addClipboardEntry({
        hash,
        content,
        contentType,
        sourceMachine,
        timestamp: new Date().toISOString(),
      });

      return jsonResponse(response, 200, { received: true, hash });
    } catch {
      return jsonResponse(response, 400, { error: "invalid JSON" });
    }
  });
}

function handleGetClipboard(response: ServerResponse, config: ClipboardConfig): void {
  const content = readLocalClipboardSync();
  if (!content) {
    return jsonResponse(response, 200, { content: "", hash: null });
  }

  const hash = computeHash(content);
  return jsonResponse(response, 200, { content, hash, contentType: "text" });
}

// -- Outbound sync: push local clipboard to peer -----------------------------------

export async function pushClipboardToPeer(host: string, port: number, token: string): Promise<{ sent: boolean; reason?: string }> {
  const content = readLocalClipboardSync();
  if (!content) {
    return { sent: false, reason: "clipboard empty" };
  }

  const hash = computeHash(content);

  // Loop prevention
  if (hash === currentContentHash) {
    return { sent: false, reason: "loop detected" };
  }

  const config = readClipboardConfig();
  const check = sanitizeClipboardForRead(content, config.maxSizeBytes, config.skipPatterns);
  if (!check.ok) {
    return { sent: false, reason: check.reason };
  }

  try {
    const res = await fetch(`http://${host}:${port}/clipboard`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        contentType: "text",
        sourceMachine: process.env["HASNA_MACHINES_MACHINE_ID"] || "unknown",
        timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      return { sent: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json() as Record<string, unknown>;
    currentContentHash = hash;
    return { sent: data["received"] === true, reason: data["reason"] as string | undefined };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
