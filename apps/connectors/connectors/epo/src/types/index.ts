// EPO Open Patent Services (OPS) Connector Types

// ============================================
// Configuration
// ============================================

export interface EPOConfig {
  consumerKey: string;
  consumerSecret: string;
  baseUrl?: string; // Override default base URL (https://ops.epo.org/3.2/rest-services)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Document type for EPO API queries */
export type DocumentType = 'publication' | 'application' | 'priority';

/** Document format for EPO API queries */
export type DocumentFormat = 'docdb' | 'epodoc' | 'original';

/** Reference type combining type and format */
export interface DocumentReference {
  type: DocumentType;
  format: DocumentFormat;
  number: string;
  country?: string;
  kind?: string;
}

// ============================================
// OAuth Token Types
// ============================================

export interface OAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number; // Unix timestamp
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ============================================
// Publication Types
// ============================================

export interface PublicationSearchRequest {
  query: string; // CQL query string
  rangeBegin?: number;
  rangeEnd?: number;
}

export interface PublicationSearchResponse {
  success: boolean;
  totalResults?: number;
  results?: PublicationResult[];
  error?: string;
}

export interface PublicationResult {
  documentId: string;
  country?: string;
  docNumber?: string;
  kind?: string;
  date?: string;
  title?: string;
  applicants?: string[];
  inventors?: string[];
  classifications?: string[];
}

export interface BiblioResponse {
  success: boolean;
  data?: BibliographicData;
  error?: string;
}

export interface BibliographicData {
  documentId: string;
  country?: string;
  docNumber?: string;
  kind?: string;
  date?: string;
  title?: string;
  titles?: { lang: string; text: string }[];
  abstract?: string;
  abstracts?: { lang: string; text: string }[];
  applicants?: Applicant[];
  inventors?: Inventor[];
  classifications?: Classification[];
  priorities?: PriorityData[];
  citations?: Citation[];
  applicationRef?: DocumentReference;
  publicationRef?: DocumentReference;
}

export interface Applicant {
  name: string;
  country?: string;
  sequence?: number;
}

export interface Inventor {
  name: string;
  country?: string;
  sequence?: number;
}

export interface Classification {
  scheme: string; // IPC, CPC, etc.
  symbol: string;
  section?: string;
  class?: string;
  subclass?: string;
  mainGroup?: string;
  subgroup?: string;
  position?: string;
  value?: string;
}

export interface PriorityData {
  country: string;
  docNumber: string;
  date: string;
  kind?: string;
}

export interface Citation {
  type: 'patcit' | 'nplcit';
  phase?: string;
  category?: string;
  documentId?: string;
  text?: string;
}

export interface AbstractResponse {
  success: boolean;
  data?: {
    documentId: string;
    abstracts: { lang: string; text: string }[];
  };
  error?: string;
}

export interface DescriptionResponse {
  success: boolean;
  data?: {
    documentId: string;
    description: string;
    lang?: string;
  };
  error?: string;
}

export interface ClaimsResponse {
  success: boolean;
  data?: {
    documentId: string;
    claims: Claim[];
  };
  error?: string;
}

export interface Claim {
  number: number;
  text: string;
  type?: 'independent' | 'dependent';
  dependsOn?: number[];
  lang?: string;
}

export interface ImagesResponse {
  success: boolean;
  data?: {
    documentId: string;
    images: ImageInfo[];
  };
  error?: string;
}

export interface ImageInfo {
  type: string; // 'DRAWINGS', 'FIRST_PAGE', etc.
  format: string;
  pages: number;
  url?: string;
}

// ============================================
// Family Types (INPADOC)
// ============================================

export interface FamilyResponse {
  success: boolean;
  data?: FamilyData;
  error?: string;
}

export interface FamilyData {
  familyId?: string;
  members: FamilyMember[];
  totalMembers?: number;
}

export interface FamilyMember {
  documentId: string;
  country: string;
  docNumber: string;
  kind?: string;
  date?: string;
  familySequence?: number;
  applicationRef?: {
    country: string;
    docNumber: string;
    date?: string;
  };
  priorityClaims?: PriorityData[];
}

// ============================================
// Legal Status Types
// ============================================

export interface LegalStatusResponse {
  success: boolean;
  data?: LegalStatusData;
  error?: string;
}

export interface LegalStatusData {
  documentId: string;
  events: LegalEvent[];
}

export interface LegalEvent {
  code: string;
  date: string;
  country?: string;
  description?: string;
  category?: string;
  gazette?: {
    number?: string;
    date?: string;
  };
  correspondingEvents?: {
    country: string;
    code: string;
    date: string;
  }[];
}

// ============================================
// Register Types (EP Register)
// ============================================

export interface RegisterSearchRequest {
  query: string;
  rangeBegin?: number;
  rangeEnd?: number;
}

export interface RegisterSearchResponse {
  success: boolean;
  totalResults?: number;
  results?: RegisterResult[];
  error?: string;
}

export interface RegisterResult {
  applicationNumber: string;
  publicationNumber?: string;
  status?: string;
  title?: string;
  applicants?: string[];
  filingDate?: string;
}

export interface RegisterDataResponse {
  success: boolean;
  data?: RegisterData;
  error?: string;
}

export interface RegisterData {
  applicationNumber: string;
  publicationNumber?: string;
  status?: string;
  procedureType?: string;
  title?: string;
  applicants?: Applicant[];
  inventors?: Inventor[];
  representatives?: Representative[];
  filingDate?: string;
  publicationDate?: string;
  grantDate?: string;
  oppositionDeadline?: string;
  designatedStates?: string[];
  classifications?: Classification[];
  priorities?: PriorityData[];
  citations?: Citation[];
  events?: RegisterEvent[];
  documents?: RegisterDocument[];
}

export interface Representative {
  name: string;
  address?: string;
  country?: string;
}

export interface RegisterEvent {
  date: string;
  code?: string;
  description?: string;
  details?: string;
}

export interface RegisterDocument {
  type: string;
  date: string;
  format?: string;
  pages?: number;
  url?: string;
}

// ============================================
// Classification Types
// ============================================

export interface CPCClassificationResponse {
  success: boolean;
  data?: CPCNode[];
  error?: string;
}

export interface CPCNode {
  symbol: string;
  level: number;
  title?: string;
  definition?: string;
  children?: CPCNode[];
  references?: string[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class EPOApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'EPOApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
