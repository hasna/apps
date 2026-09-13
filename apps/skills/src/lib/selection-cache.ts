/** Immutable, credential-authority/workspace scoped objects. Authoring corpus is never read or written. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { getDataDirReadOnly } from "./config.js";
import { inspectSkillBundle, sha256Hex, SKILL_BUNDLE_INSPECTION_LIMITS, type SkillBundleEntry } from "./skill-bundle.js";
import { isValidSkillVersion } from "./skill-version.js";
import type { ResolvedSkillProfile, ResolvedSkillSelection } from "../types/skill-selection.js";

export class SkillSelectionError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SkillSelectionError"; }
}
export interface SelectionCacheOptions { cacheDir?: string; now?: () => number }
export interface CachedSelectionProfile { schemaVersion: 1; verifiedAt: string; profile: ResolvedSkillProfile }
export interface SkillSessionReceipt extends CachedSelectionProfile { sessionId: string; loaded: string[] }
export const MAX_CACHED_PROFILE_AGE_MS = 24 * 60 * 60 * 1000;
export const SELECTION_LOCK_FILE = "selection.lock.json";
const MAX_RECEIPT_BYTES = 1024 * 1024;

export function selectionCacheRoot(options: SelectionCacheOptions = {}): string {
  return resolve(options.cacheDir ?? join(getDataDirReadOnly(), "selection-cache"));
}
export function selectionKey(selection: ResolvedSkillSelection): string {
  validateSelection(selection);
  return hash([selection.authority, selection.workspaceId, selection.slug, selection.version, selection.bundleDigest]);
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function validateSelection(selection: ResolvedSkillSelection): void {
  if (!selection || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.slug)
      || !isValidSkillVersion(selection.version) || !/^sha256:[a-f0-9]{64}$/.test(selection.bundleDigest)
      || typeof selection.workspaceId !== "string" || !selection.workspaceId.trim()
      || typeof selection.profileRevision !== "string" || !selection.profileRevision.trim()) {
    throw new SkillSelectionError("INVALID_SELECTION", "A skill selection must carry an exact version, digest, workspace and profile revision.");
  }
  try {
    const url = new URL(selection.authority);
    if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)
      || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
  } catch { throw new SkillSelectionError("INVALID_SELECTION", "The skill selection authority is invalid."); }
}
export function validateResolvedProfile(profile: ResolvedSkillProfile, authority?: string): void {
  if (!profile || typeof profile.profileId !== "string" || !profile.profileId.trim() || !Array.isArray(profile.selections)
      || profile.selections.length > 1000 || typeof profile.workspaceId !== "string" || !profile.workspaceId.trim()
      || typeof profile.profileRevision !== "string" || !profile.profileRevision.trim()
      || typeof profile.authority !== "string" || (authority !== undefined && profile.authority !== authority)) {
    throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The resolved profile does not match the configured Skills authority.");
  }
  const slugs = new Set<string>();
  for (const selection of profile.selections) {
    validateSelection(selection);
    if (selection.authority !== profile.authority || selection.workspaceId !== profile.workspaceId
      || selection.profileRevision !== profile.profileRevision || slugs.has(selection.slug)) {
      throw new SkillSelectionError("PROFILE_IDENTITY_MISMATCH", "The resolved profile contains conflicting selection identities.");
    }
    slugs.add(selection.slug);
  }
}
export function selectionBundlePath(selection: ResolvedSkillSelection, options: SelectionCacheOptions = {}): string {
  validateSelection(selection);
  return join(selectionCacheRoot(options), "objects", hash(selection.authority), hash(selection.workspaceId), `${selection.bundleDigest.slice(7)}.tar.gz`);
}

/** Reject symlinks throughout the path, including a user-supplied cache root. */
function assertRegularPath(path: string, createParents = false): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  const segments = absolute.slice(root.length).split("/");
  for (let index = 0; index < segments.length; index++) {
    cursor = join(cursor, segments[index]!);
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
        throw new SkillSelectionError("UNSAFE_CACHE_PATH", "Skills cache paths must not traverse symlinks or non-directories.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (createParents && index < segments.length - 1) mkdirSync(cursor, { mode: 0o700 });
    }
  }
}
function readRegularFile(path: string, limit: number): Uint8Array | null {
  assertRegularPath(path);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new SkillSelectionError("INVALID_CACHE_FILE", "The Skills cache contains an invalid or oversized file.");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
export function writeSelectionJson(path: string, value: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > MAX_RECEIPT_BYTES) throw new SkillSelectionError("RECEIPT_TOO_LARGE", "The Skills selection receipt exceeds its size limit.");
  atomicWrite(path, bytes, 0o600);
}
function atomicWrite(path: string, bytes: Uint8Array, mode: number): void {
  assertRegularPath(path, true);
  const temporary = join(dirname(path), `.selection-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode });
    renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
export function readSelectionJson<T>(path: string): T | null {
  const bytes = readRegularFile(path, MAX_RECEIPT_BYTES);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
  catch { throw new SkillSelectionError("INVALID_RECEIPT", "The Skills selection receipt is unreadable; sync the profile again."); }
}

async function verifiedEntries(selection: ResolvedSkillSelection, bytes: Uint8Array): Promise<SkillBundleEntry[]> {
  if (`sha256:${sha256Hex(bytes)}` !== selection.bundleDigest) throw new SkillSelectionError("BUNDLE_DIGEST_MISMATCH", "The skill bundle does not match its selected digest.");
  const bundle = await inspectSkillBundle(bytes);
  // Executable versions can ship README.md/CLAUDE.md, or only runtime files.
  // Cache validity is archive safety and exact identity; document reads decide
  // which documentation is available without executing the package.
  return bundle.entries;
}
export async function readCachedSelection(selection: ResolvedSkillSelection, options: SelectionCacheOptions = {}): Promise<SkillBundleEntry[] | null> {
  const bytes = readRegularFile(selectionBundlePath(selection, options), SKILL_BUNDLE_INSPECTION_LIMITS.compressedBytes);
  return bytes ? verifiedEntries(selection, bytes) : null;
}
export async function cacheSelectionBundle(selection: ResolvedSkillSelection, response: Response | null, options: SelectionCacheOptions = {}): Promise<SkillBundleEntry[]> {
  validateSelection(selection);
  if (!response?.ok) throw new SkillSelectionError("BUNDLE_UNAVAILABLE", `The selected skill bundle is unavailable${response ? ` (HTTP ${response.status})` : ""}.`);
  const declared = response.headers.get("X-Skill-Bundle-Sha256");
  const version = response.headers.get("X-Skill-Version");
  if ((declared && `sha256:${declared}` !== selection.bundleDigest) || (version && version !== selection.version)) {
    await response.body?.cancel();
    throw new SkillSelectionError("BUNDLE_IDENTITY_MISMATCH", "The returned bundle does not match the selected version and digest.");
  }
  const maximum = SKILL_BUNDLE_INSPECTION_LIMITS.compressedBytes;
  const reader = response.body?.getReader();
  if (!reader) throw new SkillSelectionError("BUNDLE_UNAVAILABLE", "The selected bundle response has no body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) throw new SkillSelectionError("BUNDLE_TOO_LARGE", "The selected bundle exceeds the cache size limit.");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const entries = await verifiedEntries(selection, bytes);
  const path = selectionBundlePath(selection, options);
  const existing = readRegularFile(path, maximum);
  if (existing) await verifiedEntries(selection, existing);
  else atomicWrite(path, bytes, 0o400);
  return entries;
}

function profilePath(profileId: string, options: SelectionCacheOptions): string {
  return join(selectionCacheRoot(options), "profiles", `${hash(profileId)}.json`);
}
export function activateSelectionProfile(profile: ResolvedSkillProfile, options: SelectionCacheOptions = {}): CachedSelectionProfile {
  validateResolvedProfile(profile);
  const receipt: CachedSelectionProfile = { schemaVersion: 1, verifiedAt: new Date((options.now ?? Date.now)()).toISOString(), profile };
  writeSelectionJson(profilePath(profile.profileId, options), receipt);
  return receipt;
}
export function readSelectionProfile(profileId: string, options: SelectionCacheOptions = {}): CachedSelectionProfile | null {
  const receipt = readSelectionJson<CachedSelectionProfile>(profilePath(profileId, options));
  if (receipt) validateSelectionReceipt(receipt);
  return receipt;
}
export function validateSelectionReceipt(receipt: CachedSelectionProfile): void {
  if (!receipt || receipt.schemaVersion !== 1 || !Number.isFinite(Date.parse(receipt.verifiedAt))) throw new SkillSelectionError("INVALID_RECEIPT", "The Skills selection receipt is invalid.");
  validateResolvedProfile(receipt.profile);
}
export function assertFreshCachedProfile(receipt: CachedSelectionProfile, options: SelectionCacheOptions & { maxAgeMs?: number } = {}): void {
  validateSelectionReceipt(receipt);
  const age = (options.now ?? Date.now)() - Date.parse(receipt.verifiedAt);
  const maximum = options.maxAgeMs ?? MAX_CACHED_PROFILE_AGE_MS;
  if (!Number.isFinite(maximum) || maximum <= 0 || maximum > MAX_CACHED_PROFILE_AGE_MS || age < 0 || age > maximum) {
    throw new SkillSelectionError("CACHED_PROFILE_EXPIRED", "The cached Skills profile has expired; authenticate and sync it again.");
  }
}
export function projectSelectionLockPath(projectDir: string): string { return join(resolve(projectDir), ".skills", SELECTION_LOCK_FILE); }
export function readProjectSelection(projectDir: string): CachedSelectionProfile | null {
  const receipt = readSelectionJson<CachedSelectionProfile>(projectSelectionLockPath(projectDir));
  if (receipt) validateSelectionReceipt(receipt);
  return receipt;
}
export function sessionReceiptPath(sessionId: string, options: SelectionCacheOptions = {}): string {
  if (!sessionId.trim() || sessionId.length > 256) throw new SkillSelectionError("INVALID_SESSION", "A Skills session id must contain 1–256 characters.");
  return join(selectionCacheRoot(options), "sessions", `${hash(sessionId)}.json`);
}
export function readSkillSession(sessionId: string, options: SelectionCacheOptions = {}): SkillSessionReceipt | null {
  const receipt = readSelectionJson<SkillSessionReceipt>(sessionReceiptPath(sessionId, options));
  if (receipt) {
    validateSelectionReceipt(receipt);
    if (receipt.sessionId !== sessionId || !Array.isArray(receipt.loaded) || !receipt.loaded.every((key) => /^[a-f0-9]{64}$/.test(key))) {
      throw new SkillSelectionError("INVALID_RECEIPT", "The Skills session receipt is invalid.");
    }
  }
  return receipt;
}
