export interface FreeDictionaryConfig { baseUrl?: string; }

export interface FDEntry { word: string; phonetic: string; phonetics: { text: string; audio: string; sourceUrl: string }[]; meanings: FDMeaning[]; license: { name: string; url: string }; sourceUrls: string[]; }
export interface FDMeaning { partOfSpeech: string; definitions: { definition: string; synonyms: string[]; antonyms: string[]; example?: string }[]; synonyms: string[]; antonyms: string[]; }

export class FreeDictionaryApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FreeDictionaryApiError'; this.statusCode = statusCode; }
}
