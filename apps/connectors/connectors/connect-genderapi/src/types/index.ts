export interface GenderAPIConfig { apiKey: string; }

export interface GAResult { name: string; gender: 'male' | 'female' | 'unknown'; accuracy: number; samples: number; duration: string; country?: string; }
export interface GABatchResult { results: GAResult[]; }

export class GenderAPIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GenderAPIApiError'; this.statusCode = statusCode; }
}
