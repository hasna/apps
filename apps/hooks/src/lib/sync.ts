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
import { resolveHooksTransport } from "./transport.js";
import type { HooksCredentialOptions } from "./resolver-types.js";
import { getDb } from "../db/index.js";
import {
  type LockEntry,
  readLock,
  setPinnedHook,
  sha256File,
  upsertHookRecord,
  writeLock,
} from "./store.js";
import { parseManifest, scriptRelFor, shortManifestName, writeCustomHook, type HookManifest } from "./manifest.js";
import { resolveScriptPath } from "./resolve.js";

type Env = Record<string, string | undefined>;

export interface HooksSyncOptions {
  dryRun?: boolean;
  /** Injectable environment (tests). Defaults to `process.env`. */
  env?: Env;
  /** Injectable credential-chain inputs (tests: fake `security` runner). */
  credentials?: HooksCredentialOptions;
}

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
    script_kind?: "inline" | "file";
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

async function fetchJson(
  base: string,
  path: string,
  apiKey: string | undefined,
  opts?: { withHeader?: string },
): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
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
      "registry requires API key — set HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, " +
        "or ~/.hasna/hooks/config/credentials (resolved per call, never stored)",
    );
  }
  if (!res.ok) {
    throw new Error(`GET ${path} failed with status ${res.status}`);
  }
  const body = await res.json();
  if (opts?.withHeader) {
    (body as Record<string, unknown>)[opts.withHeader] = res.headers.get("x-hook-sha256");
  }
  return body;
}

interface RemoteLock {
  hooks: Record<string, { version: string; sha256: string; source: string; versions?: string[] }>;
}

async function fetchRemoteState(apiUrl: string, apiKey: string): Promise<{
  catalog: Array<{ name: string; version: string; sha256: string }>;
  remoteLock: RemoteLock;
}> {
  const catalog = (await fetchJson(apiUrl, "/api/v1/catalog", apiKey)) as { hooks?: Array<{ name: string; version: string; sha256: string }> };
  const remoteLock = (await fetchJson(apiUrl, "/api/v1/lock", apiKey)) as RemoteLock;
  if (!catalog.hooks || !Array.isArray(catalog.hooks)) {
    throw new Error("remote catalog is malformed: missing hooks array");
  }
  if (!remoteLock.hooks || typeof remoteLock.hooks !== "object") {
    throw new Error("remote lock is malformed: missing hooks map");
  }
  return { catalog: catalog.hooks, remoteLock };
}

function classifyRemotePin(
  pin: LockEntry | undefined,
  remoteVersion: string,
  remoteSha: string,
): "added" | "updated" | "unchanged" {
  const pinnedLocally = pin !== undefined && pin.version === remoteVersion && pin.sha256 === remoteSha;
  if (pinnedLocally) return "unchanged";
  // P2-9: an EXPLICIT pin (`hooks install/update <name>@<version>`) of an
  // older version is preserved across syncs — only an explicit
  // `hooks update <name>@<version>` moves it. Sync never silently bumps an
  // explicit older pin to the latest; a same-version sha drift still heals.
  if (pin !== undefined && pin.pinned === true && pin.version !== remoteVersion) return "unchanged";
  if (pin !== undefined) return "updated";
  return "added";
}

function computeDiff(catalog: Array<{ name: string; version: string; sha256: string }>, remoteLock: RemoteLock | null): SyncDiff {
  const local = readLock();
  const diff: SyncDiff = { added: [], updated: [], unchanged: [], skipped: [] };
  for (const entry of catalog) {
    if (!entry.name || !entry.version || !entry.sha256) continue;
    const pin = local.hooks[entry.name];
    if (remoteLock) {
      const remotePin = remoteLock.hooks[entry.name];
      if (!remotePin) {
        diff.skipped.push(entry.name);
        continue;
      }
      // P2-11: the comparison is against the remote LOCK entry — the exact
      // pin the registry wants clients on — never the catalog's latest.
      // When they disagree (lock pinned older than catalog latest), the
      // mismatch is ambiguous: refuse rather than guess which one applies.
      if (remotePin.version !== entry.version) {
        throw new Error(
          `remote registry is ambiguous for '${entry.name}': lock pins ${remotePin.version} but catalog latest is ${entry.version}. ` +
            `Fix the registry (or its lock) before syncing — nothing was changed.`,
        );
      }
      diff[classifyRemotePin(pin, remotePin.version, remotePin.sha256)].push(entry.name);
    } else {
      diff[classifyRemotePin(pin, entry.version, entry.sha256)].push(entry.name);
    }
  }
  return diff;
}

