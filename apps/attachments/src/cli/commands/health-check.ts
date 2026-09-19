import { Command } from "commander";
import { type Attachment } from "../../core/db";
import { resolveStore } from "../../core/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttachmentStatus = "healthy" | "expired" | "dead" | "no-link";

export interface AttachmentHealthResult {
  id: string;
  filename: string;
  status: AttachmentStatus;
  link: string | null;
  expiresAt: number | null;
  /** ms since epoch when the link expired (only if status=expired) */
  expiredAgoMs?: number;
  /** whether it was fixed by --fix */
  fixed?: boolean;
  newLink?: string;
}

export interface HealthCheckSummary {
  healthy: number;
  expired: number;
  dead: number;
  noLink: number;
  fixed: number;
  total: number;
  results: AttachmentHealthResult[];
}

// ---------------------------------------------------------------------------
// Core logic (exported for MCP tool reuse)
// ---------------------------------------------------------------------------

/**
 * Check an ordinary share page with HEAD. S3 download signatures bind GET,
 * so a HEAD can return 403 for a working download. Probe those URLs with a
 * one-byte ranged GET and cancel the response without buffering the object.
 * Keep ordinary links on HEAD: a GET can consume a constrained share's use.
 */
export async function isLinkAlive(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const query = new URL(url).searchParams;
    const signedDownload = query.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256"
      && query.has("X-Amz-Signature");
    const signal = controller.signal;
    let res = await fetch(url, {
      method: signedDownload ? "GET" : "HEAD",
      ...(signedDownload ? { headers: { Range: "bytes=0-0" }, redirect: "error" as const } : {}),
      signal,
    });
    // Empty S3 objects reject bytes=0-0 with 416. Verify the same signed GET
    // without Range once, sharing the original deadline and cancelling both
    // bodies. A 416 alone is not evidence that a link is healthy.
    if (signedDownload && res.status === 416) {
      await res.body?.cancel();
      res = await fetch(url, { method: "GET", redirect: "error", signal });
    }
    const alive = res.ok || (!signedDownload && res.status >= 300 && res.status < 400);
    // Some compatible stores ignore Range. Stop the body in that case too.
    await res.body?.cancel();
    return alive;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    // Bun can continue receiving bytes after body.cancel(). Abort the request
    // itself so a store that ignores Range cannot stream until the deadline.
    controller.abort();
  }
}

/**
 * Determine the status of a single attachment.
 */
export async function checkAttachment(
  att: Attachment,
  now: number
): Promise<AttachmentHealthResult> {
  // No link stored
  if (!att.link) {
    return { id: att.id, filename: att.filename, status: "no-link", link: null, expiresAt: att.expiresAt };
  }

  // Expired by timestamp
  if (att.expiresAt !== null && att.expiresAt <= now) {
    return {
      id: att.id,
      filename: att.filename,
      status: "expired",
      link: att.link,
      expiresAt: att.expiresAt,
      expiredAgoMs: now - att.expiresAt,
    };
  }

  // Live link check
  const alive = await isLinkAlive(att.link);
  return {
    id: att.id,
    filename: att.filename,
    status: alive ? "healthy" : "dead",
    link: att.link,
    expiresAt: att.expiresAt,
  };
}

/**
 * Run a full health check across all attachments, routed through the resolved
 * store (local db or /v1 API). If fix=true, regenerates expired links.
 */
export async function runHealthCheck(opts: { fix?: boolean } = {}): Promise<HealthCheckSummary> {
  const store = resolveStore();
  let attachments: Attachment[];
  try {
    attachments = await store.list({ includeExpired: true });

    const now = Date.now();
    const results: AttachmentHealthResult[] = [];

    for (const att of attachments) {
      const result = await checkAttachment(att, now);

      if (opts.fix && result.status === "expired") {
        try {
          const { link } = await store.regenerateLink(att.id, {});
          result.fixed = true;
          if (link) result.newLink = link;
          result.status = "healthy";
        } catch {
          // If regeneration fails, keep as expired
        }
      }

      results.push(result);
    }

    return buildSummary(results);
  } finally {
    store.close();
  }
}

function buildSummary(results: AttachmentHealthResult[]): HealthCheckSummary {
  const summary: HealthCheckSummary = {
    healthy: results.filter((r) => r.status === "healthy").length,
    expired: results.filter((r) => r.status === "expired").length,
    dead: results.filter((r) => r.status === "dead").length,
    noLink: results.filter((r) => r.status === "no-link").length,
    fixed: results.filter((r) => r.fixed).length,
    total: results.length,
    results,
  };

  return summary;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatExpiredAgo(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function compactOutput(summary: HealthCheckSummary): string {
  const parts: string[] = [];
  if (summary.healthy > 0) parts.push(`${summary.healthy} healthy`);
  if (summary.expired > 0) parts.push(`${summary.expired} expired`);
  if (summary.dead > 0) parts.push(`${summary.dead} dead`);
  if (summary.noLink > 0) parts.push(`${summary.noLink} no-link`);

  const lines: string[] = [];
  lines.push(`Attachment health: ${parts.join(", ") || "0 attachments"}`);

  for (const r of summary.results) {
    if (r.status === "expired" || r.fixed) {
      const ago = r.expiredAgoMs != null ? ` (expired ${formatExpiredAgo(r.expiredAgoMs)})` : "";
      const fixedNote = r.fixed ? " → regenerated" : "";
      lines.push(`  Expired: ${r.id} ${r.filename}${ago}${fixedNote}`);
    }
    if (r.status === "dead") {
      lines.push(`  Dead: ${r.id} ${r.filename} (link check failed)`);
    }
    if (r.status === "no-link") {
      lines.push(`  No link: ${r.id} ${r.filename}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

export function registerHealthCheck(program: Command): void {
  program
    .command("health-check")
    .description("Validate attachment links — find expired, dead, or missing links")
    .option("--fix", "Regenerate presigned links for expired attachments", false)
    .option("--format <format>", "Output format: compact or json", "compact")
    .action(async (options: { fix?: boolean; format?: string }) => {
      const fix = !!options.fix;
      const format = (options.format ?? "compact") as string;

      if (!["compact", "json"].includes(format)) {
        process.stderr.write(`Error: --format must be one of: compact, json\n`);
        process.exit(1);
      }

      try {
        const summary = await runHealthCheck({ fix });

        if (format === "json") {
          process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
        } else {
          process.stdout.write(compactOutput(summary) + "\n");
        }

        // Exit with code 1 if there are dead or expired links (unfixed)
        if (summary.dead > 0 || summary.expired > 0) {
          process.exit(1);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
