export interface ConfluentConfig { apiKey: string; apiSecret: string; }

export interface CFEnvironment { id: string; display_name: string; stream_governance: Record<string, unknown>; }
export interface CFCluster { id: string; environment_id: string; display_name: string; cloud: string; region: string; availability: string; api_endpoint: string; }
export interface CFTopic { topic_name: string; is_internal: boolean; replication_factor: number; partitions_count: number; }
export interface CFConnector { id: { id: string }; info: { name: string; type: string; config: Record<string, string>; }; status: { state: string }; }
export interface CFServiceAccount { id: string; display_name: string; description: string; }
export interface CFApiKey { id: string; spec: { display_name: string; description: string; owner: { id: string }; resource: { id: string } }; }

export class ConfluentApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ConfluentApiError'; this.statusCode = statusCode; }
}