export async function planSync(options: HooksSyncOptions = {}): Promise<SyncPlan> {
  const transport = resolveHooksTransport(options.env ?? process.env, {
    credentials: options.credentials,
  });
  if (transport.mode === "remote" && transport.authority) {
    const { origin, apiKey } = transport.authority;
    const { catalog, remoteLock } = await fetchRemoteState(origin, apiKey);
    return { apiUrl: origin, dryRun: options.dryRun ?? false, diff: computeDiff(catalog, remoteLock) };
  }
  const diff = computeDiff(collectBundledCatalog(), null);
  return { apiUrl: null, dryRun: options.dryRun ?? false, diff };
}

export async function syncHooks(options: HooksSyncOptions = {}): Promise<SyncPlan> {
  const transport = resolveHooksTransport(options.env ?? process.env, {
    credentials: options.credentials,
  });
  const plan = await planSync(options);
  if (options.dryRun) return { ...plan, dryRun: true };
  if (transport.mode !== "remote" || !transport.authority) {
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

  const { origin, apiKey } = transport.authority;
  const { catalog, remoteLock } = await fetchRemoteState(origin, apiKey);
  const diff = computeDiff(catalog, remoteLock);
  const staged = await stageSyncArtifacts(origin, apiKey, [...diff.added, ...diff.updated], remoteLock);
  await commitSyncArtifacts(staged, origin, remoteLock);
  return { apiUrl: origin, dryRun: false, diff };
}

/**
 * One fully-validated artifact ready to be committed. Nothing has touched
 * the store at this point: every fetch, sha check and manifest parse has
 * already passed, so a failure inside staging leaves the store unchanged.
 */
export interface StagedSyncArtifact {
  name: string;
  version: string;
  sha256: string;
  source: string;
  manifest: ReturnType<typeof parseManifest>;
  scriptContent: string;
  scriptRel: string;
}

/**
 * P1-9 stage phase: fetch + validate ALL artifacts before anything is
 * written. A failure here (network, sha mismatch, malformed manifest,
 * containment violation) throws with the store untouched.
 */
export async function stageSyncArtifacts(
  apiUrl: string,
  apiKey: string,
  names: string[],
  remoteLock: RemoteLock,
): Promise<StagedSyncArtifact[]> {
  const staged: StagedSyncArtifact[] = [];
  for (const name of names) {
    const entry = remoteLock.hooks[name];
    if (!entry) continue;
    const artifact = (await fetchJson(apiUrl, `/api/v1/hooks/${encodeURIComponent(name)}/${encodeURIComponent(entry.version)}`, apiKey)) as ArtifactResponse;
    if (!artifact.manifest || typeof artifact.script !== "string") {
      throw new Error(`artifact for '${name}@${entry.version}' is malformed`);
    }
    const actualSha = sha256OfText(artifact.script);
    if (actualSha !== entry.sha256) {
      throw new Error(`sha256 mismatch for '${name}@${entry.version}': lock says ${entry.sha256}, artifact has ${actualSha}`);
    }
    const manifest = parseManifest(
      JSON.stringify({ ...artifact.manifest, name: shortManifestName(artifact.manifest.name || name) }),
    );
    // P3-13: the manifest's declared version must match the versioned row it
    // was served from — integrity of identity, mirroring fetchPinnedHook.
    if (manifest.version !== entry.version) {
      throw new Error(
        `artifact for '${name}@${entry.version}' declares a different version ('${manifest.version}')`,
      );
    }
    // P1-2: script_kind is honored here — a one-line inline manifest is
    // written to script.ts/script.sh, never to a file named after the
    // script content.
    const scriptRel = scriptRelFor(manifest);
    staged.push({
      name,
      version: entry.version,
      sha256: entry.sha256,
      source: entry.source ?? "remote",
      manifest,
      scriptContent: artifact.script,
      scriptRel,
    });
  }
  return staged;
}

/**
 * P1-9 commit phase, ordered so a mid-commit failure cannot leave a partial
 * store that reads as trusted:
 *
 *   Phase A — write ALL hook files and verify their hashes. A failure here
 *             leaves lock and DB untouched; files written without pins are
 *             refused at run time (fail-closed trust), never silently
 *             trusted.
 *   Phase B — write ALL lock pins in ONE atomic write (temp + rename).
 *   Phase C — DB records in one transaction.
 *
 * A failure between A and B leaves the DB untouched and the old pins in
 * place; a failure between B and C leaves old DB records, which take
 * precedence in checkScriptHash and refuse the new bytes until re-sync.
 */
export async function commitSyncArtifacts(
  staged: StagedSyncArtifact[],
  apiUrl: string,
  remoteLock: RemoteLock,
): Promise<void> {
  const db = getDb();

  // Phase A — files first, verified before any pin moves.
  for (const item of staged) {
    const entry = remoteLock.hooks[item.name];
    if (!entry) continue;
    writeCustomHook(item.name, item.manifest, item.scriptContent, item.scriptRel);
    // Pin the VERIFIED digest, never a re-read that could differ: the bytes
    // written are exactly item.scriptContent (already matched entry.sha256),
    // so a post-write re-read that disagrees is tampering — refuse instead
    // of trusting it (security reviewer P1-1).
    const scriptPath = resolveScriptPath(item.name)!;
    const actual = await sha256File(scriptPath);
    if (actual !== entry.sha256) {
      throw new Error(`sha256 mismatch after write for '${item.name}@${entry.version}': lock says ${entry.sha256}, on disk ${actual}`);
    }
  }

  // Phase B — one atomic lock write for every pin.
  const lock = readLock();
  for (const item of staged) {
    const entry = remoteLock.hooks[item.name];
    if (!entry) continue;
    lock.hooks[item.name] = { version: entry.version, sha256: entry.sha256, source: entry.source ?? "remote" };
  }
  writeLock(lock);

  // Phase C — DB records in one transaction.
  db.exec("BEGIN");
  try {
    for (const item of staged) {
      const entry = remoteLock.hooks[item.name];
      if (!entry) continue;
      upsertHookRecord(db, {
        name: item.name,
        version: entry.version,
        sha256: entry.sha256,
        source_type: entry.source ?? "remote",
        source_ref: apiUrl,
        last_verified_at: new Date().toISOString(),
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
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
 * against the remote lock (or the exact-version header for older versions),
 * write it to the custom store, and pin it.
 * Powers `hooks install <name>@<version>` / `hooks update <name>@<version>`
 * (QA-2 finding: pinned-version install/update was unsupported).
 *
 * Requires an api_url (remote registry). P1-4: the exact version named by
 * the user is fetched from the versioned registry — older-than-latest pins
 * are first-class, never rejected as "not the latest".
 */
export async function fetchPinnedHook(
  name: string,
  version: string,
  apiUrl: string,
  apiKey: string,
): Promise<PinnedHookInstall> {
  const remoteLock = (await fetchJson(apiUrl, "/api/v1/lock", apiKey)) as RemoteLock;
  const entry = remoteLock.hooks?.[name];
  if (!entry) {
    throw new Error(`Hook '${name}' is not in the remote registry lock`);
  }
  const isLatest = entry.version === version;
  if (!isLatest && !(entry.versions ?? []).includes(version)) {
    throw new Error(
      `Hook '${name}' version ${version} is not in the remote registry (available: ${[entry.version, ...(entry.versions ?? [])].join(", ")})`,
    );
  }
  const artifact = (await fetchJson(apiUrl, `/api/v1/hooks/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, apiKey, { withHeader: "_headerSha" })) as ArtifactResponse & { _headerSha?: string };
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
  // Latest pins verify against the lock entry (as before). Older pins have
  // no lock entry sha — their authoritative digest is the registry's
  // x-hook-sha256 header, read from the versioned row the artifact was
  // served from. A missing header for an older pin is refused, never
  // guessed.
  let expectedSha = entry.sha256;
  if (!isLatest) {
    const headerSha = artifact._headerSha;
    if (!headerSha) {
      throw new Error(`registry did not return a sha256 header for '${name}@${version}' (older pin); refusing to trust an unverified artifact`);
    }
    expectedSha = headerSha;
  }
  if (actualSha !== expectedSha) {
    throw new Error(
      `sha256 mismatch for '${name}@${version}': expected ${expectedSha}, artifact has ${actualSha}`,
    );
  }
  const manifest = parseManifest(
    JSON.stringify({ ...artifact.manifest, name: shortManifestName(artifact.manifest.name || name) }),
  );
  // P1-2: script_kind is honored here — a one-line inline manifest is
  // written to script.ts/script.sh, never to a file named after the
  // script content (round-2A P1).
  const scriptRel = scriptRelFor(manifest);
  writeCustomHook(name, manifest, artifact.script, scriptRel);
  const scriptPath = resolveScriptPath(name)!;
  const actual = await sha256File(scriptPath);
  if (actual !== expectedSha) {
    throw new Error(
      `sha256 mismatch after write for '${name}@${version}': expected ${expectedSha}, on disk ${actual}`,
    );
  }
  const db = getDb();
  // P2-9: an exact-pin install/update marks the lock entry as an EXPLICIT
  // pin, so a later sync preserves an older pinned version instead of
  // silently bumping it to the latest.
  setPinnedHook(name, { version, sha256: expectedSha, source: entry.source ?? "remote", pinned: true });
  upsertHookRecord(db, {
    name,
    version,
    sha256: expectedSha,
    source_type: entry.source ?? "remote",
    source_ref: apiUrl,
    last_verified_at: new Date().toISOString(),
  });
  return {
    name,
    version,
    sha256: expectedSha,
    source: entry.source ?? "remote",
    source_ref: apiUrl,
    artifact,
    scriptPath,
  };
}
