/** Pure public client DTOs. Exact legacy signature equivalence is tested; no database handles. */
import type * as Domain from "./index.js";

export interface ListRelationshipsOptions {
  contact_id?: string;
  relationship_type?: Domain.ContactRelationship["relationship_type"];
}

export interface ListCompanyRelationshipsOptions {
  contact_id?: string;
  company_id?: string;
  relationship_type?: Domain.CompanyRelationship["relationship_type"];
}

export interface ListActivityOptions {
  contact_id?: string;
  company_id?: string;
  limit?: number;
  offset?: number;
}

export interface ListVendorCommsOptions {
  type?: Domain.VendorCommType;
  status?: Domain.VendorCommStatus;
  direction?: Domain.VendorCommDirection;
}

export interface ListContactTasksOptions {
  contact_id?: string;
  entity_id?: string;
  status?: Domain.ContactTask["status"];
  priority?: Domain.ContactTask["priority"];
}

export interface ListDealsOptions {
  stage?: Domain.DealStage;
  contact_id?: string;
  company_id?: string;
}

export interface ListEventsOptions {
  contact_id?: string;
  company_id?: string;
  type?: Domain.EventType;
  date_from?: string;
  date_to?: string;
}

export interface CreateJobEntryInput {
  company_name: string;
  title?: string;
  company_id?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  inferred?: boolean;
  source?: string;
}

export interface CreateLearningInput {
  content: string;
  type?: ContactLearning["type"];
  confidence?: number;
  importance?: number;
  learned_by?: string;
  session_id?: string;
  visibility?: ContactLearning["visibility"];
  tags?: string[];
}

