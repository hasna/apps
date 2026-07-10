import { Command } from "commander";
import chalk from "chalk";
import { store } from "../store/index.js";
import {
  getEvidenceStorageOptions,
  DEFAULT_EVIDENCE_S3_BUCKET,
  redactSensitiveTransportText,
  toEvidenceUploadReceipt,
  type EvidenceStorageOptions,
} from "../lib/evidence.js";
import type { FileAssetStatus } from "../types/index.js";

const FILE_ASSET_STATUSES = ["pending_upload", "uploaded", "verified", "archived", "deleted"] as const satisfies readonly FileAssetStatus[];

export function registerEvidenceCommands(program: Command): void {
  const evidence = program.command("evidence").description("Shared evidence-vault files for internal apps");

  evidence
    .command("configure-prod")
    .description("Show the production evidence storage defaults")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const storage = getEvidenceStorageOptions({ provider: "s3", bucket: DEFAULT_EVIDENCE_S3_BUCKET });
      if (opts.json) {
        console.log(JSON.stringify(storage, null, 2));
        return;
      }
      console.log(chalk.bold("Evidence storage"));
      console.log(`  provider: ${chalk.cyan(storage.provider)}`);
      console.log(`  bucket:   ${chalk.cyan(storage.bucket)}`);
      console.log(`  region:   ${chalk.cyan(storage.region)}`);
      console.log(`  prefix:   ${chalk.cyan(storage.prefix || "(none)")}`);
      console.log(`  profile:  ${chalk.cyan(storage.profile || "(default chain)")}`);
    });

  evidence
    .command("create-upload")
    .description("Create a file asset and safe opaque upload handle")
    .requiredOption("--org <orgId>", "Organization ID")
    .requiredOption("--app <app>", "Owning app, e.g. iapp-accounting")
    .requiredOption("--kind <kind>", "Evidence kind, e.g. receipt")
    .requiredOption("--name <name>", "Original filename")
    .requiredOption("--size <bytes>", "Expected file size in bytes")
    .requiredOption("--checksum <sha256>", "Expected sha256 hex checksum")
    .option("--company <companyId>", "Company ID")
    .option("--content-type <type>", "Content type")
    .option("--classification <value>", "Classification", "evidence")
    .option("--storage-class <value>", "Retention storage class metadata")
    .option("--storage <provider>", "Storage provider: s3 or local")
    .option("--bucket <bucket>", "S3 bucket", DEFAULT_EVIDENCE_S3_BUCKET)
    .option("--region <region>", "S3 region")
    .option("--aws-profile <profile>", "AWS profile")
    .option("--prefix <prefix>", "Object key prefix")
    .option("--local-root <path>", "Local evidence root for local mode")
    .option("--expires <seconds>", "Upload URL expiry seconds", "600")
    .option("--json", "Output as JSON")
    .action(async (opts: EvidenceCreateUploadOptions) => {
      await runCli(async () => {
        const result = await store().createEvidenceUploadIntent({
          org_id: opts.org,
          company_id: opts.company,
          app: opts.app,
          kind: opts.kind,
          original_name: opts.name,
          content_type: opts.contentType,
          size: parseInteger(opts.size, "size"),
          checksum: opts.checksum,
          classification: opts.classification,
          storage_class: opts.storageClass,
          expires_in_seconds: parseInteger(opts.expires, "expires"),
        }, storageOptions(opts));
        printResult(toEvidenceUploadReceipt(result), opts.json, `Created upload intent ${result.intent.id} for ${result.asset.id}`);
      });
    });

  evidence
    .command("upload <path>")
    .description("Create an upload intent, upload a local file, complete verification, and optionally link it")
    .requiredOption("--org <orgId>", "Organization ID")
    .requiredOption("--app <app>", "Owning app, e.g. iapp-accounting")
    .requiredOption("--kind <kind>", "Evidence kind, e.g. receipt")
    .option("--company <companyId>", "Company ID")
    .option("--classification <value>", "Classification", "evidence")
    .option("--storage-class <value>", "Retention storage class metadata")
    .option("--source-type <type>", "Domain source type to link after upload")
    .option("--source-id <id>", "Domain source id to link after upload")
    .option("--link-kind <kind>", "Link kind, defaults to --kind")
    .option("--storage <provider>", "Storage provider: s3 or local")
    .option("--bucket <bucket>", "S3 bucket", DEFAULT_EVIDENCE_S3_BUCKET)
    .option("--region <region>", "S3 region")
    .option("--aws-profile <profile>", "AWS profile")
    .option("--prefix <prefix>", "Object key prefix")
    .option("--local-root <path>", "Local evidence root for local mode")
    .option("--json", "Output as JSON")
    .action(async (path: string, opts: EvidenceUploadOptions) => {
      await runCli(async () => {
        const result = await store().uploadEvidenceFile({
          path,
          org_id: opts.org,
          company_id: opts.company,
          app: opts.app,
          kind: opts.kind,
          classification: opts.classification,
          storage_class: opts.storageClass,
        }, storageOptions(opts));
        const link = opts.sourceType && opts.sourceId
          ? await store().linkEvidenceAsset({
              asset_id: result.asset.id,
              org_id: opts.org,
              company_id: opts.company,
              app: opts.app,
              source_type: opts.sourceType,
              source_id: opts.sourceId,
              kind: opts.linkKind ?? opts.kind,
            })
          : undefined;
        printResult({ ...result, link }, opts.json, `Uploaded and verified ${result.asset.id}`);
      });
    });

  evidence
    .command("complete <intent-id>")
    .description("Complete an upload intent after the client uploads bytes")
    .option("--storage <provider>", "Storage provider: s3 or local")
    .option("--bucket <bucket>", "S3 bucket", DEFAULT_EVIDENCE_S3_BUCKET)
    .option("--region <region>", "S3 region")
    .option("--aws-profile <profile>", "AWS profile")
    .option("--prefix <prefix>", "Object key prefix")
    .option("--local-root <path>", "Local evidence root for local mode")
    .option("--json", "Output as JSON")
    .action(async (intentId: string, opts: EvidenceStorageCliOptions) => {
      await runCli(async () => {
        const asset = await store().completeEvidenceUpload(intentId, storageOptions(opts));
        printResult(asset, opts.json, `Completed upload for ${asset.id}`);
      });
    });

  evidence
    .command("link <asset-id>")
    .description("Link a verified file asset to an app record")
    .requiredOption("--org <orgId>", "Organization ID")
    .requiredOption("--app <app>", "Owning app")
    .requiredOption("--source-type <type>", "Domain source type")
    .requiredOption("--source-id <id>", "Domain source id")
    .requiredOption("--kind <kind>", "Link kind")
    .option("--company <companyId>", "Company ID")
    .option("--json", "Output as JSON")
    .action(async (assetId: string, opts: EvidenceLinkOptions) => {
      await runCli(async () => {
        const link = await store().linkEvidenceAsset({
          asset_id: assetId,
          org_id: opts.org,
          company_id: opts.company,
          app: opts.app,
          source_type: opts.sourceType,
          source_id: opts.sourceId,
          kind: opts.kind,
        });
        printResult(link, opts.json, `Linked ${assetId}`);
      });
    });

  evidence
    .command("sign-download <asset-id>")
    .description("Create a short-lived download URL/path and record access")
    .option("--actor <actorId>", "Actor ID")
    .option("--purpose <purpose>", "Access purpose")
    .option("--expires <seconds>", "Expiry seconds", "300")
    .option("--storage <provider>", "Storage provider: s3 or local")
    .option("--bucket <bucket>", "S3 bucket", DEFAULT_EVIDENCE_S3_BUCKET)
    .option("--region <region>", "S3 region")
    .option("--aws-profile <profile>", "AWS profile")
    .option("--prefix <prefix>", "Object key prefix")
    .option("--local-root <path>", "Local evidence root for local mode")
    .option("--json", "Output as JSON")
    .action(async (assetId: string, opts: EvidenceDownloadOptions) => {
      await runCli(async () => {
        const grant = await store().signEvidenceDownload({
          asset_id: assetId,
          actor_id: opts.actor,
          purpose: opts.purpose,
          expires_in_seconds: parseInteger(opts.expires, "expires"),
        }, storageOptions(opts));
        printResult(grant, opts.json, grant.url);
      });
    });

  evidence
    .command("verify <asset-id>")
    .description("Verify stored object size and checksum")
    .option("--storage <provider>", "Storage provider: s3 or local")
    .option("--bucket <bucket>", "S3 bucket", DEFAULT_EVIDENCE_S3_BUCKET)
    .option("--region <region>", "S3 region")
    .option("--aws-profile <profile>", "AWS profile")
    .option("--prefix <prefix>", "Object key prefix")
    .option("--local-root <path>", "Local evidence root for local mode")
    .option("--json", "Output as JSON")
    .action(async (assetId: string, opts: EvidenceStorageCliOptions) => {
      await runCli(async () => {
        const result = await store().verifyEvidenceAsset(assetId, storageOptions(opts));
        printResult(result, opts.json, result.ok ? `Verified ${assetId}` : `Verification failed: ${result.diagnostics.join(", ")}`);
      });
    });

  evidence
    .command("list")
    .description("List file assets")
    .option("--org <orgId>", "Organization ID")
    .option("--company <companyId>", "Company ID")
    .option("--app <app>", "App")
    .option("--kind <kind>", "Kind")
    .option("--status <status>", "Status")
    .option("--limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts: EvidenceListOptions) => {
      await runCli(async () => {
        const assets = await store().listEvidenceAssets({
          org_id: opts.org,
          company_id: opts.company,
          app: opts.app,
          kind: opts.kind,
          status: parseFileAssetStatus(opts.status),
          limit: parseInteger(opts.limit, "limit"),
        });
        if (opts.json) {
          console.log(JSON.stringify(assets, null, 2));
          return;
        }
        for (const asset of assets) {
          console.log(`${chalk.bold(asset.id)}  ${chalk.cyan(asset.app)}:${asset.kind}  ${asset.status}/${asset.scan_status}  ${chalk.dim(asset.original_name)}`);
        }
      });
    });

  evidence
    .command("audit <asset-id>")
    .description("Show links and access events for a file asset")
    .option("--json", "Output as JSON")
    .action(async (assetId: string, opts: { json?: boolean }) => {
      await runCli(async () => {
        const asset = await store().getEvidenceAsset(assetId);
        if (!asset) throw new Error(`File asset not found: ${assetId}`);
        const result = {
          asset,
          links: await store().listEvidenceLinks(assetId),
          events: await store().listEvidenceAccessEvents(assetId),
        };
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.bold(asset.id));
        console.log(`  links: ${result.links.length}`);
        console.log(`  events: ${result.events.length}`);
      });
    });
}

