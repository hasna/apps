export interface ChromaConfig { url: string; token?: string; tenant?: string; database?: string; }

export interface ChromaCollection { id: string; name: string; metadata: Record<string, unknown> | null; tenant: string; database: string; }
export interface ChromaGetResult { ids: string[]; embeddings: number[][] | null; documents: (string | null)[]; metadatas: (Record<string, unknown> | null)[]; }
export interface ChromaQueryResult { ids: string[][]; distances: number[][] | null; documents: (string | null)[][]; metadatas: (Record<string, unknown> | null)[][]; }
export interface ChromaAddResult { ids: string[]; }

export class ChromaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ChromaApiError'; this.statusCode = statusCode; }
}
