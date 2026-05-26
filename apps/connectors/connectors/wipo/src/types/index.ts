// WIPO Connector Types

// ============================================
// Configuration
// ============================================

export interface WIPOConfig {
  apiKey?: string; // Optional for some APIs
  baseUrl?: string;
  headless?: boolean; // For Playwright browser
  browser?: 'chromium' | 'firefox' | 'webkit';
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Patentscope Types (PCT Applications)
// ============================================

export interface PatentscopeSearchParams {
  query: string;
  start?: number;
  rows?: number;
  sort?: 'relevance' | 'date_asc' | 'date_desc';
  language?: string;
  facets?: boolean;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  applicantCountry?: string;
  ipc?: string; // IPC classification
}

export interface PCTApplication {
  applicationNumber: string; // PCT/XX/YYYY/NNNNNN
  publicationNumber?: string; // WO/YYYY/NNNNNN
  internationalFilingDate: string;
  publicationDate?: string;
  title: string;
  titleLanguage?: string;
  abstract?: string;
  abstractLanguage?: string;
  applicants?: Applicant[];
  inventors?: Inventor[];
  designatedStates?: string[];
  ipcClassifications?: IPCClassification[];
  priorities?: PriorityDocument[];
  pctStatus?: string;
  nationalPhaseEntries?: NationalPhaseEntry[];
}

export interface Applicant {
  name: string;
  address?: string;
  country?: string;
  type?: 'individual' | 'organization';
}

export interface Inventor {
  name: string;
  address?: string;
  country?: string;
}

export interface IPCClassification {
  code: string;
  description?: string;
  version?: string;
  section?: string;
  class?: string;
  subclass?: string;
}

export interface PriorityDocument {
  applicationNumber: string;
  filingDate: string;
  country: string;
}

export interface NationalPhaseEntry {
  country: string;
  applicationNumber?: string;
  entryDate?: string;
  status?: string;
}

export interface PatentscopeSearchResponse {
  total: number;
  start: number;
  rows: number;
  applications: PCTApplication[];
  facets?: Record<string, FacetValue[]>;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface PatentscopeDocument {
  documentId: string;
  documentType: 'application' | 'publication' | 'search-report' | 'other';
  language?: string;
  pageCount?: number;
  downloadUrl?: string;
}

// ============================================
// Madrid System Types (International Trademarks)
// ============================================

export interface MadridSearchParams {
  query?: string;
  markName?: string;
  holderName?: string;
  holderCountry?: string;
  designatedCountry?: string;
  niceClass?: number | number[];
  status?: 'active' | 'inactive' | 'all';
  dateFrom?: string;
  dateTo?: string;
  start?: number;
  rows?: number;
  sort?: 'relevance' | 'date_asc' | 'date_desc';
}

export interface MadridMark {
  registrationNumber: string; // International Registration Number
  applicationNumber?: string;
  markName?: string;
  markType?: 'word' | 'figurative' | 'combined' | 'three-dimensional' | 'sound' | 'other';
  status: string;
  statusDate?: string;
  registrationDate: string;
  expiryDate?: string;
  holder: MarkHolder;
  representative?: Representative;
  designatedCountries: DesignatedCountry[];
  niceClassifications: NiceClassification[];
  viennaClassifications?: ViennaClassification[];
  goodsServices: string;
  colors?: string[];
  imageUrl?: string;
  priorities?: MarkPriority[];
}

export interface MarkHolder {
  name: string;
  address?: string;
  city?: string;
  country: string;
  entityType?: string;
}

export interface Representative {
  name: string;
  address?: string;
  country?: string;
}

export interface DesignatedCountry {
  countryCode: string;
  countryName?: string;
  status: string;
  statusDate?: string;
  protectionStartDate?: string;
  refusalDate?: string;
  refusalReason?: string;
}

export interface NiceClassification {
  classNumber: number;
  description?: string;
  goodsServices?: string;
}

export interface ViennaClassification {
  code: string;
  description?: string;
}

export interface MarkPriority {
  country: string;
  applicationNumber: string;
  filingDate: string;
}

export interface MadridSearchResponse {
  total: number;
  start: number;
  rows: number;
  marks: MadridMark[];
  facets?: Record<string, FacetValue[]>;
}

export interface MadridDocument {
  documentId: string;
  documentType: 'gazette' | 'notification' | 'certificate' | 'other';
  publicationDate?: string;
  downloadUrl?: string;
}

// ============================================
// WIPO Pearl Types (Terminology)
// ============================================

export interface WIPOPearlSearchParams {
  term: string;
  sourceLanguage?: string;
  targetLanguages?: string[];
  domain?: string; // Technology domain
  conceptId?: string;
  exactMatch?: boolean;
  start?: number;
  rows?: number;
}

export interface WIPOPearlTerm {
  termId: string;
  term: string;
  language: string;
  conceptId: string;
  conceptName?: string;
  definition?: string;
  domain?: string;
  reliability?: 'high' | 'medium' | 'low';
  source?: string;
  translations?: Translation[];
  relatedConcepts?: RelatedConcept[];
  synonyms?: string[];
}

export interface Translation {
  term: string;
  language: string;
  reliability?: 'high' | 'medium' | 'low';
  source?: string;
}

export interface RelatedConcept {
  conceptId: string;
  conceptName: string;
  relationshipType: 'broader' | 'narrower' | 'related';
}

export interface WIPOPearlSearchResponse {
  total: number;
  start: number;
  rows: number;
  terms: WIPOPearlTerm[];
}

export interface WIPOPearlConcept {
  conceptId: string;
  name: string;
  definition?: string;
  domain: string;
  terms: WIPOPearlTerm[];
  broaderConcepts?: RelatedConcept[];
  narrowerConcepts?: RelatedConcept[];
  relatedConcepts?: RelatedConcept[];
}

// ============================================
// Browser Automation Types
// ============================================

export interface PatentscopeWebSearchParams {
  query: string;
  searchType?: 'simple' | 'advanced' | 'field';
  language?: string;
  collection?: 'pct' | 'national';
}

export interface MadridMonitorSearchParams {
  markName?: string;
  holderName?: string;
  registrationNumber?: string;
  country?: string;
}

export interface BrowserSearchOptions {
  headless?: boolean;
  timeout?: number;
  screenshotPath?: string;
}

export interface BrowserSearchResult {
  applicationNumber: string;
  title?: string;
  date?: string;
  applicant?: string;
  url?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class WIPOApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'WIPOApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
