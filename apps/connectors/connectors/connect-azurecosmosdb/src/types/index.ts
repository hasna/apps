export interface AzureCosmosDBConfig { endpoint: string; key: string; }

export interface CosmosDatabase { id: string; _rid: string; _self: string; _etag: string; _ts: number; }
export interface CosmosDatabaseList { Databases: CosmosDatabase[]; _count: number; }
export interface CosmosContainer { id: string; indexingPolicy: Record<string, unknown>; partitionKey: { paths: string[]; kind: string }; _rid: string; _self: string; _etag: string; _ts: number; }
export interface CosmosContainerList { DocumentCollections: CosmosContainer[]; _count: number; }
export interface CosmosDocument { id: string; [key: string]: unknown; _rid: string; _self: string; _etag: string; _ts: number; }
export interface CosmosQueryResult { Documents: CosmosDocument[]; _count: number; _rid: string; }

export class AzureCosmosDBApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AzureCosmosDBApiError'; this.statusCode = statusCode; }
}
