// Pipedrive Connector Types
// CRM persons, organizations, deals, and activities

// ============================================
// Configuration
// ============================================

export interface PipedriveConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PipedriveResponse<T> {
  success: boolean;
  data: T;
  additional_data?: {
    pagination?: {
      start: number;
      limit: number;
      more_items_in_collection: boolean;
      next_start?: number;
    };
  };
}

export interface PipedriveListResponse<T> {
  success: boolean;
  data: T[] | null;
  additional_data?: {
    pagination?: {
      start: number;
      limit: number;
      more_items_in_collection: boolean;
      next_start?: number;
    };
  };
}

// ============================================
// Person Types
// ============================================

export interface Person {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  email?: { value: string; primary: boolean; label: string }[];
  phone?: { value: string; primary: boolean; label: string }[];
  org_id?: number | { value: number; name: string };
  owner_id?: number | { id: number; name: string; email: string };
  visible_to?: string;
  label?: number;
  add_time?: string;
  update_time?: string;
  active_flag?: boolean;
  open_deals_count?: number;
  closed_deals_count?: number;
  won_deals_count?: number;
  lost_deals_count?: number;
}

export interface CreatePersonInput {
  name: string;
  first_name?: string;
  last_name?: string;
  email?: string | string[];
  phone?: string | string[];
  org_id?: number;
  owner_id?: number;
  visible_to?: '1' | '3' | '5' | '7';
  label?: number;
}

// ============================================
// Organization Types
// ============================================

export interface Organization {
  id: number;
  name: string;
  owner_id?: number | { id: number; name: string; email: string };
  address?: string;
  address_street_number?: string;
  address_route?: string;
  address_locality?: string;
  address_admin_area_level_1?: string;
  address_admin_area_level_2?: string;
  address_country?: string;
  address_postal_code?: string;
  visible_to?: string;
  add_time?: string;
  update_time?: string;
  active_flag?: boolean;
  people_count?: number;
  open_deals_count?: number;
  closed_deals_count?: number;
  won_deals_count?: number;
  lost_deals_count?: number;
}

export interface CreateOrganizationInput {
  name: string;
  owner_id?: number;
  address?: string;
  visible_to?: '1' | '3' | '5' | '7';
  label?: number;
}

// ============================================
// Deal Types
// ============================================

export interface Deal {
  id: number;
  title: string;
  value?: number;
  currency?: string;
  person_id?: number | { value: number; name: string; email: { value: string }[] };
  org_id?: number | { value: number; name: string };
  stage_id?: number;
  pipeline_id?: number;
  status?: 'open' | 'won' | 'lost' | 'deleted';
  expected_close_date?: string;
  probability?: number;
  lost_reason?: string;
  visible_to?: string;
  owner_id?: number | { id: number; name: string; email: string };
  add_time?: string;
  update_time?: string;
  close_time?: string;
  won_time?: string;
  lost_time?: string;
  stage_order_nr?: number;
  activities_count?: number;
  done_activities_count?: number;
  undone_activities_count?: number;
}

export interface CreateDealInput {
  title: string;
  value?: number;
  currency?: string;
  person_id?: number;
  org_id?: number;
  stage_id?: number;
  pipeline_id?: number;
  status?: 'open' | 'won' | 'lost';
  expected_close_date?: string;
  probability?: number;
  visible_to?: '1' | '3' | '5' | '7';
  owner_id?: number;
}

// ============================================
// Lead Types
// ============================================

export interface Lead {
  id: string;
  title: string;
  owner_id?: number;
  person_id?: number;
  organization_id?: number;
  value?: { amount: number; currency: string };
  expected_close_date?: string;
  label_ids?: string[];
  is_archived?: boolean;
  add_time?: string;
  update_time?: string;
}

export interface CreateLeadInput {
  title: string;
  owner_id?: number;
  person_id?: number;
  organization_id?: number;
  value?: { amount: number; currency: string };
  expected_close_date?: string;
  label_ids?: string[];
}

// ============================================
// Activity Types
// ============================================

export interface Activity {
  id: number;
  type: string;
  subject?: string;
  due_date?: string;
  due_time?: string;
  duration?: string;
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  lead_id?: string;
  note?: string;
  done?: boolean;
  user_id?: number;
  busy_flag?: boolean;
  participants?: { person_id: number; primary_flag: boolean }[];
  location?: string;
  public_description?: string;
  add_time?: string;
  update_time?: string;
  marked_as_done_time?: string;
}

export interface CreateActivityInput {
  type: string;
  subject?: string;
  due_date?: string;
  due_time?: string;
  duration?: string;
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  lead_id?: string;
  note?: string;
  done?: boolean;
  user_id?: number;
  busy_flag?: boolean;
  participants?: { person_id: number; primary_flag: boolean }[];
  location?: string;
  public_description?: string;
}

// ============================================
// Pipeline Types
// ============================================

export interface Pipeline {
  id: number;
  name: string;
  url_title?: string;
  order_nr?: number;
  active?: boolean;
  deal_probability?: boolean;
  add_time?: string;
  update_time?: string;
}

export interface Stage {
  id: number;
  name: string;
  pipeline_id: number;
  order_nr?: number;
  active_flag?: boolean;
  deal_probability?: number;
  rotten_flag?: boolean;
  rotten_days?: number;
  add_time?: string;
  update_time?: string;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  id: number;
  content: string;
  user_id?: number;
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  lead_id?: string;
  add_time?: string;
  update_time?: string;
  pinned_to_deal_flag?: boolean;
  pinned_to_person_flag?: boolean;
  pinned_to_organization_flag?: boolean;
  pinned_to_lead_flag?: boolean;
}

export interface CreateNoteInput {
  content: string;
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  lead_id?: string;
  pinned_to_deal_flag?: boolean;
  pinned_to_person_flag?: boolean;
  pinned_to_organization_flag?: boolean;
  pinned_to_lead_flag?: boolean;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: number;
  name: string;
  email: string;
  default_currency?: string;
  locale?: string;
  lang?: number;
  active_flag?: boolean;
  is_admin?: number;
  role_id?: number;
  phone?: string;
  timezone_name?: string;
  timezone_offset?: string;
  created?: string;
  modified?: string;
}

// ============================================
// API Error Types
// ============================================

export interface PipedriveErrorDetail {
  error: string;
  error_info?: string;
}

export class PipedriveApiError extends Error {
  public readonly statusCode: number;
  public readonly errorInfo?: string;

  constructor(message: string, statusCode: number, errorInfo?: string) {
    super(message);
    this.name = 'PipedriveApiError';
    this.statusCode = statusCode;
    this.errorInfo = errorInfo;
  }
}
