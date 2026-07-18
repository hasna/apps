import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";

export const RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;
export const RELEASE_ARTIFACT_ROOTS = ["dist", "dashboard/dist"] as const;
export const RELEASE_ARTIFACT_EXCLUSIONS = ["dist/release-provenance.json"] as const;

export type ReleaseArtifactManifestEntry = {
  path: string;
  type: "file" | "symlink";
  size: number;
  sha256: string;
};

export type ReleaseArtifactManifest = {
  schemaVersion: 1;
  algorithm: "sha256";
  roots: string[];
  excluded: string[];
  files: ReleaseArtifactManifestEntry[];
  manifestSha256: string;
};

export type ReleaseArtifactManifestFailure = {
  check: string;
  message: string;
};

type ManifestBody = Omit<ReleaseArtifactManifest, "manifestSha256">;

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPortablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join(posix.sep);
}

function hashBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestBody(manifest: ReleaseArtifactManifest): ManifestBody {
  return {
    schemaVersion: manifest.schemaVersion,
    algorithm: manifest.algorithm,
    roots: manifest.roots,
    excluded: manifest.excluded,
    files: manifest.files,
  };
}

export function computeReleaseArtifactManifestSha256(body: ManifestBody): string {
  return hashBytes(`${JSON.stringify(body)}\n`);
}

function collectArtifactEntries(
  repositoryRoot: string,
  currentPath: string,
  exclusions: ReadonlySet<string>,
  entries: ReleaseArtifactManifestEntry[],
): void {
  const stats = lstatSync(currentPath);
  const portablePath = toPortablePath(repositoryRoot, currentPath);
  if (exclusions.has(portablePath)) return;
  if (stats.isDirectory()) {
    for (const child of readdirSync(currentPath).sort(comparePaths)) {
      collectArtifactEntries(repositoryRoot, join(currentPath, child), exclusions, entries);
    }
    return;
  }
  if (stats.isSymbolicLink()) {
    const target = Buffer.from(readlinkSync(currentPath), "utf8");
    entries.push({ path: portablePath, type: "symlink", size: target.length, sha256: hashBytes(target) });
    return;
  }
  if (!stats.isFile()) throw new Error(`release artifact is not a regular file or symlink: ${portablePath}`);
  const content = readFileSync(currentPath);
  entries.push({ path: portablePath, type: "file", size: content.length, sha256: hashBytes(content) });
}

export function createReleaseArtifactManifest(repositoryRoot: string): ReleaseArtifactManifest {
  const root = resolve(repositoryRoot);
  const roots = [...RELEASE_ARTIFACT_ROOTS];
  const excluded = [...RELEASE_ARTIFACT_EXCLUSIONS];
  const entries: ReleaseArtifactManifestEntry[] = [];
  const exclusions = new Set(excluded);
  for (const artifactRoot of roots) {
    const absolute = join(root, artifactRoot);
    const stats = lstatSync(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`release artifact root must be a directory: ${artifactRoot}`);
    }
    collectArtifactEntries(root, absolute, exclusions, entries);
  }
  entries.sort((left, right) => comparePaths(left.path, right.path));
  const body: ManifestBody = {
    schemaVersion: RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    algorithm: "sha256",
    roots,
    excluded,
    files: entries,
  };
  return { ...body, manifestSha256: computeReleaseArtifactManifestSha256(body) };
}

