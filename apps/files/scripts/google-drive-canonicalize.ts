#!/usr/bin/env bun
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { Database } from "bun:sqlite";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCopyCommand,
  type CompletedPart,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";

type Row = {
  file_record_id: string;
  source_id: string;
  drive_id: string;
  drive_file_id: string;
  profile: string | null;
  path: string;
  name: string;
  mime: string;
  size: number;
  modified_at: string | null;
  version: string | null;
  legacy_hash: string | null;
  storage_key: string | null;
  s3_key: string;
  destination_source_id: string | null;
};

const DEFAULT_BUCKET = "hasna-xyz-opensource-files-prod";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_PROFILE = "hasna-xyz-infra";
const DEFAULT_RAW_PREFIX = "imports/google-drive/legacy-s3-2026-06-07/raw";
const DEFAULT_MANIFEST_PREFIX = "imports/google-drive/legacy-s3-2026-06-07/manifests";
const DEFAULT_SQLITE_DB = join(homedir(), ".hasna", "files", "files.db");
const DEFAULT_LOCAL_MANIFEST_FILE = join(homedir(), ".hasna", "files", "google-drive-promotion-manifest-2026-06-08.jsonl");
const DEFAULT_LOCAL_RESULTS_DIR = join(homedir(), ".hasna", "files");
const DEFAULT_MAPPING_OUT = join(homedir(), ".hasna", "files", "google-drive-canonical-object-mapping-2026-06-08.jsonl");
const COPY_OBJECT_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const LARGE_OBJECT_COPY_PART_SIZE = 512 * 1024 * 1024;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || !args.command) {
    printHelp();
    return Promise.resolve();
  }

  const db = new Database(args.db, { readonly: true });
  const client = new S3Client({
    region: args.region,
    credentials: fromIni({ profile: args.profile }),
  });

  if (args.command === "manifest") return writeManifest(db, client, args);
  if (args.command === "promote") return promoteObjects(db, client, args);
  if (args.command === "mapping") return writeCanonicalMapping(client, args);

  throw new Error(`Unknown command: ${args.command}`);
}

