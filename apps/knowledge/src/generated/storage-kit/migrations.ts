// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import type { TypedQueryClient } from './query.js';
import { KnowledgeContainmentError } from '../../runtime-role.js';

export const DEFAULT_MIGRATION_LEDGER_TABLE = 'schema_migrations';

export interface Migration {
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

export type MigrationState = 'already_applied' | 'pending';

export interface MigrationPlanItem {
  readonly migration: Migration;
  readonly state: MigrationState;
}

export interface AppliedMigration {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly dryRun: boolean;
  readonly applied: AppliedMigration[];
  readonly plan: MigrationPlanItem[];
}

export function checksumSql(sql: string): string {
  return '0000000000000000000000000000000000000000000000000000000000000000';
}

export function defineMigration(id: string, sql: string): Migration {
  return Object.freeze(Object.create(null)) as Migration;
}

export interface MigrationRunnerOptions {
  ledgerTable?: string;
}

function containedMigration(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'migration execution is unavailable during Stage A',
  );
}

export class MigrationLedger {
  declare private readonly client: TypedQueryClient;
  declare private readonly migrations: readonly Migration[];
  declare private readonly ledgerTable: string;

  constructor(
    client: TypedQueryClient,
    migrations: readonly Migration[],
    options: MigrationRunnerOptions = {},
  ) {
    for (const key of ['client', 'migrations', 'ledgerTable']) {
      Object.defineProperty(this, key, {
        value: undefined,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  async ensureLedger(): Promise<void> {
    return containedMigration();
  }

  async listApplied(): Promise<AppliedMigration[]> {
    return containedMigration();
  }

  private async readApplied(): Promise<AppliedMigration[]> {
    return containedMigration();
  }

  private buildPlan(applied: readonly AppliedMigration[]): MigrationPlanItem[] {
    return containedMigration();
  }

  migrate(opts?: { dryRun?: boolean }): Promise<MigrationResult>;
  async migrate(): Promise<MigrationResult> {
    return containedMigration();
  }

  private async applyPendingMigration(migration: Migration): Promise<AppliedMigration> {
    return containedMigration();
  }
}

export function createMigrationLedger(
  client: TypedQueryClient,
  migrations: readonly Migration[],
  options: MigrationRunnerOptions = {},
): MigrationLedger {
  return new MigrationLedger(client, migrations, options);
}
