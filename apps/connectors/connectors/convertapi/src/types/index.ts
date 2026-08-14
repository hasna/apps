export interface ConvertAPIConfig { apiKey: string; }

export interface CAConversion { ConversionCost: number; Files: CAFile[]; }
export interface CAFile { FileName: string; FileSize: number; FileData?: string; Url?: string; }
export interface CAFormat { Name: string; ConvertersCount: number; }
export interface CAUser { Email: string; FullName: string; SecondsLeft: number; Active: boolean; }

export class ConvertAPIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ConvertAPIApiError'; this.statusCode = statusCode; }
}