type Args = {
  command: string;
  db: string;
  bucket: string;
  region: string;
  profile: string;
  rawPrefix: string;
  manifestPrefix: string;
  out: string;
  upload: boolean;
  limit: number;
  offset: number;
  dryRun: boolean;
  largeObject: boolean;
  minSize: number;
  maxSize: number;
  resultOut: string;
  resultUpload: boolean;
  manifestFile: string;
  resultsDir: string;
  mappingOut: string;
  mappingUpload: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? "help",
    db: DEFAULT_SQLITE_DB,
    bucket: DEFAULT_BUCKET,
    region: DEFAULT_REGION,
    profile: DEFAULT_PROFILE,
    rawPrefix: DEFAULT_RAW_PREFIX,
    manifestPrefix: DEFAULT_MANIFEST_PREFIX,
    out: join(homedir(), ".hasna", "files", "google-drive-promotion-manifest.jsonl"),
    upload: false,
    limit: 0,
    offset: 0,
    dryRun: false,
    largeObject: false,
    minSize: 0,
    maxSize: COPY_OBJECT_LIMIT_BYTES,
    resultOut: "",
    resultUpload: false,
    manifestFile: DEFAULT_LOCAL_MANIFEST_FILE,
    resultsDir: DEFAULT_LOCAL_RESULTS_DIR,
    mappingOut: DEFAULT_MAPPING_OUT,
    mappingUpload: false,
  };

  for (let i = 1; i < argv.length; i++) {
    const current = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${current}`);
      return value;
    };

    switch (current) {
      case "--db":
        args.db = next();
        break;
      case "--bucket":
        args.bucket = next();
        break;
      case "--region":
        args.region = next();
        break;
      case "--profile":
        args.profile = next();
        break;
      case "--raw-prefix":
        args.rawPrefix = next().replace(/\/+$/, "");
        break;
      case "--manifest-prefix":
        args.manifestPrefix = next().replace(/\/+$/, "");
        break;
      case "--out":
        args.out = next();
        break;
      case "--upload":
        args.upload = true;
        break;
      case "--limit":
        args.limit = Number(next());
        break;
      case "--offset":
        args.offset = Number(next());
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--large-object":
        args.largeObject = true;
        break;
      case "--min-size":
        args.minSize = Number(next());
        break;
      case "--max-size":
        args.maxSize = Number(next());
        break;
      case "--result-out":
        args.resultOut = next();
        break;
      case "--result-upload":
        args.resultUpload = true;
        break;
      case "--manifest-file":
        args.manifestFile = next();
        break;
      case "--results-dir":
        args.resultsDir = next();
        break;
      case "--mapping-out":
        args.mappingOut = next();
        break;
      case "--mapping-upload":
        args.mappingUpload = true;
        break;
      default:
        throw new Error(`Unknown option: ${current}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/google-drive-canonicalize.ts manifest [--upload] [--out path]
  bun scripts/google-drive-canonicalize.ts promote --limit N [--offset N] [--dry-run] [--max-size bytes] [--large-object] [--result-out path] [--result-upload]
  bun scripts/google-drive-canonicalize.ts mapping [--manifest-file path] [--results-dir dir] [--mapping-out path] [--mapping-upload]

Defaults:
  --db ${DEFAULT_SQLITE_DB}
  --bucket ${DEFAULT_BUCKET}
  --region ${DEFAULT_REGION}
  --profile ${DEFAULT_PROFILE}
  --raw-prefix ${DEFAULT_RAW_PREFIX}
  --manifest-file ${DEFAULT_LOCAL_MANIFEST_FILE}
  --results-dir ${DEFAULT_LOCAL_RESULTS_DIR}
  --mapping-out ${DEFAULT_MAPPING_OUT}
`);
}

async function writeManifest(db: Database, client: S3Client, args: Args): Promise<void> {
  const rows = listRows(db);
  mkdirSync(dirname(args.out), { recursive: true });
  const stream = createWriteStream(args.out, { encoding: "utf8" });

  const summary = {
    rows: 0,
    bytes: 0,
    zero_byte_rows: 0,
    copy_object_supported_rows: 0,
    oversized_rows: 0,
    legacy_md5_rows: 0,
    legacy_blake3_rows: 0,
  };

  for (const row of rows) {
    const item = manifestItem(row, args);
    summary.rows++;
    summary.bytes += row.size;
    if (row.size === 0) summary.zero_byte_rows++;
    if (row.size > COPY_OBJECT_LIMIT_BYTES) summary.oversized_rows++;
    else summary.copy_object_supported_rows++;
    if (item.legacy_hash_kind === "md5") summary.legacy_md5_rows++;
    if (item.legacy_hash_kind === "blake3_export") summary.legacy_blake3_rows++;
    stream.write(`${JSON.stringify(item)}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  let uploadedKey: string | undefined;
  if (args.upload) {
    uploadedKey = `${args.manifestPrefix}/promotion-manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    await client.send(new PutObjectCommand({
      Bucket: args.bucket,
      Key: uploadedKey,
      Body: readFileSync(args.out),
      ContentLength: statSync(args.out).size,
      ContentType: "application/x-ndjson",
      Metadata: {
        "source": "open-files-sqlite",
        "source-rows": String(summary.rows),
      },
    }));
  }

  console.log(JSON.stringify({
    manifest: args.out,
    uploaded_key: uploadedKey,
    ...summary,
  }, null, 2));
}

async function promoteObjects(db: Database, client: S3Client, args: Args): Promise<void> {
  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error("promote requires --limit N");
  }
  if (!Number.isFinite(args.offset) || args.offset < 0) {
    throw new Error("--offset must be a non-negative number");
  }
  if (args.resultUpload && !args.resultOut) {
    throw new Error("--result-upload requires --result-out");
  }

  const rows = listRows(db)
    .filter((row) => row.size >= args.minSize && row.size <= args.maxSize)
    .sort((a, b) => a.size - b.size || a.s3_key.localeCompare(b.s3_key))
    .slice(args.offset)
    .slice(0, args.limit);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const resultStream = args.resultOut ? createResultStream(args.resultOut) : null;
  const summary = {
    run_id: runId,
    selected: rows.length,
    offset: args.offset,
    promoted: 0,
    would_promote: 0,
    already_present: 0,
    dry_run: args.dryRun,
    skipped_oversized: 0,
    errors: 0,
    bytes: 0,
  };

  for (const row of rows) {
    try {
      if (row.size > COPY_OBJECT_LIMIT_BYTES) {
        if (!args.largeObject) {
          summary.skipped_oversized++;
          writeResult(resultStream, {
            action: "skipped_oversized",
            file_record_id: row.file_record_id,
            s3_key: row.s3_key,
            size: row.size,
          });
          continue;
        }
      }

      const rawKey = rawKeyFor(row.s3_key, args.rawPrefix);
      const sha256 = row.size === 0
        ? EMPTY_SHA256
        : row.size > COPY_OBJECT_LIMIT_BYTES
          ? await computeSha256ViaDownload(client, args.bucket, rawKey, row.size)
          : await computeSha256ViaServerCopy(client, args.bucket, rawKey, `tmp/google-drive-sha256/${runId}/${row.file_record_id}`);
      const finalKey = canonicalKey(sha256);

      const existing = await headObject(client, args.bucket, finalKey, true);
      if (existing && existing.ContentLength === row.size) {
        summary.already_present++;
        writeResult(resultStream, {
          action: "already_present",
          file_record_id: row.file_record_id,
          raw_key: rawKey,
          final_key: finalKey,
          sha256,
          size: row.size,
        });
        continue;
      }

      if (!args.dryRun) {
        if (row.size > COPY_OBJECT_LIMIT_BYTES) {
          await multipartCopyObject(client, args.bucket, rawKey, finalKey, row, sha256);
        } else {
          await copyObject(client, args.bucket, rawKey, finalKey, row, sha256);
        }
        summary.promoted++;
      } else {
        summary.would_promote++;
      }

      summary.bytes += row.size;
      writeResult(resultStream, {
        action: args.dryRun ? "would_promote" : row.size > COPY_OBJECT_LIMIT_BYTES ? "promoted_large" : "promoted",
        file_record_id: row.file_record_id,
        raw_key: rawKey,
        final_key: finalKey,
        sha256,
        size: row.size,
      });
    } catch (error) {
      summary.errors++;
      const item = {
        action: "error",
        file_record_id: row.file_record_id,
        s3_key: row.s3_key,
        message: error instanceof Error ? error.message : String(error),
      };
      writeResult(resultStream, item, true);
    }
  }

  writeResult(resultStream, { action: "summary", ...summary });
  await closeResultStream(resultStream);

  let uploadedResultKey: string | undefined;
  if (args.resultUpload && args.resultOut) {
    uploadedResultKey = `${args.manifestPrefix}/promotion-results-${runId}.jsonl`;
    await client.send(new PutObjectCommand({
      Bucket: args.bucket,
      Key: uploadedResultKey,
      Body: readFileSync(args.resultOut),
      ContentLength: statSync(args.resultOut).size,
      ContentType: "application/x-ndjson",
      Metadata: {
        "source": "google-drive-canonicalize",
        "run-id": runId,
        "selected": String(summary.selected),
      },
    }));
  }

  console.log(JSON.stringify({
    ...summary,
    result_file: args.resultOut || undefined,
    uploaded_result_key: uploadedResultKey,
  }, null, 2));
}

type ManifestRecord = ReturnType<typeof manifestItem>;

type PromotionResultRecord = {
  action?: string;
  file_record_id?: string;
  raw_key?: string;
  final_key?: string;
  sha256?: string;
  size?: number;
  message?: string;
  errors?: number;
  selected?: number;
};

async function writeCanonicalMapping(client: S3Client, args: Args): Promise<void> {
  if (!existsSync(args.manifestFile)) {
    throw new Error(`Manifest file not found: ${args.manifestFile}`);
  }
  if (!existsSync(args.resultsDir)) {
    throw new Error(`Results directory not found: ${args.resultsDir}`);
  }

  const manifestRows = readJsonl<ManifestRecord>(args.manifestFile);
  const resultFiles = readdirSync(args.resultsDir)
    .filter((name) => /^google-drive-promotion-results-.*\.jsonl$/.test(name) || /^promotion-results-.*\.jsonl$/.test(name))
    .map((name) => join(args.resultsDir, name))
    .sort();
  if (resultFiles.length === 0) {
    throw new Error(`No promotion result JSONL files found in ${args.resultsDir}`);
  }

  const resultByFileRecordId = new Map<string, PromotionResultRecord>();
  const actionCounts = new Map<string, number>();
  const summary = {
    manifest_rows: manifestRows.length,
    result_files: resultFiles.length,
    result_rows: 0,
    result_summary_rows: 0,
    result_error_rows: 0,
    duplicate_result_rows: 0,
    mapped_rows: 0,
    missing_rows: 0,
    mismatched_rows: 0,
  };

  for (const file of resultFiles) {
    for (const result of readJsonl<PromotionResultRecord>(file)) {
      summary.result_rows++;
      const action = result.action ?? "unknown";
      actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
      if (action === "summary") {
        summary.result_summary_rows++;
        if ((result.errors ?? 0) > 0) summary.result_error_rows += result.errors ?? 0;
        continue;
      }
      if (action === "error") summary.result_error_rows++;
      if (!result.file_record_id) continue;
      if (resultByFileRecordId.has(result.file_record_id)) summary.duplicate_result_rows++;
      resultByFileRecordId.set(result.file_record_id, result);
    }
  }

  mkdirSync(dirname(args.mappingOut), { recursive: true });
  const stream = createWriteStream(args.mappingOut, { encoding: "utf8" });

  for (const row of manifestRows) {
    const result = resultByFileRecordId.get(row.file_record_id);
    const expectedFinalKey = result?.sha256 ? canonicalKey(result.sha256) : null;
    const finalKey = result?.final_key ?? expectedFinalKey;
    const mismatch = Boolean(
      result && (
        result.raw_key !== row.raw_key
        || result.size !== row.size
        || (expectedFinalKey && result.final_key && result.final_key !== expectedFinalKey)
      ),
    );
    if (result) summary.mapped_rows++;
    else summary.missing_rows++;
    if (mismatch) summary.mismatched_rows++;

    stream.write(`${JSON.stringify({
      ...row,
      canonical_bucket: args.bucket,
      canonical_key: finalKey,
      canonical_uri: finalKey ? `s3://${args.bucket}/${finalKey}` : null,
      canonical_sha256: result?.sha256 ?? null,
      raw_bucket: args.bucket,
      raw_uri: `s3://${args.bucket}/${row.raw_key}`,
      promotion_action: result?.action ?? null,
      promotion_result_size: result?.size ?? null,
      mapping_status: result
        ? mismatch
          ? "mismatch"
          : "mapped"
        : "missing_result",
      promotion_error: result?.action === "error" ? result.message ?? "" : "",
    })}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  let uploadedMappingKey: string | undefined;
  if (args.mappingUpload) {
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    uploadedMappingKey = `${args.manifestPrefix}/canonical-object-mapping-${runId}.jsonl`;
    await client.send(new PutObjectCommand({
      Bucket: args.bucket,
      Key: uploadedMappingKey,
      Body: readFileSync(args.mappingOut),
      ContentLength: statSync(args.mappingOut).size,
      ContentType: "application/x-ndjson",
      Metadata: {
        "source": "google-drive-canonicalize-mapping",
        "manifest-rows": String(summary.manifest_rows),
        "mapped-rows": String(summary.mapped_rows),
      },
    }));
  }

  console.log(JSON.stringify({
    mapping_file: args.mappingOut,
    uploaded_mapping_key: uploadedMappingKey,
    result_actions: Object.fromEntries([...actionCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    ...summary,
  }, null, 2));
}

function listRows(db: Database): Row[] {
  return db.query<Row, []>(`
    SELECT
      g.file_record_id,
      g.source_id,
      g.drive_id,
      g.file_id AS drive_file_id,
      g.profile,
      g.path,
      g.name,
      g.mime,
      g.size,
      g.modified_at,
      g.version,
      g.hash AS legacy_hash,
      g.storage_key,
      g.s3_key,
      g.destination_source_id
    FROM google_drive_imported_objects g
    WHERE g.deleted = 0
    ORDER BY g.s3_key
  `).all();
}

function manifestItem(row: Row, args: Args) {
  const legacyHash = row.legacy_hash ?? "";
  return {
    file_record_id: row.file_record_id,
    google_source_id: row.source_id,
    destination_source_id: row.destination_source_id,
    drive_id: row.drive_id,
    drive_file_id: row.drive_file_id,
    profile: row.profile,
    path: row.path,
    name: row.name,
    mime: row.mime,
    size: row.size,
    modified_at: row.modified_at,
    version: row.version,
    legacy_hash: row.legacy_hash,
    legacy_hash_kind: legacyHash.length === 32
      ? "md5"
      : legacyHash.length === 64
        ? "blake3_export"
        : "unknown",
    db_s3_key: row.s3_key,
    raw_key: rawKeyFor(row.s3_key, args.rawPrefix),
    promotion_status: row.size > COPY_OBJECT_LIMIT_BYTES ? "needs_large_object_sha256" : "ready_for_sha256_promotion",
  };
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSON in ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function computeSha256ViaServerCopy(client: S3Client, bucket: string, rawKey: string, tempKey: string): Promise<string> {
  const response = await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: tempKey,
    CopySource: `${bucket}/${encodeS3CopySourceKey(rawKey)}`,
    ChecksumAlgorithm: "SHA256",
    MetadataDirective: "COPY",
  }));

  let checksum = response.CopyObjectResult?.ChecksumSHA256;
  if (!checksum) {
    const head = await headObject(client, bucket, tempKey, true);
    checksum = head?.ChecksumSHA256;
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: tempKey }));
  if (!checksum) throw new Error(`S3 did not return SHA256 checksum for ${rawKey}`);
  return Buffer.from(checksum, "base64").toString("hex");
}

