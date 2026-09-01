// @hasna/contacts — public library API
//
// The public surface is the Store abstraction plus shared domain types and the
// typed `/v1` SDK client. Every data operation uses an explicitly configured,
// authenticated HTTPS authority. The raw SQLite and PostgreSQL layers are not
// public client API; missing or invalid URL/key configuration fails closed.

// ─── Storage abstraction (the ONLY data entry point) ────────────────────────────
export {
  getStore,
  resetStoreCache,
  ApiUnavailableError,
  type Store,
  type ContactsStats,
  type ContactsStorageStatus,
  type StorageTableStatus,
} from "./store/index.js";
export type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "./types/project-memberships.js";
export { ContactProjectMembershipConflictError } from "./types/project-memberships.js";

// ─── Shared domain types + errors ───────────────────────────────────────────────
export type {
  // Enums
  EmailType,
  PhoneType,
  AddressType,
  SocialPlatform,
  RelationshipType,
  ContactSource,
  PreferredContactMethod,
  ContactStatus,
  Sensitivity,
  EntityType,
  CompanyRelationshipType,
  VendorCommType,
  VendorCommDirection,
  VendorCommStatus,
  ApplicationType,
  ApplicationStatus,
  ApplicationMethod,
  DealStage,
  EventType,
  // Sub-entities
  Email,
  Phone,
  Address,
  SocialProfile,
  // Core entities
  Tag,
  Contact,
  ContactWithDetails,
  Company,
  CompanyWithDetails,
  ContactRelationship,
  CompanyRelationship,
  ActivityLog,
  Webhook,
  Group,
  CreateGroupInput,
  UpdateGroupInput,
  ContactNote,
  OrgMember,
  VendorCommunication,
  EscalationRule,
  ContactTask,
  Application,
  Deal,
  ContactEvent,
  // Inputs
  CreateEmailInput,
  CreatePhoneInput,
  CreateAddressInput,
  CreateSocialProfileInput,
  CreateTagInput,
  UpdateTagInput,
  CreateContactInput,
  UpdateContactInput,
  ContactListOptions,
  CreateCompanyInput,
  UpdateCompanyInput,
  CompanyListOptions,
  CreateRelationshipInput,
  CreateCompanyRelationshipInput,
  CreateActivityInput,
  CreateWebhookInput,
  UpdateWebhookInput,
  DuplicateByEmail,
  DuplicateByName,
  CreateOrgMemberInput,
  UpdateOrgMemberInput,
  CreateVendorCommunicationInput,
  UpdateVendorCommunicationInput,
  CreateContactTaskInput,
  UpdateContactTaskInput,
  CreateApplicationInput,
  UpdateApplicationInput,
  ListApplicationsOptions,
  CreateDealInput,
  UpdateDealInput,
  CreateEventInput,
  // Audiences / consent / suppression
  AudienceChannel,
  ConsentStatus,
  ConsentPolicy,
  AudienceMatch,
  AudiencePredicateKind,
  AudiencePredicateOp,
  AudiencePredicateValue,
  AudiencePredicate,
  Audience,
  AudienceRow,
  CreateAudienceInput,
  UpdateAudienceInput,
  ContactConsent,
  ContactSuppression,
  AudienceRecipient,
  AudienceExclusion,
  AudienceResolution,
  // Raw rows
  ContactRow,
  CompanyRow,
  EmailRow,
  PhoneRow,
  AddressRow,
  SocialProfileRow,
  TagRow,
  RelationshipRow,
  ActivityRow,
  WebhookRow,
} from "./types/index.js";

export {
  // Errors
  ContactNotFoundError,
  CompanyNotFoundError,
  TagNotFoundError,
  DuplicateTagNameError,
  AudienceNotFoundError,
  DuplicateAudienceIdError,
  InvalidAudienceDefinitionError,
  // Audience constant sets
  AUDIENCE_CHANNELS,
  CONSENT_STATUSES,
  CONSENT_POLICIES,
} from "./types/index.js";

// ─── Cloud SDK (typed /v1 client, generated from the serve OpenAPI) ─────────────
export {
  ContactsV1Client,
  ContactsV1ApiError,
} from "./sdk/index.js";
export type {
  ContactsV1ClientOptions,
  ContactsV1Contact,
  ContactsV1Company,
  ContactsV1Tag,
  ContactsV1CreateContactInput,
  ContactsV1UpdateContactInput,
  ContactsV1CreateCompanyInput,
  ContactsV1UpdateCompanyInput,
  ContactsV1CreateTagInput,
  ContactsV1UpdateTagInput,
  ContactsV1ProjectMembershipSnapshot,
  ContactsV1ProjectMembershipMutationInput,
  ContactsV1ProjectMembershipMutationResult,
  ContactsV1ProjectMembershipListResult,
} from "./sdk/index.js";

// ─── Serve OpenAPI document (source of truth for the SDK) ───────────────────────
export { buildV1OpenApiDocument } from "./server/openapi.js";
