import { getKnowledgeApiKey, resolveKnowledgeApiUrl } from './auth';
import type { KnowledgeConfig } from './workspace';

export const REMOTE_KNOWLEDGE_CONTRACT_VERSION = 1 as const;

export type RemoteKnowledgeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface RemoteKnowledgeSourceContract {
  owner: 'open-files';
  preferred_ref: 'open-files';
  allowed_schemes: string[];
  raw_source_bytes_stored_in_open_knowledge: false;
}

export interface RemoteKnowledgeArtifactContract {
  storage_type: 'local' | 's3' | 'managed';
  uri_prefix: string | null;
  generated_only: true;
}

export interface RemoteKnowledgeRegistryContract {
  contract_version: typeof REMOTE_KNOWLEDGE_CONTRACT_VERSION;
  service: 'open-knowledge';
  mode: 'local' | 'hosted';
  capabilities: string[];
  endpoints: {
    registry: string;
    search: string;
    ask: string;
    build: string;
    sync: string;
    run_status: string;
    run_logs: string;
    run_artifacts: string;
  };
  source_contract: RemoteKnowledgeSourceContract;
  artifact_contract: RemoteKnowledgeArtifactContract;
}

export interface RemoteKnowledgeRunContract {
  contract_version: typeof REMOTE_KNOWLEDGE_CONTRACT_VERSION;
  id?: string;
  type?: 'search' | 'ask' | 'build' | 'sync' | 'artifact' | 'status';
  status?: RemoteKnowledgeRunStatus | string;
  query?: string;
  prompt?: string;
  output_preview?: unknown;
  citations?: unknown[];
  artifacts?: unknown[];
  usage?: Record<string, unknown>;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error_code?: string;
  error_message?: string;
  error?: string;
  details?: unknown;
}

export interface RemoteKnowledgeSearchRequest {
  query: string;
  limit?: number;
  semantic?: boolean;
  source_refs?: string[];
}

export interface RemoteKnowledgePromptRequest extends RemoteKnowledgeSearchRequest {
  prompt: string;
  generate?: boolean;
  approve_write?: boolean;
}

export interface RemoteKnowledgeSyncRequest {
  source_refs?: string[];
  artifact_prefix?: string;
  mode?: 'pull' | 'push' | 'both';
}

export interface RemoteKnowledgeLogEntry {
  id?: string;
  run_id?: string;
  level?: string;
  event?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface RemoteKnowledgeArtifact {
  id?: string;
  uri?: string;
  key?: string;
  kind?: string;
  content_type?: string;
  hash?: string;
  size_bytes?: number;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayValue(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

export function normalizeRemoteKnowledgeRunContract(payload: unknown, fallback?: Partial<RemoteKnowledgeRunContract>): RemoteKnowledgeRunContract {
  const record = isRecord(payload) ? payload : {};
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    id: stringValue(record, 'id') ?? fallback?.id,
    type: (stringValue(record, 'type') as RemoteKnowledgeRunContract['type'] | undefined) ?? fallback?.type,
    status: stringValue(record, 'status') ?? fallback?.status,
    query: stringValue(record, 'query') ?? fallback?.query,
    prompt: stringValue(record, 'prompt') ?? fallback?.prompt,
    output_preview: Object.prototype.hasOwnProperty.call(record, 'output_preview') ? record.output_preview : fallback?.output_preview,
    citations: arrayValue(record, 'citations') ?? fallback?.citations,
    artifacts: arrayValue(record, 'artifacts') ?? fallback?.artifacts,
    usage: isRecord(record.usage) ? record.usage : fallback?.usage,
    created_at: stringValue(record, 'created_at') ?? fallback?.created_at,
    started_at: stringValue(record, 'started_at') ?? fallback?.started_at,
    completed_at: stringValue(record, 'completed_at') ?? fallback?.completed_at,
    duration_ms: numberValue(record, 'duration_ms') ?? fallback?.duration_ms,
    error_code: stringValue(record, 'error_code') ?? fallback?.error_code,
    error_message: stringValue(record, 'error_message') ?? fallback?.error_message,
    error: stringValue(record, 'error') ?? fallback?.error,
    details: Object.prototype.hasOwnProperty.call(record, 'details') ? record.details : fallback?.details,
  };
}

export function knowledgeRegistryContract(input: {
  mode: 'local' | 'hosted';
  sourceSchemes: string[];
  storageType: 'local' | 's3' | 'managed';
  artifactUriPrefix: string | null;
}): RemoteKnowledgeRegistryContract {
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    service: 'open-knowledge',
    mode: input.mode,
    capabilities: [
      'registry',
      'search',
      'ask',
      'build',
      'sync',
      'status',
      'logs',
      'artifacts',
      'open-files-source-refs',
      's3-generated-artifacts',
    ],
    endpoints: {
      registry: '/api/v1/knowledge/registry',
      search: '/api/v1/knowledge/search',
      ask: '/api/v1/knowledge/ask',
      build: '/api/v1/knowledge/build',
      sync: '/api/v1/knowledge/sync',
      run_status: '/api/v1/knowledge/runs/{run_id}',
      run_logs: '/api/v1/knowledge/runs/{run_id}/logs',
      run_artifacts: '/api/v1/knowledge/runs/{run_id}/artifacts',
    },
    source_contract: {
      owner: 'open-files',
      preferred_ref: 'open-files',
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false,
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true,
    },
  };
}

export class RemoteKnowledgeClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string,
  ) {}

  static fromConfig(config?: KnowledgeConfig, env: Record<string, string | undefined> = process.env): RemoteKnowledgeClient | null {
    const key = getKnowledgeApiKey(env);
    if (!key.apiKey) return null;
    return new RemoteKnowledgeClient(key.apiKey, resolveKnowledgeApiUrl(config, env));
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  async registry(): Promise<RemoteKnowledgeRegistryContract> {
    const response = await this.request('/api/v1/knowledge/registry');
    return response.json() as Promise<RemoteKnowledgeRegistryContract>;
  }

  async search(request: RemoteKnowledgeSearchRequest): Promise<RemoteKnowledgeRunContract> {
    const response = await this.request('/api/v1/knowledge/search', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: 'search', query: request.query });
  }

  async ask(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract> {
    const response = await this.request('/api/v1/knowledge/ask', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: 'ask', prompt: request.prompt });
  }

  async build(request: RemoteKnowledgePromptRequest): Promise<RemoteKnowledgeRunContract> {
    const response = await this.request('/api/v1/knowledge/build', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: 'build', prompt: request.prompt });
  }

  async sync(request: RemoteKnowledgeSyncRequest = {}): Promise<RemoteKnowledgeRunContract> {
    const response = await this.request('/api/v1/knowledge/sync', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: 'sync' });
  }

  async runStatus(runId: string): Promise<RemoteKnowledgeRunContract | null> {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) return null;
    return normalizeRemoteKnowledgeRunContract(await response.json(), { id: runId, type: 'status' });
  }

  async runLogs(runId: string): Promise<RemoteKnowledgeLogEntry[]> {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/logs`);
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as RemoteKnowledgeLogEntry[] : [];
  }

  async runArtifacts(runId: string): Promise<RemoteKnowledgeArtifact[]> {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/artifacts`);
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as RemoteKnowledgeArtifact[] : [];
  }
}
