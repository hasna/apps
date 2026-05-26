import type {
  WIPOPearlSearchParams,
  WIPOPearlSearchResponse,
  WIPOPearlTerm,
  WIPOPearlConcept,
  Translation,
  RelatedConcept,
} from '../types';
import { WIPOClient } from './client';

/**
 * WIPO Pearl API - Multilingual patent terminology
 * https://wipopearl.wipo.int/
 */
export class PearlApi {
  constructor(private readonly client: WIPOClient) {}

  /**
   * Search for terms across languages
   */
  async searchTerms(params: WIPOPearlSearchParams): Promise<WIPOPearlSearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      q: params.term,
      start: params.start || 0,
      rows: params.rows || 25,
    };

    if (params.sourceLanguage) queryParams.lang = params.sourceLanguage;
    if (params.targetLanguages) queryParams.targetLangs = params.targetLanguages.join(',');
    if (params.domain) queryParams.domain = params.domain;
    if (params.conceptId) queryParams.conceptId = params.conceptId;
    if (params.exactMatch !== undefined) queryParams.exact = params.exactMatch;

    const response = await this.client.pearlGet<{
      total?: number;
      start?: number;
      terms?: unknown[];
      results?: unknown[];
    }>('/terms/search', queryParams);

    const terms = response.terms || response.results || [];
    const total = response.total || terms.length;
    const start = response.start || params.start || 0;

    return {
      total,
      start,
      rows: params.rows || 25,
      terms: terms.map(this.mapTerm.bind(this)),
    };
  }

  /**
   * Get term by ID
   */
  async getTermById(termId: string): Promise<WIPOPearlTerm | null> {
    try {
      const response = await this.client.pearlGet<unknown>(`/terms/${termId}`);
      if (!response) return null;
      return this.mapTerm(response);
    } catch {
      return null;
    }
  }

  /**
   * Get concept by ID
   */
  async getConceptById(conceptId: string): Promise<WIPOPearlConcept | null> {
    try {
      const response = await this.client.pearlGet<{
        conceptId?: string;
        name?: string;
        definition?: string;
        domain?: string;
        terms?: unknown[];
        broader?: unknown[];
        narrower?: unknown[];
        related?: unknown[];
      }>(`/concepts/${conceptId}`);

      if (!response.conceptId) return null;

      return {
        conceptId: response.conceptId,
        name: response.name || '',
        definition: response.definition,
        domain: response.domain || '',
        terms: (response.terms || []).map(this.mapTerm.bind(this)),
        broaderConcepts: this.mapRelatedConcepts(response.broader),
        narrowerConcepts: this.mapRelatedConcepts(response.narrower),
        relatedConcepts: this.mapRelatedConcepts(response.related),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get translations for a term
   */
  async getTranslations(termId: string, targetLanguages?: string[]): Promise<Translation[]> {
    const params: Record<string, string | undefined> = {};
    if (targetLanguages) params.targetLangs = targetLanguages.join(',');

    try {
      const response = await this.client.pearlGet<{
        translations?: Array<{
          term?: string;
          language?: string;
          lang?: string;
          reliability?: string;
          source?: string;
        }>;
      }>(`/terms/${termId}/translations`, params);

      return (response.translations || []).map(t => ({
        term: t.term || '',
        language: t.language || t.lang || '',
        reliability: this.mapReliability(t.reliability),
        source: t.source,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Search concepts (higher level than terms)
   */
  async searchConcepts(query: string, domain?: string, rows = 25): Promise<WIPOPearlConcept[]> {
    const params: Record<string, string | number | undefined> = {
      q: query,
      rows,
    };
    if (domain) params.domain = domain;

    try {
      const response = await this.client.pearlGet<{
        concepts?: Array<{
          conceptId?: string;
          name?: string;
          definition?: string;
          domain?: string;
          terms?: unknown[];
        }>;
      }>('/concepts/search', params);

      return (response.concepts || []).map(c => ({
        conceptId: c.conceptId || '',
        name: c.name || '',
        definition: c.definition,
        domain: c.domain || '',
        terms: (c.terms || []).map(this.mapTerm.bind(this)),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get available languages
   */
  async getLanguages(): Promise<Array<{ code: string; name: string }>> {
    try {
      const response = await this.client.pearlGet<{
        languages?: Array<{
          code?: string;
          name?: string;
        }>;
      }>('/languages');

      return (response.languages || []).map(l => ({
        code: l.code || '',
        name: l.name || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get available domains (technology areas)
   */
  async getDomains(): Promise<Array<{ id: string; name: string; description?: string }>> {
    try {
      const response = await this.client.pearlGet<{
        domains?: Array<{
          id?: string;
          name?: string;
          description?: string;
        }>;
      }>('/domains');

      return (response.domains || []).map(d => ({
        id: d.id || '',
        name: d.name || '',
        description: d.description,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Translate a term to multiple languages
   */
  async translate(term: string, sourceLanguage: string, targetLanguages: string[]): Promise<{
    sourceTerm: string;
    sourceLanguage: string;
    translations: Translation[];
  }> {
    const searchResult = await this.searchTerms({
      term,
      sourceLanguage,
      targetLanguages,
      exactMatch: true,
      rows: 1,
    });

    if (searchResult.terms.length === 0) {
      // Try fuzzy search
      const fuzzyResult = await this.searchTerms({
        term,
        sourceLanguage,
        targetLanguages,
        exactMatch: false,
        rows: 1,
      });

      if (fuzzyResult.terms.length === 0) {
        return {
          sourceTerm: term,
          sourceLanguage,
          translations: [],
        };
      }

      return {
        sourceTerm: term,
        sourceLanguage,
        translations: fuzzyResult.terms[0].translations || [],
      };
    }

    return {
      sourceTerm: term,
      sourceLanguage,
      translations: searchResult.terms[0].translations || [],
    };
  }

  /**
   * Find synonyms for a term
   */
  async findSynonyms(term: string, language: string): Promise<string[]> {
    const searchResult = await this.searchTerms({
      term,
      sourceLanguage: language,
      exactMatch: true,
      rows: 1,
    });

    if (searchResult.terms.length === 0) {
      return [];
    }

    return searchResult.terms[0].synonyms || [];
  }

  /**
   * Get related concepts for a term
   */
  async getRelatedConcepts(term: string, language: string): Promise<RelatedConcept[]> {
    const searchResult = await this.searchTerms({
      term,
      sourceLanguage: language,
      exactMatch: true,
      rows: 1,
    });

    if (searchResult.terms.length === 0) {
      return [];
    }

    return searchResult.terms[0].relatedConcepts || [];
  }

  private mapTerm(doc: unknown): WIPOPearlTerm {
    const d = doc as Record<string, unknown>;
    return {
      termId: String(d.termId || d.id || ''),
      term: String(d.term || d.value || ''),
      language: String(d.language || d.lang || ''),
      conceptId: String(d.conceptId || ''),
      conceptName: d.conceptName as string | undefined,
      definition: d.definition as string | undefined,
      domain: d.domain as string | undefined,
      reliability: this.mapReliability(d.reliability as string | undefined),
      source: d.source as string | undefined,
      translations: this.mapTranslations(d.translations),
      relatedConcepts: this.mapRelatedConcepts(d.relatedConcepts || d.related),
      synonyms: Array.isArray(d.synonyms) ? d.synonyms.map(String) : undefined,
    };
  }

  private mapTranslations(translations: unknown): Translation[] | undefined {
    if (!Array.isArray(translations)) return undefined;

    return translations.map((t: unknown) => {
      const tr = t as Record<string, unknown>;
      return {
        term: String(tr.term || tr.value || ''),
        language: String(tr.language || tr.lang || ''),
        reliability: this.mapReliability(tr.reliability as string | undefined),
        source: tr.source as string | undefined,
      };
    });
  }

  private mapRelatedConcepts(concepts: unknown): RelatedConcept[] | undefined {
    if (!Array.isArray(concepts)) return undefined;

    return concepts.map((c: unknown) => {
      const con = c as Record<string, unknown>;
      return {
        conceptId: String(con.conceptId || con.id || ''),
        conceptName: String(con.conceptName || con.name || ''),
        relationshipType: this.mapRelationshipType(con.relationshipType as string | undefined || con.relation as string | undefined),
      };
    });
  }

  private mapReliability(reliability?: string): 'high' | 'medium' | 'low' | undefined {
    if (!reliability) return undefined;
    const lower = reliability.toLowerCase();
    if (lower === 'high' || lower === '3' || lower === 'verified') return 'high';
    if (lower === 'medium' || lower === '2') return 'medium';
    if (lower === 'low' || lower === '1') return 'low';
    return undefined;
  }

  private mapRelationshipType(type?: string): RelatedConcept['relationshipType'] {
    if (!type) return 'related';
    const lower = type.toLowerCase();
    if (lower.includes('broader') || lower.includes('parent') || lower === 'bt') return 'broader';
    if (lower.includes('narrower') || lower.includes('child') || lower === 'nt') return 'narrower';
    return 'related';
  }
}
