// DeepL API Types

export interface DeepLConfig {
  authKey: string;
  baseUrl?: string;
}

export interface TranslateTextResult {
  detected_source_language: string;
  text: string;
}

export interface UsageResponse {
  character_count: number;
  character_limit: number;
  document_count?: number;
  document_limit?: number;
  team_document_count?: number;
  team_document_limit?: number;
}

export interface SupportedLanguage {
  language: string;
  name: string;
  supports_formality?: boolean;
}

export interface GlossaryInfo {
  glossary_id: string;
  name: string;
  ready: boolean;
  source_lang: string;
  target_lang: string;
  creation_time: string;
  entry_count: number;
}

export interface CreateGlossaryOptions {
  name: string;
  sourceLang: string;
  targetLang: string;
  entries: string;
  entriesFormat?: 'tsv' | 'csv';
}

export class DeepLApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'DeepLApiError';
    this.statusCode = statusCode;
  }
}
