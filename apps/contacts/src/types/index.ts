// ─── Enums ────────────────────────────────────────────────────────────────────

export type ContactStatus = "active" | "pending_reply" | "converted" | "closed" | "other";

export type PreferredContactMethod =
  | "email"
  | "phone"
  | "telegram"
  | "whatsapp"
  | "linkedin"
  | "twitter"
  | "other";

export type EmailType = "work" | "personal" | "other";

export type PhoneType = "mobile" | "work" | "home" | "fax" | "whatsapp" | "other";

export type AddressType = "physical" | "mailing" | "billing" | "virtual" | "other";

export type SocialPlatform =
  | "twitter"
  | "linkedin"
  | "github"
  | "instagram"
  | "telegram"
  | "discord"
  | "youtube"
  | "tiktok"
  | "bluesky"
  | "facebook"
  | "whatsapp"
  | "snapchat"
  | "reddit"
  | "other";

export type RelationshipType =
  | "colleague"
  | "friend"
  | "family"
  | "reports_to"
  | "mentor"
  | "investor"
  | "partner"
  | "client"
  | "vendor"
  | "other";

export type ContactSource =
  | "manual"
  | "import"
  | "linkedin"
  | "github"
  | "twitter"
  | "email"
  | "calendar"
  | "crm"
  | "other";

// ─── Sub-entities ─────────────────────────────────────────────────────────────

export interface Email {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  address: string;
  type: EmailType;
  is_primary: boolean;
  created_at: string;
}

export interface Phone {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  number: string;
  country_code: string | null;
  type: PhoneType;
  is_primary: boolean;
  created_at: string;
}

export interface Address {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  type: AddressType;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface SocialProfile {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  platform: SocialPlatform;
  handle: string | null;
  url: string | null;
  is_primary: boolean;
  created_at: string;
}

// ─── Tag ──────────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
  description?: string | null;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string | null;
  notes: string | null;
  birthday: string | null;
  company_id: string | null;
  job_title: string | null;
  source: ContactSource;
  custom_fields: Record<string, unknown>;
  last_contacted_at: string | null;
  website: string | null;
  preferred_contact_method: PreferredContactMethod | null;
  status: ContactStatus;
  follow_up_at: string | null;
  archived: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactWithDetails extends Contact {
  emails: Email[];
  phones: Phone[];
  addresses: Address[];
  social_profiles: SocialProfile[];
  tags: Tag[];
  company: Company | null;
}

export interface CreateContactInput {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  nickname?: string;
  avatar_url?: string;
  notes?: string;
  birthday?: string;
  company_id?: string;
  job_title?: string;
  source?: ContactSource;
  custom_fields?: Record<string, unknown>;
  last_contacted_at?: string;
  website?: string;
  preferred_contact_method?: PreferredContactMethod;
  status?: ContactStatus;
  follow_up_at?: string;
  project_id?: string;
  emails?: CreateEmailInput[];
  phones?: CreatePhoneInput[];
  addresses?: CreateAddressInput[];
  social_profiles?: CreateSocialProfileInput[];
  tag_ids?: string[];
}

export interface UpdateContactInput {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  nickname?: string | null;
  avatar_url?: string | null;
  notes?: string | null;
  birthday?: string | null;
  company_id?: string | null;
  job_title?: string | null;
  source?: ContactSource;
  custom_fields?: Record<string, unknown>;
  last_contacted_at?: string | null;
  website?: string | null;
  preferred_contact_method?: PreferredContactMethod | null;
  status?: ContactStatus;
  follow_up_at?: string | null;
  project_id?: string | null;
  emails_add?: CreateEmailInput[];
  phones_add?: CreatePhoneInput[];
}

export interface ContactListOptions {
  limit?: number;
  offset?: number;
  company_id?: string;
  tag_id?: string;
  tag_ids?: string[];
  source?: ContactSource;
  status?: ContactStatus;
  project_id?: string;
  archived?: boolean;
  follow_up_due?: boolean;
  last_contacted_after?: string;
  last_contacted_before?: string;
  order_by?: "display_name" | "created_at" | "updated_at" | "last_contacted_at" | "follow_up_at";
  order_dir?: "asc" | "desc";
}

// ─── Company ──────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  founded_year: number | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  archived: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyWithDetails extends Company {
  emails: Email[];
  phones: Phone[];
  addresses: Address[];
  social_profiles: SocialProfile[];
  tags: Tag[];
  employee_count: number;
}

