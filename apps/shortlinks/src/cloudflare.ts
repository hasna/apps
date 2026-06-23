import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeHostname } from "./config.js";

export interface CloudflareSetupPlan {
  hostname: string;
  target: string;
  proxied: boolean;
  workerName: string;
  origin: string;
  dnsRecord: {
    type: "CNAME";
    name: string;
    content: string;
    proxied: boolean;
  };
  wranglerCommand: string;
}

export interface CloudflareDnsOptions {
  hostname: string;
  target: string;
  token?: string;
  zoneId?: string;
  proxied?: boolean;
  dryRun?: boolean;
}

export function createCloudflarePlan(input: {
  hostname: string;
  target: string;
  origin: string;
  workerName?: string;
  proxied?: boolean;
}): CloudflareSetupPlan {
  const hostname = normalizeHostname(input.hostname);
  const target = normalizeHostname(input.target);
  const workerName = input.workerName || "shortlinks";
  const proxied = input.proxied ?? true;
  return {
    hostname,
    target,
    proxied,
    workerName,
    origin: input.origin,
    dnsRecord: {
      type: "CNAME",
      name: hostname,
      content: target,
      proxied,
    },
    wranglerCommand: `wrangler deploy cloudflare/${workerName}.js --name ${workerName}`,
  };
}

export function generateWorkerScript(): string {
  return `export default {
  async fetch(request, env) {
    const origin = env.SHORTLINKS_ORIGIN;
    if (!origin) {
      return new Response("SHORTLINKS_ORIGIN is not configured", { status: 500 });
    }

    const incoming = new URL(request.url);
    const proxyTo = (targetOrigin, marker) => {
      const upstream = new URL(incoming.pathname + incoming.search, targetOrigin);
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", incoming.host);
      headers.set("x-shortlinks-worker", marker);

      return fetch(upstream.toString(), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual"
      });
    };

    const splitList = (value, fallback) => (value || fallback)
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    let firstSegment = "";
    try {
      firstSegment = decodeURIComponent(incoming.pathname.replace(/^\\/+/, "").split("/")[0] || "").toLowerCase();
    } catch {
      return new Response("Invalid path", { status: 400 });
    }

    const reserved = splitList(env.SHORTLINKS_RESERVED_PATH_PREFIXES, "a,api");
    if (firstSegment && reserved.includes(firstSegment)) {
      if (env.ATTACHMENTS_ORIGIN) {
        return proxyTo(env.ATTACHMENTS_ORIGIN, "attachments");
      }
      return new Response("Reserved path prefix", { status: 404 });
    }

    const normalizePathPrefix = (prefix) => {
      const trimmed = prefix.replace(/^\\/+|\\/+$/g, "");
      return trimmed ? "/" + trimmed : "/";
    };
    const adminPrefixes = splitList(
      [env.SHORTLINKS_ADMIN_PATH_PREFIXES, env.SHORTLINKS_API_PATH_PREFIX, "/api,/_shortlinks/api"].filter(Boolean).join(","),
      "/api,/_shortlinks/api"
    ).map(normalizePathPrefix);
    const path = incoming.pathname.replace(/\\/+$/g, "").toLowerCase() || "/";
    if (adminPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) {
      return new Response("Not found", { status: 404 });
    }

    return proxyTo(origin, "cloudflare");
  }
};
`;
}

export function writeWorkerFiles(options: { outDir?: string; workerName?: string; origin?: string; attachmentsOrigin?: string } = {}): { workerPath: string; wranglerPath: string } {
  const outDir = options.outDir || "cloudflare";
  const workerName = options.workerName || "shortlinks";
  mkdirSync(outDir, { recursive: true });
  const workerPath = join(outDir, `${workerName}.js`);
  const wranglerPath = join(outDir, "wrangler.example.toml");
  writeFileSync(workerPath, generateWorkerScript());
  writeFileSync(wranglerPath, `name = "${workerName}"
main = "${workerName}.js"
compatibility_date = "2026-05-01"

[vars]
SHORTLINKS_ORIGIN = "${options.origin || "https://shortlinks.example.com"}"
ATTACHMENTS_ORIGIN = "${options.attachmentsOrigin || ""}"
SHORTLINKS_RESERVED_PATH_PREFIXES = "a,api"
SHORTLINKS_ADMIN_PATH_PREFIXES = "/api,/_shortlinks/api"
`);
  return { workerPath, wranglerPath };
}

function cloudflareAuthHeaders(token?: string): Record<string, string> {
  const apiToken = token || process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken) return { authorization: `Bearer ${apiToken}` };

  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL;
  if (apiKey && email) {
    return {
      "x-auth-key": apiKey,
      "x-auth-email": email,
    };
  }

  throw new Error("Cloudflare auth is required: set CLOUDFLARE_API_TOKEN, or CLOUDFLARE_API_KEY plus CLOUDFLARE_EMAIL.");
}

async function cloudflareRequest<T>(token: string | undefined, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      ...cloudflareAuthHeaders(token),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json() as { success?: boolean; errors?: Array<{ message: string }>; result?: T };
  if (!response.ok || body.success === false) {
    const message = body.errors?.map((e) => e.message).join("; ") || response.statusText;
    throw new Error(`Cloudflare API failed: ${message}`);
  }
  return body.result as T;
}

function candidateZones(hostname: string): string[] {
  const parts = normalizeHostname(hostname).split(".");
  const candidates: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

export async function findCloudflareZoneId(hostname: string, token?: string): Promise<string> {
  for (const zone of candidateZones(hostname)) {
    const result = await cloudflareRequest<Array<{ id: string; name: string }>>(token, `/zones?name=${encodeURIComponent(zone)}`);
    if (result[0]?.id) return result[0].id;
  }
  throw new Error(`Could not find a Cloudflare zone for ${hostname}. Pass --zone-id explicitly.`);
}

export async function upsertCloudflareDnsRecord(options: CloudflareDnsOptions): Promise<CloudflareSetupPlan | { id: string; action: "created" | "updated" }> {
  const token = options.token || process.env.CLOUDFLARE_API_TOKEN;
  const plan = createCloudflarePlan({
    hostname: options.hostname,
    target: options.target,
    origin: process.env.SHORTLINKS_ORIGIN || "https://shortlinks.example.com",
    proxied: options.proxied,
  });
  if (options.dryRun) return plan;
  const zoneId = options.zoneId || await findCloudflareZoneId(plan.hostname, token);
  const existing = await cloudflareRequest<Array<{ id: string }>>(
    token,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(plan.hostname)}`,
  );
  const payload = JSON.stringify(plan.dnsRecord);
  if (existing[0]?.id) {
    const updated = await cloudflareRequest<{ id: string }>(token, `/zones/${zoneId}/dns_records/${existing[0].id}`, {
      method: "PUT",
      body: payload,
    });
    return { id: updated.id, action: "updated" };
  }
  const created = await cloudflareRequest<{ id: string }>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: payload,
  });
  return { id: created.id, action: "created" };
}
