/**
 * @hasna/prompts — markdown body store.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Prompt bodies live outside the metadata database as immutable markdown
 * objects. The object layout is `prompts/<prompt-id>/versions/<version>.md`
 * on every transport: a local folder mirrors the relative key, S3 stores the
 * same key under an optional prefix. Mutable slugs never appear in keys.
 *
 * Mirrors @hasna/knowledge's artifact-store pattern (normalizeArtifactKey,
 * traversal-safe keys, local 0700/0600, S3 prefix/region/profile/SSE/KMS).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const PROMPTS_BODY_PATH_ENV = 'HASNA_PROMPTS_BODY_PATH';
export const PROMPTS_S3_BUCKET_ENV = 'HASNA_PROMPTS_S3_BUCKET';
export const PROMPTS_S3_PREFIX_ENV = 'HASNA_PROMPTS_S3_PREFIX';
export const PROMPTS_AWS_REGION_ENV = 'HASNA_PROMPTS_AWS_REGION';

/** Object layout: `prompts/<prompt-id>/versions/<version>.md`. */
export function promptBodyKey(promptId: string, version: number): string {
  return `prompts/${promptId}/versions/${version}.md`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function bytesOf(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

export interface BodyWrite {
  key: string;
  body: string;
  content_type?: string;
}

export interface BodyWriteResult {
  key: string;
  uri: string;
}

export interface BodyStore {
  readonly type: 'local' | 's3';
  readonly canRead: boolean;
  readonly canWrite: boolean;
  put(entry: BodyWrite): Promise<BodyWriteResult>;
  getText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  /** Stable URI for a logical key, without touching the object store. */
  uriFor(key: string): string;
}

export function normalizeBodyKey(key: string): string {
  const raw = key.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/')) {
    throw new Error(`Invalid body key: ${key}`);
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid body key: ${key}`);
  }
  return segments.join('/');
}

function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Body path escapes root: ${target}`);
  }
}

export class LocalBodyStore implements BodyStore {
  readonly type = 'local' as const;
  readonly canRead = true;
  readonly canWrite = true;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  async put(entry: BodyWrite): Promise<BodyWriteResult> {
    const key = normalizeBodyKey(entry.key);
    const path = join(this.root, key);
    assertInside(this.root, path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, entry.body, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { key, uri: pathToFileURL(path).href };
  }

  uriFor(key: string): string {
    const normalizedKey = normalizeBodyKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return pathToFileURL(path).href;
  }

  async getText(key: string): Promise<string> {
    const normalizedKey = normalizeBodyKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return readFileSync(path, 'utf8');
  }

  async exists(key: string): Promise<boolean> {
    const normalizedKey = normalizeBodyKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return existsSync(path);
  }

  /** Absolute filesystem path for a key; used by storage status/reconcile. */
  resolvePath(key: string): string {
    const normalizedKey = normalizeBodyKey(key);
    const path = join(this.root, normalizedKey);
    assertInside(this.root, path);
    return path;
  }

  /** Enumerate stored keys under the root. Only local stores can enumerate. */
  listKeys(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else if (entry.isFile()) out.push(rel);
      }
    };
    walk(this.root, "");
    return out;
  }
}

export interface S3BodyStoreOptions {
  bucket: string;
  prefix?: string;
  region?: string;
  profile?: string;
  server_side_encryption?: 'AES256' | 'aws:kms';
  kms_key_id?: string;
  client?: S3ClientLike;
}

export class S3BodyStore implements BodyStore {
  readonly type = 's3' as const;
  readonly canRead = true;
  readonly canWrite = true;
  private client?: S3ClientLike;

  constructor(private readonly options: S3BodyStoreOptions) {
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
    }) as unknown as S3ClientLike;
    return this.client;
  }

  private objectKey(key: string): string {
    const normalizedKey = normalizeBodyKey(key);
    const prefix = this.options.prefix ? normalizeBodyKey(this.options.prefix) : '';
    return prefix ? `${prefix}/${normalizedKey}` : normalizedKey;
  }

  async put(entry: BodyWrite): Promise<BodyWriteResult> {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import('@aws-sdk/client-s3'),
      this.getClient(),
    ]);
    const logicalKey = normalizeBodyKey(entry.key);
    const key = this.objectKey(logicalKey);
    await client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: entry.body,
      ContentType: entry.content_type ?? 'text/markdown; charset=utf-8',
      ServerSideEncryption: this.options.server_side_encryption,
      SSEKMSKeyId: this.options.kms_key_id,
    }));
    return { key: logicalKey, uri: `s3://${this.options.bucket}/${key}` };
  }

  uriFor(key: string): string {
    return `s3://${this.options.bucket}/${this.objectKey(key)}`;
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
    })) as { Body?: { transformToString(): Promise<string> } };
    if (!response.Body) {
      throw new Error(`s3 body object ${objectKey} returned no body`);
    }
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

