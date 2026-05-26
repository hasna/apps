export interface BigQueryConfig { projectId: string; token: string; }

export interface BQDataset { datasetReference: { datasetId: string; projectId: string }; friendlyName: string; description: string; location: string; creationTime: string; lastModifiedTime: string; }
export interface BQTable { tableReference: { tableId: string; datasetId: string; projectId: string }; type: string; numRows: string; numBytes: string; creationTime: string; schema: { fields: BQField[] }; }
export interface BQField { name: string; type: string; mode: string; description: string; fields?: BQField[]; }
export interface BQQueryResult { kind: string; schema: { fields: BQField[] }; totalRows: string; rows: { f: { v: string | null }[] }[]; jobComplete: boolean; totalBytesProcessed: string; }
export interface BQJob { jobReference: { jobId: string; projectId: string }; status: { state: string; errorResult?: { reason: string; message: string } }; statistics: { startTime: string; endTime: string; totalBytesProcessed: string }; configuration: Record<string, unknown>; }

export class BigQueryApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BigQueryApiError'; this.statusCode = statusCode; }
}
