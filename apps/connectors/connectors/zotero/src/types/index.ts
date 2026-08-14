// Zotero Web API v3 types

export type OutputFormat = 'json' | 'table' | 'pretty';

export type LibraryType = 'users' | 'groups';

export interface ZoteroConfig {
  apiKey: string;
  libraryId: string;
  libraryType?: LibraryType | 'group';
  baseUrl?: string;
}

export interface CliConfig {
  apiKey?: string;
  libraryId?: string;
  libraryType?: LibraryType | 'group';
  baseUrl?: string;
}

export class ZoteroApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ZoteroApiError';
  }
}

export interface ZoteroItem {
  key: string;
  version: number;
  itemType: string;
  title?: string;
  creators?: Array<{ creatorType: string; firstName?: string; lastName?: string; name?: string }>;
  tags?: Array<{ tag: string; type?: number }>;
  collections?: string[];
  relations?: Record<string, string>;
  date?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ZoteroCollection {
  key: string;
  version: number;
  name: string;
  parentCollection?: string | false;
  relations?: Record<string, string>;
}

export interface ListItemsOptions {
  collectionKey?: string;
  q?: string;
  tag?: string;
  since?: number;
  limit?: number;
  start?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  includeTrashed?: 0 | 1;
}

export interface CreateItemInput {
  itemType: string;
  title?: string;
  creators?: ZoteroItem['creators'];
  tags?: ZoteroItem['tags'];
  collections?: string[];
  relations?: Record<string, string>;
  [key: string]: unknown;
}

export interface UpdateItemInput extends Partial<CreateItemInput> {
  key?: string;
}

export interface CreateCollectionInput {
  name: string;
  parentCollection?: string | false;
  relations?: Record<string, string>;
}

export interface CreateAttachmentInput {
  parentItem: string;
  title?: string;
  url?: string;
  linkMode?: 'imported_url' | 'imported_file' | 'linked_url';
  accessDate?: string;
  contentType?: string;
  filename?: string;
  tags?: ZoteroItem['tags'];
  collections?: string[];
  relations?: Record<string, string>;
}

export interface UploadFileInput {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
  parentItem?: string;
  attachmentKey?: string;
  mtime?: number;
}

export interface UploadAuthResponse {
  exists?: number;
  url?: string;
  contentType?: string;
  prefix?: string;
  suffix?: string;
  uploadKey?: string;
}

export interface CreateItemsResponse {
  successful?: Record<string, string>;
  success?: Record<string, string>;
  failed?: Record<string, unknown>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  version?: number | string;
}
