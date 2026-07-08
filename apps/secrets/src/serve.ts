import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { getStore } from "./store/index.js";

export const SERVE_PORT = 27462;
const TOKEN_PATH = join(homedir(), ".hasna", "secrets", ".serve-token");
const ALLOWED_EXTENSION_ORIGIN = process.env.HASNA_SECRETS_EXTENSION_ORIGIN?.trim() || "";

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
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  if (origin.startsWith("chrome-extension://")) {
    if (!ALLOWED_EXTENSION_ORIGIN || origin === ALLOWED_EXTENSION_ORIGIN) {
      headers.set("Access-Control-Allow-Origin", origin);
    }
  }
  if (origin === "null" && !ALLOWED_EXTENSION_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
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
async function matchLegacyUrl(rawUrl: string): Promise<Array<{
  source: "legacy";
  key_prefix: string;
  label: string;
  username?: string;
  password?: string;
}>> {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }

  // Search terms: full hostname + base domain (e.g. github.com → github)
  const parts = hostname.split(".");
  const terms = [hostname, parts[0]].filter(Boolean);

  const all = await getStore().listSecrets();
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
      source: "legacy" as const,
      key_prefix: prefix,
      label: data.label ?? prefix.split("/").pop() ?? prefix,
      username: data.username,
      password: data.password,
    }))
    .filter(m => m.username || m.password);
}

async function matchUrl(rawUrl: string): Promise<Array<Record<string, unknown>>> {
  const vaultMatches = (await getStore().matchVaultItemsForUrl(rawUrl))
    .filter((item) => ["login", "address", "identity", "payment_card"].includes(item.kind))
    .map((item) => ({
      source: "vault_item",
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle ?? null,
      domains: item.domains,
      favorite: item.favorite,
    }));
  return [...vaultMatches, ...(await matchLegacyUrl(rawUrl))];
}

export async function startHttpServer(options: { port?: number } = {}): Promise<void> {
  const port = options.port ?? SERVE_PORT;
  const token = getOrCreateServeToken();

  console.log(`\n🔐  Secrets HTTP Server`);
  console.log(`    Host:  http://127.0.0.1:${port}  (localhost only)`);
  console.log(`    Token: use \`secrets serve token\` to reveal it`);
  console.log(`\n    → Copy that token into the extension Options page.\n`);
  console.log(`    Press Ctrl+C to stop.\n`);

  Bun.serve({
    port,
    hostname: "127.0.0.1", // never exposed to network

    async fetch(req: Request) {
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
        const secrets = (await getStore().listSecretMetadata(ns)).map(s => ({
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
        const s = await getStore().getSecret(key);
        if (!s) return err("Not found", 404, cors);
        return json({ key: s.key, value: s.value, type: s.type, label: s.label ?? null }, 200, cors);
      }

      // GET /v1/search?q=xxx
      if (url.pathname === "/v1/search") {
        const q = url.searchParams.get("q");
        if (!q) return err("Missing q", 400, cors);
        const results = (await getStore().searchSecretMetadata(q)).map(s => ({
          key: s.key,
          type: s.type,
          label: s.label ?? null,
          expires_at: s.expires_at ?? null,
        }));
        return json({ results }, 200, cors);
      }

      // GET /v1/items[?kind=login]
      if (url.pathname === "/v1/items") {
        const kind = url.searchParams.get("kind") as any;
        const items = (await getStore().listVaultItemMetadata(kind || undefined)).map(item => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle ?? null,
          domains: item.domains,
          tags: item.tags,
          favorite: item.favorite,
          created_at: item.created_at,
          updated_at: item.updated_at,
        }));
        return json({ items }, 200, cors);
      }

      // GET /v1/items/search?q=xxx
      if (url.pathname === "/v1/items/search") {
        const q = url.searchParams.get("q");
        if (!q) return err("Missing q", 400, cors);
        const results = (await getStore().searchVaultItemMetadata(q)).map(item => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle ?? null,
          domains: item.domains,
          tags: item.tags,
          favorite: item.favorite,
          created_at: item.created_at,
          updated_at: item.updated_at,
        }));
        return json({ results }, 200, cors);
      }

      // GET /v1/items/get?id=xxx
      if (url.pathname === "/v1/items/get") {
        const id = url.searchParams.get("id");
        if (!id) return err("Missing id", 400, cors);
        const item = await getStore().getVaultItem(id);
        if (!item) return err("Not found", 404, cors);
        return json({
          id: item.id,
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle ?? null,
          domains: item.domains,
          tags: item.tags,
          favorite: item.favorite,
          data: item.data,
          created_at: item.created_at,
          updated_at: item.updated_at,
        }, 200, cors);
      }

      // GET /v1/match?url=https://github.com
      if (url.pathname === "/v1/match") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return err("Missing url", 400, cors);
        return json({ matches: matchUrl(targetUrl) }, 200, cors);
      }

      return err("Not found", 404, cors);
    },

    error(e: unknown) {
      console.error("Server error:", e);
      return new Response("Internal error", { status: 500 });
    },
  });

  console.log(`✓ Listening on http://127.0.0.1:${port}\n`);

  // Keep process alive
  await new Promise<never>(() => {});
}
