// ContactOut API Types

// ============================================
// Configuration
// ============================================

export interface ContactOutConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  page?: number;
  total?: number;
}

// ============================================
// Profile Types
// ============================================

export interface ContactOutProfile {
  id?: string;
  linkedin_url?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  location?: string;
  industry?: string;
  summary?: string;
  profile_pic?: string;
  emails?: EmailInfo[];
  phones?: PhoneInfo[];
  experience?: Experience[];
  education?: Education[];
  skills?: string[];
  languages?: string[];
  certifications?: Certification[];
}

export interface EmailInfo {
  email: string;
  type?: 'personal' | 'work';
  status?: 'valid' | 'invalid' | 'unknown' | 'catch_all';
}

export interface PhoneInfo {
  phone: string;
  type?: 'mobile' | 'direct' | 'work';
}

export interface Experience {
  title?: string;
  company?: string;
  company_linkedin_url?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  is_current?: boolean;
}

export interface Education {
  school?: string;
  school_linkedin_url?: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string;
  end_date?: string;
}

export interface Certification {
  name?: string;
  authority?: string;
  start_date?: string;
  end_date?: string;
}

// ============================================
// LinkedIn API Types
// ============================================

export interface LinkedInEnrichParams {
  profile: string;
  profile_only?: boolean;
}

export interface LinkedInEnrichResponse {
  profile?: ContactOutProfile;
  emails?: string[];
  phones?: string[];
  status?: string;
  message?: string;
}

export interface ContactInfoParams {
  profile: string;
  include_phone?: boolean;
  email_type?: 'personal' | 'work' | 'personal,work' | 'none';
}

export interface ContactInfoResponse {
  emails?: EmailInfo[];
  phones?: PhoneInfo[];
  status?: string;
}

export interface BatchContactParams {
  profiles: string[];
  include_phone?: boolean;
  callback_url?: string;
}

export interface BatchContactResponse {
  job_id?: string;
  results?: Record<string, string[]>;
  status?: string;
}

export interface BatchJobResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  results?: Record<string, ContactInfoResponse>;
  progress?: number;
}

// ============================================
// People API Types
// ============================================

export interface PeopleSearchParams {
  name?: string;
  job_title?: string[];
  job_function?: string[];
  seniority?: string[];
  skills?: string[];
  languages?: string[];
  education?: string[];
  company?: string[];
  company_domain?: string[];
  location?: string[];
  industry?: string[];
  page?: number;
  data_types?: ('email' | 'phone')[];
  reveal_info?: boolean;
  detailed_experience?: boolean;
  detailed_education?: boolean;
}

export interface PeopleSearchResponse {
  profiles: ContactOutProfile[];
  page?: number;
  total?: number;
}

export interface PeopleCountParams {
  name?: string;
  job_title?: string[];
  job_function?: string[];
  seniority?: string[];
  skills?: string[];
  company?: string[];
  location?: string[];
  industry?: string[];
}

export interface PeopleCountResponse {
  count: number;
}

export interface PeopleEnrichParams {
  linkedin_url?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  company_domain?: string;
  location?: string;
  include?: ('work_email' | 'personal_email' | 'phone')[];
}

export interface PeopleEnrichResponse {
  profile?: ContactOutProfile;
  match_confidence?: number;
  status?: string;
}

export interface DecisionMakersParams {
  linkedin_url?: string;
  domain?: string;
  name?: string;
  page?: number;
  reveal_info?: boolean;
}

export interface DecisionMakersResponse {
  profiles: ContactOutProfile[];
  page?: number;
  total?: number;
}

// ============================================
// Company API Types
// ============================================

export interface CompanySearchParams {
  name?: string;
  domain?: string;
  size?: string[];
  location?: string[];
  industry?: string[];
  min_revenue?: number;
  max_revenue?: number;
  year_founded_from?: number;
  year_founded_to?: number;
  page?: number;
  hq_only?: boolean;
}

export interface CompanyProfile {
  name?: string;
  domain?: string;
  linkedin_url?: string;
  description?: string;
  industry?: string;
  size?: string;
  size_range?: string;
  employee_count?: number;
  revenue?: string;
  revenue_range?: string;
  year_founded?: number;
  headquarters?: CompanyLocation;
  locations?: CompanyLocation[];
  specialties?: string[];
  logo_url?: string;
  website?: string;
}

export interface CompanyLocation {
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  postal_code?: string;
  is_headquarters?: boolean;
}

export interface CompanySearchResponse {
  companies: CompanyProfile[];
  page?: number;
  total?: number;
}

export interface DomainEnrichParams {
  domains: string[];
}

export interface DomainEnrichResponse {
  companies: Record<string, CompanyProfile>;
}

// ============================================
// Email API Types
// ============================================

export interface EmailEnrichParams {
  email: string;
  include?: string;
}

export interface EmailEnrichResponse {
  profile?: ContactOutProfile;
  status?: string;
}

export interface EmailVerifyResponse {
  email: string;
  status: 'valid' | 'invalid' | 'accept_all' | 'disposable' | 'unknown';
}

export interface BatchEmailVerifyParams {
  emails: string[];
  callback_url?: string;
}

export interface BatchEmailVerifyResponse {
  job_id: string;
  status?: string;
}

export interface BatchEmailVerifyJobResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  results?: EmailVerifyResponse[];
  progress?: number;
}

export interface EmailToLinkedInResponse {
  linkedin_url?: string;
  status?: string;
}

// ============================================
// Contact Checker API Types
// ============================================

export interface EmailStatusResponse {
  has_personal_email?: boolean;
  has_work_email?: boolean;
  work_email_verified?: boolean;
}

export interface PhoneStatusResponse {
  has_phone: boolean;
}

// ============================================
// Stats API Types
// ============================================

export interface StatsParams {
  period?: string; // YYYY-MM format
}

export interface StatsResponse {
  email_credits_used?: number;
  phone_credits_used?: number;
  search_credits_used?: number;
  verifier_credits_used?: number;
  email_credits_remaining?: number;
  phone_credits_remaining?: number;
  search_credits_remaining?: number;
  period?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ContactOutApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ContactOutApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
