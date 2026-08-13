import { createWriteStream, lstatSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { resolveHuggingFaceToken } from "./auth.js";
import { encodeRepoId, parseProviderRef, safePathSegment } from "./ref.js";
import { getInstallRoot } from "./paths.js";
import type { CatalogEntry, DownloadPlan, EntityKind, RemoteFileEntry, SearchInput, ProviderRef } from "./types.js";

const HF_ENDPOINT = process.env["HF_ENDPOINT"] || "https://huggingface.co";

class HuggingFaceApiError extends Error {
  readonly status: number;

  constructor(response: Response, body: string) {
    super(`Hugging Face request failed ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    this.name = "HuggingFaceApiError";
    this.status = response.status;
  }
}

function apiBase(): string {
  return HF_ENDPOINT.replace(/\/+$/, "");
}

function headers(): HeadersInit {
  const { token } = resolveHuggingFaceToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function hfJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HuggingFaceApiError(response, text);
  }
  return response.json() as Promise<T>;
}

function apiKind(kind: EntityKind): "models" | "datasets" | "spaces" {
  if (kind === "dataset") return "datasets";
  if (kind === "space") return "spaces";
  return "models";
}

function canonicalUrl(kind: EntityKind, repoId: string): string {
  const base = apiBase();
  if (kind === "dataset") return `${base}/datasets/${repoId}`;
  if (kind === "space") return `${base}/spaces/${repoId}`;
  return `${base}/${repoId}`;
}

function extractLicense(tags: string[], cardData: unknown): string | null {
  const licenseTag = tags.find((tag) => tag.startsWith("license:"));
  if (licenseTag) return licenseTag.slice("license:".length);
  if (cardData && typeof cardData === "object" && "license" in cardData) {
    const raw = (cardData as { license?: unknown }).license;
    if (Array.isArray(raw)) return raw.map(String).join(",");
    if (typeof raw === "string") return raw;
  }
  return null;
}

function detectFormat(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".gguf")) return "gguf";
  if (lower.endsWith(".safetensors")) return "safetensors";
  if (lower.endsWith(".bin")) return "pytorch-bin";
  if (lower.endsWith(".onnx")) return "onnx";
  if (lower.endsWith(".h5")) return "tensorflow";
  if (lower.endsWith(".msgpack")) return "flax";
  if (lower.endsWith(".parquet")) return "parquet";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".arrow")) return "arrow";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  return null;
}

function safeDestinationPath(root: string, filePath: string): string {
  if (filePath.includes("\0")) throw new Error(`Unsafe remote file path: ${filePath}`);
  if (filePath.includes("\\")) throw new Error(`Unsafe remote file path: ${filePath}`);
  if (isAbsolute(filePath)) throw new Error(`Unsafe remote file path: ${filePath}`);
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) throw new Error(`Unsafe remote file path: ${filePath}`);
  const segments = filePath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error(`Unsafe remote file path: ${filePath}`);
  }
  const resolvedRoot = resolve(root);
  const destination = resolve(resolvedRoot, ...segments);
  if (destination === resolvedRoot) {
    throw new Error(`Unsafe remote file path: ${filePath}`);
  }
  if (!destination.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Remote file path escapes install root: ${filePath}`);
  }
  return destination;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function assertSafeExistingParentPath(root: string, filePath: string): void {
  const segments = filePath.split("/");
  let current = resolve(root);
  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment);
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Remote file path traverses symlink inside install root: ${filePath}`);
      }
      if (!stats.isDirectory()) {
        throw new Error(`Remote file path parent is not a directory: ${filePath}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }
}

