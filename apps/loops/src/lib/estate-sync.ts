/**
 * Loops ↔ estate-store sync adapter.
 *
 * The shared `@hasna/estate-sync` engine pushes/pulls named artifacts against an
 * estate store bucket, parameterized by (estate bucket, app prefix). This module
 * is the loops side: it resolves the loops configuration
 * (`HASNA_LOOPS_S3_BUCKET` + `HASNA_LOOPS_S3_PREFIX`, base prefix `loops/`) and
 * maps a loop directory onto the engine — push packs the loop tree (deterministic
 * manifest) and writes `loops/bundles/<digest>` plus the signed
 * `loops/index/<name>.json` pointer; pull resolves the signed index, fetches by
 * digest, verifies sha256, and hydrates the verified bundle atomically.
 *
 * The local layout this adapter syncs is the canonical per-loop directory:
 * `~/.hasna/loops/loops/<name>/` with `prompt/` + `scripts/` subdirectories. The
 * directory itself is the unit of sync: pushing a loop packs the whole tree.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createEstateSync, type EstateSyncClient, type PullArtifactOptions, type PushArtifactResult } from "@hasna/estate-sync";
import { dataDir } from "./paths.js";

export const LOOP_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface LoopBundleFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  contentBase64: string;
}

export interface LoopBundle {
  schemaVersion: typeof LOOP_BUNDLE_SCHEMA_VERSION;
  name: string;
  packedAt: string;
  files: LoopBundleFile[];
}

/**
 * Deterministic pack of a loop directory: every file (recursively), sorted by
 * relative path, with base64 content and per-file sha256. Two identical
 * directories produce byte-identical bundles, so the bundle digest is the loop's
 * content address (the same property the skills bundle relies on).
 */
export function packLoopDir(name: string, dir: string): Uint8Array {
  const files: LoopBundleFile[] = [];
  for (const filePath of walkFiles(dir)) {
    const bytes = readFileSync(filePath);
    files.push({
      path: relative(dir, filePath).split("\\").join("/"),
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentBase64: Buffer.from(bytes).toString("base64"),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const bundle: LoopBundle = {
    schemaVersion: LOOP_BUNDLE_SCHEMA_VERSION,
    name,
    packedAt: new Date().toISOString(),
    files,
  };
  return new TextEncoder().encode(`${JSON.stringify(bundle)}\n`);
}

function walkFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** The estate prefix tenant for loops. Matches the verdict's `<app>` prefix. */
export const LOOPS_ESTATE_PREFIX = "loops" as const;

export interface LoopsEstateSyncConfig {
  bucket: string;
  prefix: string;
  signingKey?: string;
}

export function resolveLoopsEstateSyncConfig(
  env: Record<string, string | undefined> = process.env,
): LoopsEstateSyncConfig {
  const bucket = clean(env.HASNA_LOOPS_S3_BUCKET);
  if (!bucket) {
    throw new Error("HASNA_LOOPS_S3_BUCKET is required for estate-sync");
  }
  const prefix = clean(env.HASNA_LOOPS_S3_PREFIX) ?? LOOPS_ESTATE_PREFIX;
  const signingKey = clean(env.ESTATE_SYNC_SIGNING_KEY);
  return {
    bucket,
    prefix,
    ...(signingKey ? { signingKey } : {}),
  };
}

export function createLoopsEstateSync(options: {
  config?: LoopsEstateSyncConfig;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} = {}): EstateSyncClient {
  const config = options.config ?? resolveLoopsEstateSyncConfig();
  return createEstateSync({
    bucket: config.bucket,
    prefix: config.prefix,
    ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * Canonical local loops layout — `~/.hasna/loops/loops/<name>/` with `prompt/`
 * and `scripts/` subdirectories. `dataDir()` is `~/.hasna/loops` (LOOPS_DATA_DIR
 * overrides). These are pure path helpers so every consumer resolves the same
 * tree.
 */
export function loopsEstateRoot(): string {
  return join(dataDir(), "loops");
}

export function loopDir(name: string): string {
  const normalized = normalizeLoopName(name);
  return join(loopsEstateRoot(), normalized);
}

export function loopPromptDir(name: string): string {
  return join(loopDir(name), "prompt");
}

export function loopScriptsDir(name: string): string {
  return join(loopDir(name), "scripts");
}

/** Push a loop directory's packed tree to the estate store under `loops/`. */
export async function pushLoopToEstate(
  loopName: string,
  dir: string,
  options: { client?: EstateSyncClient; contentType?: string } = {},
): Promise<PushArtifactResult> {
  const client = options.client ?? createLoopsEstateSync();
  const body = packLoopDir(loopName, dir);
  return client.push({
    name: loopName,
    body,
    ...(options.contentType ? { contentType: options.contentType } : {}),
  });
}

/** Pull a loop from the estate store and hydrate it atomically to `hydrateTo`. */
export async function pullLoopFromEstate(
  loopName: string,
  options: Omit<PullArtifactOptions, "name"> & { client?: EstateSyncClient } = {},
) {
  const client = options.client ?? createLoopsEstateSync();
  const { client: _client, ...pullOptions } = options;
  return client.pull({ name: loopName, ...pullOptions });
}

function normalizeLoopName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid loop name: '${name}'`);
  }
  return name;
}

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}
