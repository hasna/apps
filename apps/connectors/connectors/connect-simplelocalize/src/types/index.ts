export interface SimpleLocalizeConfig {
  apiKey: string;
  projectToken?: string;
  baseUrl?: string;
}
export interface Translation { key: string; language: string; value: string | null; namespaceName?: string }
export interface Language { name: string; textDirection: string; isDefault: boolean }
export interface TranslationKey { key: string; namespaceName: string | null; description: string | null; defaultValue: string | null }
export class SimpleLocalizeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SimpleLocalizeApiError'; this.statusCode = statusCode; }
}
