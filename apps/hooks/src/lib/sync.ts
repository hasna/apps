/**
 * hooks sync — reconcile the local store against the remote registry (when an
 * API URL is configured) or the bundled registry (otherwise).
 *
 * Fail-closed: every network read happens before anything is written, so a
 * failure mid-sync leaves the local store untouched. Local-only hooks are
 * never deleted by a remote sync.
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { HOOKS } from "./registry.js";
import { resolveApiKey, resolveApiUrl } from "../config.js";
import { getDb } from "../db/index.js";
import {
  readLock,
  setPinnedHook,
  sha256File,
  upsertHookRecord,
} from "./store.js";
import { parseManifest, shortManifestName, writeCustomHook } from "./manifest.js";
import { resolveScriptPath } from "./resolve.js";

export interface SyncDiff {
  added: string[];
  updated: string[];
  unchanged: string[];
  skipped: string[];
}

export interface SyncPlan {
  apiUrl: string | null;
  dryRun: boolean;
  diff: SyncDiff;
}

export interface ArtifactResponse {
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

function sha256OfText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sha256OfPath(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectBundledCatalog(): Array<{ name: string; version: string; sha256: string }> {
  const out: Array<{ name: string; version: string; sha256: string }> = [];
  for (const meta of HOOKS) {
    const scriptPath = resolveScriptPath(meta.name);
    if (!scriptPath) continue;
    out.push({
      name: meta.name,
      version: meta.version,
      sha256: sha256OfPath(scriptPath),
    });
  }
  return out;
}

async function fetchJson(base: string, path: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = resolveApiKey();
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${base}${path}`, {
    headers,
    // redirect:"error" is a security control, not a convenience: a 3xx would
    // otherwise carry the x-api-key header to another origin (fetch strips
    // Authorization/Cookie cross-origin but forwards custom headers — QA-3
    // measured the live key following a 302). Any redirect refuses; the key
    // never hops origins.
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) {
    throw new Error(
      "registry requires API key — set HASNA_HOOKS_API_KEY or HOOKS_API_KEY (vault-delivered, never stored)",
    );
  }
  if (!res.ok) {
    throw new Error(`GET ${path} failed with status ${res.status}`);
  }
  return res.json();
}

interface RemoteLock {
  hooks: Record<string, { version: string; sha256: string; source: string }>;
}

async function fetchRemoteState(apiUrl: string): Promise<{
  catalog: Array<{ name: string; version: string; sha256: string }>;
  remoteLock: RemoteLock;
}> {
  const catalog = (await fetchJson(apiUrl, "/api/v1/catalog")) as { hooks?: Array<{ name: string; version: string; sha256: string }> };
  const remoteLock = (await fetchJson(apiUrl, "/api/v1/lock")) as RemoteLock;
  if (!catalog.hooks || !Array.isArray(catalog.hooks)) {
    throw new Error("remote catalog is malformed: missing hooks array");
  }
  if (!remoteLock.hooks || typeof remoteLock.hooks !== "object") {
    throw new Error("remote lock is malformed: missing hooks map");
  }
  return { catalog: catalog.hooks, remoteLock };
}

function computeDiff(catalog: Array<{ name: string; version: string; sha256: string }>, remoteLock: RemoteLock | null): SyncDiff {
  const local = readLock();
  const diff: SyncDiff = { added: [], updated: [], unchanged: [], skipped: [] };
  for (const entry of catalog) {
    if (!entry.name || !entry.version || !entry.sha256) continue;
    const pin = local.hooks[entry.name];
    const remotePin = remoteLock ? remoteLock.hooks[entry.name] : entry;
    if (remoteLock && !remotePin) {
      diff.skipped.push(entry.name);
      continue;
    }
    const pinnedLocally = pin && pin.version === entry.version && pin.sha256 === entry.sha256;
    if (pinnedLocally) {
      diff.unchanged.push(entry.name);
    } else if (pin) {
      diff.updated.push(entry.name);
    } else {
      diff.added.push(entry.name);
    }
  }
  return diff;
}

export async function planSync(): Promise<SyncPlan> {
  const apiUrl = resolveApiUrl();
  if (apiUrl) {
    const { catalog, remoteLock } = await fetchRemoteState(apiUrl);
    return { apiUrl, dryRun: false, diff: computeDiff(catalog, remoteLock) };
  }
  const diff = computeDiff(collectBundledCatalog(), null);
  return { apiUrl: null, dryRun: false, diff };
}

export async function syncHooks(options: { dryRun?: boolean } = {}): Promise<SyncPlan> {
  const apiUrl = resolveApiUrl();
  const plan = await planSync();
  if (options.dryRun) return { ...plan, dryRun: true };
  if (!apiUrl) {
    const db = getDb();
    for (const entry of collectBundledCatalog()) {
      setPinnedHook(entry.name, { version: entry.version, sha256: entry.sha256, source: "bundled" });
      upsertHookRecord(db, {
        name: entry.name,
        version: entry.version,
        sha256: entry.sha256,
        source_type: "bundled",
        source_ref: "apps/hooks/hooks",
        last_verified_at: new Date().toISOString(),
      });
    }
    return plan;
  }

  const { catalog, remoteLock } = await fetchRemoteState(apiUrl);
  const diff = computeDiff(catalog, remoteLock);
  const toFetch = [...diff.added, ...diff.updated];
  const artifacts = new Map<string, ArtifactResponse>();
  for (const name of toFetch) {
    const entry = remoteLock.hooks[name];
    if (!entry) continue;
    const artifact = (await fetchJson(apiUrl, `/api/v1/hooks/${name}/${entry.version}`)) as ArtifactResponse;
    if (!artifact.manifest || typeof artifact.script !== "string") {
      throw new Error(`artifact for '${name}@${entry.version}' is malformed`);
    }
    const actualSha = sha256OfText(artifact.script);
    if (actualSha !== entry.sha256) {
      throw new Error(`sha256 mismatch for '${name}@${entry.version}': lock says ${entry.sha256}, artifact has ${actualSha}`);
    }
    artifacts.set(name, artifact);
  }

  const db = getDb();
  for (const name of toFetch) {
    const artifact = artifacts.get(name);
    const entry = remoteLock.hooks[name];
    if (!artifact || !entry) continue;
    const manifest = parseManifest(
      JSON.stringify({ ...artifact.manifest, name: shortManifestName(artifact.manifest.name || name) }),
    );
    const scriptRel = artifact.manifest.script.includes("\n") ? "script.ts" : artifact.manifest.script;
    writeCustomHook(name, manifest, artifact.script, scriptRel);
    // Pin the VERIFIED digest, never a re-read that could differ: the bytes
    // written are exactly artifact.script (already matched entry.sha256), so
    // a post-write re-read that disagrees is tampering — refuse instead of
    // trusting it (security reviewer P1-1).
    const scriptPath = resolveScriptPath(name)!;
    const actual = await sha256File(scriptPath);
    if (actual !== entry.sha256) {
      throw new Error(`sha256 mismatch after write for '${name}@${entry.version}': lock says ${entry.sha256}, on disk ${actual}`);
    }
    setPinnedHook(name, { version: entry.version, sha256: entry.sha256, source: entry.source ?? "remote" });
    upsertHookRecord(db, {
      name,
      version: entry.version,
      sha256: entry.sha256,
      source_type: entry.source ?? "remote",
      source_ref: apiUrl,
      last_verified_at: new Date().toISOString(),
    });
  }
  return { apiUrl, dryRun: false, diff };
}

export interface PinnedHookInstall {
  name: string;
  version: string;
  sha256: string;
  source: string;
  source_ref: string;
  artifact: ArtifactResponse;
  scriptPath: string;
}

/**
 * Fetch one exact hook version from the remote registry, verify its sha
 * against the remote lock, write it to the custom store, and pin it.
 * Powers `hooks install <name>@<version>` / `hooks update <name>@<version>`
 * (QA-2 finding: pinned-version install/update was unsupported).
 *
 * Requires an api_url (remote registry). The sha check is against the remote
 * lock — the exact version named by the user, never a mutable latest.
 */
