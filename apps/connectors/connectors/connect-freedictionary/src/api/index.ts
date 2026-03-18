// Free Dictionary Connector — Dictionary definitions, phonetics, and translations
import { FreeDictionaryClient } from './client';
import type { FreeDictionaryConfig, FDEntry } from '../types';
export { FreeDictionaryClient } from './client';

export class FreeDictionary {
  private readonly client: FreeDictionaryClient;
  constructor(config: FreeDictionaryConfig = {}) { this.client = new FreeDictionaryClient(config); }
  static fromEnv(): FreeDictionary {
    return new FreeDictionary();
  }

  async define(word: string, language?: string): Promise<FDEntry[]> {
    const lang = language || 'en';
    return this.client.request<FDEntry[]>(`/entries/${lang}/${encodeURIComponent(word)}`);
  }

  async getPhonetics(word: string, language?: string): Promise<{ word: string; phonetics: { text: string; audio: string }[] }> {
    const entries = await this.define(word, language);
    return { word, phonetics: entries.flatMap(e => e.phonetics.filter(p => p.text || p.audio)) };
  }

  async getSynonyms(word: string, language?: string): Promise<string[]> {
    const entries = await this.define(word, language);
    const synonyms = new Set<string>();
    entries.forEach(e => e.meanings.forEach(m => { m.synonyms.forEach(s => synonyms.add(s)); m.definitions.forEach(d => d.synonyms.forEach(s => synonyms.add(s))); }));
    return Array.from(synonyms);
  }

  async getAntonyms(word: string, language?: string): Promise<string[]> {
    const entries = await this.define(word, language);
    const antonyms = new Set<string>();
    entries.forEach(e => e.meanings.forEach(m => { m.antonyms.forEach(a => antonyms.add(a)); m.definitions.forEach(d => d.antonyms.forEach(a => antonyms.add(a))); }));
    return Array.from(antonyms);
  }

  getClient(): FreeDictionaryClient { return this.client; }
}
