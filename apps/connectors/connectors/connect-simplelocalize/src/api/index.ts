// SimpleLocalize Connector — Translation management and i18n
import { SimpleLocalizeClient } from './client';
import type { SimpleLocalizeConfig, Translation, Language, TranslationKey } from '../types';
export { SimpleLocalizeClient } from './client';
export class SimpleLocalize {
  private readonly client: SimpleLocalizeClient;
  constructor(config: SimpleLocalizeConfig) { this.client = new SimpleLocalizeClient(config); }
  static fromEnv(): SimpleLocalize {
    const apiKey = process.env.SIMPLELOCALIZE_API_KEY;
    if (!apiKey) throw new Error('SIMPLELOCALIZE_API_KEY environment variable is required');
    return new SimpleLocalize({ apiKey, projectToken: process.env.SIMPLELOCALIZE_PROJECT_TOKEN });
  }
  async listLanguages(): Promise<Language[]> { const r = await this.client.request<{ data: Language[] }>('/languages'); return r.data; }
  async addLanguage(languageCode: string): Promise<void> { await this.client.request('/languages', { method: 'POST', body: { languageCode } }); }
  async listTranslationKeys(options?: { limit?: string; page?: string }): Promise<TranslationKey[]> {
    const r = await this.client.request<{ data: TranslationKey[] }>('/translation-keys', { params: options });
    return r.data;
  }
  async createTranslationKey(key: string, namespace?: string): Promise<void> {
    await this.client.request('/translation-keys', { method: 'POST', body: { key, namespaceName: namespace } });
  }
  async listTranslations(languageCode?: string, namespace?: string): Promise<Translation[]> {
    const r = await this.client.request<{ data: Translation[] }>('/translations', { params: { languageCode, namespaceName: namespace } });
    return r.data;
  }
  async updateTranslation(key: string, languageCode: string, value: string, namespace?: string): Promise<void> {
    await this.client.request('/translations', { method: 'POST', body: { key, languageCode, value, namespaceName: namespace } });
  }
  async deleteTranslation(key: string, languageCode: string): Promise<void> {
    await this.client.request(`/translations/${key}/${languageCode}`, { method: 'DELETE' });
  }
  getClient(): SimpleLocalizeClient { return this.client; }
}
