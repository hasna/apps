export interface SimpleLocalizeConfig { apiKey: string; }

export interface SLTranslation { key: string; language: string; text: string; reviewed: boolean; }
export interface SLTranslationList { data: SLTranslation[]; msg: string; }
export interface SLKey { key: string; namespace: string; description: string; }
export interface SLKeyList { data: SLKey[]; msg: string; }
export interface SLLanguage { key: string; name: string; isDefault: boolean; }
export interface SLProject { projectToken: string; name: string; languages: SLLanguage[]; defaultLanguage: string; }
export interface SLNamespace { name: string; }
export interface SLImportResult { data: { uniqueKeysFound: number; translationsFound: number; translationsUpdated: number }; msg: string; }

export class SimpleLocalizeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SimpleLocalizeApiError'; this.statusCode = statusCode; }
}
