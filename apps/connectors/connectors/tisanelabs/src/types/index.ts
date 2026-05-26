export interface TisaneLabsConfig { apiKey: string; }

export interface TLParseResult { text: string; sentiment: number; abuse: TLAbuse[]; entities_summary: TLEntity[]; topics: string[]; language: string; }
export interface TLAbuse { type: string; severity: string; text: string; offset: number; length: number; explanation: string; }
export interface TLEntity { name: string; type: string; mentions: number; }
export interface TLLanguageDetection { language: string; confidence: number; }
export interface TLTransformResult { text: string; }

export class TisaneLabsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TisaneLabsApiError'; this.statusCode = statusCode; }
}
