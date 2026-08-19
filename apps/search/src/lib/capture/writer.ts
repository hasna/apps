import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { scanInputExposures } from "@hasna/secrets/scanner";
import type { Search, SearchResult } from "../../types/index.js";
import {
  redactCredentialBearingText,
  redactContentSearchResult,
} from "../redaction.js";
import {
  type CapturePoint,
  type CaptureFrontmatter,
  CAPTURE_KIND,
  CAPTURE_SCHEMA_VERSION,
  renderFrontmatterBlock,
} from "./frontmatter.js";
import { type CaptureLayout, captureObjectKey } from "./layout.js";

/**
 * Writer artifact for the auto-save-to-md capture pipeline (I38-00188).
 *
 * Writes one search capture as an append-only markdown document to the S3
 * corpus: frontmatter (metadata) + body (query, provenance, results). The
 * write path mirrors the plans app S3 markdown store (I38-00175):
 *   - redaction at render time (this package's redaction module);
 *   - secret-scan of the rendered document before the PUT
 *     (SECRET_FOUND refuses the write, nothing is stored);
 *   - create-exclusive PUT (If-None-Match: "*") — a taken key is a 412 and
 *     the capture is skipped, never overwritten;
 *   - HEAD verification of the exact byte size after the PUT, with the
 *     fresh object removed again on any verification failure;
 *   - a 2 MiB size bound.
 */

export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

/**
 * Minimal send surface so tests can inject a fake client. The commands are
 * REAL @aws-sdk/client-s3 Command instances: the smithy-client runtime
 * invokes `command.resolveMiddleware(...)` on every send, so a fabricated
 * plain object is rejected by the real S3Client at runtime.
 */
export interface S3ClientLike {
  send(
    command: PutObjectCommand | HeadObjectCommand | DeleteObjectCommand,
  ): Promise<unknown>;
}

export interface CaptureWriterConfig {
  bucket: string;
  layout?: CaptureLayout;
  region?: string;
}

export interface SearchCaptureInput {
  search: Search;
  results: SearchResult[];
  capturePoint: CapturePoint;
}

export interface CaptureWriteResult {
  key: string;
  contentHash: string;
  sizeBytes: number;
  redacted: boolean;
}

export function captureConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CaptureWriterConfig {
  return {
    bucket: env.HASNA_SEARCH_S3_BUCKET ?? "",
    layout: {
      prefix: env.HASNA_SEARCH_S3_PREFIX ?? "search",
    },
    region: env.HASNA_SEARCH_S3_REGION ?? env.AWS_REGION,
  };
}

/** True when the capture pipeline has the config it needs to write. */
export function isCaptureConfigured(config: CaptureWriterConfig): boolean {
  return config.bucket.trim() !== "";
}

function isPreconditionFailed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "PreconditionFailed"
  );
}

export class SearchCaptureWriter {
  readonly bucket: string;
  readonly layout: CaptureLayout;
  private readonly client: S3ClientLike;

  constructor(config: CaptureWriterConfig, client?: S3ClientLike) {
    this.bucket = config.bucket;
    this.layout = config.layout ?? { prefix: "search" };
    this.client =
      client ??
      new S3Client({
        region: config.region ?? process.env.AWS_REGION ?? "us-east-1",
      });
  }

  /**
   * Render a capture to markdown without touching S3. Redaction happens
   * here: query and result text go through the package's redaction module,
   * and the frontmatter's `redacted` flag records whether any field was
   * changed.
   */
  renderCapture(input: SearchCaptureInput): { markdown: string; redacted: boolean } {
    const query = redactCredentialBearingText(input.search.query);
    const results = input.results.map(redactContentSearchResult);
    const redacted = query !== input.search.query || results.some((r, i) => r !== input.results[i]);

    const frontmatter: CaptureFrontmatter = {
      schema_version: CAPTURE_SCHEMA_VERSION,
      capture_id: input.search.id,
      kind: CAPTURE_KIND,
      query,
      providers: input.search.providers,
      profile_id: input.search.profileId,
      result_count: input.results.length,
      duration_ms: input.search.duration,
      captured_at: input.search.createdAt,
      capture_point: input.capturePoint,
      redacted,
    };

    const body = renderResultsBody(query, results);
    const markdown = `${renderFrontmatterBlock(frontmatter)}\n\n${body}`;
    return { markdown, redacted };
  }

