export interface AzureAISearchConfig { serviceName: string; apiKey: string; apiVersion?: string; }

export interface AZSIndex { name: string; fields: AZSField[]; scoringProfiles: Record<string, unknown>[]; defaultScoringProfile: string | null; corsOptions: Record<string, unknown> | null; }
export interface AZSField { name: string; type: string; searchable: boolean; filterable: boolean; sortable: boolean; facetable: boolean; key: boolean; retrievable: boolean; dimensions?: number; vectorSearchProfile?: string; }
export interface AZSSearchResult { value: { '@search.score': number; [key: string]: unknown }[]; '@odata.count'?: number; '@search.nextPageParameters'?: Record<string, unknown>; }
export interface AZSDocument { [key: string]: unknown; }
export interface AZSIndexResult { value: { key: string; status: boolean; errorMessage: string | null; statusCode: number }[]; }
export interface AZSVectorQuery { kind: 'vector'; vector: number[]; fields: string; k: number; }

export class AzureAISearchApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AzureAISearchApiError'; this.statusCode = statusCode; }
}
