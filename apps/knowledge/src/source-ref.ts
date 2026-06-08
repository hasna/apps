export type SourceRefKind = 'open-files' | 's3' | 'file' | 'web';

export interface BaseSourceRef {
  kind: SourceRefKind;
  uri: string;
}

export interface OpenFilesSourceRef extends BaseSourceRef {
  kind: 'open-files';
  entity: 'file' | 'source';
  id: string;
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
    throw new Error("Invalid open-files ref. Expected open-files://file/<id> or open-files://source/<id>/path/<path>.");
  }
  const id = assertNonEmpty(parts[1], 'Invalid open-files ref. Missing id.');
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
  const parsed = new URL(uri);
  return { kind: 'file', uri, path: decodeURIComponent(parsed.pathname) };
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

export function isSupportedSourceRef(uri: string): boolean {
  try {
    parseSourceRef(uri);
    return true;
  } catch {
    return false;
  }
}
