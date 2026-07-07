export interface TextRazorConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TextRazorAnalyzeOptions {
  text: string;
  extractors?: string;
  language?: string;
  cleanup?: string;
  cleanupMode?: string;
  allowOverlap?: boolean;
  entitiesFilterTypes?: string;
  entitiesFilterFreeTypes?: string;
  entitiesFilterDbpediaTypes?: string;
  entitiesFilterFreeDbpediaTypes?: string;
  entitiesFilterConfidence?: number;
  entitiesEnlink?: boolean;
  entitiesSpot?: string;
  entitiesAllowOverlap?: boolean;
  topicsFilter?: string;
  topicsFilterConfidence?: number;
  topicsEnlink?: boolean;
  topicsSpot?: string;
  topicsAllowOverlap?: boolean;
}

export interface TextRazorEntity {
  id: string;
  type: string[];
  matchingTokens: number[];
  confidenceScore: number;
  relevanceScore: number;
  wikiLink?: string;
  freebaseId?: string;
  freebaseTypes?: string[];
  entityId?: string;
  entityEnglishId?: string;
  dataJson?: string;
}

export interface TextRazorTopic {
  label: string;
  score: number;
  wikiLink?: string;
}

export interface TextRazorSentence {
  words: TextRazorWord[];
}

export interface TextRazorWord {
  token: string;
  startingPos: number;
  endingPos: number;
  position: string;
  stem?: string;
  lemma?: string;
  partOfSpeech?: string;
}

export interface TextRazorResponse {
  language: string;
  languageIsReliable: boolean;
  time: number;
  ok: boolean;
  response: {
    entities?: TextRazorEntity[];
    topics?: TextRazorTopic[];
    sentences?: TextRazorSentence[];
    sentiment?: { score: number };
    coarseTopics?: TextRazorTopic[];
    categories?: Array<{ label: string; score: number }>;
    relations?: Array<{ predicate: string; wordPositions: number[] }>;
    nphrases?: Array<{ text: string; wordPositions: number[] }>;
    words?: TextRazorWord[];
  };
  error?: string;
  message?: string;
}

export interface TextRazorRawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class TextRazorApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TextRazorApiError';
    this.statusCode = statusCode;
  }
}
