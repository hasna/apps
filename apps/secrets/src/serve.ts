import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { listSecrets, getSecret, searchSecrets } from "./store.js";

export const SERVE_PORT = 27462;
const TOKEN_PATH = join(homedir(), ".hasna", "secrets", ".serve-token");

export function getOrCreateServeToken(): string {
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const dir = join(homedir(), ".hasna", "secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") ?? "";
  return new Headers({
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
}

function json(data: unknown, status = 200, extra?: Headers): Response {
  const h = new Headers({ "Content-Type": "application/json" });
  if (extra) for (const [k, v] of extra) h.set(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}

function err(msg: string, status = 400, extra?: Headers): Response {
  return json({ error: msg }, status, extra);
}

function authorized(req: Request, token: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${token}`;
}

/**
 * Given a URL, find secrets that look like they belong to that site.
 * Groups username/password pairs by common key prefix.
 */
function matchUrl(rawUrl: string): Array<{
  key_prefix: string;
  label: string;
  username?: string;
  password?: string;
}> {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }

  // Search terms: full hostname + base domain (e.g. github.com → github)
  const parts = hostname.split(".");
  const terms = [hostname, parts[0]].filter(Boolean);

  const all = listSecrets();
  const groups: Record<string, { label?: string; username?: string; password?: string }> = {};

  for (const s of all) {
    const keyLow = s.key.toLowerCase();
    const labelLow = (s.label ?? "").toLowerCase();
    const hits = terms.some(t => keyLow.includes(t) || labelLow.includes(t));
    if (!hits) continue;

    const segments = s.key.split("/");
    const leaf = segments[segments.length - 1].toLowerCase();
    const prefix = segments.slice(0, -1).join("/") || s.key;

    if (!groups[prefix]) groups[prefix] = { label: s.label };

    const isPassword = ["password", "pass", "pwd", "secret"].some(p => leaf.includes(p));
    const isUsername = ["username", "user", "email", "login", "account", "mail"].some(p => leaf.includes(p));

    if (isPassword) {
      groups[prefix].password = s.value;
    } else if (isUsername) {
      groups[prefix].username = s.value;
    } else if (s.type === "password" && !groups[prefix].password) {
      groups[prefix].password = s.value;
    }
  }

  return Object.entries(groups)
    .map(([prefix, data]) => ({
      key_prefix: prefix,
      label: data.label ?? prefix.split("/").pop() ?? prefix,
      username: data.username,
      password: data.password,
    }))
    .filter(m => m.username || m.password);
}

export async function startHttpServer(options: { port?: number } = {}): Promise<void> {
  const port = options.port ?? SERVE_PORT;
  const token = getOrCreateServeToken();

  console.log(`\n🔐  Secrets HTTP Server`);
  console.log(`    Host:  http://127.0.0.1:${port}  (localhost only)`);
  console.log(`    Token: ${token}`);
  console.log(`\n    → Copy this token into the extension Options page.`);
  console.log(`      (Or run: secrets serve token)\n`);
  console.log(`    Press Ctrl+C to stop.\n`);

  Bun.serve({
    port,
    hostname: "127.0.0.1", // never exposed to network

    fetch(req) {
      const url = new URL(req.url);
      const cors = corsHeaders(req);

      // Preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      // Health — no auth
      if (url.pathname === "/health") {
        return json({ ok: true, version: "1.0.0" }, 200, cors);
      }

      // All other endpoints require auth
      if (!authorized(req, token)) {
        return err("Unauthorized", 401, cors);
      }

      // GET /v1/list[?namespace=xxx]
      if (url.pathname === "/v1/list") {
        const ns = url.searchParams.get("namespace") ?? undefined;
        const secrets = listSecrets(ns).map(s => ({
          key: s.key,
          type: s.type,
          label: s.label ?? null,
          expires_at: s.expires_at ?? null,
        }));
        return json({ secrets }, 200, cors);
      }

      // GET /v1/get?key=xxx
      if (url.pathname === "/v1/get") {
        const key = url.searchParams.get("key");
        if (!key) return err("Missing key", 400, cors);
        const s = getSecret(key);
        if (!s) return err("Not found", 404, cors);
        return json({ key: s.key, value: s.value, type: s.type, label: s.label ?? null }, 200, cors);
      }

      // GET /v1/search?q=xxx
      if (url.pathname === "/v1/search") {
        const q = url.searchParams.get("q");
        if (!q) return err("Missing q", 400, cors);
        const results = searchSecrets(q).map(s => ({
          key: s.key,
          value: s.value,
          type: s.type,
          label: s.label ?? null,
        }));
        return json({ results }, 200, cors);
      }

      // GET /v1/match?url=https://github.com
      if (url.pathname === "/v1/match") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return err("Missing url", 400, cors);
        return json({ matches: matchUrl(targetUrl) }, 200, cors);
      }

      return err("Not found", 404, cors);
    },

    error(e) {
      console.error("Server error:", e);
      return new Response("Internal error", { status: 500 });
    },
  });

  console.log(`✓ Listening on http://127.0.0.1:${port}\n`);

  // Keep process alive
  await new Promise<never>(() => {});
}
