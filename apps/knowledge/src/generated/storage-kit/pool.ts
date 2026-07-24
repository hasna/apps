// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import type { Pool } from 'pg';
import type { TlsResolveOptions } from './tls.js';
import type { PoolQueryClient } from './query.js';
import { KnowledgeContainmentError } from '../../runtime-role.js';

export interface CreatePgPoolOptions extends TlsResolveOptions {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  applicationName?: string;
}

export interface CreateCloudPoolFromEnvOptions extends TlsResolveOptions {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  applicationName?: string;
}

export interface CloudPoolFromEnv {
  client: PoolQueryClient;
  connectionSource: string;
}

function containedPool(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'database pool construction is unavailable during Stage A',
  );
}

export function createPgPool(options: CreatePgPoolOptions): Pool {
  return containedPool();
}

export function createCloudPoolFromEnv(
  appName: string,
  options?: CreateCloudPoolFromEnvOptions,
): CloudPoolFromEnv;
export function createCloudPoolFromEnv(appName: string): CloudPoolFromEnv {
  return containedPool();
}
