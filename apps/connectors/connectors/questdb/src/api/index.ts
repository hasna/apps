// QuestDB Connector — High-performance time-series database with SQL
import { QuestDBClient } from './client';
import type { QuestDBConfig, QDBQueryResult, QDBTable, QDBImportResult } from '../types';
export { QuestDBClient } from './client';

export class QuestDB {
  private readonly client: QuestDBClient;
  constructor(config: QuestDBConfig) { this.client = new QuestDBClient(config); }
  static fromEnv(): QuestDB {
    const url = process.env.QUESTDB_URL;
    if (!url) throw new Error('QUESTDB_URL is required');
    return new QuestDB({ url, username: process.env.QUESTDB_USERNAME, password: process.env.QUESTDB_PASSWORD });
  }

  async query(sql: string, options?: { limit?: number; count?: boolean }): Promise<QDBQueryResult> {
    return this.client.request<QDBQueryResult>('/exec', { params: { query: sql, limit: options?.limit, count: options?.count ? 'true' : undefined } });
  }

  async listTables(): Promise<QDBTable[]> {
    const result = await this.query('SHOW TABLES');
    return result.dataset.map(row => ({ name: row[0] as string, partitionBy: row[1] as string, designatedTimestamp: row[2] as string | null, walEnabled: row[3] as boolean }));
  }

  async describeTable(tableName: string): Promise<QDBQueryResult> {
    return this.query(`SHOW COLUMNS FROM '${tableName}'`);
  }

  async createTable(sql: string): Promise<QDBQueryResult> { return this.query(sql); }
  async dropTable(tableName: string): Promise<QDBQueryResult> { return this.query(`DROP TABLE IF EXISTS '${tableName}'`); }

  async insert(tableName: string, columns: string[], values: unknown[][]): Promise<QDBQueryResult> {
    const cols = columns.join(', ');
    const rows = values.map(row => `(${row.map(v => typeof v === 'string' ? `'${v}'` : String(v)).join(', ')})`).join(', ');
    return this.query(`INSERT INTO '${tableName}' (${cols}) VALUES ${rows}`);
  }

  async getHealth(): Promise<{ status: string }> {
    const response = await fetch(`${(this.client as unknown as { baseUrl: string }).baseUrl || ''}/status`);
    return { status: response.ok ? 'ok' : 'error' };
  }

  getClient(): QuestDBClient { return this.client; }
}
