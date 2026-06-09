import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';

interface S3ClientLike {
  send(command: unknown): Promise<any>;
}

export interface ArtifactWrite {
  key: string;
  body: string | Uint8Array;
  content_type?: string;
  metadata?: Record<string, string>;
}

export interface ArtifactStore {
  readonly type: 'local' | 's3';
  readonly canRead: boolean;
  readonly canWrite: boolean;
  put(entry: ArtifactWrite): Promise<{ key: string; uri: string }>;
  getText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export function normalizeArtifactKey(key: string): string {
  const raw = key.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/')) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  return segments.join('/');
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Artifact path escapes root: ${target}`);
  }
}

export class LocalArtifactStore implements ArtifactStore {
  readonly type = 'local' as const;
  readonly canRead = true;
  readonly canWrite = true;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  async put(entry: ArtifactWrite): Promise<{ key: string; uri: string }> {
    const key = normalizeArtifactKey(entry.key);
    const path = join(this.root, key);
    assertInside(this.root, path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.body);
    return { key, uri: `file://${path}` };
  }

  async getText(key: string): Promise<string> {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return readFileSync(path, 'utf8');
  }

  async exists(key: string): Promise<boolean> {
    const normalizedKey = normalizeArtifactKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return existsSync(path);
  }
}

export interface S3ArtifactStoreOptions {
  bucket: string;
  prefix?: string;
  region?: string;
  profile?: string;
  max_attempts?: number;
  server_side_encryption?: 'AES256' | 'aws:kms';
  kms_key_id?: string;
  client?: S3ClientLike;
}

export class S3ArtifactStore implements ArtifactStore {
  readonly type = 's3' as const;
  readonly canRead = true;
  readonly canWrite = true;
  private client?: S3ClientLike;

  constructor(private readonly options: S3ArtifactStoreOptions) {
    this.client = options.client;
  }

  private async getClient(): Promise<S3ClientLike> {
    if (this.client) return this.client;
    const [{ S3Client }, { fromIni }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/credential-providers'),
    ]);
    this.client = new S3Client({
      region: this.options.region,
      credentials: this.options.profile ? fromIni({ profile: this.options.profile }) : undefined,
      maxAttempts: this.options.max_attempts,
    });
    return this.client;
  }

  private objectKey(key: string): string {
    const normalizedKey = normalizeArtifactKey(key);
    const prefix = this.options.prefix ? normalizeArtifactKey(this.options.prefix) : '';
    return prefix ? `${prefix}/${normalizedKey}` : normalizedKey;
  }

  async put(entry: ArtifactWrite): Promise<{ key: string; uri: string }> {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.getClient(),
    ]);
    const logicalKey = normalizeArtifactKey(entry.key);
    const key = this.objectKey(logicalKey);
    await client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: entry.body,
      ContentType: entry.content_type,
      Metadata: entry.metadata,
      ServerSideEncryption: this.options.server_side_encryption,
      SSEKMSKeyId: this.options.kms_key_id,
    }));
    return { key: logicalKey, uri: `s3://${this.options.bucket}/${key}` };
  }

  async getText(key: string): Promise<string> {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.getClient(),
    ]);
    const objectKey = this.objectKey(key);
    const response = await client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
    }));
    if (!response.Body) return '';
    return await response.Body.transformToString();
  }

  async exists(key: string): Promise<boolean> {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.getClient(),
    ]);
    const objectKey = this.objectKey(key);
    try {
      await client.send(new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
      }));
      return true;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotFound' || name === 'NoSuchKey' || name === 'NotFoundError') return false;
      throw error;
    }
  }
}

export function createArtifactStore(config: KnowledgeConfig, workspace: KnowledgeWorkspace): ArtifactStore {
  if (config.storage.type === 's3') {
    if (!config.storage.s3?.bucket) throw new Error('S3 artifact storage requires storage.s3.bucket');
    return new S3ArtifactStore({
      bucket: config.storage.s3.bucket,
      prefix: config.storage.s3.prefix,
      region: config.storage.s3.region,
      profile: config.storage.s3.profile,
      max_attempts: config.storage.s3.max_attempts,
      server_side_encryption: config.storage.s3.server_side_encryption,
      kms_key_id: config.storage.s3.kms_key_id,
    });
  }
  return new LocalArtifactStore(workspace.artifactsDir);
}
