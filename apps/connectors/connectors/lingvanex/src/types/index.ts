export interface LingvanexConfig { apiKey: string; }

export interface LVTranslation { result: string; source: string; from: string; to: string; }
export interface LVDetection { languageCode: string; languageName: string; score: number; }
export interface LVLanguage { code: string; englishName: string; nativeName: string; }
export interface LVTranslateOptions { from?: string; to: string; data: string; platform?: string; }

export class LingvanexApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LingvanexApiError'; this.statusCode = statusCode; }
}
