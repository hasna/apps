// HubSpot Connector Types
// CRM contacts, companies, deals, and tickets

// ============================================
// Configuration
// ============================================

export interface HubSpotConfig {
  apiKey: string; // Private app access token
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface HubSpotPaging {
  next?: {
    after: string;
    link: string;
  };
}

export interface HubSpotListResponse<T> {
  results: T[];
  paging?: HubSpotPaging;
}

// ============================================
// Contact Types
// ============================================

export interface ContactProperties {
  email?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  jobtitle?: string;
  lifecyclestage?: string;
  hs_lead_status?: string;
  createdate?: string;
  lastmodifieddate?: string;
  [key: string]: string | undefined;
}

export interface Contact {
  id: string;
  properties: ContactProperties;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateContactInput {
  properties: Partial<ContactProperties>;
}

export interface UpdateContactInput {
  properties: Partial<ContactProperties>;
}

// ============================================
// Company Types
// ============================================

export interface CompanyProperties {
  name?: string;
  domain?: string;
  description?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  industry?: string;
  numberofemployees?: string;
  annualrevenue?: string;
  website?: string;
  lifecyclestage?: string;
  createdate?: string;
  lastmodifieddate?: string;
  [key: string]: string | undefined;
}

export interface Company {
  id: string;
  properties: CompanyProperties;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateCompanyInput {
  properties: Partial<CompanyProperties>;
}

export interface UpdateCompanyInput {
  properties: Partial<CompanyProperties>;
}

// ============================================
// Deal Types
// ============================================

export interface DealProperties {
  dealname?: string;
  dealstage?: string;
  pipeline?: string;
  amount?: string;
  closedate?: string;
  description?: string;
  hubspot_owner_id?: string;
  createdate?: string;
  lastmodifieddate?: string;
  [key: string]: string | undefined;
}

export interface Deal {
  id: string;
  properties: DealProperties;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateDealInput {
  properties: Partial<DealProperties>;
}

export interface UpdateDealInput {
  properties: Partial<DealProperties>;
}

// ============================================
// Ticket Types
// ============================================

export interface TicketProperties {
  subject?: string;
  content?: string;
  hs_pipeline?: string;
  hs_pipeline_stage?: string;
  hs_ticket_priority?: string;
  hubspot_owner_id?: string;
  createdate?: string;
  lastmodifieddate?: string;
  [key: string]: string | undefined;
}

export interface Ticket {
  id: string;
  properties: TicketProperties;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateTicketInput {
  properties: Partial<TicketProperties>;
}

export interface UpdateTicketInput {
  properties: Partial<TicketProperties>;
}

// ============================================
// Owner Types
// ============================================

export interface Owner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

// ============================================
// Note Types
// ============================================

export interface NoteProperties {
  hs_note_body?: string;
  hs_timestamp?: string;
  hubspot_owner_id?: string;
  [key: string]: string | undefined;
}

export interface Note {
  id: string;
  properties: NoteProperties;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateNoteInput {
  properties: Partial<NoteProperties>;
  associations?: {
    to: { id: string };
    types: { associationCategory: string; associationTypeId: number }[];
  }[];
}

// ============================================
// Association Types
// ============================================

export interface AssociationType {
  category: string;
  typeId: number;
  label?: string;
}

export interface Association {
  id: string;
  type: string;
}

// ============================================
// Search Types
// ============================================

export interface SearchFilter {
  propertyName: string;
  operator: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE' | 'HAS_PROPERTY' | 'NOT_HAS_PROPERTY' | 'CONTAINS_TOKEN' | 'NOT_CONTAINS_TOKEN';
  value?: string;
}

export interface SearchFilterGroup {
  filters: SearchFilter[];
}

export interface SearchRequest {
  filterGroups?: SearchFilterGroup[];
  sorts?: { propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }[];
  properties?: string[];
  limit?: number;
  after?: string;
}

export interface SearchResponse<T> {
  total: number;
  results: T[];
  paging?: HubSpotPaging;
}

// ============================================
// API Error Types
// ============================================

export interface HubSpotErrorDetail {
  message: string;
  in?: string;
  code?: string;
  subCategory?: string;
  context?: Record<string, string[]>;
}

export class HubSpotApiError extends Error {
  public readonly statusCode: number;
  public readonly category?: string;
  public readonly errors?: HubSpotErrorDetail[];

  constructor(message: string, statusCode: number, category?: string, errors?: HubSpotErrorDetail[]) {
    super(message);
    this.name = 'HubSpotApiError';
    this.statusCode = statusCode;
    this.category = category;
    this.errors = errors;
  }
}
