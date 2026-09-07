/**
 * Shared hosted-transport content helpers for the CLI and MCP surface.
 *
 * On the hosted transport the files service owns object storage and ingestion,
 * so every byte-level operation (cat, open, where, resolve, extraction
 * snapshots, context packs) must go through the ApiStore's signed/content
 * routes rather than the on-box store. These helpers keep the CLI and the MCP
 * server from drifting on those paths: one spelling of "download the bytes",
 * "where is this file", and "what is its storage location" per surface layer.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiStore } from "../store/index.js";
import { openSecureOutput } from "./secure-output.js";
import type { FileWithTags } from "../types/index.js";

/** Default expiry for hosted location URLs minted by `where` / `resolve`. */
export const HOSTED_LOCATION_URL_EXPIRES_IN = 3600;

/** Collect a hosted file's bytes (honoring the server's truncation signal). */
export async function collectHostedBytes(
  api: ApiStore,
  fileId: string,
  maxBytes?: number,
): Promise<{ chunks: Uint8Array[]; truncated: boolean; totalBytes?: number }> {
  const chunks: Uint8Array[] = [];
  const result = await api.downloadFileContent(
    fileId,
    (chunk) => { chunks.push(chunk); },
    maxBytes !== undefined ? { max_bytes: maxBytes } : undefined,
  );
  return { chunks, truncated: result.truncated, totalBytes: result.totalBytes };
}

/**
 * Where a hosted file currently lives, in terms a caller can use: the
 * server-signed object-store URL with the configured expiry.
 */
export async function hostedWhereUrl(api: ApiStore, fileId: string): Promise<string> {
  return api.signFileDownload(fileId, HOSTED_LOCATION_URL_EXPIRES_IN);
}

/** The hosted storage-location summary `files resolve` / `resolve_file_storage` print. */
export interface HostedStorageResolve {
  file_id: string;
  name: string;
  kind: "s3";
  provider: "hosted-service";
  url: string;
  expires_in: number;
  path?: string;
  mime?: string;
  size?: number;
}

export async function hostedStorageResolve(api: ApiStore, file: FileWithTags): Promise<HostedStorageResolve> {
  const url = await hostedWhereUrl(api, file.id);
  return {
    file_id: file.id,
    name: file.name,
    kind: "s3",
    provider: "hosted-service",
    url,
    expires_in: HOSTED_LOCATION_URL_EXPIRES_IN,
    path: file.path,
    mime: file.mime,
    size: file.size,
  };
}

/**
 * Download a hosted file's bytes into a new owner-only temp file and return
 * its path (used by `files open` on the hosted transport, where the client has
 * no local copy to open in the default application).
 */
export async function hostedFileToTemp(api: ApiStore, file: FileWithTags): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "files-open-"));
  const safeName = file.name.replace(/[/\\]/g, "_").slice(0, 120) || "file";
  const target = join(dir, safeName);
  const output = openSecureOutput(target);
  try {
    await api.downloadFileContent(file.id, (chunk) => output.write(chunk));
    output.commit();
  } catch (error) {
    output.abort();
    throw error;
  }
  return target;
}