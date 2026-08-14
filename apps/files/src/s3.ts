import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type PutObjectCommandInput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3ObjectStoreConfig {
  region?: string;
  endpoint?: string;
  credentials?: S3ClientConfig["credentials"];
  forcePathStyle?: boolean;
  client?: S3Client;
  signer?: S3UrlSigner;
}

export interface PutS3ObjectInput {
  bucket: string;
  key: string;
  body: PutObjectCommandInput["Body"];
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface GetS3ObjectInput {
  bucket: string;
  key: string;
}

export interface DeleteS3ObjectInput {
  bucket: string;
  key: string;
}

export interface ListS3ObjectsInput {
  bucket: string;
  prefix?: string;
}

export interface SignedS3DownloadUrlInput {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}

export interface SignedS3UploadUrlInput {
  bucket: string;
  key: string;
  contentType?: string;
  contentLength?: number;
  expiresInSeconds?: number;
  signableHeaders?: Set<string>;
}

export interface S3ObjectHead {
  size: number;
  contentType: string;
  lastModified?: Date;
}

export interface ListedS3Object {
  key: string;
  size: number;
  lastModified?: Date;
}

export type S3UrlSigner = (
  client: S3Client,
  command: GetObjectCommand | PutObjectCommand,
  options: { expiresIn?: number; signableHeaders?: Set<string> },
) => Promise<string>;

export interface S3ObjectStore {
  putObject(input: PutS3ObjectInput): Promise<void>;
  getObject(input: GetS3ObjectInput): Promise<GetObjectCommandOutput | null>;
  getObjectBodyBuffer(input: GetS3ObjectInput): Promise<Buffer | null>;
  deleteObject(input: DeleteS3ObjectInput): Promise<void>;
  headObject(input: GetS3ObjectInput): Promise<S3ObjectHead | null>;
  objectExists(input: GetS3ObjectInput): Promise<boolean>;
  listObjects(input: ListS3ObjectsInput): Promise<ListedS3Object[]>;
  getSignedDownloadUrl(input: SignedS3DownloadUrlInput): Promise<string>;
  getSignedUploadUrl(input: SignedS3UploadUrlInput): Promise<string>;
}

export function createS3ObjectStore(
  config: S3ObjectStoreConfig = {},
): S3ObjectStore {
  const client =
    config.client ??
    new S3Client({
      ...(config.region ? { region: config.region } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.credentials ? { credentials: config.credentials } : {}),
      ...(config.forcePathStyle !== undefined
        ? { forcePathStyle: config.forcePathStyle }
        : {}),
    });
  const signer = config.signer ?? getSignedUrl;

  return {
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
          Metadata: input.metadata,
        }),
      );
    },

    async getObject(input) {
      try {
        return await client.send(
          new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        );
      } catch (error) {
        if (isMissingS3ObjectError(error)) return null;
        throw error;
      }
    },

    async getObjectBodyBuffer(input) {
      const object = await this.getObject(input);
      if (!object) return null;
      return s3BodyToBuffer(object.Body);
    },

    async deleteObject(input) {
      await client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
    },

    async headObject(input) {
      try {
        const object = await client.send(
          new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
        );
        return {
          size: object.ContentLength ?? 0,
          contentType: object.ContentType ?? "application/octet-stream",
          lastModified: object.LastModified,
        };
      } catch (error) {
        if (isMissingS3ObjectError(error)) return null;
        throw error;
      }
    },

    async objectExists(input) {
      return (await this.headObject(input)) !== null;
    },

    async listObjects(input) {
      const objects: ListedS3Object[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const object of result.Contents ?? []) {
          if (!object.Key) continue;
          objects.push({
            key: object.Key,
            size: object.Size ?? 0,
            lastModified: object.LastModified,
          });
        }
        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return objects;
    },

    async getSignedDownloadUrl(input) {
      return signer(
        client,
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { expiresIn: input.expiresInSeconds ?? 3600 },
      );
    },

    async getSignedUploadUrl(input) {
      return signer(
        client,
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        }),
        {
          expiresIn: input.expiresInSeconds ?? 600,
          signableHeaders: input.signableHeaders,
        },
      );
    },
  };
}

export function isMissingS3ObjectError(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = candidate?.name || candidate?.Code || candidate?.code || "";
  return (
    code === "NoSuchKey" ||
    code === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}

export async function s3BodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");

  const candidate = body as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    transformToByteArray?: () => Promise<Uint8Array>;
    transformToString?: (encoding?: string) => Promise<string>;
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<
      Uint8Array | Buffer | string
    >;
  };

  if (typeof candidate.arrayBuffer === "function") {
    return Buffer.from(await candidate.arrayBuffer());
  }
  if (typeof candidate.transformToByteArray === "function") {
    return Buffer.from(await candidate.transformToByteArray());
  }
  if (typeof candidate.transformToString === "function") {
    return Buffer.from(await candidate.transformToString("utf8"), "utf8");
  }
  if (typeof candidate.getReader === "function") {
    const reader = candidate.getReader();
    const chunks: Buffer[] = [];
    let done = false;
    while (!done) {
      const next = await reader.read();
      done = next.done;
      if (next.value) chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof candidate[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<
      Uint8Array | Buffer | string
    >) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 body type");
}