function assertSafeInstallRoot(root: string): void {
  const resolvedRoot = resolve(root);
  const parsed = parse(resolvedRoot);
  let current = parsed.root;
  for (const segment of resolvedRoot.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        if (current === resolvedRoot) {
          throw new Error(`Install root cannot be a symlink: ${root}`);
        }
        throw new Error(`Install root cannot contain symlink components: ${root}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }
}

function validateDestinationPaths(root: string, files: RemoteFileEntry[]): string[] {
  assertSafeInstallRoot(root);
  const destinations: string[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const destination = safeDestinationPath(root, file.path);
    assertSafeExistingParentPath(root, file.path);
    const previousPath = seen.get(destination);
    if (previousPath) {
      throw new Error(`Remote file paths resolve to the same destination: ${previousPath}, ${file.path}`);
    }
    seen.set(destination, file.path);
    destinations.push(destination);
  }
  return destinations;
}

function normalizeEntry(raw: Record<string, unknown>, kind: EntityKind, fallbackRevision = "main"): CatalogEntry {
  const repoId = String(raw.id ?? raw.modelId ?? "");
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
  const cardData = raw.cardData;
  return {
    provider: "huggingface",
    entityKind: kind,
    repoId,
    revision: String(raw.sha ?? fallbackRevision),
    canonicalUrl: canonicalUrl(kind, repoId),
    title: repoId,
    author: typeof raw.author === "string" ? raw.author : repoId.split("/")[0],
    task: typeof raw.pipeline_tag === "string" ? raw.pipeline_tag : null,
    libraryName: typeof raw.library_name === "string" ? raw.library_name : null,
    license: extractLicense(tags, cardData),
    gated: Boolean(raw.gated),
    private: Boolean(raw.private),
    downloads: typeof raw.downloads === "number" ? raw.downloads : null,
    likes: typeof raw.likes === "number" ? raw.likes : null,
    tags,
    lastModified: typeof raw.lastModified === "string" ? raw.lastModified : null,
    metadata: raw,
  };
}

function normalizeTreeFile(raw: Record<string, unknown>, ref: ProviderRef): RemoteFileEntry | null {
  if (raw.type && raw.type !== "file") return null;
  const path = String(raw.path ?? raw.rfilename ?? "");
  if (!path) return null;
  const lfs = raw.lfs && typeof raw.lfs === "object" ? raw.lfs as Record<string, unknown> : {};
  const size = typeof raw.size === "number"
    ? raw.size
    : typeof lfs.size === "number"
      ? lfs.size
      : null;
  return {
    provider: "huggingface",
    entityKind: ref.entityKind,
    repoId: ref.repoId,
    revision: ref.revision,
    path,
    size,
    oid: typeof raw.oid === "string" ? raw.oid : null,
    lfsOid: typeof lfs.oid === "string" ? lfs.oid : null,
    format: detectFormat(path),
    downloadUrl: fileDownloadUrl(ref, path),
    metadata: raw,
  };
}

function normalizeSibling(raw: Record<string, unknown>, ref: ProviderRef): RemoteFileEntry | null {
  const path = String(raw.rfilename ?? raw.path ?? "");
  if (!path) return null;
  return {
    provider: "huggingface",
    entityKind: ref.entityKind,
    repoId: ref.repoId,
    revision: ref.revision,
    path,
    size: typeof raw.size === "number" ? raw.size : null,
    oid: typeof raw.oid === "string" ? raw.oid : null,
    lfsOid: null,
    format: detectFormat(path),
    downloadUrl: fileDownloadUrl(ref, path),
    metadata: raw,
  };
}

export function fileDownloadUrl(ref: ProviderRef, path: string): string {
  const encodedRepo = encodeRepoId(ref.repoId);
  const encodedRevision = encodeURIComponent(ref.revision || "main");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const prefix = ref.entityKind === "dataset" ? "datasets/" : ref.entityKind === "space" ? "spaces/" : "";
  return `${apiBase()}/${prefix}${encodedRepo}/resolve/${encodedRevision}/${encodedPath}`;
}

export async function searchHuggingFace(input: SearchInput = {}): Promise<CatalogEntry[]> {
  const kind = input.entityKind ?? "model";
  const params = new URLSearchParams();
  if (input.query) params.set("search", input.query);
  params.set("limit", String(input.limit ?? 20));
  params.set("full", "1");
  params.set("sort", input.sort ?? "downloads");
  params.set("direction", input.direction === "asc" ? "1" : "-1");
  if (input.task) params.append("filter", input.task);
  if (input.license) params.append("filter", `license:${input.license}`);
  for (const tag of input.tags ?? []) params.append("filter", tag);

  const raw = await hfJson<Record<string, unknown>[]>(`/api/${apiKind(kind)}?${params.toString()}`);
  return raw.map((entry) => normalizeEntry(entry, kind)).filter((entry) => Boolean(entry.repoId));
}

export async function getHuggingFaceInfo(refOrInput: ProviderRef | string, defaultKind: EntityKind = "model"): Promise<CatalogEntry> {
  const ref = typeof refOrInput === "string" ? parseProviderRef(refOrInput, defaultKind) : refOrInput;
  const revision = ref.revision || "main";
  const raw = await hfJson<Record<string, unknown>>(
    `/api/${apiKind(ref.entityKind)}/${encodeRepoId(ref.repoId)}/revision/${encodeURIComponent(revision)}`,
  );
  return normalizeEntry(raw, ref.entityKind, revision);
}

export async function listHuggingFaceFiles(refOrInput: ProviderRef | string, defaultKind: EntityKind = "model"): Promise<RemoteFileEntry[]> {
  const ref = typeof refOrInput === "string" ? parseProviderRef(refOrInput, defaultKind) : refOrInput;
  const revision = ref.revision || "main";
  const treePath = `/api/${apiKind(ref.entityKind)}/${encodeRepoId(ref.repoId)}/tree/${encodeURIComponent(revision)}?recursive=1&expand=1`;
  try {
    const raw = await hfJson<Record<string, unknown>[]>(treePath);
    return raw.map((entry) => normalizeTreeFile(entry, ref)).filter((entry): entry is RemoteFileEntry => Boolean(entry));
  } catch (error) {
    if (!(error instanceof HuggingFaceApiError) || error.status !== 404) throw error;
    const info = await hfJson<Record<string, unknown>>(
      `/api/${apiKind(ref.entityKind)}/${encodeRepoId(ref.repoId)}/revision/${encodeURIComponent(revision)}`,
    );
    const siblings = Array.isArray(info.siblings) ? info.siblings as Record<string, unknown>[] : [];
    return siblings.map((entry) => normalizeSibling(entry, ref)).filter((entry): entry is RemoteFileEntry => Boolean(entry));
  }
}

export function matchesFilePattern(path: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (!normalized) return false;
  if (normalized === path) return true;
  if (normalized.endsWith("/")) return path.startsWith(normalized);
  if (normalized.includes("*")) {
    const regex = new RegExp(`^${normalized.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return regex.test(path);
  }
  if (!normalized.includes("/")) {
    return path.split("/").pop() === normalized;
  }
  return false;
}

function matchAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => matchesFilePattern(path, pattern));
}