  /**
   * Write one capture to the S3 corpus. Fails closed: throws SECRET_FOUND
   * when the rendered document carries credential-shaped content, skips
   * silently when the key already exists (412), and removes the object
   * again when the post-write HEAD verification fails.
   */
  async writeCapture(input: SearchCaptureInput): Promise<CaptureWriteResult> {
    if (this.bucket.trim() === "") {
      throw new Error(
        "HASNA_SEARCH_S3_BUCKET is not configured — no capture can be written",
      );
    }

    // Bound the INPUT before any rendering: redaction runs regexes over the
    // query and result text, and a pathological single-line input (measured
    // on the redaction module with a 2 MiB unbroken line) can backtrack far
    // past the capture limit. Failing closed on input size keeps capture
    // fast even for hostile inputs.
    const inputBytes =
      Buffer.byteLength(input.search.query, "utf8") +
      input.results.reduce(
        (acc, r) =>
          acc +
          Buffer.byteLength(r.title, "utf8") +
          Buffer.byteLength(r.url, "utf8") +
          Buffer.byteLength(r.snippet, "utf8"),
        0,
      );
    if (inputBytes > MAX_CAPTURE_BYTES) {
      throw new Error(
        `capture input exceeds the ${MAX_CAPTURE_BYTES}-byte limit (${inputBytes} bytes)`,
      );
    }

    const { markdown, redacted } = this.renderCapture(input);
    const bytes = Buffer.byteLength(markdown, "utf8");
    if (bytes > MAX_CAPTURE_BYTES) {
      throw new Error(
        `capture exceeds the ${MAX_CAPTURE_BYTES}-byte limit (${bytes} bytes)`,
      );
    }

    const scan = scanInputExposures({ text: markdown });
    if (scan.findings.length > 0) {
      const detectors = [...new Set(scan.findings.map((f) => f.detector))].join(", ");
      throw new Error(
        `capture refused: secret scan found ${scan.findings.length} credential-shaped match(es) (${detectors})`,
      );
    }

    const key = captureObjectKey(this.layout, input.search.createdAt, input.search.id);
    const contentHash = createHash("sha256").update(markdown, "utf8").digest("hex");

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: markdown,
          ContentType: "text/markdown; charset=utf-8",
          IfNoneMatch: "*", // create-exclusive: never overwrite an object
        }),
      );
    } catch (err) {
      if (isPreconditionFailed(err)) {
        // A concurrent writer took this key — the capture already exists.
        return { key, contentHash, sizeBytes: bytes, redacted };
      }
      throw err;
    }

    // Verify what landed: HEAD must report the exact byte size we PUT. On
    // any verification failure the object we just wrote is removed again
    // (we exclusively own the key via create-exclusive PUT) so a partial
    // failure cannot leave a permanently unverified object in the bucket.
    const head = (await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    )) as { ContentLength?: number };
    if (head.ContentLength !== bytes) {
      await this.deleteObject(key).catch(() => {});
      throw new Error(
        `capture object ${key} landed with ${head.ContentLength ?? "unknown"} bytes, expected ${bytes}`,
      );
    }

    return { key, contentHash, sizeBytes: bytes, redacted };
  }

  private async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function renderResultsBody(query: string, results: SearchResult[]): string {
  const lines: string[] = [];
  lines.push(`# ${query}`);
  lines.push("");
  lines.push(`*${results.length} results*`);
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.rank}. ${r.title}`);
    lines.push("");
    lines.push(`**Source:** ${r.provider} | **URL:** ${r.url}`);
    if (r.publishedAt) lines.push(`**Published:** ${r.publishedAt}`);
    if (r.score !== null) lines.push(`**Score:** ${r.score.toFixed(3)}`);
    lines.push("");
    if (r.snippet) {
      lines.push(`> ${r.snippet}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
