import {
  MigrationLedger,
  createMigrationLedger,
  defineMigration,
  wrapExecutor,
  type PgExecutor,
  type TypedQueryClient,
} from '../../src/storage.ts';
import { KnowledgeContainmentError } from '../../src/runtime-role.ts';

let executorCalls = 0;
const executor = {
  async query<T>(): Promise<{ rows: T[]; rowCount: number }> {
    executorCalls += 1;
    throw new Error('caller executor tripwire');
  },
} as unknown as PgExecutor;

function migrationTripwire(): { client: TypedQueryClient; calls: () => number } {
  let count = 0;
  const fail = async (): Promise<never> => {
    count += 1;
    throw new Error('caller migration client tripwire');
  };
  return {
    client: {
      query: fail,
      many: fail,
      get: fail,
      one: fail,
      execute: fail,
      transaction: fail,
    } as unknown as TypedQueryClient,
    calls: () => count,
  };
}

const errors: Array<{ code: string; status: number }> = [];
async function capture(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected public storage containment');
  } catch (error) {
    if (!(error instanceof KnowledgeContainmentError)) throw error;
    errors.push({ code: error.code, status: error.status });
  }
}

await capture(() => wrapExecutor(executor));

const migration = defineMigration('001_contained', 'SELECT 1');
const direct = migrationTripwire();
const directLedger = new MigrationLedger(direct.client, [migration]);
await capture(() => directLedger.ensureLedger());
await capture(() => directLedger.listApplied());
await capture(() => directLedger.migrate());

const factory = migrationTripwire();
const factoryLedger = createMigrationLedger(factory.client, [migration]);
await capture(() => factoryLedger.ensureLedger());
await capture(() => factoryLedger.listApplied());
await capture(() => factoryLedger.migrate());

process.stdout.write(JSON.stringify({
  calls: {
    executor: executorCalls,
    directLedger: direct.calls(),
    factoryLedger: factory.calls(),
  },
  errors,
}));
