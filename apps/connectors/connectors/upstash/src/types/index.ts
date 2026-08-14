export interface UpstashConfig {
  email: string;
  apiKey: string;
  baseUrl?: string;
}

export interface UpstashDatabase {
  database_id: string;
  database_name: string;
  region?: string;
  port?: number;
  endpoint?: string;
  state?: string;
  creation_time?: number;
  password?: string;
  tls?: boolean;
  type?: string;
  primary_region?: string;
  [key: string]: unknown;
}

export interface UpstashDatabaseSummary {
  databaseId: string;
  databaseName: string;
  databaseType?: string;
  region?: string;
  port?: number;
  endpoint?: string;
  state?: string;
  creationTime?: number;
  password: string;
  consistent?: boolean;
  multizone?: boolean;
  tls?: boolean;
  type?: string;
  primaryRegion?: string;
}

export interface UpstashStats {
  [key: string]: unknown;
}

export interface UpstashTopic {
  topic_id?: string;
  topic_name?: string;
  region?: string;
  partitions?: number;
  retention_time?: number;
  creation_time?: number;
}

export interface UpstashTopicSummary {
  topicId?: string;
  topicName?: string;
  region?: string;
  partitions?: number;
  retentionTime?: number;
  creationTime?: number;
}

export interface CreateDatabaseInput {
  name: string;
  region?: string;
  tls?: boolean;
}

export class UpstashApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UpstashApiError';
    this.statusCode = statusCode;
  }
}