async function computeSha256ViaDownload(client: S3Client, bucket: string, rawKey: string, expectedSize: number): Promise<string> {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: rawKey,
  }));
  const body = response.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) throw new Error(`S3 did not return a body for ${rawKey}`);

  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }

  if (bytes !== expectedSize) {
    throw new Error(`Downloaded ${bytes} bytes for ${rawKey}, expected ${expectedSize}`);
  }

  return hash.digest("hex");
}

async function copyObject(client: S3Client, bucket: string, fromKey: string, toKey: string, row: Row, sha256: string): Promise<void> {
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: toKey,
    CopySource: `${bucket}/${encodeS3CopySourceKey(fromKey)}`,
    ChecksumAlgorithm: "SHA256",
    MetadataDirective: "REPLACE",
    ContentType: row.mime || "application/octet-stream",
    Metadata: canonicalMetadata(row, sha256),
  }));
}

async function multipartCopyObject(client: S3Client, bucket: string, fromKey: string, toKey: string, row: Row, sha256: string): Promise<void> {
  const create = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: toKey,
    ContentType: row.mime || "application/octet-stream",
    Metadata: canonicalMetadata(row, sha256),
  }));
  const uploadId = create.UploadId;
  if (!uploadId) throw new Error(`S3 did not return an upload ID for ${toKey}`);

  const parts: CompletedPart[] = [];
  try {
    let start = 0;
    let partNumber = 1;
    while (start < row.size) {
      const end = Math.min(start + LARGE_OBJECT_COPY_PART_SIZE, row.size) - 1;
      const response = await client.send(new UploadPartCopyCommand({
        Bucket: bucket,
        Key: toKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        CopySource: `${bucket}/${encodeS3CopySourceKey(fromKey)}`,
        CopySourceRange: `bytes=${start}-${end}`,
      }));
      const eTag = response.CopyPartResult?.ETag;
      if (!eTag) throw new Error(`S3 did not return an ETag for ${toKey} part ${partNumber}`);
      parts.push({ PartNumber: partNumber, ETag: eTag });
      start = end + 1;
      partNumber++;
    }

    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: toKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
  } catch (error) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: toKey,
      UploadId: uploadId,
    })).catch(() => undefined);
    throw error;
  }
}

