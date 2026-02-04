// Exa AI API Types
// AI-powered search and content retrieval API

// ============================================
// Configuration
// ============================================

export interface ExaConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ISO 8601 date string
export type DateString = string;

// ============================================
// Search Types
// ============================================

export type SearchType = 'auto' | 'neural' | 'keyword';

export interface SearchOptions {
  query: string;
  useAutoprompt?: boolean;
  type?: SearchType;
  category?: SearchCategory;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startCrawlDate?: DateString;
  endCrawlDate?: DateString;
  startPublishedDate?: DateString;
  endPublishedDate?: DateString;
  includeText?: string[];
  excludeText?: string[];
  // Contents options (when contents are requested inline)
  contents?: ContentsOptions;
}

export type SearchCategory =
  | 'company'
  | 'research paper'
  | 'news'
  | 'linkedin profile'
  | 'github'
  | 'tweet'
  | 'movie'
  | 'song'
  | 'personal site'
  | 'pdf';

export interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  id: string;
  // When contents are included
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
}

export interface SearchResponse {
  requestId?: string;
  autopromptString?: string;
  results: SearchResult[];
}

// ============================================
// Contents Types
// ============================================

export interface ContentsOptions {
  text?: TextContentsOptions | boolean;
  highlights?: HighlightsContentsOptions | boolean;
  summary?: SummaryContentsOptions | boolean;
}

export interface TextContentsOptions {
  maxCharacters?: number;
  includeHtmlTags?: boolean;
}

export interface HighlightsContentsOptions {
  query?: string;
  numSentences?: number;
  highlightsPerUrl?: number;
}

export interface SummaryContentsOptions {
  query?: string;
}

export interface ContentsRequest {
  ids?: string[];
  urls?: string[];
  text?: TextContentsOptions | boolean;
  highlights?: HighlightsContentsOptions | boolean;
  summary?: SummaryContentsOptions | boolean;
}

export interface ContentsResult {
  id: string;
  url: string;
  title: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
}

export interface ContentsResponse {
  requestId?: string;
  results: ContentsResult[];
}

// ============================================
// Find Similar Types
// ============================================

export interface FindSimilarOptions {
  url: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startCrawlDate?: DateString;
  endCrawlDate?: DateString;
  startPublishedDate?: DateString;
  endPublishedDate?: DateString;
  includeText?: string[];
  excludeText?: string[];
  excludeSourceDomain?: boolean;
  category?: SearchCategory;
  contents?: ContentsOptions;
}

export interface FindSimilarResponse {
  requestId?: string;
  results: SearchResult[];
}

// ============================================
// Answer Types
// ============================================

export interface AnswerOptions {
  query: string;
  text?: boolean;
  model?: AnswerModel;
  stream?: boolean;
}

export type AnswerModel = 'exa' | 'exa-pro';

export interface AnswerCitation {
  url: string;
  title: string;
  publishedDate?: string;
  author?: string;
  id: string;
}

export interface AnswerResponse {
  requestId?: string;
  answer: string;
  citations: AnswerCitation[];
}

export interface AnswerStreamEvent {
  type: 'content' | 'citations' | 'done' | 'error';
  content?: string;
  citations?: AnswerCitation[];
  error?: string;
}

// ============================================
// Code Context Types
// ============================================

export interface CodeContextOptions {
  query: string;
  tokensNum?: number | 'dynamic';
}

export interface CodeContextResult {
  url: string;
  title: string;
  text: string;
  score?: number;
}

export interface CodeContextResponse {
  requestId?: string;
  query: string;
  response: string;
  resultsCount: number;
  costDollars: string;
  searchTime: number;
  outputTokens: number;
}

// ============================================
// Research Types (Async Tasks)
// ============================================

export type ResearchStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ResearchTask {
  id: string;
  query: string;
  status: ResearchStatus;
  createdAt: DateString;
  completedAt?: DateString;
  result?: ResearchResult;
  error?: string;
}

export interface ResearchResult {
  summary: string;
  sources: ResearchSource[];
  topics: string[];
}

export interface ResearchSource {
  url: string;
  title: string;
  relevance: number;
  snippet?: string;
}

export interface ResearchCreateOptions {
  query: string;
  depth?: 'basic' | 'thorough' | 'comprehensive';
}

export interface ResearchListParams {
  limit?: number;
  offset?: number;
  status?: ResearchStatus;
}

export interface ResearchListResponse {
  tasks: ResearchTask[];
  total: number;
}

// ============================================
// Websets Types (Entity Collections)
// ============================================

export type WebsetStatus = 'idle' | 'running' | 'completed' | 'failed' | 'canceled';

export interface Webset {
  id: string;
  status: WebsetStatus;
  externalId?: string;
  searches: WebsetSearch[];
  createdAt: DateString;
  updatedAt: DateString;
}

export interface WebsetSearch {
  id: string;
  query: string;
  entity: WebsetEntity;
  numResults?: number;
  criteria?: WebsetCriterion[];
}

export interface WebsetEntity {
  type: string;
  properties?: WebsetEntityProperty[];
}

export interface WebsetEntityProperty {
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'url';
  description?: string;
  required?: boolean;
}

export interface WebsetCriterion {
  description: string;
}

export interface WebsetCreateOptions {
  searches: WebsetSearchInput[];
  externalId?: string;
}

export interface WebsetSearchInput {
  query: string;
  entity: WebsetEntity;
  numResults?: number;
  criteria?: WebsetCriterion[];
}

export interface WebsetItem {
  id: string;
  websetId: string;
  url: string;
  properties: Record<string, unknown>;
  sourceSearchId: string;
  createdAt: DateString;
}

export interface WebsetItemsResponse {
  items: WebsetItem[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

export interface WebsetEnrichment {
  id: string;
  websetId: string;
  name: string;
  description: string;
  format: 'text' | 'number' | 'date' | 'boolean' | 'url';
  status: WebsetStatus;
  createdAt: DateString;
}

export interface WebsetEnrichmentCreateOptions {
  name: string;
  description: string;
  format: 'text' | 'number' | 'date' | 'boolean' | 'url';
}

export interface WebsetListParams {
  limit?: number;
  cursor?: string;
  status?: WebsetStatus;
}

export interface WebsetListResponse {
  websets: Webset[];
  hasMore: boolean;
  cursor?: string;
}

// ============================================
// Team/API Key Types
// ============================================

export interface ApiKey {
  id: string;
  name: string;
  key?: string; // Only returned on creation
  prefix: string;
  createdAt: DateString;
  lastUsedAt?: DateString;
  rateLimit?: number;
  monthlyLimit?: number;
}

export interface ApiKeyCreateOptions {
  name: string;
  rateLimit?: number;
  monthlyLimit?: number;
}

export interface ApiKeyUpdateOptions {
  name?: string;
  rateLimit?: number;
  monthlyLimit?: number;
}

export interface ApiKeyUsage {
  keyId: string;
  period: string;
  requestCount: number;
  tokenCount?: number;
}

export interface ApiKeyListResponse {
  keys: ApiKey[];
  total: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ExaApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ExaApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