export interface ResolvedBodyStore {
  store: BodyStore;
  root: string;
  source: string;
}

/**
 * Resolve the server-side body store from environment. The body path selects
 * the local markdown folder; otherwise a configured S3 bucket selects S3. With
 * neither, `fallbackRoot` (the prompts data directory) hosts the local folder.
 * This is SERVER-side selection (prompts-serve and the storage verbs); a
 * client never receives S3 credentials and never constructs an S3 store.
 */
export function resolveBodyStore(
  env: NodeJS.ProcessEnv = process.env,
  fallbackRoot?: string,
): ResolvedBodyStore {
  const bodyPath = env[PROMPTS_BODY_PATH_ENV]?.trim();
  if (bodyPath) {
    return { store: new LocalBodyStore(bodyPath), root: bodyPath, source: PROMPTS_BODY_PATH_ENV };
  }
  const bucket = env[PROMPTS_S3_BUCKET_ENV]?.trim();
  if (bucket) {
    return {
      store: new S3BodyStore({
        bucket,
        prefix: env[PROMPTS_S3_PREFIX_ENV]?.trim() || undefined,
        region: env[PROMPTS_AWS_REGION_ENV]?.trim() || undefined,
      }),
      root: `s3://${bucket}`,
      source: PROMPTS_S3_BUCKET_ENV,
    };
  }
  const home = env.HOME || env.USERPROFILE || '~';
  const root = fallbackRoot ?? join(home, '.hasna', 'prompts', 'bodies');
  return { store: new LocalBodyStore(root), root, source: 'default' };
}

/**
 * Named failure for a body object whose stored hash or byte count does not
 * match what was read. Never an empty body.
 */
export class PromptBodyCorruptError extends Error {
  readonly code = 'prompt_body_corrupt';
  readonly kind = 'corrupt' as const;

  constructor(
    readonly key: string,
    readonly expectedSha256: string,
    readonly actualSha256: string,
    readonly expectedBytes: number,
    readonly actualBytes: number,
  ) {
    super(
      `prompt body ${key} is corrupt: expected sha256 ${expectedSha256} (${expectedBytes} bytes), `
        + `read ${actualSha256} (${actualBytes} bytes).`,
    );
    this.name = 'PromptBodyCorruptError';
  }
}

/** Named failure for a body object that is missing from the store. */
export class PromptBodyMissingError extends Error {
  readonly code = 'prompt_body_missing';
  readonly kind = 'missing' as const;

  constructor(readonly key: string) {
    super(`prompt body ${key} is missing from the body store.`);
    this.name = 'PromptBodyMissingError';
  }
}

export interface VerifiedBodyRead {
  body: string;
  sha256: string;
  bytes: number;
}

/**
 * Read a body object and verify its SHA-256 and byte count. The body store
 * never returns an empty body for a stored object: a missing object or a
 * corrupt object raises a named failure.
 */
export async function readBodyVerified(
  store: BodyStore,
  key: string,
  expectedSha256: string | null,
  expectedBytes: number | null,
): Promise<VerifiedBodyRead> {
  if (!(await store.exists(key))) {
    throw new PromptBodyMissingError(key);
  }
  const body = await store.getText(key);
  const sha256 = sha256Hex(body);
  const bytes = bytesOf(body);
  if (expectedSha256 !== null && expectedSha256 !== sha256) {
    throw new PromptBodyCorruptError(key, expectedSha256, sha256, expectedBytes ?? -1, bytes);
  }
  if (expectedBytes !== null && expectedBytes !== bytes) {
    throw new PromptBodyCorruptError(key, expectedSha256 ?? sha256, sha256, expectedBytes, bytes);
  }
  return { body, sha256, bytes };
}
