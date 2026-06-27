import { fileURLToPath } from 'node:url';

export type SourceRefKind = 'open-files' | 's3' | 'file' | 'web';

export interface BaseSourceRef {
  kind: SourceRefKind;
  uri: string;
}

export interface OpenFilesSourceRef extends BaseSourceRef {
  kind: 'open-files';
  entity: 'file' | 'source';
  id: string;
  revision_id?: string;
  path?: string;
}

export interface S3SourceRef extends BaseSourceRef {
  kind: 's3';
  bucket: string;
  key: string;
}

export interface FileSourceRef extends BaseSourceRef {
  kind: 'file';
  path: string;
}

export interface WebSourceRef extends BaseSourceRef {
  kind: 'web';
  url: string;
}

export type SourceRef = OpenFilesSourceRef | S3SourceRef | FileSourceRef | WebSourceRef;

function assertNonEmpty(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function parseOpenFilesRef(uri: string): OpenFilesSourceRef {
  const withoutScheme = uri.slice('open-files://'.length);
  const parts = withoutScheme.split('/').filter(Boolean);
  const entity = parts[0];
  if (entity !== 'file' && entity !== 'source') {
    throw new Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://file/<id>/revision/<revision_id>, or open-files://source/<id>/path/<path>.");
  }
  const id = assertNonEmpty(parts[1], 'Invalid open-files ref. Missing id.');
  if (entity === 'file') {
    if (parts.length === 2) return { kind: 'open-files', uri, entity, id };
    if (parts[2] === 'revision' && parts[3] && parts.length === 4) {
      return { kind: 'open-files', uri, entity, id, revision_id: decodeURIComponent(parts[3]) };
    }
    throw new Error('Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.');
  }
  const pathIndex = parts.indexOf('path');
  const path = pathIndex >= 0 ? decodeURIComponent(parts.slice(pathIndex + 1).join('/')) : undefined;
  return { kind: 'open-files', uri, entity, id, path };
}

function parseS3Ref(uri: string): S3SourceRef {
  const parsed = new URL(uri);
  const bucket = assertNonEmpty(parsed.hostname, 'Invalid s3 ref. Missing bucket.');
  const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!key) throw new Error('Invalid s3 ref. Missing object key.');
  return { kind: 's3', uri, bucket, key };
}

function parseFileRef(uri: string): FileSourceRef {
  return { kind: 'file', uri, path: fileURLToPath(uri) };
}

function parseWebRef(uri: string): WebSourceRef {
  const parsed = new URL(uri);
  return { kind: 'web', uri, url: parsed.toString() };
}

export function parseSourceRef(uri: string): SourceRef {
  if (uri.startsWith('open-files://')) return parseOpenFilesRef(uri);
  if (uri.startsWith('s3://')) return parseS3Ref(uri);
  if (uri.startsWith('file://')) return parseFileRef(uri);
  if (uri.startsWith('https://') || uri.startsWith('http://')) return parseWebRef(uri);
  throw new Error(`Unsupported source ref scheme: ${uri}`);
}

export function catalogSourceUriForRef(uri: string, parsed = parseSourceRef(uri)): string {
  if (parsed.kind === 'open-files' && parsed.entity === 'file' && parsed.revision_id) {
    return uri.replace(/\/revision\/[^/]+$/, '');
  }
  return uri;
}

export function revisionIdForSourceRef(uri: string): string | null {
  const parsed = parseSourceRef(uri);
  return parsed.kind === 'open-files' && parsed.entity === 'file' ? parsed.revision_id ?? null : null;
}

export function isSupportedSourceRef(uri: string): boolean {
  try {
    parseSourceRef(uri);
    return true;
  } catch {
    return false;
  }
}
