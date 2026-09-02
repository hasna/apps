#!/usr/bin/env bun
import pkg from "../../package.json" with { type: "json" };
import { assertNoLegacyHostedEnvironment } from "../lib/mode.js";
import { resolveServerBindOptions } from "./bind-options.js";
import { resolveServerStorageBackend } from "./storage-backend.js";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: emails-serve [command] [options]

Runs the Emails HTTP service (or a background worker).

Commands:
  (default)          Run the PostgreSQL HTTP service. Requires server-side
                     HASNA_EMAILS_DATABASE_URL and EMAILS_API_SIGNING_KEY.
                     GET /health, /ready, /version and authenticated /v1.
                     Missing configuration fails before listener startup.
  ingest-worker      Run the SES-inbound ingestion worker: long-poll the SQS
                     queue (EMAILS_INGEST_QUEUE_URL), fetch each archived raw
                     message from S3, and write it to self-hosted Postgres.
  ingest-s3-backfill One-shot repair/backfill: list EMAILS_INGEST_S3_BUCKET /
                     EMAILS_INGEST_S3_PREFIX and ingest existing raw objects.
  attachment-repair-canary
                     Exact-ID, exact-object attachment repair. Dry-run unless
                     --apply is passed; never inserts or updates other fields.
  attachment-repair-ledger
                     Operator-only, image-bundled checkpoint ledger maintenance.
                     Reads one canonical secret manifest, proves ECS/image
                     provenance, and emits aggregate JSON only.
  gmail-recovery-reconcile
                     Read-only census of legacy-inbound messages with attachment
                     metadata but no payload bytes (issue #52). Aggregates by
                     resolvability class; --ids emits a bounded exact-id manifest.
                     Never reads or emits payload bytes.
  gmail-recovery-replay
                     Bounded exact-id attachment payload recovery from the Gmail
                     source mailbox (issue #52). Dry-run unless --apply; apply
                     requires --reviewed-dry-run-sha256 matching the dry-run
                     report. Fail-closed without EMAILS_GMAIL_ACCESS_TOKEN.
  inbound-provenance-audit
                     Read-only all-tenant post-fence provenance audit. Emits
                     aggregate counts only and exits nonzero on any gap.
  inbound-provenance-fence
                     Capture a privacy-safe cutoff from PostgreSQL's clock.
                     Pre-0017 compatible and accepts no options.

Options:
  --host <host>      Host to bind to (default: 0.0.0.0)
  --port <port>      Port to listen on (default: 8080)
  --message-id <id>  Exact message canary; repeat for every row bound to the object
  --object-key <key> One exact S3 object key (repair command only)
  --recipient <addr> Trusted envelope recipient (repeatable; repair command only)
  --region <name>    AWS region (repair command; else AWS_REGION)
  --ids              Emit the bounded exact-id manifest (reconcile command only)
  --limit <n>        Manifest bound (reconcile; default 500, max 5000) or max
                     messages processed (replay; default 25, max 200)
  --reviewed-dry-run-sha256 <hex>
                     Reviewed dry-run gate (replay --apply only)
  --since <ISO8601>  Required post-fence cutoff (provenance audit only)
  --apply            Apply attachment-only CAS after reviewed dry-run
  -V, --version      output the version number
  -h, --help         display help`);
  process.exit(0);
}

// EVERY command fails closed on a removed hosted/legacy variable, ahead of dispatch.
// This is deliberately eager while the storage resolution below is lazy: the legacy
// variables configure a runtime that no longer exists, so honouring one for a worker
// while refusing it for the service would be a silent difference between two entry
// points of the same binary. The STORE, by contrast, is resolved only by the branches
// that actually open one — the workers and one-shot commands validate their own
// PostgreSQL, signing and AWS requirements after dispatch, and must be able to report a
// bad flag without a database being configured at all.
assertNoLegacyHostedEnvironment();

function repeated(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && args[index + 1]) values.push(args[++index]!);
  }
  return values;
}

function option(flag: string): string | undefined {
  return repeated(flag)[0];
}

if (args[0] === "ingest-worker") {
  if (args.includes("--bucket")) {
    throw new Error("ingest worker does not accept --bucket; EMAILS_INGEST_S3_BUCKET is the only canonical source");
  }
  const { runIngestWorker } = await import("./self-hosted/ingest-worker.js");
  await runIngestWorker();
} else if (args[0] === "ingest-s3-backfill") {
  if (args.includes("--bucket")) {
    throw new Error("ingest S3 backfill does not accept --bucket; EMAILS_INGEST_S3_BUCKET is the only canonical source");
  }
  const { runIngestS3Backfill } = await import("./self-hosted/ingest-worker.js");
  await runIngestS3Backfill();
} else if (args[0] === "attachment-repair-canary") {
  if (args.includes("--bucket")) {
    throw new Error("attachment repair does not accept --bucket; immutable stored provenance selects the canonical bucket");
  }
  const { runAttachmentRepairCanary } = await import("./self-hosted/ingest-worker.js");
  await runAttachmentRepairCanary({
    region: option("--region"),
    objectKeys: repeated("--object-key"),
    recipients: repeated("--recipient"),
    canaryMessageIds: repeated("--message-id"),
    apply: args.includes("--apply"),
  });
} else if (args[0] === "attachment-repair-ledger") {
  const { runAttachmentRepairMaintenanceCommand } =
    await import("./self-hosted/attachment-repair-maintenance.js");
  await runAttachmentRepairMaintenanceCommand(args.slice(1));
} else if (args[0] === "gmail-recovery-reconcile") {
  if (args.includes("--apply") || args.includes("--message-id")) {
    throw new Error("gmail recovery reconcile is read-only and accepts only --ids and --limit");
  }
  const { runGmailRecoveryReconcile } = await import("./self-hosted/gmail-recovery.js");
  const limitValues = repeated("--limit");
  const limit = limitValues.length === 0
    ? 500
    : limitValues.length === 1
      ? Number(limitValues[0]!)
      : NaN;
  await runGmailRecoveryReconcile({ emitIds: args.includes("--ids"), limit });
} else if (args[0] === "gmail-recovery-replay") {
  const { runGmailRecoveryReplay } = await import("./self-hosted/gmail-recovery.js");
  const limitValues = repeated("--limit");
  const limit = limitValues.length === 0
    ? 25
    : limitValues.length === 1
      ? Number(limitValues[0]!)
      : NaN;
  await runGmailRecoveryReplay({
    messageIds: repeated("--message-id"),
    apply: args.includes("--apply"),
    reviewedDryRunSha256: option("--reviewed-dry-run-sha256"),
    limit,
  });
} else if (args[0] === "inbound-provenance-audit") {
  const sinceValues = repeated("--since");
  if (args.length !== 3 || args[1] !== "--since" || sinceValues.length !== 1) {
    throw new Error("inbound provenance audit requires exactly one --since <ISO8601> and accepts no other options");
  }
  const { runInboundProvenanceAudit } = await import("./self-hosted/ingest-worker.js");
  await runInboundProvenanceAudit({ since: sinceValues[0]! });
} else if (args[0] === "inbound-provenance-fence") {
  if (args.length !== 1) {
    throw new Error("inbound provenance fence accepts no options");
  }
  const { runInboundProvenanceFence } = await import("./self-hosted/ingest-worker.js");
  await runInboundProvenanceFence();
} else {
  const backend = resolveServerStorageBackend();
  const { port, host } = resolveServerBindOptions(args, process.env, backend);
  const { startSelfHostedServer } = await import("./self-hosted/serve.js");
  await startSelfHostedServer(pkg.version, port, host);
}
