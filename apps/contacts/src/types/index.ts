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

export type Sensitivity = "normal" | "confidential" | "restricted";

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
  sensitivity: Sensitivity;
  do_not_contact?: boolean;
  priority?: number;
  timezone?: string | null;
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
  sensitivity?: Sensitivity;
  do_not_contact?: boolean;
  priority?: number;
  timezone?: string;
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
  sensitivity?: Sensitivity;
  do_not_contact?: boolean;
  priority?: number | null;
  timezone?: string | null;
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
  include_dnc?: boolean;
  include_restricted?: boolean;
  priority_min?: number;
  updated_since?: string;
}

// ─── Deals ────────────────────────────────────────────────────────────────────

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'cancelled';

export interface Deal {
  id: string;
  title: string;
  contact_id?: string | null;
  company_id?: string | null;
  stage: DealStage;
  value_usd?: number | null;
  currency: string;
  close_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDealInput {
  title: string;
  contact_id?: string;
  company_id?: string;
  stage?: DealStage;
  value_usd?: number;
  currency?: string;
  close_date?: string;
  notes?: string;
}

export type UpdateDealInput = Partial<CreateDealInput>;

// ─── Events ───────────────────────────────────────────────────────────────────

export type EventType = 'meeting' | 'call' | 'lunch' | 'email' | 'demo' | 'conference' | 'intro' | 'other';

export interface ContactEvent {
  id: string;
  title: string;
  type: EventType;
  event_date: string;
  duration_min?: number | null;
  contact_ids: string[];
  company_id?: string | null;
  notes?: string | null;
  outcome?: string | null;
  deal_id?: string | null;
  created_at: string;
}

export interface CreateEventInput {
  title: string;
  type?: EventType;
  event_date: string;
  duration_min?: number;
  contact_ids?: string[];
  company_id?: string;
  notes?: string;
  outcome?: string;
  deal_id?: string;
}

// ─── Company ──────────────────────────────────────────────────────────────────

export type EntityType = 'operating' | 'holding' | 'dissolved' | 'nonprofit' | 'trust' | 'branch' | 'other';

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
  is_owned_entity: boolean;
  entity_type?: EntityType | null;
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
  is_owned_entity?: boolean;
  entity_type?: EntityType;
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
  is_owned_entity?: boolean;
  entity_type?: EntityType | null;
}

