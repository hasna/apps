import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import type { PortableSkillManifest } from "./portable-skills-types.js";

/**
 * Canonical content hashing for the hasna.skill.v1 portable bundle.
 *
 * The hash covers the normalized skill bundle: skill.json (blank-canonicalized —
 * its own `content_hash` field removed, keys sorted, line endings normalized)
 * plus SKILL.md and every file under src/, scripts/, assets/, and references/,
 * plus AGENTS.md, package.json, and tsconfig.json. Entries are sorted by
 * relative path and hash-stable across platforms (posix separators, LF
 * endings, sorted keys), so two checkouts of the same skill produce the same
 * hash regardless of OS or editor.
 *
 * Excluded, mirroring the port/copy rules: node_modules, .git, dist, build,
 * .turbo, dot-entries, and symlinks (symlinks are validation errors anyway).
 */

export const CONTENT_HASH_ALGORITHM = "sha256";
export const CONTENT_HASH_HEX_LENGTH = 64;

/** Top-level and nested directories that never belong to the hashed bundle. */
const HASH_EXCLUDE_DIRS = new Set([".git", "node_modules", "dist", "build", ".turbo"]);

/** Relative paths (from the skill root) covered by the hash. */
const HASH_COVERAGE = [
  "SKILL.md",
  "skill.json",
  "AGENTS.md",
  "package.json",
  "tsconfig.json",
  "src",
  "scripts",
  "assets",
  "references",
] as const;

/** Normalize CRLF/CR to LF for hash stability across platforms. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Blank-canonicalize a skill.json manifest for hashing: parse it, drop the
 * self-referencing `content_hash` field, and re-serialize with sorted keys so
 * key order and the hash's own presence never change the digest.
 */
export function canonicalizeManifest(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return normalizeLineEndings(raw);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return normalizeLineEndings(raw);
  }
  const record = parsed as Record<string, unknown>;
  delete record.content_hash;
  if (record.provenance && typeof record.provenance === "object" && !Array.isArray(record.provenance)) {
    delete (record.provenance as Record<string, unknown>).content_hash;
  }
  return `${JSON.stringify(sortObjectKeys(record), null, 2)}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeys(item));
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortObjectKeys(record[key]);
    return sorted;
  }
  return value;
}

export interface BundleFile {
  /** Posix relative path from the skill root, e.g. `scripts/setup.sh`. */
  rel: string;
  /** Normalized text content for text files; raw buffer for binary files. */
  content: Uint8Array;
}

/** Whether a path looks like text (no NUL byte) so line-ending normalization is safe. */
function looksLikeText(buffer: Uint8Array): boolean {
  return !buffer.includes(0);
}

/**
 * Collect the normalized bundle files for a skill folder, sorted by relative
 * path. Only the documented coverage set is included.
 */
export function collectBundleFiles(skillPath: string): BundleFile[] {
  const files: BundleFile[] = [];
  const seen = new Set<string>();
  for (const entry of HASH_COVERAGE) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const absolute = join(skillPath, entry);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory()) collectDirectory(files, absolute, entry);
    else collectFile(files, absolute, entry);
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

function collectDirectory(files: BundleFile[], dir: string, rel: string): void {
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".")) continue;
    const absolute = join(dir, entry);
    const childRel = `${rel}/${entry}`;
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(absolute);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      if (HASH_EXCLUDE_DIRS.has(entry)) continue;
      collectDirectory(files, absolute, childRel);
    } else if (stats.isFile()) {
      collectFile(files, absolute, childRel);
    }
  }
}

function collectFile(files: BundleFile[], absolute: string, rel: string): void {
  const buffer = readFileSync(absolute);
  if (rel === "skill.json") {
    files.push({ rel: rel.split(sep).join("/"), content: new TextEncoder().encode(canonicalizeManifest(new TextDecoder().decode(buffer))) });
    return;
  }
  if (looksLikeText(buffer)) {
    const normalized = normalizeLineEndings(new TextDecoder().decode(buffer));
    files.push({ rel: rel.split(sep).join("/"), content: new TextEncoder().encode(normalized) });
    return;
  }
  files.push({ rel: rel.split(sep).join("/"), content: buffer });
}

/**
 * Compute the canonical content hash of a skill folder. Stable across
 * platforms: sorted posix paths, LF line endings, canonicalized manifest.
 */
export function computeContentHash(skillPath: string): string {
  const hash = createHash(CONTENT_HASH_ALGORITHM);
  for (const file of collectBundleFiles(skillPath)) {
    hash.update(new TextEncoder().encode(file.rel));
    hash.update(new TextEncoder().encode(`\0${file.content.length}\0`));
    hash.update(file.content);
    hash.update(new TextEncoder().encode("\0"));
  }
  hash.update(new TextEncoder().encode("\0"));
  return hash.digest("hex");
}

export interface ContentHashVerification {
  /** Whether the skill declares a content_hash at all. */
  declared: boolean;
  /** Whether the declared hash is present, well-formed, and matches the bundle. */
  valid: boolean;
  /** The declared value, if any. */
  declaredHash?: string;
  /** The recomputed hash over the current bundle. */
  computedHash?: string;
}

/**
 * Verify a skill folder's declared content_hash against the recomputed
 * canonical hash of the current bundle. A missing declaration or a mismatch
 * fails; a malformed declaration fails.
 */
export function verifyContentHash(skillPath: string, manifest?: PortableSkillManifest): ContentHashVerification {
  const declaredHash = manifest?.provenance?.content_hash?.trim() || undefined;
  if (!declaredHash) return { declared: false, valid: false };
  if (!/^[a-f0-9]{64}$/.test(declaredHash)) {
    return { declared: true, valid: false, declaredHash };
  }
  const computedHash = computeContentHash(skillPath);
  return {
    declared: true,
    valid: computedHash === declaredHash,
    declaredHash,
    computedHash,
  };
}

/** Path sanity helper used by the contract validator: the skill folder exists. */
export function skillFolderExists(skillPath: string): boolean {
  try {
    return existsSync(skillPath) && statSync(skillPath).isDirectory();
  } catch {
    return false;
  }
}
