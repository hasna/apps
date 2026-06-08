import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ingestOpenFilesManifestItems, type ManifestIngestResult, type ManifestObject } from './manifest-ingest';
import { parseSourceRef, type SourceRef } from './source-ref';
import { resolveOpenFilesSource } from './source-resolver';
import type { KnowledgeConfig } from './workspace';
import { assertS3ReadAllowed, assertWebSearchAllowed, type SafetyPolicy } from './safety';

export interface SourceIngestOptions {
  dbPath: string;
  sourceRef: string;
  purpose?: string;
  config?: KnowledgeConfig;
  safetyPolicy?: SafetyPolicy;
  now?: Date;
}

export interface SourceIngestResult extends ManifestIngestResult {
  source_ref: string;
  content_source: 'catalog_chunks' | 'extracted_text_ref' | 'file' | 's3' | 'web';
  read_only: true;
  hash: string;
}

interface ResolvedText {
  text: string;
  contentSource: SourceIngestResult['content_source'];
  title: string | null;
  mime: string | null;
  size: number | null;
  hash: string | null;
  revision: string | null;
  extractedTextRef: string | null;
  metadata: Record<string, unknown>;
  permissions: Record<string, unknown>;
}

function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function readS3Text(uri: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<string> {
  const parsed = new URL(uri);
  const bucket = parsed.hostname;
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!bucket || !key) throw new Error(`Invalid S3 source URI: ${uri}`);
  if (safetyPolicy) assertS3ReadAllowed(uri, safetyPolicy);
  const [{ S3Client, GetObjectCommand }, { fromIni }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/credential-providers'),
  ]);
  const s3Config = config?.storage.type === 's3' && config.storage.s3?.bucket === bucket ? config.storage.s3 : undefined;
  const client = new S3Client({
    region: s3Config?.region,
    credentials: s3Config?.profile ? fromIni({ profile: s3Config.profile }) : undefined,
    maxAttempts: s3Config?.max_attempts,
  });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) return '';
  return await response.Body.transformToString();
}

async function readWebText(uri: string, safetyPolicy?: SafetyPolicy): Promise<{ text: string; mime: string | null }> {
  if (safetyPolicy) assertWebSearchAllowed(safetyPolicy);
  const response = await fetch(uri, {
    headers: {
      accept: 'text/markdown,text/plain,text/html,application/json;q=0.8,*/*;q=0.5',
      'user-agent': '@hasna/knowledge source-ingest',
    },
  });
  if (!response.ok) throw new Error(`Web source read failed ${response.status}: ${uri}`);
  const mime = response.headers.get('content-type');
  const body = await response.text();
  return { text: mime?.includes('html') ? stripHtml(body) : body, mime };
}

function titleForRef(parsed: SourceRef): string | null {
  if (parsed.kind === 'file') return basename(parsed.path);
  if (parsed.kind === 's3') return basename(parsed.key);
  if (parsed.kind === 'web') return basename(new URL(parsed.url).pathname) || parsed.url;
  return parsed.path ? basename(parsed.path) : parsed.id;
}

