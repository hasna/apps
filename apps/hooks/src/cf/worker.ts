/**
 * hooks registry Cloudflare Worker.
 *
 * Same API surface as `hooks serve`: catalog, artifact, lock reads; publish
 * via PUT with the API key. Artifacts live in R2 under
 * hook_artifacts/<name>/<version>.json; hook rows live in D1.
 *
 * Bindings: HOOKS_D1 (D1), HOOKS_R2 (R2), HOOKS_API_KEY (secret).
 *
 * Privacy lock-down: when HOOKS_API_KEY is set, every route except /health
 * requires the API key. Without the binding, reads stay open (OSS default) —
 * the behavior is config-driven.
 *
 * Version retention (P1-4, bug d3b4025c): D1 keeps a `hook_versions` table
 * keyed (name, version) with the manifest, script sha256, artifact key and
 * publish time; the `hooks` table is the LATEST pointer only. PUT never
 * overwrites an existing (name, version) — a byte-identical republish is
 * idempotent, anything else is a 409 conflict. The latest pointer only
 * moves FORWARD by semver (bug 6e412e52): publishing an older version
 * stores its row but never downgrades the pointer. GET /api/v1/hooks/:name/:version
 * serves ANY published version (exact pin fetch), and the catalog and lock
 * expose versions[].
 */

import { secureEqual } from "../lib/secure-compare.js";
import { SEMVER_PATTERN, compareVersions } from "../lib/semver.js";

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

interface HookVersionRow {
  name: string;
  version: string;
  manifest_json: string;
  script_sha256: string;
  artifact_key: string;
  published_at: string;
}

