// Upstash Connector — Serverless Redis and Kafka control-plane API
import { UpstashClient } from './client';
import type {
  UpstashConfig,
  UpstashDatabase,
  UpstashDatabaseSummary,
  UpstashStats,
  UpstashTopic,
  UpstashTopicSummary,
  CreateDatabaseInput,
} from '../types';

export { UpstashClient, redactSensitive } from './client';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function toDatabaseSummary(db: Record<string, unknown>): UpstashDatabaseSummary {
  return {
    databaseId: String(db.database_id ?? ''),
    databaseName: String(db.database_name ?? ''),
    databaseType: db.database_type as string | undefined,
    region: db.region as string | undefined,
    port: db.port as number | undefined,
    endpoint: db.endpoint as string | undefined,
    state: db.state as string | undefined,
    creationTime: db.creation_time as number | undefined,
    password: '[redacted]',
    consistent: db.consistent as boolean | undefined,
    multizone: db.multizone as boolean | undefined,
    tls: db.tls as boolean | undefined,
    type: db.type as string | undefined,
    primaryRegion: db.primary_region as string | undefined,
  };
}

function toTopicSummary(topic: Record<string, unknown>): UpstashTopicSummary {
  return {
    topicId: topic.topic_id as string | undefined,
    topicName: topic.topic_name as string | undefined,
    region: topic.region as string | undefined,
    partitions: topic.partitions as number | undefined,
    retentionTime: topic.retention_time as number | undefined,
    creationTime: topic.creation_time as number | undefined,
  };
}

export class Upstash {
  private readonly client: UpstashClient;

  constructor(config: UpstashConfig) {
    this.client = new UpstashClient(config);
  }

  static fromEnv(): Upstash {
    const email = process.env.UPSTASH_EMAIL;
    const apiKey = process.env.UPSTASH_API_KEY;
    if (!email || !apiKey) {
      throw new Error('UPSTASH_EMAIL and UPSTASH_API_KEY are required');
    }
    return new Upstash({
      email,
      apiKey,
      baseUrl: process.env.UPSTASH_BASE_URL,
    });
  }

  async listDatabases(): Promise<UpstashDatabaseSummary[]> {
    const data = await this.client.request<UpstashDatabase[]>('/redis/databases');
    return asArray(data).map(toDatabaseSummary);
  }

  async getDatabase(databaseId: string): Promise<UpstashDatabaseSummary> {
    const data = await this.client.request<UpstashDatabase>(
      `/redis/database/${encodeURIComponent(databaseId)}`,
    );
    return toDatabaseSummary(asRecord(data));
  }

  async createDatabase(input: CreateDatabaseInput): Promise<UpstashDatabaseSummary> {
    const name = input.name?.trim();
    if (!name) {
      throw new Error('Database name is required');
    }
    const data = await this.client.request<UpstashDatabase>('/redis/database', {
      method: 'POST',
      body: {
        name,
        region: input.region ?? 'us-east-1',
        tls: input.tls ?? true,
      },
    });
    return toDatabaseSummary(asRecord(data));
  }

  async getStats(databaseId: string): Promise<UpstashStats> {
    return this.client.request<UpstashStats>(
      `/redis/stats/${encodeURIComponent(databaseId)}`,
    );
  }

  async listTopics(): Promise<UpstashTopicSummary[]> {
    const data = await this.client.request<UpstashTopic[]>('/kafka/topics');
    return asArray(data).map(toTopicSummary);
  }

  getClient(): UpstashClient {
    return this.client;
  }
}
