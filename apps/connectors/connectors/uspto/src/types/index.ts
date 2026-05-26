// USPTO Connector Types

// ============================================
// Configuration
// ============================================

export interface USPTOConfig {
  apiKey?: string; // Optional for some APIs
  baseUrl?: string;
  headless?: boolean; // For Playwright browser
  browser?: 'chromium' | 'firefox' | 'webkit';
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Patent Types
// ============================================

export interface PatentSearchParams {
  query: string;
  start?: number;
  rows?: number;
  sort?: string;
  facet?: boolean;
  fl?: string[]; // Field list
}

export interface Patent {
  patentNumber: string;
  publicationNumber?: string;
  applicationNumber?: string;
  title: string;
  abstract?: string;
  inventors?: string[];
  assignees?: string[];
  filingDate?: string;
  publicationDate?: string;
  grantDate?: string;
  claims?: string[];
  classifications?: PatentClassification[];
  citations?: PatentCitation[];
  status?: string;
  type?: 'utility' | 'design' | 'plant' | 'reissue';
}

export interface PatentClassification {
  type: 'CPC' | 'IPC' | 'USPC';
  code: string;
  description?: string;
}

export interface PatentCitation {
  patentNumber?: string;
  publicationNumber?: string;
  date?: string;
  name?: string;
  category?: 'patent' | 'non-patent';
}

export interface PatentSearchResponse {
  total: number;
  start: number;
  rows: number;
  patents: Patent[];
}

export interface PatentDocument {
  documentId: string;
  documentType: string;
  mailDate?: string;
  pageCount?: number;
  downloadUrl?: string;
}

export interface PatentFileWrapper {
  applicationNumber: string;
  filingDate: string;
  status: string;
  applicationType: string;
  documents: PatentDocument[];
  continuity?: PatentContinuity[];
  transactions?: PatentTransaction[];
}

export interface PatentContinuity {
  parentApplicationNumber: string;
  parentFilingDate: string;
  claimType: string;
  description: string;
}

export interface PatentTransaction {
  date: string;
  code: string;
  description: string;
}

export interface PatentAssignment {
  reelFrame: string;
  recordDate: string;
  executionDate?: string;
  assignor: string;
  assignee: string;
  conveyanceText?: string;
  patentNumbers?: string[];
  applicationNumbers?: string[];
}

// ============================================
// Trademark Types
// ============================================

export interface TrademarkSearchParams {
  query: string;
  start?: number;
  rows?: number;
  status?: 'live' | 'dead' | 'all';
  searchType?: 'basic' | 'structured';
}

export interface Trademark {
  serialNumber: string;
  registrationNumber?: string;
  markText?: string;
  markDrawingCode?: string;
  goodsServices?: string;
  filingDate?: string;
  registrationDate?: string;
  status: string;
  statusDate?: string;
  owner?: TrademarkOwner;
  attorney?: string;
  classifications?: NiceClassification[];
  designCodes?: string[];
  imageUrl?: string;
}

export interface TrademarkOwner {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  entityType?: string;
}

export interface NiceClassification {
  classNumber: number;
  description: string;
}

export interface TrademarkSearchResponse {
  total: number;
  start: number;
  rows: number;
  trademarks: Trademark[];
}

export interface TrademarkDocument {
  documentId: string;
  documentType: string;
  createDate?: string;
  description?: string;
  downloadUrl?: string;
}

export interface TrademarkAssignment {
  reelFrame: string;
  recordDate: string;
  executionDate?: string;
  assignor: string;
  assignee: string;
  conveyanceType?: string;
  serialNumbers?: string[];
  registrationNumbers?: string[];
}

export interface TrademarkStatus {
  serialNumber: string;
  status: string;
  statusDate: string;
  nextActionDue?: string;
  markDrawingCode?: string;
  markText?: string;
}

// ============================================
// TSDR (Trademark Status & Document Retrieval)
// ============================================

export interface TSDRStatus {
  serialNumber: string;
  registrationNumber?: string;
  markText?: string;
  status: string;
  statusDate: string;
  filingDate: string;
  registrationDate?: string;
  owner?: TrademarkOwner;
  prosecutionHistory?: ProsecutionEvent[];
}

export interface ProsecutionEvent {
  date: string;
  description: string;
  code?: string;
}

// ============================================
// PTAB (Patent Trial and Appeal Board)
// ============================================

export interface PTABProceeding {
  proceedingNumber: string;
  type: 'IPR' | 'PGR' | 'CBM' | 'DER' | 'APPEAL';
  status: string;
  filingDate: string;
  institutionDate?: string;
  decisionDate?: string;
  patentNumber?: string;
  patentOwner?: string;
  petitioner?: string;
  accordedFilingDate?: string;
}

export interface PTABSearchParams {
  query?: string;
  proceedingNumber?: string;
  patentNumber?: string;
  petitioner?: string;
  patentOwner?: string;
  type?: 'IPR' | 'PGR' | 'CBM' | 'DER' | 'APPEAL';
  status?: string;
  start?: number;
  rows?: number;
}

export interface PTABSearchResponse {
  total: number;
  start: number;
  rows: number;
  proceedings: PTABProceeding[];
}

export interface PTABDocument {
  documentId: string;
  documentType: string;
  filingDate: string;
  partyName?: string;
  pageCount?: number;
  downloadUrl?: string;
}

// ============================================
// Browser Automation Types
// ============================================

export interface TESSSearchParams {
  searchTerm: string;
  searchType?: 'basic' | 'word-and-or' | 'structured' | 'free-form';
  plurals?: boolean;
  liveOnly?: boolean;
}

export interface TESSResult {
  serialNumber: string;
  registrationNumber?: string;
  wordMark?: string;
  status: string;
  goodsServices?: string;
  owner?: string;
  filingDate?: string;
}

export interface BrowserSearchOptions {
  headless?: boolean;
  timeout?: number;
  screenshotPath?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class USPTOApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'USPTOApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