export async function createDownloadPlan(input: {
  ref: ProviderRef;
  include?: string[];
  exclude?: string[];
  maxBytes?: number | null;
  destinationRoot?: string;
}): Promise<DownloadPlan> {
  const include = input.include ?? [];
  const exclude = input.exclude ?? [];
  const files = (await listHuggingFaceFiles(input.ref))
    .filter((file) => include.length === 0 || matchAny(file.path, include))
    .filter((file) => exclude.length === 0 || !matchAny(file.path, exclude));
  const destinationRoot = input.destinationRoot ?? join(
    getInstallRoot(),
    input.ref.provider,
    input.ref.entityKind,
    safePathSegment(input.ref.repoId),
    safePathSegment(input.ref.revision),
  );
  validateDestinationPaths(destinationRoot, files);
  const knownBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const unknownSizeFiles = files.filter((file) => file.size == null).map((file) => file.path);
  const totalBytes = unknownSizeFiles.length > 0 ? null : knownBytes;
  const maxBytes = input.maxBytes ?? null;
  return {
    ref: input.ref,
    files,
    totalBytes,
    unknownSizeFiles,
    destinationRoot,
    exceedsMaxBytes: maxBytes != null && totalBytes != null && totalBytes > maxBytes,
    maxBytes,
  };
}

export async function downloadPlannedFiles(plan: DownloadPlan): Promise<Array<{ path: string; bytes: number; destination: string }>> {
  if (plan.exceedsMaxBytes) {
    throw new Error(`Download plan exceeds max bytes: ${plan.totalBytes} > ${plan.maxBytes}`);
  }
  if (plan.maxBytes != null && plan.unknownSizeFiles.length > 0) {
    throw new Error(`Download plan has unknown-size files under a byte cap: ${plan.unknownSizeFiles.join(", ")}`);
  }
  const destinations = validateDestinationPaths(plan.destinationRoot, plan.files);
  const downloaded: Array<{ path: string; bytes: number; destination: string }> = [];
  for (const [index, file] of plan.files.entries()) {
    const destination = destinations[index];
    const tempDestination = `${destination}.partial-${randomUUID()}`;
    const response = await fetch(fileDownloadUrl(plan.ref, file.path), { headers: headers(), redirect: "follow" });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to download ${file.path}: ${response.status} ${response.statusText} ${text.slice(0, 200)}`);
    }
    assertSafeInstallRoot(plan.destinationRoot);
    assertSafeExistingParentPath(plan.destinationRoot, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    assertSafeInstallRoot(plan.destinationRoot);
    assertSafeExistingParentPath(plan.destinationRoot, file.path);
    try {
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tempDestination));
      const bytes = statSync(tempDestination).size;
      if (file.size != null && bytes !== file.size) {
        throw new Error(`Downloaded size mismatch for ${file.path}: expected ${file.size} bytes, got ${bytes}`);
      }
      renameSync(tempDestination, destination);
      downloaded.push({ path: file.path, bytes, destination });
    } catch (error) {
      try {
        unlinkSync(tempDestination);
      } catch {
        // Ignore cleanup errors; the primary failure is what matters.
      }
      throw error;
    }
  }
  return downloaded;
}