async function readDirectSourceText(parsed: SourceRef, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<ResolvedText> {
  if (parsed.kind === 'file') {
    if (!existsSync(parsed.path)) throw new Error(`Source file not found: ${parsed.path}`);
    const text = readFileSync(parsed.path, 'utf8');
    return {
      text,
      contentSource: 'file',
      title: titleForRef(parsed),
      mime: 'text/plain',
      size: text.length,
      hash: sha256Text(text),
      revision: null,
      extractedTextRef: null,
      metadata: { path: parsed.path },
      permissions: { mode: 'read_only' },
    };
  }

  if (parsed.kind === 's3') {
    const text = await readS3Text(parsed.uri, config, safetyPolicy);
    return {
      text,
      contentSource: 's3',
      title: titleForRef(parsed),
      mime: 'text/plain',
      size: text.length,
      hash: sha256Text(text),
      revision: null,
      extractedTextRef: null,
      metadata: { bucket: parsed.bucket, key: parsed.key },
      permissions: { mode: 'read_only' },
    };
  }

  if (parsed.kind === 'web') {
    const web = await readWebText(parsed.url, safetyPolicy);
    return {
      text: web.text,
      contentSource: 'web',
      title: titleForRef(parsed),
      mime: web.mime,
      size: web.text.length,
      hash: sha256Text(web.text),
      revision: null,
      extractedTextRef: null,
      metadata: { url: parsed.url },
      permissions: { mode: 'read_only' },
    };
  }

  throw new Error(`Direct source reading is not available for ${parsed.uri}`);
}

async function readTextRef(uri: string, config?: KnowledgeConfig, safetyPolicy?: SafetyPolicy): Promise<{ text: string; contentSource: SourceIngestResult['content_source'] }> {
  if (uri.startsWith('open-files://')) {
    throw new Error('Open-files extracted text refs require an open-files resolver API. Ingest an open-files manifest with extracted_text or an extracted_text_ref using file://, s3://, or https://.');
  }
  const parsed = parseSourceRef(uri);
  const direct = await readDirectSourceText(parsed, config, safetyPolicy);
  return { text: direct.text, contentSource: 'extracted_text_ref' };
}

async function readOpenFilesSourceText(options: SourceIngestOptions): Promise<ResolvedText> {
  const resolved = await resolveOpenFilesSource({
    dbPath: options.dbPath,
    sourceRef: options.sourceRef,
    purpose: options.purpose ?? 'knowledge_index',
    limit: 100,
    safetyPolicy: options.safetyPolicy,
    now: options.now,
  });
  if (!resolved.resolved) {
    throw new Error('Open-files source is not in the local knowledge catalog. Ingest an open-files manifest first or use the open-files resolver API.');
  }
  if (resolved.revision?.extracted_text_uri && !resolved.content.text_available) {
    const textRef = await readTextRef(resolved.revision.extracted_text_uri, options.config, options.safetyPolicy);
    return {
      text: textRef.text,
      contentSource: textRef.contentSource,
      title: resolved.source?.title ?? null,
      mime: resolved.content.mime,
      size: textRef.text.length,
      hash: resolved.revision.hash ?? sha256Text(textRef.text),
      revision: resolved.revision.revision,
      extractedTextRef: resolved.revision.extracted_text_uri,
      metadata: resolved.source?.metadata ?? {},
      permissions: resolved.source?.permissions ?? { mode: 'read_only' },
    };
  }
  if (resolved.chunks.length === 0) {
    throw new Error('Open-files source has no extracted text chunks yet. Ingest an open-files manifest with extracted_text or extracted_text_ref first.');
  }
  const text = resolved.chunks.map((chunk) => chunk.text).join('\n\n');
  return {
    text,
    contentSource: 'catalog_chunks',
    title: resolved.source?.title ?? null,
    mime: resolved.content.mime,
    size: text.length,
    hash: resolved.revision?.hash ?? sha256Text(text),
    revision: resolved.revision?.revision ?? null,
    extractedTextRef: resolved.revision?.extracted_text_uri ?? null,
    metadata: resolved.source?.metadata ?? {},
    permissions: resolved.source?.permissions ?? { mode: 'read_only' },
  };
}

function manifestItemForSource(sourceRef: string, parsed: SourceRef, resolved: ResolvedText, purpose: string): ManifestObject {
  const hash = resolved.hash ?? sha256Text(resolved.text);
  const metadata = {
    ...resolved.metadata,
    source_ref: sourceRef,
    content_source: resolved.contentSource,
    read_only: true,
  };
  const item: ManifestObject = {
    source_ref: sourceRef,
    name: resolved.title ?? titleForRef(parsed),
    mime: resolved.mime ?? 'text/plain',
    size: resolved.size ?? resolved.text.length,
    hash,
    revision: resolved.revision ?? hash,
    status: 'active',
    updated_at: new Date().toISOString(),
    permissions: {
      mode: 'read_only',
      allowed_purposes: [purpose],
      ...resolved.permissions,
    },
    metadata,
    extracted_text_ref: resolved.extractedTextRef,
    extracted_text: resolved.text,
  };
  if (parsed.kind === 'open-files') {
    if (parsed.entity === 'file') item.file_id = parsed.id;
    if (parsed.entity === 'source') {
      item.source_id = parsed.id;
      item.path = parsed.path;
    }
  }
  if (parsed.kind === 'file') item.path = parsed.path;
  if (parsed.kind === 's3') item.path = parsed.key;
  if (parsed.kind === 'web') item.url = parsed.url;
  return item;
}

export async function ingestSourceRef(options: SourceIngestOptions): Promise<SourceIngestResult> {
  const purpose = options.purpose ?? 'knowledge_index';
  const parsed = parseSourceRef(options.sourceRef);
  const resolved = parsed.kind === 'open-files'
    ? await readOpenFilesSourceText(options)
    : await readDirectSourceText(parsed, options.config, options.safetyPolicy);
  const item = manifestItemForSource(options.sourceRef, parsed, resolved, purpose);
  const result = await ingestOpenFilesManifestItems({
    dbPath: options.dbPath,
    items: [item],
    sourceLabel: options.sourceRef,
    readAction: 'source_ref_ingest_read',
    safetyPolicy: options.safetyPolicy,
    now: options.now,
  });
  return {
    ...result,
    source_ref: options.sourceRef,
    content_source: resolved.contentSource,
    read_only: true,
    hash: String(item.hash),
  };
}