export async function fetchPinnedHook(
  name: string,
  version: string,
  apiUrl: string,
): Promise<PinnedHookInstall> {
  const remoteLock = (await fetchJson(apiUrl, "/api/v1/lock")) as RemoteLock;
  const entry = remoteLock.hooks?.[name];
  if (!entry) {
    throw new Error(`Hook '${name}' is not in the remote registry lock`);
  }
  if (entry.version !== version) {
    throw new Error(
      `Hook '${name}' version ${version} is not in the remote registry (available: ${entry.version})`,
    );
  }
  const artifact = (await fetchJson(apiUrl, `/api/v1/hooks/${name}/${version}`)) as ArtifactResponse;
  if (!artifact.manifest || typeof artifact.script !== "string") {
    throw new Error(`artifact for '${name}@${version}' is malformed`);
  }
  // Manifest identity must match the requested name@version — a registry that
  // serves the right script under the wrong identity is refused (general
  // reviewer P2-1).
  const manifestName = shortManifestName(artifact.manifest.name ?? name);
  if (manifestName !== name) {
    throw new Error(`artifact for '${name}@${version}' declares a different hook name ('${manifestName}')`);
  }
  if (artifact.manifest.version !== version) {
    throw new Error(`artifact for '${name}@${version}' declares a different version ('${artifact.manifest.version}')`);
  }
  const actualSha = sha256OfText(artifact.script);
  if (actualSha !== entry.sha256) {
    throw new Error(
      `sha256 mismatch for '${name}@${version}': lock says ${entry.sha256}, artifact has ${actualSha}`,
    );
  }
  const manifest = parseManifest(
    JSON.stringify({ ...artifact.manifest, name: shortManifestName(artifact.manifest.name || name) }),
  );
  const scriptRel = artifact.manifest.script.includes("\n") ? "script.ts" : artifact.manifest.script;
  writeCustomHook(name, manifest, artifact.script, scriptRel);
  const scriptPath = resolveScriptPath(name)!;
  const actual = await sha256File(scriptPath);
  if (actual !== entry.sha256) {
    throw new Error(
      `sha256 mismatch after write for '${name}@${version}': lock says ${entry.sha256}, on disk ${actual}`,
    );
  }
  const db = getDb();
  setPinnedHook(name, { version, sha256: entry.sha256, source: entry.source ?? "remote" });
  upsertHookRecord(db, {
    name,
    version,
    sha256: entry.sha256,
    source_type: entry.source ?? "remote",
    source_ref: apiUrl,
    last_verified_at: new Date().toISOString(),
  });
  return {
    name,
    version,
    sha256: entry.sha256,
    source: entry.source ?? "remote",
    source_ref: apiUrl,
    artifact,
    scriptPath,
  };
}
