/**
 * hooks registry Cloudflare Worker.
 *
 * Same API surface as `hooks serve`: catalog, artifact, lock reads; publish
 * via PUT with the API key. Artifacts live in R2 under
 * hook_artifacts/<name>/<version>.json; hook rows live in D1.
 *
 * Bindings: HOOKS_D1 (D1), HOOKS_R2 (R2), HOOKS_API_KEY (secret).
 */

interface D1Result {
  results?: unknown[];
  success: boolean;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first(): Promise<unknown>;
  all(): Promise<D1Result>;
  run(): Promise<unknown>;
}

interface R2Object {
  json(): Promise<unknown>;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: string): Promise<unknown>;
}

export interface Env {
  HOOKS_D1: D1Database;
  HOOKS_R2: R2Bucket;
  HOOKS_API_KEY?: string;
}

interface HookRow {
  id: string;
  name: string;
  version: string;
  sha256: string;
  source_type: string;
  source_ref: string | null;
  installed_at: string;
  enabled: number;
  last_verified_at: string | null;
}

interface ArtifactJson {
  manifest: {
    name: string;
    version: string;
    description?: string;
    events: string[];
    script: string;
    args?: string[];
    timeout_ms?: number;
  };
  script: string;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function authorized(req: Request, env: Env): boolean {
  if (!env.HOOKS_API_KEY) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length) === env.HOOKS_API_KEY;
  return req.headers.get("x-api-key") === env.HOOKS_API_KEY;
}

async function listRows(env: Env): Promise<HookRow[]> {
  const { results } = await env.HOOKS_D1.prepare(
    "SELECT id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at FROM hooks WHERE enabled = 1 ORDER BY name",
  ).all();
  return results as unknown as HookRow[];
}

async function artifactFor(env: Env, name: string, version: string): Promise<{ payload: ArtifactJson; sha256: string } | null> {
  const obj = await env.HOOKS_R2.get(`hook_artifacts/${name}/${version}.json`);
  if (!obj) return null;
  const payload = (await obj.json()) as ArtifactJson;
  const row = (await env.HOOKS_D1.prepare(
    "SELECT sha256 FROM hooks WHERE name = ? AND version = ?",
  ).bind(name, version).first()) as { sha256: string } | null;
  const sha256 = row?.sha256 ?? (await sha256Hex(payload.script));
  return { payload, sha256 };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return json({ status: "ok", name: "hooks-registry" });
    }

    if (url.pathname === "/api/v1/catalog" && req.method === "GET") {
      const rows = await listRows(env);
      const catalog = await Promise.all(
        rows.map(async (row) => {
          const artifact = await artifactFor(env, row.name, row.version);
          const events = artifact?.payload.manifest.events ?? [];
          return {
            name: row.name,
            version: row.version,
            sha256: row.sha256,
            events,
            description: artifact?.payload.manifest.description ?? "",
            source: row.source_type,
          };
        }),
      );
      return json({ hooks: catalog });
    }

    const artifactMatch = /^\/api\/v1\/hooks\/([\w-]+)\/(\d+\.\d+\.\d+)$/.exec(url.pathname);
    if (artifactMatch && req.method === "GET") {
      const [, name, version] = artifactMatch;
      const artifact = await artifactFor(env, name, version);
      if (!artifact) return json({ error: `Hook '${name}@${version}' not found` }, 404);
      return json(artifact.payload, 200, { "x-hook-sha256": artifact.sha256 });
    }

    if (url.pathname === "/api/v1/lock" && req.method === "GET") {
      const rows = await listRows(env);
      const hooks: Record<string, { version: string; sha256: string; source: string }> = {};
      for (const row of rows) {
        hooks[row.name] = { version: row.version, sha256: row.sha256, source: row.source_type };
      }
      return json({ hooks });
    }

    if (url.pathname === "/api/v1/hooks" && req.method === "PUT") {
      if (!authorized(req, env)) {
        return json({ error: "unauthorized: valid API key required to publish" }, 401);
      }
      const body = (await req.json().catch(() => null)) as Partial<ArtifactJson> & { name?: string } | null;
      const manifest = body?.manifest;
      if (!body || !manifest?.name || !manifest.version || typeof body.script !== "string") {
        return json({ error: "invalid body: manifest.name, manifest.version and script are required" }, 400);
      }
      const name = manifest.name;
      const version = manifest.version;
      const sha256 = await sha256Hex(body.script);
      await env.HOOKS_R2.put(`hook_artifacts/${name}/${version}.json`, JSON.stringify({ manifest, script: body.script }));
      const now = new Date().toISOString();
      await env.HOOKS_D1.prepare(
        `INSERT INTO hooks (id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at)
         VALUES (?, ?, ?, ?, 'remote', NULL, ?, 1, NULL)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, sha256 = excluded.sha256, source_type = excluded.source_type, last_verified_at = excluded.last_verified_at`,
      ).bind(name, name, version, sha256, now).run();
      return json({ ok: true, hook: { name, version, sha256 } });
    }

    return json({ error: "Not Found" }, 404);
  },
};