export interface CompanyListOptions {
  limit?: number;
  offset?: number;
  industry?: string;
  tag_id?: string;
  project_id?: string;
  archived?: boolean;
  is_owned_entity?: boolean;
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

// ─── Structured Notes ─────────────────────────────────────────────────────────

export interface ContactNote {
  id: string;
  contact_id: string;
  body: string;
  created_by: string | null;
  company_id?: string | null;
  created_at: string;
}

// ─── Company Relationships ────────────────────────────────────────────────────

export type CompanyRelationshipType =
  | "client" | "vendor" | "partner" | "employee" | "contractor"
  | "investor" | "advisor" | "other"
  | "tax_preparer" | "registered_agent" | "bank_manager" | "attorney"
  | "paralegal" | "accountant" | "payroll_specialist" | "compliance_officer"
  | "primary_contact" | "backup_contact" | "recruiter" | "insurance_broker";

export interface CompanyRelationship {
  id: string;
  contact_id: string;
  company_id: string;
  relationship_type: CompanyRelationshipType;
  notes: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_primary: boolean;
  status: 'active' | 'inactive' | 'ended';
  created_at: string;
}

export interface CreateCompanyRelationshipInput {
  contact_id: string;
  company_id: string;
  relationship_type: CompanyRelationshipType;
  notes?: string;
  start_date?: string;
  end_date?: string;
  is_primary?: boolean;
  status?: 'active' | 'inactive' | 'ended';
}

export interface CompanyRelationshipRow {
  id: string;
  contact_id: string;
  company_id: string;
  relationship_type: string;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  is_primary: number;
  status: string;
  created_at: string;
}

// ─── Org Members ──────────────────────────────────────────────────────────────

export interface OrgMember {
  id: string;
  company_id: string;
  contact_id: string;
  title?: string | null;
  specialization?: string | null;
  office_phone?: string | null;
  response_sla_hours?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgMemberInput {
  company_id: string;
  contact_id: string;
  title?: string;
  specialization?: string;
  office_phone?: string;
  response_sla_hours?: number;
  notes?: string;
}

export interface UpdateOrgMemberInput {
  title?: string | null;
  specialization?: string | null;
  office_phone?: string | null;
  response_sla_hours?: number | null;
  notes?: string | null;
}

// ─── Vendor Communications ────────────────────────────────────────────────────

export type VendorCommType = 'email' | 'call' | 'meeting' | 'invoice_request' | 'invoice_received' | 'payment' | 'dispute' | 'other';
export type VendorCommDirection = 'inbound' | 'outbound';
export type VendorCommStatus = 'sent' | 'awaiting_response' | 'responded' | 'no_response' | 'resolved';

export interface VendorCommunication {
  id: string;
  company_id: string;
  contact_id?: string | null;
  comm_date: string;
  type: VendorCommType;
  direction: VendorCommDirection;
  subject?: string | null;
  body?: string | null;
  status: VendorCommStatus;
  invoice_amount?: number | null;
  invoice_currency?: string | null;
  invoice_ref?: string | null;
  follow_up_date?: string | null;
  follow_up_done: boolean;
  created_at: string;
}

export interface CreateVendorCommunicationInput {
  company_id: string;
  contact_id?: string;
  comm_date: string;
  type?: VendorCommType;
  direction?: VendorCommDirection;
  subject?: string;
  body?: string;
  status?: VendorCommStatus;
  invoice_amount?: number;
  invoice_currency?: string;
  invoice_ref?: string;
  follow_up_date?: string;
  follow_up_done?: boolean;
}

export interface UpdateVendorCommunicationInput {
  contact_id?: string | null;
  comm_date?: string;
  type?: VendorCommType;
  direction?: VendorCommDirection;
  subject?: string | null;
  body?: string | null;
  status?: VendorCommStatus;
  invoice_amount?: number | null;
  invoice_currency?: string | null;
  invoice_ref?: string | null;
  follow_up_date?: string | null;
  follow_up_done?: boolean;
}

// ─── Contact Tasks ────────────────────────────────────────────────────────────

export interface EscalationRule {
  after_days: number;
  escalate_to_contact_id: string;
  method: 'email' | 'note' | 'both';
}

export interface ContactTask {
  id: string;
  title: string;
  description?: string | null;
  contact_id: string;
  assigned_by?: string | null;
  deadline?: string | null;
  status: 'pending' | 'awaiting_response' | 'in_progress' | 'completed' | 'cancelled' | 'escalated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  entity_id?: string | null;
  linked_todos_task_id?: string | null;
  escalation_rules: EscalationRule[];
  created_at: string;
  updated_at: string;
}

export interface CreateContactTaskInput {
  title: string;
  description?: string;
  contact_id: string;
  assigned_by?: string;
  deadline?: string;
  status?: ContactTask['status'];
  priority?: ContactTask['priority'];
  entity_id?: string;
  linked_todos_task_id?: string;
  escalation_rules?: EscalationRule[];
}

export interface UpdateContactTaskInput {
  title?: string;
  description?: string | null;
  assigned_by?: string | null;
  deadline?: string | null;
  status?: ContactTask['status'];
  priority?: ContactTask['priority'];
  entity_id?: string | null;
  linked_todos_task_id?: string | null;
  escalation_rules?: EscalationRule[];
}

// ─── Applications ─────────────────────────────────────────────────────────────

export type ApplicationType = 'ai_credits' | 'grant' | 'startup_program' | 'visa' | 'trademark' | 'tax_filing' | 'loan' | 'other';
export type ApplicationStatus = 'draft' | 'submitted' | 'pending' | 'approved' | 'rejected' | 'follow_up_needed' | 'expired' | 'cancelled';
export type ApplicationMethod = 'email' | 'form' | 'typeform' | 'hubspot' | 'manual' | 'browser' | 'feathery' | 'other';

export interface Application {
  id: string;
  program_name: string;
  provider_company_id?: string | null;
  type: ApplicationType;
  value_usd?: number | null;
  applicant_contact_id?: string | null;
  primary_contact_id?: string | null;
  status: ApplicationStatus;
  submitted_date?: string | null;
  decision_date?: string | null;
  follow_up_date?: string | null;
  notes?: string | null;
  method?: ApplicationMethod | null;
  form_url?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationInput {
  program_name: string;
  provider_company_id?: string;
  type?: ApplicationType;
  value_usd?: number;
  applicant_contact_id?: string;
  primary_contact_id?: string;
  status?: ApplicationStatus;
  submitted_date?: string;
  decision_date?: string;
  follow_up_date?: string;
  notes?: string;
  method?: ApplicationMethod;
  form_url?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateApplicationInput {
  program_name?: string;
  provider_company_id?: string | null;
  type?: ApplicationType;
  value_usd?: number | null;
  applicant_contact_id?: string | null;
  primary_contact_id?: string | null;
  status?: ApplicationStatus;
  submitted_date?: string | null;
  decision_date?: string | null;
  follow_up_date?: string | null;
  notes?: string | null;
  method?: ApplicationMethod | null;
  form_url?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListApplicationsOptions {
  type?: ApplicationType;
  status?: ApplicationStatus;
  provider_company_id?: string;
  applicant_contact_id?: string;
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
  sensitivity: string;
  do_not_contact: number;
  priority: number;
  timezone: string | null;
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
  is_owned_entity: number;
  entity_type: string | null;
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
  project_id: string | null;
  member_count?: number;
  company_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  project_id?: string;
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
