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
} from "./db/relationships.js";

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

// Connector layer
export { runConnector, readConnectorTokens, getConnectorTokenPath, ConnectorNotInstalledError, ConnectorAuthError } from "./lib/connector.js";
export type { ConnectorRunOptions } from "./lib/connector.js";

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
  ActivityLog,
  Webhook,
  Group,
  CreateGroupInput,
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
  CreateActivityInput,
  CreateWebhookInput,
  UpdateWebhookInput,
  DuplicateByEmail,
  DuplicateByName,
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
