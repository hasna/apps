import type { Pool, QueryResultRow } from 'pg';
import type { KnowledgeProjectPanelOptions } from '@hasna/knowledge';
import type { ServeDeps } from '@hasna/knowledge/serve';
import type {
  PgExecutor,
  PoolQueryClient,
} from '@hasna/knowledge/storage';

declare const poolClient: PoolQueryClient;
const pool: Pool = poolClient.pool;
const executor: PgExecutor = {
  async query<Row extends QueryResultRow>() {
    return { rows: [] as Row[], rowCount: 0 };
  },
};
declare const panelOptions: KnowledgeProjectPanelOptions;
declare const serveDeps: ServeDeps;
void pool;
void executor;
void panelOptions;
void serveDeps;
