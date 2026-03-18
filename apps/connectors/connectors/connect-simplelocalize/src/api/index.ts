// SimpleLocalize Connector — Translation management and localization platform
import { SimpleLocalizeClient } from './client';
import type { SimpleLocalizeConfig, SLTranslationList, SLKeyList, SLLanguage, SLProject, SLNamespace, SLImportResult } from '../types';
export { SimpleLocalizeClient } from './client';

export class SimpleLocalize {
  private readonly client: SimpleLocalizeClient;
  constructor(config: SimpleLocalizeConfig) { this.client = new SimpleLocalizeClient(config); }
  static fromEnv(): SimpleLocalize {
    const apiKey = process.env.SIMPLELOCALIZE_API_KEY;
    if (!apiKey) throw new Error('SIMPLELOCALIZE_API_KEY is required');
    return new SimpleLocalize({ apiKey });
  }

  async getProject(): Promise<SLProject> { return this.client.request<SLProject>('/project'); }

  async listTranslations(options?: { language?: string; namespace?: string; page?: number }): Promise<SLTranslationList> {
    return this.client.request<SLTranslationList>('/translations', { params: { languageKey: options?.language, namespace: options?.namespace, page: options?.page } });
  }
  async updateTranslations(translations: { key: string; language: string; text: string; namespace?: string }[]): Promise<SLImportResult> {
    return this.client.request<SLImportResult>('/translations', { method: 'PATCH', body: translations as unknown[] });
  }

  async listKeys(options?: { namespace?: string; page?: number }): Promise<SLKeyList> {
    return this.client.request<SLKeyList>('/translation-keys', { params: { namespace: options?.namespace, page: options?.page } });
  }
  async createKeys(keys: { key: string; namespace?: string; description?: string }[]): Promise<SLImportResult> {
    return this.client.request<SLImportResult>('/translation-keys', { method: 'POST', body: keys as unknown[] });
  }
  async deleteKey(key: string, namespace?: string): Promise<void> {
    await this.client.request('/translation-keys', { method: 'DELETE', body: [{ key, namespace }] as unknown[] });
  }

  async listLanguages(): Promise<SLLanguage[]> { return this.client.request<SLLanguage[]>('/languages'); }
  async addLanguage(languageKey: string): Promise<void> {
    await this.client.request('/languages', { method: 'POST', body: { languageKey } as Record<string, unknown> });
  }

  async listNamespaces(): Promise<SLNamespace[]> { return this.client.request<SLNamespace[]>('/namespaces'); }

  getClient(): SimpleLocalizeClient { return this.client; }
}