interface ArtifactJson {
  manifest: {
    name: string;
    version: string;
    description?: string;
    events: string[];
    script: string;
    script_kind?: "inline" | "file";
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
  if (header.startsWith("Bearer ")) return secureEqual(header.slice("Bearer ".length), env.HOOKS_API_KEY);
  return secureEqual(req.headers.get("x-api-key") ?? "", env.HOOKS_API_KEY);
}

async function versionsFor(env: Env, name: string): Promise<string[]> {
  const { results } = await env.HOOKS_D1.prepare(
    "SELECT version FROM hook_versions WHERE name = ? ORDER BY published_at ASC",
  ).bind(name).all();
  const rows = results as unknown as Array<{ version: string }>;
  const versions = rows.map((row) => row.version);
  // Back-compat: a pre-hook_versions row (latest only) still reports its
  // own version as the sole published version.
  return versions.length > 0 ? versions : [];
}

async function hookVersionRow(env: Env, name: string, version: string): Promise<HookVersionRow | null> {
  const row = (await env.HOOKS_D1.prepare(
    "SELECT name, version, manifest_json, script_sha256, artifact_key, published_at FROM hook_versions WHERE name = ? AND version = ?",
  ).bind(name, version).first()) as HookVersionRow | null;
  return row ?? null;
}

async function artifactFor(env: Env, name: string, version: string): Promise<{ payload: ArtifactJson; sha256: string } | null> {
  const versionRow = await hookVersionRow(env, name, version);
  if (versionRow) {
    const obj = await env.HOOKS_R2.get(versionRow.artifact_key);
    if (!obj) return null;
    const payload = (await obj.json()) as ArtifactJson;
    return { payload, sha256: versionRow.script_sha256 };
  }
  // Pre-hook_versions fallback: the hooks row is the latest pointer.
  const row = (await env.HOOKS_D1.prepare(
    "SELECT sha256 FROM hooks WHERE name = ? AND version = ?",
  ).bind(name, version).first()) as { sha256: string } | null;
  if (!row) return null;
  const obj = await env.HOOKS_R2.get(`hook_artifacts/${name}/${version}.json`);
  if (!obj) return null;
  const payload = (await obj.json()) as ArtifactJson;
  return { payload, sha256: row.sha256 };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode a URL path segment that the client percent-encoded. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The hooks table is the LATEST pointer; hook_versions is the immutable
 * history. A crash between the hook_versions INSERT and the latest-pointer
 * upsert leaves a published version with no pointer — invisible to
 * catalog/lock until republished. Every catalog/lock read heals that window
 * (P2-4): the highest-semver published version of any name missing from
 * `hooks` becomes its pointer, so the next GET after a crash returns the
 * hook. The heal compares by SEMVER (bug 6e412e52), never by published_at —
 * an older-version republish carries a LATER timestamp and must not win the
 * pointer just because it was published more recently.
 */
async function ensureLatestRows(env: Env): Promise<HookRow[]> {
  const { results } = await env.HOOKS_D1.prepare(
    "SELECT id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at FROM hooks WHERE enabled = 1 ORDER BY name",
  ).all();
  const rows = results as unknown as HookRow[];
  const present = new Set(rows.map((row) => row.name));
  const { results: allVersions } = await env.HOOKS_D1.prepare(
    "SELECT name, version, script_sha256, published_at FROM hook_versions ORDER BY name, published_at",
  ).all();
  const versionRows = allVersions as unknown as Array<{ name: string; version: string; script_sha256: string; published_at: string }>;
  // Highest semver per name — the ONLY ordering rule for the pointer.
  const highest = new Map<string, { name: string; version: string; script_sha256: string; published_at: string }>();
  for (const row of versionRows) {
    const current = highest.get(row.name);
    if (!current || compareVersions(row.version, current.version) > 0) highest.set(row.name, row);
  }
  const healed: HookRow[] = [];
  for (const versionRow of highest.values()) {
    if (present.has(versionRow.name)) continue;
    await env.HOOKS_D1.prepare(
      `INSERT INTO hooks (id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at)
       VALUES (?, ?, ?, ?, 'remote', NULL, ?, 1, NULL)
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, sha256 = excluded.sha256, source_type = excluded.source_type, last_verified_at = excluded.last_verified_at`,
    ).bind(versionRow.name, versionRow.name, versionRow.version, versionRow.script_sha256, versionRow.published_at).run();
    healed.push({
      id: versionRow.name,
      name: versionRow.name,
      version: versionRow.version,
      sha256: versionRow.script_sha256,
      source_type: "remote",
      source_ref: null,
      installed_at: versionRow.published_at,
      enabled: 1,
      last_verified_at: null,
    });
  }
  return [...rows, ...healed];
}

/**
 * Upsert the hooks (latest-pointer) row for a just-published version.
 *
 * The pointer only moves FORWARD (bug 6e412e52): publishing an OLDER
 * version still stores its (name, version) row and artifact — history
 * grows — but the pointer is compared by semver and kept when the publish
 * is lower than the current pointer. Equal or higher moves it; lower leaves
 * the existing pointer untouched.
 */
async function upsertLatestPointer(env: Env, name: string, version: string, sha256: string, now: string): Promise<void> {
  const current = (await env.HOOKS_D1.prepare("SELECT version FROM hooks WHERE id = ?").bind(name).first()) as { version: string } | null;
  if (current && compareVersions(version, current.version) < 0) return;
  await env.HOOKS_D1.prepare(
    `INSERT INTO hooks (id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at)
     VALUES (?, ?, ?, ?, 'remote', NULL, ?, 1, NULL)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, sha256 = excluded.sha256, source_type = excluded.source_type, last_verified_at = excluded.last_verified_at`,
  ).bind(name, name, version, sha256, now).run();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return json({ status: "ok", name: "hooks-registry" });
    }

    // Privacy lock-down: a configured API key gates every route except
    // /health (which stays open for probes). No binding -> reads stay open.
    if (env.HOOKS_API_KEY && !authorized(req, env)) {
      return json({ error: "unauthorized: valid API key required" }, 401);
    }

    if (url.pathname === "/api/v1/catalog" && req.method === "GET") {
      const rows = await ensureLatestRows(env);
      const catalog = await Promise.all(
        rows.map(async (row) => {
          const artifact = await artifactFor(env, row.name, row.version);
          const events = artifact?.payload.manifest.events ?? [];
          const versions = await versionsFor(env, row.name);
          return {
            name: row.name,
            version: row.version,
            sha256: row.sha256,
            events,
            description: artifact?.payload.manifest.description ?? "",
            source: row.source_type,
            versions,
          };
        }),
      );
      return json({ hooks: catalog });
    }

    // P1-4: exact-version artifact route — accepts any published version
    // (including prerelease/build-metadata pins), encoded as the client
    // sends them (%2B for build metadata). The version segment is validated
    // against the same semver the manifest validation accepts (P2-10),
    // never a narrower pattern.
    const artifactMatch = /^\/api\/v1\/hooks\/([\w-]+)\/([0-9A-Za-z.%+_-]+)$/.exec(url.pathname);
    if (artifactMatch && req.method === "GET") {
      const [, rawName, rawVersion] = artifactMatch;
      const name = decodeSegment(rawName);
      const version = decodeSegment(rawVersion);
      if (!SEMVER_PATTERN.test(version)) {
        return json({ error: `invalid semver version '${version}'` }, 400);
      }
      const artifact = await artifactFor(env, name, version);
      if (!artifact) return json({ error: `Hook '${name}@${version}' not found` }, 404);
      return json(artifact.payload, 200, { "x-hook-sha256": artifact.sha256 });
    }

    if (url.pathname === "/api/v1/lock" && req.method === "GET") {
      const rows = await ensureLatestRows(env);
      const hooks: Record<string, { version: string; sha256: string; source: string; versions: string[] }> = {};
      for (const row of rows) {
        hooks[row.name] = {
          version: row.version,
          sha256: row.sha256,
          source: row.source_type,
          versions: await versionsFor(env, row.name),
        };
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
      if (!SEMVER_PATTERN.test(version)) {
        return json({ error: `invalid semver version '${version}'` }, 400);
      }
      const sha256 = await sha256Hex(body.script);
      const manifestJson = JSON.stringify(manifest);

      // P1-4 immutability: an existing (name, version) is never overwritten.
      // A byte-identical republish (same script sha, same manifest
      // serialization) is idempotent; anything else is a conflicting
      // republish and is refused.
      const existing = await hookVersionRow(env, name, version);
      if (existing) {
        if (existing.script_sha256 === sha256 && existing.manifest_json === manifestJson) {
          // P2-4 healing: an idempotent republish also repairs a missing
          // latest pointer (a crash between the version INSERT and the
          // pointer upsert) so the hook is not left invisible in
          // catalog/lock.
          await upsertLatestPointer(env, name, version, sha256, new Date().toISOString());
          return json({ ok: true, idempotent: true, hook: { name, version, sha256 } });
        }
        return json(
          { error: `conflicting republish of '${name}@${version}': versions are immutable. Bump the version or publish the identical bytes.` },
          409,
        );
      }

      const artifactKey = `hook_artifacts/${name}/${version}.json`;
      const now = new Date().toISOString();
      // P2-4 write order: the hook_versions INSERT comes FIRST, the R2 write
      // second, the latest-pointer upsert last. A concurrent PUT of the same
      // new (name, version) then loses on the version-row primary key (409)
      // BEFORE touching R2, so the stored artifact always matches the
      // recorded script_sha256; a failure between insert and upsert leaves a
      // version row that catalog/lock reads heal on the next GET.
      try {
        await env.HOOKS_D1.prepare(
          `INSERT INTO hook_versions (name, version, manifest_json, script_sha256, artifact_key, published_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(name, version, manifestJson, sha256, artifactKey, now).run();
      } catch {
        // The concurrent loser hits the (name, version) primary key — the
        // row now exists, so the publish is no longer a new version.
        return json(
          { error: `conflicting republish of '${name}@${version}': versions are immutable. Bump the version or publish the identical bytes.` },
          409,
        );
      }
      try {
        await env.HOOKS_R2.put(artifactKey, JSON.stringify({ manifest, script: body.script }));
      } catch (err) {
        // Roll back the version row so no partial state survives: without
        // the R2 object the artifact 404s forever (round-2B P3).
        await env.HOOKS_D1.prepare("DELETE FROM hook_versions WHERE name = ? AND version = ?").bind(name, version).run();
        const detail = err instanceof Error ? err.message : String(err);
        return json({ error: `failed to store artifact: ${detail}` }, 500);
      }
      await upsertLatestPointer(env, name, version, sha256, now);
      return json({ ok: true, hook: { name, version, sha256 } });
    }

    return json({ error: "Not Found" }, 404);
  },
};
