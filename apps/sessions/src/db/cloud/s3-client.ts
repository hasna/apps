import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client as AwsS3Client,
  type S3ClientConfig as AwsS3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

export interface S3ObjectInfo {
  contentLength?: number;
  contentType?: string;
}

interface S3Transport {
  send(command: unknown): Promise<unknown>;
}

interface ManagedUpload {
  done(): Promise<unknown>;
}

interface ManagedUploadInput {
  client: S3Transport;
  params: {
    Bucket: string;
    Key: string;
    Body: Buffer | Uint8Array;
    ContentType?: string;
  };
}

export interface S3ClientDependencies {
  createClient?: (config: AwsS3ClientConfig) => S3Transport;
  createUpload?: (input: ManagedUploadInput) => ManagedUpload;
  presign?: (
    client: S3Transport,
    command: GetObjectCommand | PutObjectCommand,
    expiresIn: number
  ) => Promise<string>;
}

const MANAGED_UPLOAD_THRESHOLD = 5 * 1024 * 1024;

function createAwsClient(config: AwsS3ClientConfig): S3Transport {
  return new AwsS3Client(config);
}

function createManagedUpload(input: ManagedUploadInput): ManagedUpload {
  return new Upload({
    client: input.client as AwsS3Client,
    params: input.params,
    leavePartsOnError: false,
  });
}

async function presignCommand(
  client: S3Transport,
  command: GetObjectCommand | PutObjectCommand,
  expiresIn: number
): Promise<string> {
  return getSignedUrl(client as AwsS3Client, command, { expiresIn });
}

async function responseBodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);

  if (
    body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function"
  ) {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body && Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 response body");
}

export class S3Client {
  private readonly bucket: string;
  private readonly client: S3Transport;
  private readonly createUpload: (input: ManagedUploadInput) => ManagedUpload;
  private readonly sign: NonNullable<S3ClientDependencies["presign"]>;

  constructor(config: S3Config, dependencies: S3ClientDependencies = {}) {
    this.bucket = config.bucket;
    this.createUpload = dependencies.createUpload ?? createManagedUpload;
    this.sign = dependencies.presign ?? presignCommand;

    const clientConfig: AwsS3ClientConfig = {
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
      ...(config.endpoint !== undefined
        ? { endpoint: config.endpoint, forcePathStyle: true }
        : {}),
    };

    this.client = (dependencies.createClient ?? createAwsClient)(clientConfig);
  }

  async upload(
    key: string,
    body: Buffer | Uint8Array,
    contentType?: string
  ): Promise<void> {
    const params = {
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ...(contentType !== undefined ? { ContentType: contentType } : {}),
    };

    if (body.byteLength > MANAGED_UPLOAD_THRESHOLD) {
      await this.createUpload({ client: this.client, params }).done();
      return;
    }

    await this.client.send(new PutObjectCommand(params));
  }

  async download(key: string): Promise<Buffer> {
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    )) as { Body?: unknown };

    if (response.Body === undefined) {
      throw new Error(`No body returned for key: ${key}`);
    }

    return responseBodyToBuffer(response.Body);
  }

  async head(key: string): Promise<S3ObjectInfo> {
    const response = (await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key })
    )) as { ContentLength?: number; ContentType?: string };

    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async presign(key: string, expiresIn: number): Promise<string> {
    return this.sign(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      expiresIn
    );
  }

  async presignPut(
    key: string,
    contentType: string,
    expiresIn: number
  ): Promise<string> {
    return this.sign(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      expiresIn
    );
  }
}
