// TesterArmy Connector Types

export interface TesterArmyConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type JsonBody = Record<string, unknown>;

export interface TesterArmyResource {
  id: string;
  [key: string]: unknown;
}

export class TesterArmyApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TesterArmyApiError';
    this.statusCode = statusCode;
  }
}
