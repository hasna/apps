/**
 * Files integration — evidence artifacts for slug runs.
 *
 * Two exact package-owned surfaces, per the monitor-v2 design:
 *
 * - upload: the `files evidence upload <path>` CLI (creates an upload intent,
 *   uploads the local file, completes verification, and returns a redacted
 *   receipt carrying the asset id);
 * - retrieval: `FilesClient.signEvidenceDownload` from `@hasna/files/sdk`.
 *
 * Upload failure is non-fatal unless the caller marks the artifact required —
 * this module returns a typed result so the caller decides. No file capability,
 * credential value, or raw receipt is ever stored in logs. Missing evidence
 * (a 404 from the Files service) is a typed `missing_evidence` result, never
 * an exception.
 *
 * Credential resolution stays package-owned: the SDK client is constructed
 * from the `@hasna/files` client environment (`FILES_API_URL`, `FILES_API_KEY`)
 * when no client is injected.
 */

import { readFileSync } from "node:fs";
import { FilesClient, ApiError } from "@hasna/files/sdk";
import { captureCommandOutput, removeCaptureSpool } from "../output-capture.js";
import { redactOutputText } from "../output-evidence.js";

export interface FilesEvidenceConfig {
  org: string;
  app: string;
  /** Evidence kind, e.g. "receipt" — required by the files CLI contract (`--kind` is a requiredOption). */
  kind: string;
  /** Override the `files` binary path (tests inject a stub). */
  binary?: string;
  /** Storage provider passthrough: "s3" | "local". Omitted = package default. */
  storage?: "s3" | "local";
  /** Local evidence root (only meaningful with storage "local"). */
  localRoot?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface UploadEvidenceOptions {
  /** Artifact file path to upload. */
  path: string;
  config: FilesEvidenceConfig;
}

export type UploadArtifactResult =
  | { ok: true; assetId: string; intentId: string; replayed: boolean }
  | { ok: false; code: "upload_failed"; message: string; exitCode: number | null };

export interface SignEvidenceOptions {
  client?: FilesClient;
  env?: NodeJS.ProcessEnv;
  purpose?: string;
  expiresInSeconds?: number;
}

export type SignDownloadResult =
  | { ok: true; assetId: string; url: string; expiresAt: string }
  | { ok: false; code: "missing_evidence" | "sign_failed" | "not_configured"; message: string };

interface EvidenceUploadReceipt {
  asset?: { id?: unknown };
  intent?: { id?: unknown };
  replayed?: unknown;
}

const UPLOAD_RECEIPT_MAX_BYTES = 1024 * 1024;
const UPLOAD_STDERR_MAX_BYTES = 64 * 1024;

/**
 * Upload an artifact through `files evidence upload <path>`.
 *
 * The invocation is structured argv — no shell strings, no interpolation. The
 * CLI's own receipt is already credential-redacted (`redactEvidenceUploadCredentials`),
 * and this module additionally never renders the receipt beyond the asset and
 * intent ids.
 */
export async function uploadEvidenceArtifact(
  path: string,
  config: FilesEvidenceConfig
): Promise<UploadArtifactResult> {
  const args = [
    "evidence",
    "upload",
    path,
    "--org",
    config.org,
    "--app",
    config.app,
    "--kind",
    config.kind,
    ...(config.storage ? ["--storage", config.storage] : []),
    ...(config.localRoot ? ["--local-root", config.localRoot] : []),
    "--json",
  ];

  const result = await captureCommandOutput(config.binary ?? "files", args, {
    env: config.env,
    timeoutMs: config.timeoutMs ?? 120_000,
    maxStdoutBytes: UPLOAD_RECEIPT_MAX_BYTES,
    maxStderrBytes: UPLOAD_STDERR_MAX_BYTES,
  });

  try {
    if (result.exitCode !== 0) {
      // The failure message is redacted before it can flow into logs or
      // receipts: a failed upload whose stderr carries a credential or a
      // signed URL must never preserve that value verbatim.
      const stderrExcerpt = redactText(readSpoolExcerpt(result.stderr.path));
      const errorText = result.error ? redactText(result.error) : "";
      return {
        ok: false,
        code: "upload_failed",
        message: stderrExcerpt || errorText || `files evidence upload exited ${result.exitCode}`,
        exitCode: result.exitCode,
      };
    }

    let receipt: EvidenceUploadReceipt;
    try {
      receipt = JSON.parse(readFileSync(result.stdout.path, "utf8")) as EvidenceUploadReceipt;
    } catch {
      return {
        ok: false,
        code: "upload_failed",
        message: "files evidence upload returned an unparseable receipt",
        exitCode: result.exitCode,
      };
    }

    const assetId = typeof receipt.asset?.id === "string" ? receipt.asset.id : undefined;
    const intentId = typeof receipt.intent?.id === "string" ? receipt.intent.id : undefined;
    if (!assetId || !intentId) {
      return {
        ok: false,
        code: "upload_failed",
        message: "files evidence upload receipt is missing the asset or intent id",
        exitCode: result.exitCode,
      };
    }

    return { ok: true, assetId, intentId, replayed: receipt.replayed === true };
  } finally {
    removeCaptureSpool(result);
  }
}

/**
 * Retrieve a bounded download grant through `FilesClient.signEvidenceDownload`.
 *
 * A 404 from the Files service is a typed `missing_evidence` result; a missing
 * client configuration is a typed `not_configured` result. Neither throws.
 */
export async function signEvidenceDownload(
  assetId: string,
  options: SignEvidenceOptions = {}
): Promise<SignDownloadResult> {
  const client = options.client ?? createFilesClient(options.env);
  if (!client) {
    return {
      ok: false,
      code: "not_configured",
      message: "FilesClient is not configured: set FILES_API_URL and FILES_API_KEY",
    };
  }

  try {
    const grant = await client.signEvidenceDownload(assetId, {
      purpose: options.purpose,
      ...(options.expiresInSeconds !== undefined
        ? { expires_in_seconds: options.expiresInSeconds }
        : {}),
    });
    return { ok: true, assetId, url: grant.url, expiresAt: grant.expires_at };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return {
        ok: false,
        code: "missing_evidence",
        message: `File asset not found: ${assetId}`,
      };
    }
    return {
      ok: false,
      code: "sign_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function createFilesClient(env?: NodeJS.ProcessEnv): FilesClient | null {
  const source = env ?? process.env;
  const baseUrl = source.FILES_API_URL;
  const apiKey = source.FILES_API_KEY;
  if (!baseUrl || !apiKey) return null;
  try {
    return new FilesClient({ baseUrl, apiKey });
  } catch {
    return null;
  }
}

function readSpoolExcerpt(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function redactText(text: string): string {
  return redactOutputText(text).text;
}