function canonicalMetadata(row: Row, sha256: string): Record<string, string> {
  return {
    "sha256": sha256,
    "source": "google-drive",
    "import-run": "legacy-s3-2026-06-07",
    "file-record-id": row.file_record_id,
    "drive-file-id": row.drive_file_id,
    "legacy-hash-kind": legacyHashKind(row.legacy_hash),
  };
}

function legacyHashKind(legacyHash: string | null): "md5" | "blake3_export" | "unknown" {
  const value = legacyHash ?? "";
  if (value.length === 32) return "md5";
  if (value.length === 64) return "blake3_export";
  return "unknown";
}

function createResultStream(path: string): ReturnType<typeof createWriteStream> {
  mkdirSync(dirname(path), { recursive: true });
  return createWriteStream(path, { flags: "a", encoding: "utf8" });
}

function writeResult(stream: ReturnType<typeof createWriteStream> | null, item: Record<string, unknown>, stderr = false): void {
  const line = JSON.stringify(item);
  if (stderr) console.error(line);
  else console.log(line);
  stream?.write(`${line}\n`);
}

async function closeResultStream(stream: ReturnType<typeof createWriteStream> | null): Promise<void> {
  if (!stream) return;
  await new Promise<void>((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });
}

async function headObject(client: S3Client, bucket: string, key: string, checksum = false): Promise<HeadObjectCommandOutput | null> {
  try {
    return await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(checksum ? { ChecksumMode: "ENABLED" } : {}),
    }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey" || name === "NotFoundException") return null;
    throw error;
  }
}

function rawKeyFor(dbS3Key: string, rawPrefix: string): string {
  return `${rawPrefix}/${dbS3Key.replace(/^google-drive\//, "")}`;
}

function canonicalKey(sha256: string): string {
  return `objects/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

function encodeS3CopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

await main();
