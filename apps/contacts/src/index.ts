// Database
export { getDatabase, resetDatabase } from "./db/database.js";

// Contacts
export {
  createContact,
  getContact,
  getContactByEmail,
  listContacts,
  updateContact,
  deleteContact,
  searchContacts,
  mergeContacts,
  listRecentContacts,
  addEmailToContact,
  addPhoneToContact,
  archiveContact,
  unarchiveContact,
  autoLinkContactToCompany,
  listColdContacts,
} from "./db/contacts.js";

// Companies
export {
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  deleteCompany,
  searchCompanies,
  listCompanyEmployees,
  archiveCompany,
  unarchiveCompany,
  listOwnedEntities,
} from "./db/companies.js";

// Tags
export {
  createTag,
  getTag,
  getTagByName,
  listTags,
  updateTag,
  deleteTag,
  addTagToContact,
  removeTagFromContact,
  listContactsByTag,
  addTagToCompany,
  removeTagFromCompany,
} from "./db/tags.js";

// Relationships
export {
  createRelationship,
  listRelationships,
  getRelationship,
  deleteRelationship,
  createCompanyRelationship,
  listCompanyRelationships,
  deleteCompanyRelationship,
  getEntityTeam,
} from "./db/relationships.js";
export type { ListRelationshipsOptions, ListCompanyRelationshipsOptions, EntityTeamMember } from "./db/relationships.js";

// Org Members
export {
  addOrgMember,
  getOrgMember,
  listOrgMembers,
  listOrgMembersForContact,
  updateOrgMember,
  removeOrgMember,
} from "./db/org-members.js";

// Vendor Communications
export {
  logVendorCommunication,
  listVendorCommunications,
  updateVendorCommunication,
  deleteVendorCommunication,
  listPendingFollowUps,
  listMissingInvoices,
  markFollowUpDone,
} from "./db/vendor-comms.js";
export type { ListVendorCommsOptions } from "./db/vendor-comms.js";

// Contact Tasks
export {
  createContactTask,
  getContactTask,
  listContactTasks,
  updateContactTask,
  deleteContactTask,
  listOverdueTasks,
  checkEscalations,
} from "./db/contact-tasks.js";
export type { ListContactTasksOptions } from "./db/contact-tasks.js";

// Applications
export {
  createApplication,
  getApplication,
  listApplications,
  updateApplication,
  deleteApplication,
  listFollowUpDue,
  listPendingApplications,
} from "./db/applications.js";

// Deals
export {
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  deleteDeal,
  getDealsByStage,
} from "./db/deals.js";
export type { ListDealsOptions } from "./db/deals.js";

// Events
export {
  logEvent,
  getEvent,
  listEvents,
  deleteEvent,
} from "./db/events.js";
export type { ListEventsOptions } from "./db/events.js";

// Notes
export { addNote, listNotes, deleteNote, getNote, listNotesForContactAtCompany } from "./db/notes.js";

// Groups
export {
  createGroup,
  getGroup,
  listGroups,
  updateGroup,
  deleteGroup,
  addContactToGroup,
  removeContactFromGroup,
  listContactsInGroup,
  listGroupsForContact,
  addCompanyToGroup,
  removeCompanyFromGroup,
  listCompaniesInGroup,
  listGroupsForCompany,
} from "./db/groups.js";

// Activity
export { logActivity, listActivity, getActivity } from "./db/activity.js";

// Upcoming items
export { getUpcomingItems } from "./lib/upcoming.js";
export type { UpcomingItem, UpcomingItemType } from "./lib/upcoming.js";

// Network stats
export { getNetworkStats } from "./lib/stats.js";
export type { NetworkStats } from "./lib/stats.js";

// Contact audit
export { auditContact, listContactAudit } from "./lib/audit.js";
export type { AuditResult } from "./lib/audit.js";

// Timeline
export { getContactTimeline } from "./lib/timeline.js";
export type { TimelineItem, TimelineItemType } from "./lib/timeline.js";

// Brief
export { generateBrief } from "./lib/brief.js";

// Apple Contacts
export { exportFromApple, importToApple } from "./lib/apple-contacts.js";

// Connector layer
export { runConnector, readConnectorTokens, getConnectorTokenPath, ConnectorNotInstalledError, ConnectorAuthError } from "./lib/connector.js";
export type { ConnectorRunOptions } from "./lib/connector.js";

// Import / Export
export { importContacts, importFromCsv, parseLinkedIn } from "./lib/import.js";
export { exportContacts } from "./lib/export.js";

// Gmail import
export { extractContactsFromGmail, parseAddressHeader, domainToCompany, parseName } from "./lib/gmail-import.js";
export type { GmailImportOptions, ExtractedContact } from "./lib/gmail-import.js";

// Google Contacts sync
export {
  listGoogleContacts,
  searchGoogleContacts,
  pullGoogleContactsAsInputs,
  pushContactToGoogle,
  googlePersonToContactInput,
  contactToGoogleArgs,
} from "./lib/google-contacts.js";
export type { GooglePerson, GoogleContactsSyncOptions, GoogleContactsPushOptions, SyncResult } from "./lib/google-contacts.js";

// Types
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

// Errors
export {
  ContactNotFoundError,
  CompanyNotFoundError,
  TagNotFoundError,
  DuplicateTagNameError,
} from "./types/index.js";
