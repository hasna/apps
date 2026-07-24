// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import type { TypedQueryClient } from './query.js';
import type { Migration, MigrationRunnerOptions } from './migrations.js';
import { KnowledgeContainmentError } from '../../runtime-role.js';

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReadyResult extends HealthResult {
  pendingMigrations: string[];
}

function containedHealth(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'database health checks are unavailable during Stage A',
  );
}

export async function checkHealth(client: TypedQueryClient): Promise<HealthResult> {
  return containedHealth();
}

export function checkReady(
  client: TypedQueryClient,
  migrations: readonly Migration[],
  options?: MigrationRunnerOptions,
): Promise<ReadyResult>;
export async function checkReady(
  client: TypedQueryClient,
  migrations: readonly Migration[],
): Promise<ReadyResult> {
  return containedHealth();
}