export interface ContactLearning {
  id: string;
  contact_id: string;
  content: string;
  type: "preference" | "fact" | "inference" | "warning" | "signal";
  confidence: number;
  importance: number;
  learned_by?: string | null;
  session_id?: string | null;
  visibility: "private" | "shared" | "human";
  tags: string[];
  confirmed_count: number;
  contradicts_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FreshnessScore {
  contact_id: string;
  overall_score: number;
  fields: FieldFreshness[];
  stale_fields: string[];
  verified_fields: string[];
}

export interface FieldFreshness {
  field_name: string;
  value: string | null;
  last_verified_at: string | null;
  source: string | null;
  confidence: "verified" | "inferred" | "imported" | "stale" | "unknown";
  days_old: number | null;
}

export type OrgEdgeType = "reports_to" | "manages" | "collaborates_with" | "peer";

export type AccountRole =
  | "economic_buyer"
  | "technical_evaluator"
  | "champion"
  | "blocker"
  | "influencer"
  | "user"
  | "sponsor"
  | "other";

export interface CreateDocumentInput {
  contact_id: string;
  doc_type: DocumentType;
  label?: string;
  value: string; // plaintext — will be encrypted
  file_path?: string; // optional file to attach (stored plain for agent access)
  metadata?: Record<string, unknown>;
  expires_at?: string;
}

export type DocumentType = "other" | "passport" | "national_id" | "tax_id" | "ssn" | "drivers_license" | "bank_account" | "visa" | "insurance" | "contract" | "certificate" | "medical_record" | "prescription" | "allergy_list" | "vaccination" | "blood_type" | "health_insurance" | "medical_condition" | "emergency_contact_medical";

export interface SetHealthInput {
  blood_type?: string;
  allergies?: string[];
  medical_conditions?: string[];
  medications?: string[];
  emergency_contacts?: EmergencyContact[];
  health_insurance_provider?: string;
  health_insurance_id?: string;
  primary_physician?: string;
  primary_physician_phone?: string;
  organ_donor?: boolean;
  notes?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface ContactHealth {
  id: string;
  contact_id: string;
  blood_type: string | null;
  allergies: string[];
  medical_conditions: string[];
  medications: string[];
  emergency_contacts: EmergencyContact[];
  health_insurance_provider: string | null;
  health_insurance_id: string | null;
  primary_physician: string | null;
  primary_physician_phone: string | null;
  organ_donor: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuppressInput {
  channel: Domain.AudienceChannel;
  address: string;
  contact_id?: string;
  reason?: string;
}

export interface SuppressionSyncResult {
  adapter: string;
  dry_run: boolean;
  pending: number;
  pushed: number;
  failed: { address: string; error: string }[];
  synced_at: string | null;
}

export interface NetworkStats {
  total_contacts: number;
  total_companies: number;
  owned_entities: number;
  total_tags: number;
  total_groups: number;
  total_deals: number;
  total_events: number;
  cold_30d: number;
  cold_60d: number;
  cold_never: number;
  contacts_with_email: number;
  contacts_with_phone: number;
  contacts_no_company: number;
  overdue_tasks: number;
  pending_applications: number;
  missing_invoices: number;
  upcoming_7d: number;
  notes_count: number;
  active_deals_value: number;
}

export type contactsCreateContactInput0 = Domain.CreateContactInput;
export type contactsUpdateContactInput1 = Domain.UpdateContactInput;
export type contactsListContactsInput0 = Domain.ContactListOptions | undefined;
export type contactsListContactsResult = { contacts: Domain.ContactWithDetails[]; total: number; };
export type contactsGetContactResult = Domain.ContactWithDetails;
export type contactsAddEmailToContactInput1 = Domain.CreateEmailInput;
export type contactsAddPhoneToContactInput1 = Domain.CreatePhoneInput;
export type companiesCreateCompanyInput0 = Domain.CreateCompanyInput;
export type companiesUpdateCompanyInput1 = Domain.UpdateCompanyInput;
export type companiesListCompaniesInput0 = Domain.CompanyListOptions | undefined;
export type companiesListCompaniesResult = { companies: Domain.CompanyWithDetails[]; total: number; };
export type tagsCreateTagInput0 = Domain.CreateTagInput;
export type groupsCreateGroupInput1 = Domain.CreateGroupInput;
export type groupsUpdateGroupInput2 = Domain.UpdateGroupInput;
export type relationshipsCreateRelationshipInput0 = Domain.CreateRelationshipInput;
export type relationshipsListRelationshipsInput0 = ListRelationshipsOptions | undefined;
export type relationshipsCreateCompanyRelationshipInput0 = Domain.CreateCompanyRelationshipInput;
export type relationshipsListCompanyRelationshipsInput0 = ListCompanyRelationshipsOptions | undefined;
export type activityListActivityInput0 = ListActivityOptions | undefined;
export type vendorCommsLogVendorCommunicationInput0 = Domain.CreateVendorCommunicationInput;
export type vendorCommsListVendorCommunicationsInput1 = ListVendorCommsOptions | undefined;
export type contactTasksCreateContactTaskInput0 = Domain.CreateContactTaskInput;
export type contactTasksListContactTasksInput0 = ListContactTasksOptions | undefined;
export type contactTasksUpdateContactTaskInput1 = Domain.UpdateContactTaskInput;
export type applicationsCreateApplicationInput0 = Domain.CreateApplicationInput;
export type applicationsListApplicationsInput0 = Domain.ListApplicationsOptions | undefined;
export type applicationsUpdateApplicationInput1 = Domain.UpdateApplicationInput;
export type orgMembersAddOrgMemberInput0 = Domain.CreateOrgMemberInput;
export type orgMembersUpdateOrgMemberInput1 = Domain.UpdateOrgMemberInput;
export type dealsCreateDealInput0 = Domain.CreateDealInput;
export type dealsListDealsInput0 = ListDealsOptions | undefined;
export type dealsUpdateDealInput1 = Domain.UpdateDealInput;
export type eventsLogEventInput0 = Domain.CreateEventInput;
export type eventsListEventsInput0 = ListEventsOptions | undefined;
export type jobHistoryAddJobEntryInput1 = CreateJobEntryInput;
export type learningsSaveLearningInput1 = CreateLearningInput;
export type learningsGetLearningsInput1 = { type?: string; min_importance?: number; visibility?: string; } | undefined;
export type learningsSearchLearningsInput1 = { type?: string; contact_id?: string; } | undefined;
export type identityResolveByPartialInput0 = { name?: string; email?: string; phone?: string; linkedin_url?: string; };
export type freshnessGetFreshnessScoreResult = FreshnessScore;
export type orgChartAddOrgChartEdgeInput3 = OrgEdgeType;
export type orgChartSetDealContactRoleInput2 = AccountRole;
export type documentsAddDocumentInput0 = CreateDocumentInput;
export type healthSetHealthDataInput1 = SetHealthInput;
export type healthGetHealthDataResult = ContactHealth | null;
export type audiencesCreateAudienceInput0 = Domain.CreateAudienceInput;
export type audiencesGetAudienceResult = Domain.Audience;
export type audiencesUpdateAudienceInput1 = Domain.UpdateAudienceInput;
export type audiencesResolveAudienceInput1 = "email" | "telegram" | "sms";
export type audiencesResolveAudienceResult = Domain.AudienceResolution;
export type audiencesSetContactConsentInput1 = "email" | "telegram" | "sms";
export type audiencesSetContactConsentInput2 = "opt_in" | "opt_out" | "unknown";
export type audiencesSuppressAddressInput0 = SuppressInput;
export type audiencesUnsuppressAddressInput0 = "email" | "telegram" | "sms";
export type audiencesListSuppressionsInput0 = { channel?: Domain.AudienceChannel; unsyncedOnly?: boolean; } | undefined;
export type mailerySyncSyncSuppressionsResult = Promise<SuppressionSyncResult>;
export type contextAssembleContextInput1 = "meeting_prep" | "deal_review" | "outreach" | "research" | undefined;
export type statsGetNetworkStatsResult = NetworkStats;
export type meetingCaptureIngestMeetingParticipantsInput0 = { title: string; event_date: string; attendees: Array<{ name: string; email: string; }>; context?: string; };

/** The HTTPS client has no local storage diagnostics endpoint. */
export type ContactsStorageStatus = null;
export interface StorageTableStatus { table: string; ok: boolean; rows: number | null; error?: string; }
