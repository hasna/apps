import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Resolve the local artifact store root directory adjacent to the todos database. */
export function getArtifactStoreRoot(dbPath?: string): string {
  const path = dbPath || process.env["TODOS_DB_PATH"] || process.env["HASNA_TODOS_DB_PATH"] || "";
  if (path === ":memory:" || path.startsWith("file::memory:")) {
    const tmp = join(process.env["TMPDIR"] || "/tmp", "todos-artifacts", String(process.pid));
    mkdirSync(tmp, { recursive: true });
    return tmp;
  }
  if (path) {
    return join(dirname(resolve(path)), "artifacts");
  }
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".hasna", "todos", "artifacts");
}

export function computeContentHash(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function detectMimeType(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    html: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    zip: "application/zip",
    gz: "application/gzip",
  };
  return ext ? map[ext] ?? "application/octet-stream" : null;
}

export function ensureArtifactDir(root: string, artifactId: string): string {
  const dir = join(root, artifactId.slice(0, 2), artifactId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface StoreArtifactFileInput {
  artifactId: string;
  sourcePath: string;
  storageMode: "reference" | "copy";
  name?: string;
  dbPath?: string;
}

export interface StoredArtifactFile {
  localPath: string;
  contentHash: string;
  mimeType: string | null;
  sizeBytes: number;
  sourcePath: string | null;
}

/** Store a file locally — never uploads to remote services. */
export function storeArtifactFile(input: StoreArtifactFileInput): StoredArtifactFile {
  const resolved = resolve(input.sourcePath);
  if (!existsSync(resolved)) {
    throw new Error(`Source file not found: ${input.sourcePath}`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Source is not a file: ${input.sourcePath}`);
  }

  const root = getArtifactStoreRoot(input.dbPath);
  const contentHash = computeContentHash(resolved);
  const mimeType = detectMimeType(resolved);
  const sizeBytes = stat.size;

  if (input.storageMode === "reference") {
    return {
      localPath: resolved,
      contentHash,
      mimeType,
      sizeBytes,
      sourcePath: resolved,
    };
  }

  const dir = ensureArtifactDir(root, input.artifactId);
  const fileName = input.name || basename(resolved);
  const dest = join(dir, fileName);
  copyFileSync(resolved, dest);

  return {
    localPath: dest,
    contentHash,
    mimeType,
    sizeBytes,
    sourcePath: resolved,
  };
}

export function deleteStoredArtifactFile(localPath: string, storageMode: "reference" | "copy", dbPath?: string): void {
  if (storageMode === "reference") return;
  const root = getArtifactStoreRoot(dbPath);
  if (!localPath.startsWith(root)) return;
  if (existsSync(localPath)) {
    unlinkSync(localPath);
  }
}

export interface ArtifactExportEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  storage_mode: string;
  source_path: string | null;
  local_path: string;
  content_hash: string;
  mime_type: string | null;
  size_bytes: number;
  redaction_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ArtifactExportManifest {
  schema_version: "todos.artifacts.v1";
  exported_at: string;
  store_root: string;
  artifacts: ArtifactExportEntry[];
}

export function buildArtifactExportManifest(
  artifacts: ArtifactExportEntry[],
  dbPath?: string,
): ArtifactExportManifest {
  return {
    schema_version: "todos.artifacts.v1",
    exported_at: new Date().toISOString(),
    store_root: getArtifactStoreRoot(dbPath),
    artifacts,
  };
}

export function writeArtifactExportManifest(manifest: ArtifactExportManifest, destPath: string): void {
  mkdirSync(dirname(resolve(destPath)), { recursive: true });
  writeFileSync(destPath, JSON.stringify(manifest, null, 2));
}

export interface CleanupPolicy {
  /** Delete soft-deleted artifacts older than this many days. Default: 30 */
  deleted_retention_days?: number;
  now?: Date;
}

export function isArtifactExpired(deletedAt: string | null, policy: CleanupPolicy = {}): boolean {
  if (!deletedAt) return false;
  const days = policy.deleted_retention_days ?? 30;
  const cutoff = (policy.now ?? new Date()).getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(deletedAt).getTime() < cutoff;
}
