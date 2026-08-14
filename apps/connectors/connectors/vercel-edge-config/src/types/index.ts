// Vercel Edge Config Connector Types

export interface VercelEdgeConfigConfig {
  apiKey: string;
  teamId?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface EdgeConfigPurpose {
  type: 'flags';
  projectId: string;
}

export interface EdgeConfigTransfer {
  fromAccountId?: string;
  startedAt: number;
  doneAt: number | null;
}

export interface EdgeConfig {
  id: string;
  slug?: string;
  ownerId?: string;
  createdAt?: number;
  updatedAt?: number;
  digest?: string;
  purpose?: EdgeConfigPurpose | Record<string, unknown>;
  transfer?: EdgeConfigTransfer;
  schema?: Record<string, unknown>;
  syncedToDynamoAt?: number;
  sizeInBytes: number;
  itemCount: number;
}

export interface EdgeConfigListResponse {
  edgeConfigs: EdgeConfig[];
}

export interface EdgeConfigCreateParams {
  slug: string;
  items?: Record<string, unknown>;
}

export interface EdgeConfigUpdateParams {
  slug?: string;
  items?: Record<string, unknown>;
}

export type EdgeConfigItemOperation =
  | { operation: 'create'; key: string; value: unknown }
  | { operation: 'update'; key: string; value: unknown }
  | { operation: 'upsert'; key: string; value: unknown }
  | { operation: 'delete'; key: string };

export interface EdgeConfigItemsPatchParams {
  items: EdgeConfigItemOperation[];
}

export interface EdgeConfigItem {
  key: string;
  value: unknown;
  edgeConfigId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface EdgeConfigToken {
  token: string;
  label?: string;
  id?: string;
  createdAt?: number;
}

export interface EdgeConfigBackup {
  id: string;
  createdAt: number;
  lastModified?: number;
}

export interface VercelErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class VercelEdgeConfigApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'VercelEdgeConfigApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