interface EvidenceStorageCliOptions {
  storage?: string;
  bucket?: string;
  region?: string;
  awsProfile?: string;
  prefix?: string;
  localRoot?: string;
  json?: boolean;
}

interface EvidenceCreateUploadOptions extends EvidenceStorageCliOptions {
  org: string;
  company?: string;
  app: string;
  kind: string;
  name: string;
  size: string;
  checksum: string;
  contentType?: string;
  classification?: string;
  storageClass?: string;
  expires: string;
}

interface EvidenceUploadOptions extends EvidenceStorageCliOptions {
  org: string;
  company?: string;
  app: string;
  kind: string;
  classification?: string;
  storageClass?: string;
  sourceType?: string;
  sourceId?: string;
  linkKind?: string;
}

interface EvidenceLinkOptions {
  org: string;
  company?: string;
  app: string;
  sourceType: string;
  sourceId: string;
  kind: string;
  json?: boolean;
}

interface EvidenceDownloadOptions extends EvidenceStorageCliOptions {
  actor?: string;
  purpose?: string;
  expires: string;
}

interface EvidenceListOptions {
  org?: string;
  company?: string;
  app?: string;
  kind?: string;
  status?: string;
  limit: string;
  json?: boolean;
}

function storageOptions(opts: EvidenceStorageCliOptions): EvidenceStorageOptions {
  return {
    provider: opts.storage as EvidenceStorageOptions["provider"],
    bucket: opts.bucket,
    region: opts.region,
    profile: opts.awsProfile,
    prefix: opts.prefix,
    localRoot: opts.localRoot,
  };
}

function parseInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid --${name} value: ${value}`);
  return parsed;
}

function parseFileAssetStatus(value: string | undefined): FileAssetStatus | undefined {
  if (!value) return undefined;
  if ((FILE_ASSET_STATUSES as readonly string[]).includes(value)) return value as FileAssetStatus;
  throw new Error(`Invalid --status value: ${value}`);
}

async function runCli(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(redactSensitiveTransportText(message)));
    process.exit(1);
  }
}

function printResult(data: unknown, json: boolean | undefined, message: string): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(chalk.green(`✓ ${message}`));
}
