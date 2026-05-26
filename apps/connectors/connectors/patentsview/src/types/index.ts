// PatentsView Connector Types
// Based on the PatentsView API v1 (May 2025+)

// ============================================
// Configuration
// ============================================

export interface PatentsViewConfig {
  apiKey?: string; // API key for authentication (required)
  baseUrl?: string; // Override default base URL (https://search.patentsview.org/api/v1)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// Query operators for filtering
export interface QueryFilter {
  _eq?: string | number | boolean;
  _neq?: string | number | boolean;
  _gt?: number | string;
  _gte?: number | string;
  _lt?: number | string;
  _lte?: number | string;
  _begins?: string;
  _contains?: string;
  _text_any?: string;
  _text_all?: string;
  _text_phrase?: string;
}

// Generic query object structure
export type QueryObject = {
  _and?: QueryObject[];
  _or?: QueryObject[];
  _not?: QueryObject;
} & {
  [field: string]: QueryFilter | QueryObject | QueryObject[] | undefined;
};

// Pagination and sorting options
export interface QueryOptions {
  page?: number;
  per_page?: number;
  sort?: Array<{ [field: string]: 'asc' | 'desc' }>;
}

// Base search request format
export interface SearchRequest {
  q?: QueryObject;
  f?: string[];
  o?: QueryOptions;
}

// Base search response format
export interface SearchResponse<T> {
  patents?: T[];
  assignees?: T[];
  inventors?: T[];
  cpc_subgroups?: T[];
  locations?: T[];
  count?: number;
  total_hits?: number;
}

// ============================================
// Patent Types
// ============================================

export interface Patent {
  patent_id: string;
  patent_number?: string;
  patent_title?: string;
  patent_abstract?: string;
  patent_date?: string;
  patent_type?: string;
  patent_kind?: string;
  patent_num_claims?: number;
  patent_num_cited_by_us_patents?: number;
  patent_num_combined_citations?: number;
  patent_num_foreign_citations?: number;
  patent_num_us_application_citations?: number;
  patent_num_us_patent_citations?: number;
  patent_firstnamed_assignee_id?: string;
  patent_firstnamed_assignee_city?: string;
  patent_firstnamed_assignee_state?: string;
  patent_firstnamed_assignee_country?: string;
  patent_firstnamed_inventor_id?: string;
  patent_firstnamed_inventor_city?: string;
  patent_firstnamed_inventor_state?: string;
  patent_firstnamed_inventor_country?: string;
  patent_year?: number;
  // Nested objects
  assignees?: Assignee[];
  inventors?: Inventor[];
  cpc_current?: CPCClassification[];
  application?: Application;
  claims?: Claim[];
}

export interface Application {
  application_id?: string;
  application_number?: string;
  application_date?: string;
  application_type?: string;
}

export interface Claim {
  claim_number?: number;
  claim_text?: string;
  claim_dependent?: number;
}

// ============================================
// Assignee Types
// ============================================

export interface Assignee {
  assignee_id: string;
  assignee_organization?: string;
  assignee_type?: string;
  assignee_individual_name_first?: string;
  assignee_individual_name_last?: string;
  assignee_city?: string;
  assignee_state?: string;
  assignee_country?: string;
  assignee_latitude?: number;
  assignee_longitude?: number;
  assignee_num_patents?: number;
  assignee_num_inventors?: number;
  assignee_first_seen_date?: string;
  assignee_last_seen_date?: string;
  assignee_years_active?: number;
}

// ============================================
// Inventor Types
// ============================================

export interface Inventor {
  inventor_id: string;
  inventor_name_first?: string;
  inventor_name_last?: string;
  inventor_city?: string;
  inventor_state?: string;
  inventor_country?: string;
  inventor_latitude?: number;
  inventor_longitude?: number;
  inventor_num_patents?: number;
  inventor_num_assignees?: number;
  inventor_first_seen_date?: string;
  inventor_last_seen_date?: string;
  inventor_years_active?: number;
}

// ============================================
// CPC (Cooperative Patent Classification) Types
// ============================================

export interface CPCClassification {
  cpc_subgroup_id?: string;
  cpc_subgroup_title?: string;
  cpc_group_id?: string;
  cpc_group_title?: string;
  cpc_subclass_id?: string;
  cpc_subclass_title?: string;
  cpc_class_id?: string;
  cpc_class_title?: string;
  cpc_section_id?: string;
  cpc_section_title?: string;
  cpc_sequence?: number;
  cpc_type?: string;
}

export interface CPCSubgroup {
  cpc_subgroup_id: string;
  cpc_subgroup_title?: string;
  cpc_group_id?: string;
  cpc_group_title?: string;
  cpc_subclass_id?: string;
  cpc_subclass_title?: string;
  cpc_class_id?: string;
  cpc_class_title?: string;
  cpc_section_id?: string;
  cpc_section_title?: string;
  cpc_num_patents?: number;
  cpc_num_inventors?: number;
  cpc_num_assignees?: number;
}

// ============================================
// Location Types
// ============================================

export interface Location {
  location_id: string;
  location_city?: string;
  location_state?: string;
  location_country?: string;
  location_latitude?: number;
  location_longitude?: number;
  location_num_patents?: number;
  location_num_inventors?: number;
  location_num_assignees?: number;
}

// ============================================
// API Response Types
// ============================================

export interface PatentSearchResponse {
  patents: Patent[];
  count: number;
  total_hits: number;
}

export interface PatentGetResponse {
  patents: Patent[];
}

export interface AssigneeSearchResponse {
  assignees: Assignee[];
  count: number;
  total_hits: number;
}

export interface AssigneeGetResponse {
  assignees: Assignee[];
}

export interface InventorSearchResponse {
  inventors: Inventor[];
  count: number;
  total_hits: number;
}

export interface InventorGetResponse {
  inventors: Inventor[];
}

export interface CPCSearchResponse {
  cpc_subgroups: CPCSubgroup[];
  count: number;
  total_hits: number;
}

export interface CPCGetResponse {
  cpc_subgroups: CPCSubgroup[];
}

export interface LocationSearchResponse {
  locations: Location[];
  count: number;
  total_hits: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class PatentsViewApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'PatentsViewApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Default Fields (commonly used fields for each entity)
// ============================================

export const DEFAULT_PATENT_FIELDS = [
  'patent_id',
  'patent_number',
  'patent_title',
  'patent_abstract',
  'patent_date',
  'patent_type',
  'patent_num_claims',
  'patent_num_cited_by_us_patents',
];

export const DEFAULT_ASSIGNEE_FIELDS = [
  'assignee_id',
  'assignee_organization',
  'assignee_individual_name_first',
  'assignee_individual_name_last',
  'assignee_city',
  'assignee_state',
  'assignee_country',
  'assignee_num_patents',
];

export const DEFAULT_INVENTOR_FIELDS = [
  'inventor_id',
  'inventor_name_first',
  'inventor_name_last',
  'inventor_city',
  'inventor_state',
  'inventor_country',
  'inventor_num_patents',
];

export const DEFAULT_CPC_FIELDS = [
  'cpc_subgroup_id',
  'cpc_subgroup_title',
  'cpc_group_id',
  'cpc_group_title',
  'cpc_section_id',
  'cpc_num_patents',
];

export const DEFAULT_LOCATION_FIELDS = [
  'location_id',
  'location_city',
  'location_state',
  'location_country',
  'location_num_patents',
  'location_num_inventors',
];
