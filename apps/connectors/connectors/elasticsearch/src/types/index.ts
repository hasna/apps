export interface ElasticsearchConfig { url: string; apiKey?: string; username?: string; password?: string; }

export interface ESSearchResult { took: number; timed_out: boolean; _shards: { total: number; successful: number; skipped: number; failed: number }; hits: { total: { value: number; relation: string }; max_score: number | null; hits: ESHit[] }; aggregations?: Record<string, unknown>; }
export interface ESHit { _index: string; _id: string; _score: number | null; _source: Record<string, unknown>; highlight?: Record<string, string[]>; sort?: unknown[]; }
export interface ESIndex { health: string; status: string; index: string; uuid: string; pri: string; rep: string; 'docs.count': string; 'store.size': string; }
export interface ESIndexMapping { mappings: { properties: Record<string, { type: string; [key: string]: unknown }> }; }
export interface ESBulkResult { took: number; errors: boolean; items: { index?: { _id: string; status: number; error?: { type: string; reason: string } } }[]; }
export interface ESClusterHealth { cluster_name: string; status: 'green' | 'yellow' | 'red'; number_of_nodes: number; number_of_data_nodes: number; active_primary_shards: number; active_shards: number; }

export class ElasticsearchApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ElasticsearchApiError'; this.statusCode = statusCode; }
}