function validateManifestShape(value: unknown): ReleaseArtifactManifestFailure[] {
  const failures: ReleaseArtifactManifestFailure[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ check: "provenance-artifact-manifest", message: "release provenance must include an artifact manifest" }];
  }
  const manifest = value as Partial<ReleaseArtifactManifest>;
  if (manifest.schemaVersion !== RELEASE_ARTIFACT_MANIFEST_SCHEMA_VERSION || manifest.algorithm !== "sha256") {
    failures.push({
      check: "provenance-artifact-manifest",
      message: "release artifact manifest must use schema version 1 and sha256",
    });
  }
  if (JSON.stringify(manifest.roots) !== JSON.stringify(RELEASE_ARTIFACT_ROOTS) ||
      JSON.stringify(manifest.excluded) !== JSON.stringify(RELEASE_ARTIFACT_EXCLUSIONS)) {
    failures.push({
      check: "provenance-artifact-scope",
      message: "release artifact manifest must cover dist and dashboard/dist while excluding only its provenance file",
    });
  }
  if (!Array.isArray(manifest.files)) {
    failures.push({ check: "provenance-artifact-manifest", message: "release artifact manifest files must be an array" });
    return failures;
  }
  const seen = new Set<string>();
  let previous = "";
  for (const entry of manifest.files) {
    const valid = entry && typeof entry === "object" &&
      typeof entry.path === "string" &&
      (entry.type === "file" || entry.type === "symlink") &&
      Number.isSafeInteger(entry.size) && entry.size >= 0 &&
      typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256);
    if (!valid) {
      failures.push({ check: "provenance-artifact-entry", message: "release artifact manifest contains an invalid file entry" });
      continue;
    }
    const inScope = RELEASE_ARTIFACT_ROOTS.some((artifactRoot) => (
      entry.path.startsWith(`${artifactRoot}/`) && !entry.path.includes("/../") && !entry.path.startsWith("/")
    ));
    if (!inScope || RELEASE_ARTIFACT_EXCLUSIONS.includes(entry.path as (typeof RELEASE_ARTIFACT_EXCLUSIONS)[number])) {
      failures.push({ check: "provenance-artifact-entry", message: `release artifact path is outside the bound scope: ${entry.path}` });
    }
    if (seen.has(entry.path) || (previous && comparePaths(previous, entry.path) >= 0)) {
      failures.push({ check: "provenance-artifact-order", message: "release artifact manifest paths must be unique and byte-sorted" });
    }
    seen.add(entry.path);
    previous = entry.path;
  }
  if (typeof manifest.manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.manifestSha256)) {
    failures.push({ check: "provenance-artifact-manifest-hash", message: "release artifact manifest must include a SHA-256 digest" });
  } else if (failures.length === 0 && manifest.manifestSha256 !== computeReleaseArtifactManifestSha256(
    manifestBody(manifest as ReleaseArtifactManifest),
  )) {
    failures.push({ check: "provenance-artifact-manifest-hash", message: "release artifact manifest digest does not match its entries" });
  }
  return failures;
}

export function validateReleaseArtifactManifestMetadata(value: unknown): ReleaseArtifactManifestFailure[] {
  return validateManifestShape(value);
}

export function validateReleaseArtifactManifest(
  repositoryRoot: string,
  recorded: unknown,
): ReleaseArtifactManifestFailure[] {
  const failures = validateManifestShape(recorded);
  if (failures.length > 0) return failures;
  let actual: ReleaseArtifactManifest;
  try {
    actual = createReleaseArtifactManifest(repositoryRoot);
  } catch (error) {
    return [{
      check: "provenance-artifact-read",
      message: error instanceof Error ? error.message : String(error),
    }];
  }
  const expected = recorded as ReleaseArtifactManifest;
  const actualByPath = new Map(actual.files.map((entry) => [entry.path, entry]));
  const expectedByPath = new Map(expected.files.map((entry) => [entry.path, entry]));
  for (const entry of expected.files) {
    const found = actualByPath.get(entry.path);
    if (!found) {
      failures.push({ check: "provenance-artifact-missing", message: `release artifact is missing: ${entry.path}` });
      continue;
    }
    if (found.type !== entry.type || found.size !== entry.size || found.sha256 !== entry.sha256) {
      failures.push({ check: "provenance-artifact-integrity", message: `release artifact bytes differ from provenance: ${entry.path}` });
    }
  }
  for (const entry of actual.files) {
    if (!expectedByPath.has(entry.path)) {
      failures.push({ check: "provenance-artifact-unbound", message: `release artifact is not bound by provenance: ${entry.path}` });
    }
  }
  if (actual.manifestSha256 !== expected.manifestSha256) {
    failures.push({ check: "provenance-artifact-manifest-match", message: "release artifact manifest does not match the current published artifacts" });
  }
  return failures;
}
