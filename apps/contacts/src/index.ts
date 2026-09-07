// @hasna/contacts — public library API
//
// The public surface is the Store abstraction plus shared domain types and the
// typed `/v1` SDK client. The Store resolves its transport automatically: a
// configured, authenticated HTTPS authority (the @hasna/contracts chain) selects
// the hosted `/v1` ApiStore; otherwise the on-box SQLite LocalStore. The
// storage-mode axis is retired — no switch gates or redirects a command, and
// both transports expose the same command surface.
//
// The raw SQLite and PostgreSQL layers are not public client API; every data
// operation flows through `getStore()`.

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
  createContactsClient,
  contactsSdkAuthorityPinMessage,
} from "./sdk/index.js";
export type {
  ContactsV1ClientOptions,
  CreateContactsClientOptions,
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
