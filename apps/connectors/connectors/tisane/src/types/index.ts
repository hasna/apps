// Tisane API Types

export interface TisaneConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonObject = Record<string, unknown>;

export interface ParseRequest extends JsonObject {
  content: string;
  language?: string;
}

export interface ExtractTextRequest extends JsonObject {
  url?: string;
  html?: string;
}

export interface CompareEntitiesRequest extends JsonObject {
  text1: string;
  text2: string;
}

export interface SimilarityRequest extends JsonObject {
  text1: string;
  text2: string;
}

export interface DetectLanguageRequest extends JsonObject {
  content: string;
}

export interface TransformRequest extends JsonObject {
  content: string;
  targetLanguage?: string;
}

export type TisaneResponse = JsonObject | unknown[] | string | number | boolean | null;

export type OutputFormat = 'json' | 'pretty';

export class TisaneApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'TisaneApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
