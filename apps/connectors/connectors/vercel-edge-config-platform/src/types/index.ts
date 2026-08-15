// Vercel Edge Config Platform Connector Types

export interface EdgeConfigPlatformConfig {
  apiKey: string;
  teamId?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface EdgeConfigTransfer {
  fromAccountId: string;
  startedAt: number;
  doneAt: number | null;
}

export interface EdgeConfigPurposeFlags {
  type: 'flags';
  projectId: string;
}

export interface EdgeConfigPurposeExperimentation {
  type: 'experimentation';
  resourceId: string;
}

export type EdgeConfigPurpose = EdgeConfigPurposeFlags | EdgeConfigPurposeExperimentation;

export interface EdgeConfig {
  id: string;
  slug: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  digest: string;
  sizeInBytes: number;
  itemCount: number;
  createdBy?: string;
  deletedAt?: number | null;
  purpose?: EdgeConfigPurpose;
  transfer?: EdgeConfigTransfer;
  schema?: Record<string, unknown>;
  syncedToDynamoAt?: number;
}

export interface EdgeConfigCreateParams {
  slug: string;
  items?: Record<string, unknown>;
}

export interface EdgeConfigUpdateParams {
  slug: string;
}

export interface EdgeConfigItem {
  key: string;
  value: unknown;
  description?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export type EdgeConfigItemOperation = 'create' | 'update' | 'upsert' | 'delete';

export interface EdgeConfigItemPatch {
  operation: EdgeConfigItemOperation;
  key: string;
  value?: unknown;
  description?: string | null;
}

export interface EdgeConfigItemsPatchParams {
  items: EdgeConfigItemPatch[];
}

export interface EdgeConfigItemsPatchResponse {
  status: string;
}

export interface EdgeConfigSchemaUpdateParams {
  definition: unknown;
}

export interface EdgeConfigToken {
  id: string;
  token: string;
  label?: string;
  createdAt?: number;
}

export interface EdgeConfigTokenCreateParams {
  label: string;
}

export interface EdgeConfigTokenCreateResponse {
  id: string;
  token: string;
}

export interface EdgeConfigTokensDeleteParams {
  tokens?: string[];
  ids?: string[];
}

export interface EdgeConfigBackup {
  id: string;
  versionId: string;
  createdAt: number;
  sizeInBytes?: number;
  itemCount?: number;
}

export interface EdgeConfigBackupRestoreParams {
  versionId: string;
}

export interface VercelErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class EdgeConfigPlatformApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'EdgeConfigPlatformApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
