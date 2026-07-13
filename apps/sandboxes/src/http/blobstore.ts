/**
 * Tenant-prefixed blob store for checkpoint payloads. S3 keys are
 * `sandboxes/<tenant_id>/<name>` so a tenant can never read another tenant's
 * blob even by guessing a content hash, and per-tenant lifecycle/deletion works
 * (Auth & Tenancy standard §3). Uses Bun's built-in S3 client; a memory
 * implementation backs tests + local runs.
 */
import { S3Client } from "bun";
import { sha256 } from "../canonical.js";

export interface PutResult {
  key: string;
  size_bytes: number;
  sha256: string;
}

export interface BlobStore {
  readonly kind: "s3" | "memory";
  put(tenantId: string, name: string, data: Uint8Array): Promise<PutResult>;
  get(tenantId: string, name: string): Promise<Uint8Array | null>;
  delete(tenantId: string, name: string): Promise<void>;
}

function tenantKey(tenantId: string, name: string): string {
  const safeName = name.replace(/^\/+/, "");
  return `sandboxes/${tenantId}/${safeName}`;
}

export class MemoryBlobStore implements BlobStore {
  readonly kind = "memory" as const;
  private readonly blobs = new Map<string, Uint8Array>();

  async put(tenantId: string, name: string, data: Uint8Array): Promise<PutResult> {
    const key = tenantKey(tenantId, name);
    this.blobs.set(key, data);
    return { key, size_bytes: data.byteLength, sha256: sha256(data) };
  }

  async get(tenantId: string, name: string): Promise<Uint8Array | null> {
    return this.blobs.get(tenantKey(tenantId, name)) ?? null;
  }

  async delete(tenantId: string, name: string): Promise<void> {
    this.blobs.delete(tenantKey(tenantId, name));
  }
}

export interface S3BlobStoreConfig {
  bucket: string;
  region?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  sessionToken?: string | undefined;
  endpoint?: string | undefined;
}

export class S3BlobStore implements BlobStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;

  constructor(config: S3BlobStoreConfig) {
    const options: ConstructorParameters<typeof S3Client>[0] = { bucket: config.bucket };
    if (config.region) options.region = config.region;
    if (config.accessKeyId) options.accessKeyId = config.accessKeyId;
    if (config.secretAccessKey) options.secretAccessKey = config.secretAccessKey;
    if (config.sessionToken) options.sessionToken = config.sessionToken;
    if (config.endpoint) options.endpoint = config.endpoint;
    this.client = new S3Client(options);
  }

  async put(tenantId: string, name: string, data: Uint8Array): Promise<PutResult> {
    const key = tenantKey(tenantId, name);
    await this.client.file(key).write(data);
    return { key, size_bytes: data.byteLength, sha256: sha256(data) };
  }

  async get(tenantId: string, name: string): Promise<Uint8Array | null> {
    const file = this.client.file(tenantKey(tenantId, name));
    if (!(await file.exists())) return null;
    return new Uint8Array(await file.arrayBuffer());
  }

  async delete(tenantId: string, name: string): Promise<void> {
    await this.client.file(tenantKey(tenantId, name)).delete();
  }
}

/** Build a BlobStore from env; falls back to memory when S3 is not configured. */
export function blobStoreFromEnv(env: Record<string, string | undefined> = process.env): BlobStore {
  const bucket = env["HASNA_SANDBOXES_S3_BUCKET"];
  if (!bucket) return new MemoryBlobStore();
  return new S3BlobStore({
    bucket,
    region: env["AWS_REGION"] ?? env["HASNA_SANDBOXES_S3_REGION"],
    accessKeyId: env["HASNA_SANDBOXES_S3_ACCESS_KEY_ID"] ?? env["AWS_ACCESS_KEY_ID"],
    secretAccessKey: env["HASNA_SANDBOXES_S3_SECRET_ACCESS_KEY"] ?? env["AWS_SECRET_ACCESS_KEY"],
    sessionToken: env["AWS_SESSION_TOKEN"],
  });
}