export interface CreateCompanyInput {
  name: string;
  domain?: string;
  logo_url?: string;
  description?: string;
  industry?: string;
  size?: string;
  founded_year?: number;
  notes?: string;
  custom_fields?: Record<string, unknown>;
  emails?: CreateEmailInput[];
  phones?: CreatePhoneInput[];
  addresses?: CreateAddressInput[];
  social_profiles?: CreateSocialProfileInput[];
  tag_ids?: string[];
}

export interface UpdateCompanyInput {
  name?: string;
  domain?: string | null;
  logo_url?: string | null;
  description?: string | null;
  industry?: string | null;
  size?: string | null;
  founded_year?: number | null;
  notes?: string | null;
  custom_fields?: Record<string, unknown>;
  project_id?: string | null;
}

export interface CompanyListOptions {
  limit?: number;
  offset?: number;
  industry?: string;
  tag_id?: string;
  project_id?: string;
  archived?: boolean;
  order_by?: "name" | "created_at" | "updated_at";
  order_dir?: "asc" | "desc";
}

// ─── Sub-entity inputs ────────────────────────────────────────────────────────

export interface CreateEmailInput {
  address: string;
  type?: EmailType;
  is_primary?: boolean;
}

export interface CreatePhoneInput {
  number: string;
  country_code?: string;
  type?: PhoneType;
  is_primary?: boolean;
}

export interface CreateAddressInput {
  type?: AddressType;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  is_primary?: boolean;
}

export interface CreateSocialProfileInput {
  platform: SocialPlatform;
  handle?: string;
  url?: string;
  is_primary?: boolean;
}

// ─── Contact Relationship ─────────────────────────────────────────────────────

export interface ContactRelationship {
  id: string;
  contact_a_id: string;
  contact_b_id: string;
  relationship_type: RelationshipType;
  notes: string | null;
  created_at: string;
}

export interface CreateRelationshipInput {
  contact_a_id: string;
  contact_b_id: string;
  relationship_type: RelationshipType;
  notes?: string;
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export interface ActivityLog {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

export interface CreateActivityInput {
  contact_id?: string;
  company_id?: string;
  action: string;
  details?: string;
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  secret?: string | null;
  active?: boolean;
}

// ─── Raw DB row types ─────────────────────────────────────────────────────────

export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string | null;
  notes: string | null;
  birthday: string | null;
  company_id: string | null;
  job_title: string | null;
  source: string;
  custom_fields: string;
  last_contacted_at: string | null;
  website: string | null;
  preferred_contact_method: string | null;
  status: string;
  follow_up_at: string | null;
  archived: number;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  founded_year: number | null;
  notes: string | null;
  custom_fields: string;
  archived: number;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailRow {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  address: string;
  type: string;
  is_primary: number;
  created_at: string;
}

export interface PhoneRow {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  number: string;
  country_code: string | null;
  type: string;
  is_primary: number;
  created_at: string;
}

export interface AddressRow {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  type: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  is_primary: number;
  created_at: string;
}

export interface SocialProfileRow {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  platform: string;
  handle: string | null;
  url: string | null;
  is_primary: number;
  created_at: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
}

export interface RelationshipRow {
  id: string;
  contact_a_id: string;
  contact_b_id: string;
  relationship_type: string;
  notes: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: number;
  created_at: string;
}

// ─── Group ────────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count?: number;
  company_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
}

// ─── Dedup ────────────────────────────────────────────────────────────────────

export interface DuplicateByEmail {
  email: string;
  contact_ids: string[];
}

export interface DuplicateByName {
  contact_ids: [string, string];
  similarity: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ContactNotFoundError extends Error {
  constructor(id: string) {
    super(`Contact not found: ${id}`);
    this.name = "ContactNotFoundError";
  }
}

export class CompanyNotFoundError extends Error {
  constructor(id: string) {
    super(`Company not found: ${id}`);
    this.name = "CompanyNotFoundError";
  }
}

export class TagNotFoundError extends Error {
  constructor(id: string) {
    super(`Tag not found: ${id}`);
    this.name = "TagNotFoundError";
  }
}

export class DuplicateTagNameError extends Error {
  constructor(name: string) {
    super(`Tag with name already exists: ${name}`);
    this.name = "DuplicateTagNameError";
  }
}
