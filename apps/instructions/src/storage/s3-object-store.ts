import type { InstructionsS3Config } from "./s3-config.js";

export interface InstructionsObjectMetadata {
  size: number;
  etag?: string;
  contentType?: string;
  lastModified?: Date;
}

export interface InstructionsObjectStore {
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  head(key: string): Promise<InstructionsObjectMetadata | undefined>;
  delete(key: string): Promise<void>;
}

export interface InstructionsNativeS3File {
  exists(): Promise<boolean>;
  bytes(): Promise<Uint8Array>;
  stat(): Promise<{ size: number; etag: string; type: string; lastModified: Date }>;
}

export interface InstructionsNativeS3Client {
  write(key: string, bytes: Uint8Array, options?: { type?: string }): Promise<number>;
  file(key: string): InstructionsNativeS3File;
  delete(key: string): Promise<void>;
}

export type InstructionsNativeS3ClientFactory = (
  options: ConstructorParameters<typeof Bun.S3Client>[0],
) => InstructionsNativeS3Client;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Validate a complete bucket-relative object key at every adapter boundary. */
export function assertSafeInstructionsObjectKey(key: string): void {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    CONTROL_CHARACTERS.test(key)
  ) {
    throw new Error("Instructions S3 object key is invalid");
  }
  for (const segment of key.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("Instructions S3 object key contains an unsafe path segment");
    }
  }
}

/** Bun-native S3 adapter; callers can inject a factory for deterministic tests. */
export function createInstructionsS3ObjectStore(
  config: InstructionsS3Config,
  createClient: InstructionsNativeS3ClientFactory = (options) => new Bun.S3Client(options),
): InstructionsObjectStore {
  const client = createClient({
    bucket: config.bucket,
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.credentials
      ? {
          accessKeyId: config.credentials.accessKeyId,
          secretAccessKey: config.credentials.secretAccessKey,
          ...(config.credentials.sessionToken ? { sessionToken: config.credentials.sessionToken } : {}),
        }
      : {}),
    ...(config.forcePathStyle ? { virtualHostedStyle: false } : {}),
  });

  return {
    async put(key, bytes, options) {
      assertSafeInstructionsObjectKey(key);
      await client.write(key, bytes, { type: options.contentType });
    },
    async get(key) {
      assertSafeInstructionsObjectKey(key);
      const file = client.file(key);
      if (!(await file.exists())) return undefined;
      return Uint8Array.from(await file.bytes());
    },
    async head(key) {
      assertSafeInstructionsObjectKey(key);
      const file = client.file(key);
      if (!(await file.exists())) return undefined;
      const stat = await file.stat();
      return {
        size: stat.size,
        ...(stat.etag ? { etag: stat.etag } : {}),
        ...(stat.type ? { contentType: stat.type } : {}),
        ...(stat.lastModified ? { lastModified: stat.lastModified } : {}),
      };
    },
    async delete(key) {
      assertSafeInstructionsObjectKey(key);
      await client.delete(key);
    },
  };
}

/** In-memory object store for tests and non-network planning fixtures. */
export function memoryInstructionsObjectStore(): InstructionsObjectStore & { keys(): string[] } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; lastModified: Date }>();
  return {
    async put(key, bytes, options) {
      assertSafeInstructionsObjectKey(key);
      objects.set(key, {
        bytes: Uint8Array.from(bytes),
        contentType: options.contentType,
        lastModified: new Date(),
      });
    },
    async get(key) {
      assertSafeInstructionsObjectKey(key);
      const object = objects.get(key);
      return object ? Uint8Array.from(object.bytes) : undefined;
    },
    async head(key) {
      assertSafeInstructionsObjectKey(key);
      const object = objects.get(key);
      return object
        ? { size: object.bytes.byteLength, contentType: object.contentType, lastModified: new Date(object.lastModified) }
        : undefined;
    },
    async delete(key) {
      assertSafeInstructionsObjectKey(key);
      objects.delete(key);
    },
    keys() {
      return [...objects.keys()].sort();
    },
  };
}
