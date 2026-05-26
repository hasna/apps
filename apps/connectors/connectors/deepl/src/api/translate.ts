import type { DeepLClient } from './client';
import type {
  TranslateTextResult,
  SupportedLanguage,
  GlossaryInfo,
  CreateGlossaryOptions,
  UsageResponse,
} from '../types';

export class TranslateApi {
  constructor(private readonly client: DeepLClient) {}

  /** Translate one or more text strings */
  async translateText(
    text: string | string[],
    targetLang: string,
    options: {
      sourceLang?: string;
      formality?: 'default' | 'more' | 'less' | 'prefer_more' | 'prefer_less';
      glossaryId?: string;
      splitSentences?: '0' | '1' | 'nonewlines';
      preserveFormatting?: boolean;
      tagHandling?: 'xml' | 'html';
      context?: string;
    } = {}
  ): Promise<TranslateTextResult[]> {
    const texts = Array.isArray(text) ? text : [text];
    const result = await this.client.request<{ translations: TranslateTextResult[] }>(
      '/translate',
      {
        method: 'POST',
        body: {
          text: texts,
          target_lang: targetLang.toUpperCase(),
          source_lang: options.sourceLang?.toUpperCase(),
          formality: options.formality,
          glossary_id: options.glossaryId,
          split_sentences: options.splitSentences,
          preserve_formatting: options.preserveFormatting ? '1' : undefined,
          tag_handling: options.tagHandling,
          context: options.context,
        },
      }
    );
    return result.translations;
  }

  /** Get account usage statistics */
  async getUsage(): Promise<UsageResponse> {
    return this.client.request<UsageResponse>('/usage');
  }

  /** List supported source or target languages */
  async getLanguages(type?: 'source' | 'target'): Promise<SupportedLanguage[]> {
    return this.client.request<SupportedLanguage[]>('/languages', {
      params: type ? { type } : undefined,
    });
  }

  // ============================================
  // Glossaries
  // ============================================

  /** List all glossaries */
  async listGlossaries(): Promise<GlossaryInfo[]> {
    const result = await this.client.request<{ glossaries: GlossaryInfo[] }>('/glossaries');
    return result.glossaries;
  }

  /** Get a glossary by ID */
  async getGlossary(glossaryId: string): Promise<GlossaryInfo> {
    return this.client.request<GlossaryInfo>(`/glossaries/${glossaryId}`);
  }

  /** Create a glossary */
  async createGlossary(options: CreateGlossaryOptions): Promise<GlossaryInfo> {
    return this.client.request<GlossaryInfo>('/glossaries', {
      method: 'POST',
      body: {
        name: options.name,
        source_lang: options.sourceLang.toLowerCase(),
        target_lang: options.targetLang.toLowerCase(),
        entries: options.entries,
        entries_format: options.entriesFormat || 'tsv',
      },
    });
  }

  /** Delete a glossary */
  async deleteGlossary(glossaryId: string): Promise<void> {
    await this.client.request(`/glossaries/${glossaryId}`, { method: 'POST' });
  }

  /** Get glossary entries as TSV string */
  async getGlossaryEntries(glossaryId: string): Promise<string> {
    return this.client.request<string>(`/glossaries/${glossaryId}/entries`);
  }
}
