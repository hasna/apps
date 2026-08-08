/**
 * The ONE storage abstraction for @hasna/contacts.
 *
 * Every CLI command, MCP tool, and SDK method routes reads and writes through a
 * single `Store` interface. There are exactly two transports behind it:
 *
 *   - LocalStore — on-box SQLite (the `src/db/*` relational layer). First-class.
 *   - ApiStore   — HTTPS `/v1` + bearer key against the self_hosted service.
 *
 * The mode is resolved from env by `resolveStorageClient` (see
 * `../cloud/http-storage.ts`): presence of `HASNA_CONTACTS_API_URL` +
 * `HASNA_CONTACTS_API_KEY` (or an explicit `HASNA_CONTACTS_STORAGE_MODE`) selects
 * the ApiStore; otherwise the LocalStore. `self_hosted` and `cloud` BOTH use the
 * ApiStore (identical client code — only the URL/key differ; tenancy is a
 * server-side concern).
 *
 * NO command, tool, or SDK method may import `getDatabase`/`bun:sqlite` or issue
 * a raw `fetch`. Direct SQLite access lives ONLY inside LocalStore (which is the
 * SQLite transport); direct HTTP lives ONLY inside ApiStore. This is what
 * eliminates the split-brain bug where some operations silently wrote local
 * SQLite even while the app was pointed at the cloud.
 *
 * Operations that the self_hosted `/v1` API does not yet expose throw a clear
 * `ApiUnavailableError` in ApiStore rather than silently falling back to local
 * SQLite — a loud failure, never a split brain. Adding the missing `/v1` route
 * to `src/server` (+ an ECS redeploy) is the only way to enable them in the
 * cloud; there is deliberately no per-command local fallback.
 */
import type { ContactsDatabase } from "../db/database.js";
import { getDatabase } from "../db/database.js";
import * as storageDb from "../db/storage.js";
import type { ContactsStorageStatus } from "../db/storage.js";
import * as contactsDb from "../db/contacts.js";
import * as projectMembershipsDb from "../db/project-memberships.js";
import * as companiesDb from "../db/companies.js";
import * as tagsDb from "../db/tags.js";
import * as groupsDb from "../db/groups.js";
import * as relationshipsDb from "../db/relationships.js";
import * as notesDb from "../db/notes.js";
import * as activityDb from "../db/activity.js";
// Extended domains — each of these db modules holds a SQLite handle internally
// (via getDatabase() when no db is passed). They are the LocalStore's
// implementation detail; ONLY LocalStore may call them. ApiStore never touches
// them — it throws ApiUnavailableError until the /v1 API exposes the operation.
import * as vendorCommsDb from "../db/vendor-comms.js";
import * as contactTasksDb from "../db/contact-tasks.js";
import * as applicationsDb from "../db/applications.js";
import * as orgMembersDb from "../db/org-members.js";
import * as dealsDb from "../db/deals.js";
import * as eventsDb from "../db/events.js";
import * as fieldHistoryDb from "../db/field-history.js";
import * as jobHistoryDb from "../db/job-history.js";
import * as learningsDb from "../db/learnings.js";
import * as coordinationDb from "../db/coordination.js";
import * as graphDb from "../db/graph.js";
import * as identityDb from "../db/identity.js";
import * as signalsDb from "../db/signals.js";
import * as freshnessDb from "../db/freshness.js";
import * as orgChartDb from "../db/org-chart.js";
import * as documentsDb from "../db/documents.js";
import * as healthDb from "../db/health.js";
import * as audiencesDb from "../db/audiences.js";
import * as briefLib from "../lib/brief.js";
import * as upcomingLib from "../lib/upcoming.js";
import * as statsLib from "../lib/stats.js";
import * as auditLib from "../lib/audit.js";
import * as timelineLib from "../lib/timeline.js";
import * as embeddingsLib from "../lib/embeddings.js";
import * as meetingCaptureLib from "../lib/meeting-capture.js";
import * as contextLib from "../lib/context.js";
import * as imagesLib from "../lib/images.js";
import * as vaultLib from "../lib/vault.js";
import * as mailerySyncLib from "../lib/mailery-sync.js";
import { findEmailDuplicates, findNameDuplicates } from "../lib/dedup.js";
import { resolveStorageClient, type StorageClient, type QueryParams } from "../cloud/http-storage.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";

// ── Convenience shorthands for input / result types (track the db layer) ──
type CreateContactInput = Parameters<typeof contactsDb.createContact>[0];
type UpdateContactInput = Parameters<typeof contactsDb.updateContact>[1];
type ContactListOptions = Parameters<typeof contactsDb.listContacts>[0];
type ContactListResult = Awaited<ReturnType<typeof contactsDb.listContacts>>;
type Contact = ReturnType<typeof contactsDb.getContact>;
type CreateEmailInput = Parameters<typeof contactsDb.addEmailToContact>[1];
type CreatePhoneInput = Parameters<typeof contactsDb.addPhoneToContact>[1];

type CreateCompanyInput = Parameters<typeof companiesDb.createCompany>[0];
type UpdateCompanyInput = Parameters<typeof companiesDb.updateCompany>[1];
type CompanyListOptions = Parameters<typeof companiesDb.listCompanies>[0];
type CompanyListResult = Awaited<ReturnType<typeof companiesDb.listCompanies>>;

type CreateTagInput = Parameters<typeof tagsDb.createTag>[0];

type CreateGroupInput = Parameters<typeof groupsDb.createGroup>[1];
type UpdateGroupInput = Parameters<typeof groupsDb.updateGroup>[2];

type CreateRelationshipInput = Parameters<typeof relationshipsDb.createRelationship>[0];
type ListRelationshipsOptions = Parameters<typeof relationshipsDb.listRelationships>[0];
type CreateCompanyRelationshipInput = Parameters<typeof relationshipsDb.createCompanyRelationship>[0];
type ListCompanyRelationshipsOptions = Parameters<typeof relationshipsDb.listCompanyRelationships>[0];

type ListActivityOptions = Parameters<typeof activityDb.listActivity>[0];

export interface ContactsStats {
  contacts: number;
  companies: number;
  tags: number;
  groups: number;
}

/** Thrown when an operation is requested in api (self_hosted/cloud) mode but the
 * `/v1` server does not expose it yet. Never silently falls back to local. */
export class ApiUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `contacts: '${operation}' is not available in self_hosted mode yet — the /v1 API ` +
        `does not expose it. Run in local mode, or add the endpoint to src/server and redeploy. ` +
        `(No local fallback: silently writing on-box SQLite while pointed at the cloud is the ` +
        `split-brain bug this abstraction eliminates.)`,
    );
    this.name = "ApiUnavailableError";
  }
}

/** Throw for an operation the /v1 API does not expose. Returns `never` so
 * ApiStore methods can `return unavailable(...)` and still satisfy any return
 * type without a bogus `Promise<void>` inference. */
function unavailable(operation: string): never {
  throw new ApiUnavailableError(operation);
}

/**
 * The single storage contract. Every method is async so LocalStore (sync SQLite)
 * and ApiStore (async HTTP) share one shape. Callers never branch on transport.
 */
export interface Store {
  readonly mode: "local" | "api";

  // Contacts
  createContact(input: CreateContactInput): Promise<Contact>;
  getContact(id: string): Promise<Contact | null>;
  getContactByEmail(email: string): Promise<Contact | null>;
  updateContact(id: string, input: UpdateContactInput): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  listContacts(opts?: ContactListOptions): Promise<ContactListResult>;
  searchContacts(query: string): Promise<Contact[]>;
  listRecentContacts(limit: number): Promise<Contact[]>;
  mergeContacts(keepId: string, mergeId: string): Promise<Contact>;
  addEmailToContact(contactId: string, email: CreateEmailInput): Promise<unknown>;
  addPhoneToContact(contactId: string, phone: CreatePhoneInput): Promise<unknown>;
  archiveContact(id: string): Promise<Contact>;
  unarchiveContact(id: string): Promise<Contact>;
  autoLinkContactToCompany(contactId: string): Promise<Contact | null>;
  /** Local-only helper for find-or-create/upsert flows: resolves an existing
   * contact by one of its email addresses (case-insensitive by default). */
  findContactByEmailAddress(address: string, opts?: { caseSensitive?: boolean }): Promise<Contact | null>;

  // Contact ↔ project links
  linkContactToProject(contactId: string, projectId: string): Promise<void>;
  unlinkContactFromProject(contactId: string, projectId: string): Promise<void>;
  getContactProjectIds(contactId: string): Promise<string[]>;
  setContactProjects(contactId: string, projectIds: string[]): Promise<void>;
  listContactIdsByProject(projectId: string): Promise<string[]>;
  readContactProjectMembership(contactId: string, projectId: string): Promise<ContactProjectMembershipSnapshot>;
  listContactProjectMemberships(projectId: string, maxItems: number): Promise<ContactProjectMembershipListResult>;
  mutateContactProjectMembership(
    direction: ContactProjectMembershipMutationDirection,
    input: ContactProjectMembershipMutationInput,
  ): Promise<ContactProjectMembershipMutationResult>;

  // Companies
  createCompany(input: CreateCompanyInput): Promise<unknown>;
  getCompany(id: string): Promise<unknown | null>;
  updateCompany(id: string, input: UpdateCompanyInput): Promise<unknown>;
  deleteCompany(id: string): Promise<void>;
  listCompanies(opts?: CompanyListOptions): Promise<CompanyListResult>;
  searchCompanies(query: string): Promise<unknown[]>;
  archiveCompany(id: string): Promise<unknown>;
  unarchiveCompany(id: string): Promise<unknown>;

  // Tags
  createTag(input: CreateTagInput): Promise<unknown>;
  listTags(): Promise<unknown[]>;
  getTagByName(name: string): Promise<unknown | null>;
  deleteTag(id: string): Promise<void>;
  addTagToContact(contactId: string, tagId: string): Promise<void>;
  removeTagFromContact(contactId: string, tagId: string): Promise<void>;
  addTagToCompany(companyId: string, tagId: string): Promise<void>;
  removeTagFromCompany(companyId: string, tagId: string): Promise<void>;

  // Groups
  createGroup(input: CreateGroupInput): Promise<unknown>;
  getGroup(id: string): Promise<unknown | null>;
  listGroups(projectId?: string): Promise<unknown[]>;
  updateGroup(id: string, input: UpdateGroupInput): Promise<unknown>;
  deleteGroup(id: string): Promise<void>;
  addContactToGroup(contactId: string, groupId: string): Promise<unknown>;
  removeContactFromGroup(contactId: string, groupId: string): Promise<void>;
  listContactsInGroup(groupId: string): Promise<string[]>;
  listGroupsForContact(contactId: string): Promise<unknown[]>;
  addCompanyToGroup(companyId: string, groupId: string): Promise<unknown>;
  removeCompanyFromGroup(companyId: string, groupId: string): Promise<void>;
  listCompaniesInGroup(groupId: string): Promise<string[]>;
  listGroupsForCompany(companyId: string): Promise<unknown[]>;

  // Relationships
  createRelationship(input: CreateRelationshipInput): Promise<unknown>;
  listRelationships(opts?: ListRelationshipsOptions): Promise<unknown[]>;
  deleteRelationship(id: string): Promise<void>;
  createCompanyRelationship(input: CreateCompanyRelationshipInput): Promise<unknown>;
  listCompanyRelationships(opts?: ListCompanyRelationshipsOptions): Promise<unknown[]>;
  deleteCompanyRelationship(id: string): Promise<void>;

  // Notes
  addNote(contactId: string, body: string, createdBy?: string, companyId?: string): Promise<unknown>;
  listNotes(contactId: string): Promise<unknown[]>;
  listNotesForContactAtCompany(contactId: string, companyId: string): Promise<unknown[]>;
  deleteNote(noteId: string): Promise<void>;

  // Activity / interactions
  listActivity(opts?: ListActivityOptions): Promise<unknown>;

  // Aggregate + maintenance
  stats(): Promise<ContactsStats>;
  findEmailDuplicates(): Promise<Array<{ email: string; contact_ids: string[] }>>;
  findNameDuplicates(): Promise<Array<{ contact_ids: [string, string]; similarity: number }>>;
  /** Local-only: checkpoint + release the SQLite handle before a file backup. */
  flushForBackup(): Promise<void>;

  // ── Extended domains (CRM / intelligence / audiences) ──────────────────────
  // Every method the crm / advanced / audience CLI commands and MCP tools need.
  // In api (self_hosted/cloud) mode these throw ApiUnavailableError until the
  // /v1 API exposes them — never a silent local write.

  // Contacts extras
  listColdContacts(days: number): Promise<unknown[]>;
  findOrCreateContact(input: CreateContactInput): Promise<{ contact: Contact; created: boolean }>;
  findContactsForContext(topic: string, limit: number): Promise<Array<{ id: string; display_name: string; job_title: string | null; reason: string }>>;
  listContactsNotContactedSince(days: number, limit: number): Promise<Array<{ id: string; display_name: string; last_contacted_at: string | null }>>;
  listFollowupDueContacts(onOrBefore: string): Promise<Array<{ id: string; display_name: string; follow_up_at: string }>>;

  // Vendor communications
  logVendorCommunication(input: Parameters<typeof vendorCommsDb.logVendorCommunication>[0]): Promise<unknown>;
  listVendorCommunications(companyId: string, opts?: Parameters<typeof vendorCommsDb.listVendorCommunications>[1]): Promise<unknown[]>;
  listMissingInvoices(): Promise<unknown[]>;
  listPendingFollowUps(): Promise<unknown[]>;
  markFollowUpDone(id: string): Promise<unknown>;

  // Contact tasks
  createContactTask(input: Parameters<typeof contactTasksDb.createContactTask>[0]): Promise<unknown>;
  listContactTasks(opts?: Parameters<typeof contactTasksDb.listContactTasks>[0]): Promise<unknown[]>;
  updateContactTask(id: string, input: Parameters<typeof contactTasksDb.updateContactTask>[1]): Promise<unknown>;
  deleteContactTask(id: string): Promise<void>;
  listOverdueTasks(): Promise<unknown[]>;
  checkEscalations(): Promise<unknown[]>;

  // Applications
  createApplication(input: Parameters<typeof applicationsDb.createApplication>[0]): Promise<unknown>;
  listApplications(opts?: Parameters<typeof applicationsDb.listApplications>[0]): Promise<unknown[]>;
  updateApplication(id: string, input: Parameters<typeof applicationsDb.updateApplication>[1]): Promise<unknown>;
  listFollowUpDueApplications(): Promise<unknown[]>;

  // Org members
  addOrgMember(input: Parameters<typeof orgMembersDb.addOrgMember>[0]): Promise<unknown>;
  listOrgMembers(companyId: string): Promise<unknown[]>;
  updateOrgMember(id: string, input: Parameters<typeof orgMembersDb.updateOrgMember>[1]): Promise<unknown>;
  removeOrgMember(id: string): Promise<void>;
  listOrgMembersForContact(contactId: string): Promise<unknown[]>;

  // Deals
  createDeal(input: Parameters<typeof dealsDb.createDeal>[0]): Promise<unknown>;
  getDeal(id: string): Promise<unknown | null>;
  listDeals(opts?: Parameters<typeof dealsDb.listDeals>[0]): Promise<unknown[]>;
  updateDeal(id: string, input: Parameters<typeof dealsDb.updateDeal>[1]): Promise<unknown | null>;
  deleteDeal(id: string): Promise<void>;

  // Events
  logEvent(input: Parameters<typeof eventsDb.logEvent>[0]): Promise<unknown>;
  listEvents(opts?: Parameters<typeof eventsDb.listEvents>[0]): Promise<unknown[]>;
  deleteEvent(id: string): Promise<void>;

  // Field history
  getFieldHistory(contactId: string, fieldName?: string): Promise<unknown[]>;
  getContactAt(contactId: string, timestamp: string): Promise<Record<string, string>>;

  // Job history
  addJobEntry(contactId: string, input: Parameters<typeof jobHistoryDb.addJobEntry>[1]): Promise<unknown>;
  getJobHistory(contactId: string): Promise<unknown[]>;

  // Learnings
  saveLearning(contactId: string, input: Parameters<typeof learningsDb.saveLearning>[1]): Promise<unknown>;
  getLearnings(contactId: string, opts?: Parameters<typeof learningsDb.getLearnings>[1]): Promise<Array<{ confidence: number; type: string; content: string }>>;
  searchLearnings(query: string, opts?: Parameters<typeof learningsDb.searchLearnings>[1]): Promise<Array<{ contact_id: string; type: string; confidence: number; content: string }>>;
  confirmLearning(learningId: string, agentName: string): Promise<void>;
  getStaleLearnings(daysOld: number, minConfidence: number): Promise<unknown[]>;
  runLearningMaintenance(): Promise<{ decayed_count: number; potential_contradictions: unknown[] }>;

  // Coordination (locks / activity)
  acquireContactLock(contactId: string, agentName: string, ttlSeconds?: number, reason?: string, sessionId?: string): Promise<unknown>;
  releaseContactLock(contactId: string, agentName: string): Promise<boolean>;
  checkContactLock(contactId: string): Promise<unknown | null>;
  logAgentActivity(contactId: string, agentName: string, action: string, details?: string, sessionId?: string): Promise<void>;
  getAgentActivity(contactId: string, limit: number): Promise<unknown[]>;

  // Graph / relationship intelligence
  computeRelationshipStrength(contactId: string): Promise<number>;
  findWarmPath(fromContactId: string, toContactId: string): Promise<unknown[]>;
  findConnectionsAtCompany(companyId: string): Promise<unknown[]>;
  detectCoolingRelationships(): Promise<Array<{ display_name: string; days_since: number }>>;

  // Identity resolution
  resolveContactIdentity(partial: Parameters<typeof identityDb.resolveByPartial>[0]): Promise<Array<{ contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>>;
  addContactIdentity(contactId: string, system: string, externalId: string, externalUrl?: string, confidence?: "verified" | "inferred"): Promise<unknown>;
  getContactIdentities(contactId: string): Promise<unknown[]>;

  // Embeddings / semantic search
  semanticSearch(query: string, limit: number): Promise<Array<{ contact_id: string; score: number }>>;
  embedContact(contactId: string): Promise<void>;
  embedAllContacts(): Promise<number>;

  // Signals
  getRelationshipSignals(contactId: string): Promise<Array<{ signal_type: string; reason: string; days_since_contact: number | null }>>;
  getGhostContacts(): Promise<Array<{ display_name: string; days_since_contact: number | null }>>;
  getWarmingContacts(): Promise<Array<{ display_name: string; days_since_contact: number | null }>>;
  recomputeSignals(): Promise<{ updated: number }>;

  // Freshness
  getFreshnessScore(contactId: string): Promise<ReturnType<typeof freshnessDb.getFreshnessScore>>;
  getStaleContacts(threshold: number): Promise<Array<{ contact_id: string; display_name: string; score: number }>>;
  markFieldVerified(contactId: string, fieldName: string, source?: string): Promise<void>;

  // Org chart / deal teams
  addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: Parameters<typeof orgChartDb.addOrgChartEdge>[3], inferred?: boolean): Promise<unknown>;
  listOrgChart(companyId: string): Promise<Array<{ contact_a_name: string; contact_b_name: string; edge_type: string }>>;
  setDealContactRole(dealId: string, contactId: string, accountRole: Parameters<typeof orgChartDb.setDealContactRole>[2]): Promise<unknown>;
  getDealTeam(dealId: string): Promise<Array<{ display_name: string; account_role: string; job_title?: string }>>;
  getCoverageGaps(companyId: string): Promise<unknown>;

  // Recent activity events
  getRecentContactEvents(since?: string, eventTypes?: string[]): Promise<unknown[]>;

  // Documents (encrypted vault)
  addDocument(input: Parameters<typeof documentsDb.addDocument>[0]): Promise<unknown>;
  getDocument(id: string): Promise<unknown>;
  listDocuments(contactId: string): Promise<Array<{ doc_type: string; label?: string | null; has_file: boolean; expires_at?: string | null; created_at: string }>>;
  deleteDocument(id: string): Promise<void>;
  getDocumentFilePath(id: string): Promise<string | null>;

  // Health
  setHealthData(contactId: string, input: Parameters<typeof healthDb.setHealthData>[1]): Promise<unknown>;
  getHealthData(contactId: string): Promise<ReturnType<typeof healthDb.getHealthData>>;
  deleteHealthData(contactId: string): Promise<void>;

  // Audiences / consent / suppression
  createAudience(input: Parameters<typeof audiencesDb.createAudience>[0]): Promise<{ id: string; audience_id: string }>;
  getAudience(idOrSlug: string): Promise<ReturnType<typeof audiencesDb.getAudience>>;
  listAudiences(): Promise<Array<{ audience_id: string; name: string; match: string; consent_policy: string; predicates: unknown[]; suppression_synced_at?: string | null }>>;
  updateAudience(idOrSlug: string, input: Parameters<typeof audiencesDb.updateAudience>[1]): Promise<unknown>;
  deleteAudience(idOrSlug: string): Promise<void>;
  resolveAudience(idOrSlug: string, channel: Parameters<typeof audiencesDb.resolveAudience>[1]): Promise<ReturnType<typeof audiencesDb.resolveAudience>>;
  setContactConsent(contactId: string, channel: Parameters<typeof audiencesDb.setContactConsent>[1], status: Parameters<typeof audiencesDb.setContactConsent>[2], source?: string): Promise<{ channel: string; status: string }>;
  listContactConsent(contactId: string): Promise<Array<{ channel: string; status: string; source?: string | null; updated_at: string }>>;
  suppressAddress(input: Parameters<typeof audiencesDb.suppressAddress>[0]): Promise<{ address: string; channel: string }>;
  unsuppressAddress(channel: Parameters<typeof audiencesDb.unsuppressAddress>[0], address: string): Promise<void>;
  listSuppressions(opts?: Parameters<typeof audiencesDb.listSuppressions>[0]): Promise<Array<{ address: string; channel: string; reason?: string | null; synced_at?: string | null }>>;
  syncSuppressions(dryRun?: boolean): Promise<Awaited<ReturnType<typeof mailerySyncLib.syncSuppressions>>>;

  // Context / briefs / stats (lib layer, db-backed)
  generateBrief(contactId: string): Promise<string>;
  getContactCard(contactId: string): Promise<object>;
  getContactBrief(contactId: string, taskContext?: string): Promise<object>;
  assembleContext(contactIds: string[], format: Parameters<typeof contextLib.assembleContext>[1]): Promise<object>;
  getUpcomingItems(days: number): Promise<unknown[]>;
  getNetworkStats(): Promise<ReturnType<typeof statsLib.getNetworkStats>>;
  listContactAudit(): Promise<unknown[]>;
  getContactTimeline(contactId: string, limit: number): Promise<Array<{ type: string; date?: string | null; title: string; body?: string | null }>>;
  ingestMeetingParticipants(input: Parameters<typeof meetingCaptureLib.ingestMeetingParticipants>[0]): Promise<{ created: number; updated: number; contact_ids: string[] }>;

  // Images (on-box filesystem)
  saveImage(entityId: string, source: string, options?: { format?: string }): Promise<string>;
  getImagePath(entityId: string): Promise<string | null>;
  getImageAsBase64(entityId: string): Promise<string | null>;
  deleteImage(entityId: string): Promise<boolean>;
  listImages(): Promise<Array<{ entity_id: string; filename: string; path: string }>>;

  // Vault (on-box key material)
  initVault(passphrase: string): Promise<void>;
  unlockVault(passphrase: string): Promise<boolean>;
  lockVault(): Promise<void>;
  isVaultInitialized(): Promise<boolean>;
  isVaultUnlocked(): Promise<boolean>;
  vaultStatus(): Promise<{ initialized: boolean; unlocked: boolean; document_count: number }>;

  // Feedback
  saveFeedback(message: string, email: string | null, category: string, version: string): Promise<void>;

  // Storage diagnostics — on-box table/row status. LocalStore reports the SQLite
  // tables; ApiStore returns null (there are NO on-box tables when pointed at the
  // cloud — transport status conveys that instead). Lets CLI/MCP inspect storage
  // WITHOUT importing the db layer directly (which would be a split-brain bypass).
  storageStatus(): Promise<ContactsStorageStatus | null>;

  // Webhooks (local delivery registry — reads only; delivery stays in caller)
  listActiveWebhooks(): Promise<Array<{ id: string; event_type: string; url: string; secret?: string | null }>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LocalStore — on-box SQLite transport (delegates to src/db/*).
// This is the ONLY place in the client that holds a SQLite handle.
// ─────────────────────────────────────────────────────────────────────────────

class LocalStore implements Store {
  readonly mode = "local" as const;
  private get db(): ContactsDatabase {
    return getDatabase();
  }

  // Contacts
  async createContact(input: CreateContactInput) { return contactsDb.createContact(input, this.db); }
  async getContact(id: string) { return contactsDb.getContact(id, this.db); }
  async getContactByEmail(email: string) { return contactsDb.getContactByEmail(email, this.db); }
  async updateContact(id: string, input: UpdateContactInput) { return contactsDb.updateContact(id, input, this.db); }
  async deleteContact(id: string) { contactsDb.deleteContact(id, this.db); }
  async listContacts(opts: ContactListOptions = {}) { return contactsDb.listContacts(opts, this.db); }
  async searchContacts(query: string) { return contactsDb.searchContacts(query, this.db); }
  async listRecentContacts(limit: number) { return contactsDb.listRecentContacts(limit, this.db); }
  async mergeContacts(keepId: string, mergeId: string) { return contactsDb.mergeContacts(keepId, mergeId, this.db); }
  async addEmailToContact(contactId: string, email: CreateEmailInput) { return contactsDb.addEmailToContact(contactId, email, this.db); }
  async addPhoneToContact(contactId: string, phone: CreatePhoneInput) { return contactsDb.addPhoneToContact(contactId, phone, this.db); }
  async archiveContact(id: string) { return contactsDb.archiveContact(id, this.db); }
  async unarchiveContact(id: string) { return contactsDb.unarchiveContact(id, this.db); }
  async autoLinkContactToCompany(contactId: string) { return contactsDb.autoLinkContactToCompany(contactId, this.db); }
  async findContactByEmailAddress(address: string, opts: { caseSensitive?: boolean } = {}) {
    const row = opts.caseSensitive
      ? (this.db.prepare(`SELECT contact_id FROM emails WHERE address = ? AND contact_id IS NOT NULL LIMIT 1`).get(address) as { contact_id: string } | null)
      : (this.db.prepare(`SELECT contact_id FROM emails WHERE LOWER(address) = LOWER(?) AND contact_id IS NOT NULL LIMIT 1`).get(address) as { contact_id: string } | null);
    return row ? contactsDb.getContact(row.contact_id, this.db) : null;
  }

  // Contact ↔ project links
  async linkContactToProject(contactId: string, projectId: string) { contactsDb.linkContactToProject(contactId, projectId, this.db); }
  async unlinkContactFromProject(contactId: string, projectId: string) { contactsDb.unlinkContactFromProject(contactId, projectId, this.db); }
  async getContactProjectIds(contactId: string) { return contactsDb.getContactProjectIds(contactId, this.db); }
  async setContactProjects(contactId: string, projectIds: string[]) { contactsDb.setContactProjects(contactId, projectIds, this.db); }
  async listContactIdsByProject(projectId: string) { return contactsDb.listContactIdsByProject(projectId, this.db); }
  async readContactProjectMembership(contactId: string, projectId: string) {
    return projectMembershipsDb.readContactProjectMembership(contactId, projectId, this.db);
  }
  async listContactProjectMemberships(projectId: string, maxItems: number) {
    return projectMembershipsDb.listContactProjectMemberships(projectId, maxItems, this.db);
  }
  async mutateContactProjectMembership(
    direction: ContactProjectMembershipMutationDirection,
    input: ContactProjectMembershipMutationInput,
  ) {
    return projectMembershipsDb.mutateContactProjectMembership(direction, input, this.db);
  }

  // Companies
  async createCompany(input: CreateCompanyInput) { return companiesDb.createCompany(input, this.db); }
  async getCompany(id: string) { return companiesDb.getCompany(id, this.db); }
  async updateCompany(id: string, input: UpdateCompanyInput) { return companiesDb.updateCompany(id, input, this.db); }
  async deleteCompany(id: string) { companiesDb.deleteCompany(id, this.db); }
  async listCompanies(opts: CompanyListOptions = {}) { return companiesDb.listCompanies(opts, this.db); }
  async searchCompanies(query: string) { return companiesDb.searchCompanies(query, this.db); }
  async archiveCompany(id: string) { return companiesDb.archiveCompany(id, this.db); }
  async unarchiveCompany(id: string) { return companiesDb.unarchiveCompany(id, this.db); }

  // Tags
  async createTag(input: CreateTagInput) { return tagsDb.createTag(input, this.db); }
  async listTags() { return tagsDb.listTags(this.db); }
  async getTagByName(name: string) { return tagsDb.getTagByName(name, this.db); }
  async deleteTag(id: string) { tagsDb.deleteTag(id, this.db); }
  async addTagToContact(contactId: string, tagId: string) { tagsDb.addTagToContact(contactId, tagId, this.db); }
  async removeTagFromContact(contactId: string, tagId: string) { tagsDb.removeTagFromContact(contactId, tagId, this.db); }
  async addTagToCompany(companyId: string, tagId: string) { tagsDb.addTagToCompany(companyId, tagId, this.db); }
  async removeTagFromCompany(companyId: string, tagId: string) { tagsDb.removeTagFromCompany(companyId, tagId, this.db); }

  // Groups
  async createGroup(input: CreateGroupInput) { return groupsDb.createGroup(this.db, input); }
  async getGroup(id: string) { return groupsDb.getGroup(this.db, id); }
  async listGroups(projectId?: string) { return groupsDb.listGroups(this.db, projectId); }
  async updateGroup(id: string, input: UpdateGroupInput) { return groupsDb.updateGroup(this.db, id, input); }
  async deleteGroup(id: string) { groupsDb.deleteGroup(this.db, id); }
  async addContactToGroup(contactId: string, groupId: string) { return groupsDb.addContactToGroup(this.db, contactId, groupId); }
  async removeContactFromGroup(contactId: string, groupId: string) { groupsDb.removeContactFromGroup(this.db, contactId, groupId); }
  async listContactsInGroup(groupId: string) { return groupsDb.listContactsInGroup(this.db, groupId); }
  async listGroupsForContact(contactId: string) { return groupsDb.listGroupsForContact(this.db, contactId); }
  async addCompanyToGroup(companyId: string, groupId: string) { return groupsDb.addCompanyToGroup(this.db, companyId, groupId); }
  async removeCompanyFromGroup(companyId: string, groupId: string) { groupsDb.removeCompanyFromGroup(this.db, companyId, groupId); }
  async listCompaniesInGroup(groupId: string) { return groupsDb.listCompaniesInGroup(this.db, groupId); }
  async listGroupsForCompany(companyId: string) { return groupsDb.listGroupsForCompany(this.db, companyId); }

  // Relationships
  async createRelationship(input: CreateRelationshipInput) { return relationshipsDb.createRelationship(input, this.db); }
  async listRelationships(opts: ListRelationshipsOptions = {}) { return relationshipsDb.listRelationships(opts, this.db); }
  async deleteRelationship(id: string) { relationshipsDb.deleteRelationship(id, this.db); }
  async createCompanyRelationship(input: CreateCompanyRelationshipInput) { return relationshipsDb.createCompanyRelationship(input, this.db); }
  async listCompanyRelationships(opts: ListCompanyRelationshipsOptions = {}) { return relationshipsDb.listCompanyRelationships(opts, this.db); }
  async deleteCompanyRelationship(id: string) { relationshipsDb.deleteCompanyRelationship(id, this.db); }

  // Notes
  async addNote(contactId: string, body: string, createdBy?: string, companyId?: string) { return notesDb.addNote(contactId, body, createdBy, this.db, companyId); }
  async listNotes(contactId: string) { return notesDb.listNotes(contactId, this.db); }
  async listNotesForContactAtCompany(contactId: string, companyId: string) { return notesDb.listNotesForContactAtCompany(contactId, companyId, this.db); }
  async deleteNote(noteId: string) { notesDb.deleteNote(noteId, this.db); }

  // Activity
  async listActivity(opts: ListActivityOptions = {}) { return activityDb.listActivity(opts, this.db); }

  // Aggregate + maintenance
  async stats(): Promise<ContactsStats> {
    const db = this.db;
    const one = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
    return {
      contacts: one("SELECT COUNT(*) as count FROM contacts"),
      companies: one("SELECT COUNT(*) as count FROM companies"),
      tags: one("SELECT COUNT(*) as count FROM tags"),
      groups: one("SELECT COUNT(*) as count FROM groups"),
    };
  }
  async findEmailDuplicates() { return findEmailDuplicates(this.db); }
  async findNameDuplicates() { return findNameDuplicates(this.db); }
  async flushForBackup() {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const { resetDatabase } = await import("../db/database.js");
    resetDatabase();
  }

  // ── Extended domains ────────────────────────────────────────────────────────
  // Contacts extras
  async listColdContacts(days: number) { return contactsDb.listColdContacts(days, this.db); }
  async findOrCreateContact(input: CreateContactInput) {
    const res = await contactsDb.findOrCreateContact(input, this.db);
    return { contact: res.contact as Contact, created: res.created };
  }
  async findContactsForContext(topic: string, limit: number) {
    const db = this.db;
    const like = `%${topic}%`;
    const byTitle = db.query(`SELECT c.id, c.display_name, c.job_title, 'job_title' as reason FROM contacts c WHERE c.job_title LIKE ? AND c.archived=0 LIMIT 20`).all(like) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const byNotes = db.query(`SELECT c.id, c.display_name, c.job_title, 'notes' as reason FROM contacts c WHERE c.notes LIKE ? AND c.archived=0 LIMIT 10`).all(like) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const byCompany = db.query(`SELECT c.id, c.display_name, c.job_title, 'company' as reason FROM contacts c JOIN companies co ON c.company_id = co.id WHERE (co.name LIKE ? OR co.industry LIKE ?) AND c.archived=0 LIMIT 10`).all(like, like) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const bySpec = db.query(`SELECT c.id, c.display_name, c.job_title, om.specialization as reason FROM contacts c JOIN org_members om ON c.id = om.contact_id WHERE om.specialization LIKE ? LIMIT 10`).all(like) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const seen = new Set<string>();
    return [...byTitle, ...bySpec, ...byCompany, ...byNotes].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, limit);
  }
  async listContactsNotContactedSince(days: number, limit: number) {
    return this.db.query(
      `SELECT id, display_name, last_contacted_at FROM contacts WHERE (last_contacted_at IS NULL OR last_contacted_at < date('now', ?)) AND archived=0 LIMIT ?`,
    ).all(`-${days} days`, limit) as Array<{ id: string; display_name: string; last_contacted_at: string | null }>;
  }
  async listFollowupDueContacts(onOrBefore: string) {
    return this.db.query(
      `SELECT id, display_name, follow_up_at FROM contacts WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND archived=0`,
    ).all(onOrBefore) as Array<{ id: string; display_name: string; follow_up_at: string }>;
  }

  // Vendor communications
  async logVendorCommunication(input: Parameters<typeof vendorCommsDb.logVendorCommunication>[0]) { return vendorCommsDb.logVendorCommunication(input, this.db); }
  async listVendorCommunications(companyId: string, opts: Parameters<typeof vendorCommsDb.listVendorCommunications>[1] = {}) { return vendorCommsDb.listVendorCommunications(companyId, opts, this.db); }
  async listMissingInvoices() { return vendorCommsDb.listMissingInvoices(this.db); }
  async listPendingFollowUps() { return vendorCommsDb.listPendingFollowUps(this.db); }
  async markFollowUpDone(id: string) { return vendorCommsDb.markFollowUpDone(id, this.db); }

  // Contact tasks
  async createContactTask(input: Parameters<typeof contactTasksDb.createContactTask>[0]) { return contactTasksDb.createContactTask(input, this.db); }
  async listContactTasks(opts: Parameters<typeof contactTasksDb.listContactTasks>[0] = {}) { return contactTasksDb.listContactTasks(opts, this.db); }
  async updateContactTask(id: string, input: Parameters<typeof contactTasksDb.updateContactTask>[1]) { return contactTasksDb.updateContactTask(id, input, this.db); }
  async deleteContactTask(id: string) { contactTasksDb.deleteContactTask(id, this.db); }
  async listOverdueTasks() { return contactTasksDb.listOverdueTasks(this.db); }
  async checkEscalations() { return contactTasksDb.checkEscalations(this.db); }

  // Applications
  async createApplication(input: Parameters<typeof applicationsDb.createApplication>[0]) { return applicationsDb.createApplication(input, this.db); }
  async listApplications(opts: Parameters<typeof applicationsDb.listApplications>[0] = {}) { return applicationsDb.listApplications(opts, this.db); }
  async updateApplication(id: string, input: Parameters<typeof applicationsDb.updateApplication>[1]) { return applicationsDb.updateApplication(id, input, this.db); }
  async listFollowUpDueApplications() { return applicationsDb.listFollowUpDue(this.db); }

  // Org members
  async addOrgMember(input: Parameters<typeof orgMembersDb.addOrgMember>[0]) { return orgMembersDb.addOrgMember(input, this.db); }
  async listOrgMembers(companyId: string) { return orgMembersDb.listOrgMembers(companyId, this.db); }
  async updateOrgMember(id: string, input: Parameters<typeof orgMembersDb.updateOrgMember>[1]) { return orgMembersDb.updateOrgMember(id, input, this.db); }
  async removeOrgMember(id: string) { orgMembersDb.removeOrgMember(id, this.db); }
  async listOrgMembersForContact(contactId: string) { return orgMembersDb.listOrgMembersForContact(contactId, this.db); }

  // Deals
  async createDeal(input: Parameters<typeof dealsDb.createDeal>[0]) { return dealsDb.createDeal(input, this.db); }
  async getDeal(id: string) { return dealsDb.getDeal(id, this.db); }
  async listDeals(opts: Parameters<typeof dealsDb.listDeals>[0] = {}) { return dealsDb.listDeals(opts, this.db); }
  async updateDeal(id: string, input: Parameters<typeof dealsDb.updateDeal>[1]) { return dealsDb.updateDeal(id, input, this.db); }
  async deleteDeal(id: string) { dealsDb.deleteDeal(id, this.db); }

  // Events
  async logEvent(input: Parameters<typeof eventsDb.logEvent>[0]) { return eventsDb.logEvent(input, this.db); }
  async listEvents(opts: Parameters<typeof eventsDb.listEvents>[0] = {}) { return eventsDb.listEvents(opts, this.db); }
  async deleteEvent(id: string) { eventsDb.deleteEvent(id, this.db); }

  // Field history
  async getFieldHistory(contactId: string, fieldName?: string) { return fieldHistoryDb.getFieldHistory(contactId, fieldName, this.db); }
  async getContactAt(contactId: string, timestamp: string) { return fieldHistoryDb.getContactAt(contactId, timestamp, this.db); }

  // Job history
  async addJobEntry(contactId: string, input: Parameters<typeof jobHistoryDb.addJobEntry>[1]) { return jobHistoryDb.addJobEntry(contactId, input, this.db); }
  async getJobHistory(contactId: string) { return jobHistoryDb.getJobHistory(contactId, this.db); }

  // Learnings
  async saveLearning(contactId: string, input: Parameters<typeof learningsDb.saveLearning>[1]) { return learningsDb.saveLearning(contactId, input, this.db); }
  async getLearnings(contactId: string, opts: Parameters<typeof learningsDb.getLearnings>[1] = {}) { return learningsDb.getLearnings(contactId, opts, this.db) as Array<{ confidence: number; type: string; content: string }>; }
  async searchLearnings(query: string, opts: Parameters<typeof learningsDb.searchLearnings>[1] = {}) { return learningsDb.searchLearnings(query, opts, this.db) as Array<{ contact_id: string; type: string; confidence: number; content: string }>; }
  async confirmLearning(learningId: string, agentName: string) { learningsDb.confirmLearning(learningId, agentName, this.db); }
  async getStaleLearnings(daysOld: number, minConfidence: number) {
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    return this.db.query(
      `SELECT * FROM contact_learnings WHERE confirmed_count=0 AND created_at<? AND confidence>=? ORDER BY confidence ASC LIMIT 50`,
    ).all(cutoff, minConfidence) as unknown[];
  }
  async runLearningMaintenance() {
    const decayed = learningsDb.decayLearnings(this.db);
    const duplicates = this.db.query(
      `SELECT contact_id, COUNT(*) as cnt FROM contact_learnings GROUP BY contact_id, LOWER(SUBSTR(content,1,30)) HAVING cnt > 1`,
    ).all() as unknown[];
    return { decayed_count: decayed, potential_contradictions: duplicates };
  }

  // Coordination
  async acquireContactLock(contactId: string, agentName: string, ttlSeconds?: number, reason?: string, sessionId?: string) {
    return coordinationDb.acquireLock(contactId, agentName, ttlSeconds, reason, sessionId, this.db);
  }
  async releaseContactLock(contactId: string, agentName: string) { return coordinationDb.releaseLock(contactId, agentName, this.db); }
  async checkContactLock(contactId: string) { return coordinationDb.checkLock(contactId, this.db); }
  async logAgentActivity(contactId: string, agentName: string, action: string, details?: string, sessionId?: string) {
    coordinationDb.logAgentActivity(contactId, agentName, action, details, sessionId, this.db);
  }
  async getAgentActivity(contactId: string, limit: number) { return coordinationDb.getAgentActivity(contactId, limit, this.db); }

  // Graph
  async computeRelationshipStrength(contactId: string) { return graphDb.computeRelationshipStrength(contactId, this.db); }
  async findWarmPath(fromContactId: string, toContactId: string) { return graphDb.findWarmPath(fromContactId, toContactId, this.db); }
  async findConnectionsAtCompany(companyId: string) { return graphDb.findConnectionsAtCompany(companyId, this.db); }
  async detectCoolingRelationships() { return graphDb.detectCoolingRelationships(this.db) as Array<{ display_name: string; days_since: number }>; }

  // Identity
  async resolveContactIdentity(partial: Parameters<typeof identityDb.resolveByPartial>[0]) {
    return identityDb.resolveByPartial(partial, this.db) as Array<{ contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>;
  }
  async addContactIdentity(contactId: string, system: string, externalId: string, externalUrl?: string, confidence: "verified" | "inferred" = "inferred") {
    return identityDb.addIdentity(contactId, system, externalId, externalUrl, confidence, this.db);
  }
  async getContactIdentities(contactId: string) { return identityDb.getIdentities(contactId, this.db); }

  // Embeddings
  async semanticSearch(query: string, limit: number) { return embeddingsLib.semanticSearch(query, limit, this.db); }
  async embedContact(contactId: string) { await embeddingsLib.embedContact(contactId, this.db); }
  async embedAllContacts() { return embeddingsLib.embedAllContacts(this.db); }

  // Signals
  async getRelationshipSignals(contactId: string) { return signalsDb.getRelationshipSignals(contactId, this.db) as Array<{ signal_type: string; reason: string; days_since_contact: number | null }>; }
  async getGhostContacts() { return signalsDb.getGhostContacts(this.db) as unknown as Array<{ display_name: string; days_since_contact: number | null }>; }
  async getWarmingContacts() { return signalsDb.getWarmingContacts(this.db) as unknown as Array<{ display_name: string; days_since_contact: number | null }>; }
  async recomputeSignals() { return signalsDb.recomputeAllSignals(this.db); }

  // Freshness
  async getFreshnessScore(contactId: string) { return freshnessDb.getFreshnessScore(contactId, this.db); }
  async getStaleContacts(threshold: number) { return freshnessDb.getStaleContacts(threshold, this.db); }
  async markFieldVerified(contactId: string, fieldName: string, source?: string) { freshnessDb.markFieldVerified(contactId, fieldName, source, this.db); }

  // Org chart
  async addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: Parameters<typeof orgChartDb.addOrgChartEdge>[3], inferred = false) {
    return orgChartDb.addOrgChartEdge(companyId, contactAId, contactBId, edgeType, inferred, this.db);
  }
  async listOrgChart(companyId: string) { return orgChartDb.listOrgChart(companyId, this.db); }
  async setDealContactRole(dealId: string, contactId: string, accountRole: Parameters<typeof orgChartDb.setDealContactRole>[2]) {
    return orgChartDb.setDealContactRole(dealId, contactId, accountRole, this.db);
  }
  async getDealTeam(dealId: string) { return orgChartDb.getDealTeam(dealId, this.db); }
  async getCoverageGaps(companyId: string) { return orgChartDb.getCoverageGaps(companyId, this.db); }

  // Recent activity events
  async getRecentContactEvents(since?: string, eventTypes?: string[]) {
    let sql = `SELECT * FROM activity_log WHERE 1=1`;
    const params: string[] = [];
    if (since) { sql += ` AND created_at >= ?`; params.push(since); }
    if (eventTypes?.length) { sql += ` AND action IN (${eventTypes.map(() => "?").join(",")})`; params.push(...eventTypes); }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    return this.db.query(sql).all(...params) as unknown[];
  }

  // Documents
  async addDocument(input: Parameters<typeof documentsDb.addDocument>[0]) { return documentsDb.addDocument(input, this.db); }
  async getDocument(id: string) { return documentsDb.getDocument(id, this.db); }
  async listDocuments(contactId: string) { return documentsDb.listDocuments(contactId, this.db); }
  async deleteDocument(id: string) { documentsDb.deleteDocument(id, this.db); }
  async getDocumentFilePath(id: string) {
    const row = this.db.query(`SELECT encrypted_file_path FROM contact_documents WHERE id = ?`).get(id) as { encrypted_file_path: string | null } | null;
    return row ? row.encrypted_file_path : null;
  }

  // Health
  async setHealthData(contactId: string, input: Parameters<typeof healthDb.setHealthData>[1]) { return healthDb.setHealthData(contactId, input, this.db); }
  async getHealthData(contactId: string) { return healthDb.getHealthData(contactId, this.db); }
  async deleteHealthData(contactId: string) { healthDb.deleteHealthData(contactId, this.db); }

  // Audiences
  async createAudience(input: Parameters<typeof audiencesDb.createAudience>[0]) { return audiencesDb.createAudience(input, this.db); }
  async getAudience(idOrSlug: string) { return audiencesDb.getAudience(idOrSlug, this.db); }
  async listAudiences() { return audiencesDb.listAudiences(this.db); }
  async updateAudience(idOrSlug: string, input: Parameters<typeof audiencesDb.updateAudience>[1]) { return audiencesDb.updateAudience(idOrSlug, input, this.db); }
  async deleteAudience(idOrSlug: string) { audiencesDb.deleteAudience(idOrSlug, this.db); }
  async resolveAudience(idOrSlug: string, channel: Parameters<typeof audiencesDb.resolveAudience>[1]) { return audiencesDb.resolveAudience(idOrSlug, channel, this.db); }
  async setContactConsent(contactId: string, channel: Parameters<typeof audiencesDb.setContactConsent>[1], status: Parameters<typeof audiencesDb.setContactConsent>[2], source?: string) {
    return audiencesDb.setContactConsent(contactId, channel, status, source, this.db);
  }
  async listContactConsent(contactId: string) { return audiencesDb.listContactConsent(contactId, this.db); }
  async suppressAddress(input: Parameters<typeof audiencesDb.suppressAddress>[0]) { return audiencesDb.suppressAddress(input, this.db); }
  async unsuppressAddress(channel: Parameters<typeof audiencesDb.unsuppressAddress>[0], address: string) { audiencesDb.unsuppressAddress(channel, address, this.db); }
  async listSuppressions(opts: Parameters<typeof audiencesDb.listSuppressions>[0] = {}) { return audiencesDb.listSuppressions(opts, this.db); }
  async syncSuppressions(dryRun?: boolean) { return mailerySyncLib.syncSuppressions({ dryRun, db: this.db }); }

  // Context / briefs / stats
  async generateBrief(contactId: string) { return briefLib.generateBrief(contactId, this.db); }
  async getContactCard(contactId: string) { return contextLib.getContactCard(contactId, this.db); }
  async getContactBrief(contactId: string, taskContext?: string) { return contextLib.getContactBrief(contactId, taskContext, this.db); }
  async assembleContext(contactIds: string[], format: Parameters<typeof contextLib.assembleContext>[1]) { return contextLib.assembleContext(contactIds, format, this.db); }
  async getUpcomingItems(days: number) { return upcomingLib.getUpcomingItems(days, this.db); }
  async getNetworkStats() { return statsLib.getNetworkStats(this.db); }
  async listContactAudit() { return auditLib.listContactAudit(this.db); }
  async getContactTimeline(contactId: string, limit: number) { return timelineLib.getContactTimeline(contactId, limit, this.db); }
  async ingestMeetingParticipants(input: Parameters<typeof meetingCaptureLib.ingestMeetingParticipants>[0]) { return meetingCaptureLib.ingestMeetingParticipants(input, this.db); }

  // Images
  async saveImage(entityId: string, source: string, options?: { format?: string }) { return imagesLib.saveImage(entityId, source, options); }
  async getImagePath(entityId: string) { return imagesLib.getImagePath(entityId); }
  async getImageAsBase64(entityId: string) { return imagesLib.getImageAsBase64(entityId); }
  async deleteImage(entityId: string) { return imagesLib.deleteImage(entityId); }
  async listImages() { return imagesLib.listImages(); }

  // Vault
  async initVault(passphrase: string) { vaultLib.initVault(passphrase); }
  async unlockVault(passphrase: string) { return vaultLib.unlockVault(passphrase); }
  async lockVault() { vaultLib.lockVault(); }
  async isVaultInitialized() { return vaultLib.isVaultInitialized(); }
  async isVaultUnlocked() { return vaultLib.isVaultUnlocked(); }
  async vaultStatus() {
    const initialized = vaultLib.isVaultInitialized();
    const unlocked = vaultLib.isVaultUnlocked();
    let document_count = 0;
    try {
      document_count = (this.db.query("SELECT COUNT(*) as n FROM contact_documents").get() as { n: number }).n;
    } catch { /* table may not exist yet */ }
    return { initialized, unlocked, document_count };
  }

  // Feedback
  async saveFeedback(message: string, email: string | null, category: string, version: string) {
    this.db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(message, email, category, version);
  }

  // Storage diagnostics
  async storageStatus() { return storageDb.getStorageStatus(this.db); }

  // Webhooks
  async listActiveWebhooks() {
    try {
      return this.db.query(`SELECT id, event_type, url, secret FROM webhooks WHERE active=1`).all() as Array<{ id: string; event_type: string; url: string; secret?: string | null }>;
    } catch {
      return [];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ApiStore — HTTPS /v1 transport (self_hosted / cloud). Bearer key only.
// The ONLY place in the client that performs HTTP. Operations the /v1 API does
// not expose throw ApiUnavailableError — never a silent local fallback.
// ─────────────────────────────────────────────────────────────────────────────

function pick<T = unknown>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[key] as T;
  return undefined;
}
function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

class ApiStore implements Store {
  readonly mode = "api" as const;
  constructor(private readonly client: StorageClient) {}

  // ── Raw /v1 transport helpers (unwrap a named envelope key) ──────────────────
  private g(path: string, query?: QueryParams): Promise<unknown> {
    return this.client.transport.get(path, query ? { query } : undefined);
  }
  private post(path: string, body?: unknown): Promise<unknown> {
    return this.client.transport.post(path, body);
  }
  private patch(path: string, body?: unknown): Promise<unknown> {
    return this.client.transport.patch(path, body);
  }
  private del(path: string, query?: QueryParams): Promise<unknown> {
    return this.client.transport.del(path, undefined, query ? { query } : undefined);
  }
  /** GET that resolves to null on a 404 (for get-by-id endpoints). */
  private async gMaybe(path: string): Promise<unknown> {
    try {
      return await this.client.transport.get(path);
    } catch (e) {
      if (e && typeof e === "object" && (e as { status?: number }).status === 404) return null;
      throw e;
    }
  }
  private enc(id: string): string {
    return encodeURIComponent(String(id));
  }

  // Contacts
  async createContact(input: CreateContactInput) {
    const res = await this.client.create<{ contact?: unknown }>("contacts", stripUndefined(input as unknown as Record<string, unknown>));
    return (pick(res, "contact") ?? res) as Contact;
  }
  async getContact(id: string) {
    const res = await this.client.get<{ contact?: unknown }>("contacts", id);
    return (res ? (pick(res, "contact") ?? null) : null) as Contact | null;
  }
  async getContactByEmail(email: string) {
    const res = await this.client.list<{ contacts?: unknown[] }>("contacts", { query: { q: email, limit: 1 } });
    return ((pick<unknown[]>(res, "contacts") ?? [])[0] ?? null) as Contact | null;
  }
  async updateContact(id: string, input: UpdateContactInput) {
    const res = await this.client.update<{ contact?: unknown }>("contacts", id, stripUndefined(input as unknown as Record<string, unknown>));
    return (pick(res, "contact") ?? res) as Contact;
  }
  async deleteContact(id: string) { await this.client.delete("contacts", id); }
  async listContacts(opts: ContactListOptions = {}) {
    const res = await this.client.list<{ contacts?: unknown[]; count?: number }>("contacts", {
      query: stripUndefined(opts as Record<string, unknown>) as QueryParams,
    });
    const contacts = (pick<unknown[]>(res, "contacts") ?? []);
    return { contacts, total: pick<number>(res, "count") ?? contacts.length } as ContactListResult;
  }
  async searchContacts(query: string) {
    const res = await this.client.list<{ contacts?: unknown[] }>("contacts", { query: { q: query } });
    return (pick<unknown[]>(res, "contacts") ?? []) as Contact[];
  }
  async listRecentContacts(limit: number) {
    const res = await this.client.list<{ contacts?: unknown[] }>("contacts", {
      query: { limit, offset: 0, order_by: "updated_at", order_dir: "desc" },
    });
    return (pick<unknown[]>(res, "contacts") ?? []) as Contact[];
  }
  async mergeContacts(): Promise<never> { return unavailable("mergeContacts"); }
  async addEmailToContact(): Promise<never> { return unavailable("addEmailToContact"); }
  async addPhoneToContact(): Promise<never> { return unavailable("addPhoneToContact"); }
  async archiveContact(): Promise<never> { return unavailable("archiveContact"); }
  async unarchiveContact(): Promise<never> { return unavailable("unarchiveContact"); }
  async autoLinkContactToCompany(): Promise<never> { return unavailable("autoLinkContactToCompany"); }
  async findContactByEmailAddress(address: string) { return this.getContactByEmail(address); }

  async linkContactToProject(contactId: string, projectId: string) {
    await this.client.transport.put(`/contacts/${this.enc(contactId)}/projects/${this.enc(projectId)}`);
  }
  async unlinkContactFromProject(contactId: string, projectId: string) {
    await this.del(`/contacts/${this.enc(contactId)}/projects/${this.enc(projectId)}`);
  }
  async getContactProjectIds(contactId: string) {
    return pick<string[]>(await this.g(`/contacts/${this.enc(contactId)}/projects`), "project_ids") ?? [];
  }
  async setContactProjects(contactId: string, projectIds: string[]) {
    await this.client.transport.put(`/contacts/${this.enc(contactId)}/projects`, { project_ids: projectIds });
  }
  async listContactIdsByProject(projectId: string) {
    return pick<string[]>(await this.g(`/projects/${this.enc(projectId)}/contacts`), "contact_ids") ?? [];
  }
  async readContactProjectMembership(contactId: string, projectId: string) {
    return this.client.transport.get<ContactProjectMembershipSnapshot>(
      `/projects/${this.enc(projectId)}/contact-memberships/${this.enc(contactId)}`,
    );
  }
  async listContactProjectMemberships(projectId: string, maxItems: number) {
    return this.client.transport.get<ContactProjectMembershipListResult>(
      `/projects/${this.enc(projectId)}/contact-memberships`,
      { query: { max_items: maxItems } },
    );
  }
  async mutateContactProjectMembership(
    direction: ContactProjectMembershipMutationDirection,
    input: ContactProjectMembershipMutationInput,
  ) {
    return this.client.transport.post<ContactProjectMembershipMutationResult>(
      `/projects/${this.enc(input.project_id)}/contact-memberships/${this.enc(input.contact_id)}/${direction}`,
      {
        operation_id: input.operation_id,
        step_id: input.step_id,
        expected_version: input.expected_version,
      },
    );
  }

  // Companies
  async createCompany(input: CreateCompanyInput) {
    const res = await this.client.create<{ company?: unknown }>("companies", stripUndefined(input as unknown as Record<string, unknown>));
    return pick(res, "company") ?? res;
  }
  async getCompany(id: string) {
    const res = await this.client.get<{ company?: unknown }>("companies", id);
    return res ? (pick(res, "company") ?? null) : null;
  }
  async updateCompany(id: string, input: UpdateCompanyInput) {
    const res = await this.client.update<{ company?: unknown }>("companies", id, stripUndefined(input as unknown as Record<string, unknown>));
    return pick(res, "company") ?? res;
  }
  async deleteCompany(id: string) { await this.client.delete("companies", id); }
  async listCompanies(opts: CompanyListOptions = {}) {
    const res = await this.client.list<{ companies?: unknown[]; count?: number; total?: number }>("companies", {
      query: stripUndefined(opts as Record<string, unknown>) as QueryParams,
    });
    const companies = (pick<unknown[]>(res, "companies") ?? []);
    return { companies, total: pick<number>(res, "total") ?? pick<number>(res, "count") ?? companies.length } as CompanyListResult;
  }
  async searchCompanies(query: string) {
    const res = await this.client.list<{ companies?: unknown[] }>("companies", { query: { q: query } });
    return pick<unknown[]>(res, "companies") ?? [];
  }
  async archiveCompany(): Promise<never> { return unavailable("archiveCompany"); }
  async unarchiveCompany(): Promise<never> { return unavailable("unarchiveCompany"); }

  // Tags
  async createTag(input: CreateTagInput) {
    const res = await this.client.create<{ tag?: unknown }>("tags", stripUndefined(input as unknown as Record<string, unknown>));
    return pick(res, "tag") ?? res;
  }
  async listTags() {
    const res = await this.client.list<{ tags?: unknown[] }>("tags");
    return pick<unknown[]>(res, "tags") ?? [];
  }
  async getTagByName(name: string) {
    const res = await this.client.list<{ tags?: unknown[] }>("tags", { query: { name } });
    const tags = pick<Array<{ name?: unknown }>>(res, "tags") ?? [];
    return tags.find((tag) => tag?.name === name) ?? null;
  }
  async deleteTag(id: string) { await this.client.delete("tags", id); }
  async addTagToContact(contactId: string, tagId: string) {
    await this.client.transport.put(`/contacts/${this.enc(contactId)}/tags/${this.enc(tagId)}`);
  }
  async removeTagFromContact(contactId: string, tagId: string) {
    await this.del(`/contacts/${this.enc(contactId)}/tags/${this.enc(tagId)}`);
  }
  async addTagToCompany(): Promise<never> { return unavailable("addTagToCompany"); }
  async removeTagFromCompany(): Promise<never> { return unavailable("removeTagFromCompany"); }

  // Groups
  async createGroup(input: CreateGroupInput) { return pick(await this.post("/groups", input), "group"); }
  async getGroup(id: string) { return pick(await this.gMaybe(`/groups/${this.enc(id)}`), "group") ?? null; }
  async listGroups(projectId?: string) { return (pick<unknown[]>(await this.g("/groups", projectId ? { project_id: projectId } : undefined), "groups") ?? []); }
  async updateGroup(id: string, input: UpdateGroupInput) { return pick(await this.patch(`/groups/${this.enc(id)}`, input), "group"); }
  async deleteGroup(id: string) { await this.del(`/groups/${this.enc(id)}`); }
  async addContactToGroup(contactId: string, groupId: string) { return this.post(`/groups/${this.enc(groupId)}/contacts`, { contact_id: contactId }); }
  async removeContactFromGroup(contactId: string, groupId: string) { await this.del(`/groups/${this.enc(groupId)}/contacts/${this.enc(contactId)}`); }
  async listContactsInGroup(groupId: string) { return (pick<string[]>(await this.g(`/groups/${this.enc(groupId)}/contacts`), "contact_ids") ?? []); }
  async listGroupsForContact(contactId: string) { return (pick<unknown[]>(await this.g(`/groups/for-contact/${this.enc(contactId)}`), "groups") ?? []); }
  async addCompanyToGroup(companyId: string, groupId: string) { return this.post(`/groups/${this.enc(groupId)}/companies`, { company_id: companyId }); }
  async removeCompanyFromGroup(companyId: string, groupId: string) { await this.del(`/groups/${this.enc(groupId)}/companies/${this.enc(companyId)}`); }
  async listCompaniesInGroup(groupId: string) { return (pick<string[]>(await this.g(`/groups/${this.enc(groupId)}/companies`), "company_ids") ?? []); }
  async listGroupsForCompany(companyId: string) { return (pick<unknown[]>(await this.g(`/groups/for-company/${this.enc(companyId)}`), "groups") ?? []); }

  // Relationships
  async createRelationship(input: CreateRelationshipInput) { return pick(await this.post("/relationships", input), "relationship"); }
  async listRelationships(opts: ListRelationshipsOptions = {}) { return (pick<unknown[]>(await this.g("/relationships", stripUndefined(opts as Record<string, unknown>) as QueryParams), "relationships") ?? []); }
  async deleteRelationship(id: string) { await this.del(`/relationships/${this.enc(id)}`); }
  async createCompanyRelationship(input: CreateCompanyRelationshipInput) { return pick(await this.post("/company-relationships", input), "relationship"); }
  async listCompanyRelationships(opts: ListCompanyRelationshipsOptions = {}) { return (pick<unknown[]>(await this.g("/company-relationships", stripUndefined(opts as Record<string, unknown>) as QueryParams), "relationships") ?? []); }
  async deleteCompanyRelationship(id: string) { await this.del(`/company-relationships/${this.enc(id)}`); }

  // Notes
  async addNote(contactId: string, body: string, createdBy?: string, companyId?: string) { return pick(await this.post("/notes", { contact_id: contactId, body, created_by: createdBy, company_id: companyId }), "note"); }
  async listNotes(contactId: string) { return (pick<unknown[]>(await this.g("/notes", { contact_id: contactId }), "notes") ?? []); }
  async listNotesForContactAtCompany(contactId: string, companyId: string) { return (pick<unknown[]>(await this.g("/notes", { contact_id: contactId, company_id: companyId }), "notes") ?? []); }
  async deleteNote(noteId: string) { await this.del(`/notes/${this.enc(noteId)}`); }

  // Activity
  async listActivity(): Promise<never> { return unavailable("listActivity"); }

  // Aggregate + maintenance
  async stats(): Promise<ContactsStats> {
    const res = await this.client.transport.get<Record<string, number>>("/stats");
    return {
      contacts: Number(res?.contacts ?? 0),
      companies: Number(res?.companies ?? 0),
      tags: Number(res?.tags ?? 0),
      groups: Number(res?.groups ?? 0),
    };
  }
  async findEmailDuplicates() { return (pick<Array<{ email: string; contact_ids: string[] }>>(await this.g("/email-duplicates"), "duplicates") ?? []); }
  async findNameDuplicates() { return (pick<Array<{ contact_ids: [string, string]; similarity: number }>>(await this.g("/name-duplicates"), "duplicates") ?? []); }
  // On-box SQLite maintenance only; a no-op when pointed at the cloud.
  async flushForBackup() { /* no on-box handle in api mode */ }

  // ── Extended domains — routed through the /v1 API ───────────────────────────
  async listColdContacts(days: number) { return (pick<unknown[]>(await this.g("/cold-contacts", { days }), "contacts") ?? []); }
  async findOrCreateContact(input: CreateContactInput) {
    const emails = (input.emails ?? []).map((e) => e.address).filter(Boolean);
    for (const addr of emails) { const c = await this.getContactByEmail(addr); if (c) return { contact: c, created: false }; }
    const nameQuery = input.display_name ?? ((input.first_name || input.last_name) ? `${input.first_name ?? ""} ${input.last_name ?? ""}`.trim() : null);
    if (nameQuery) { const results = await this.searchContacts(nameQuery); if (results[0]) return { contact: results[0], created: false }; }
    return { contact: await this.createContact(input), created: true };
  }
  async findContactsForContext(topic: string, limit: number) { return (pick<Array<{ id: string; display_name: string; job_title: string | null; reason: string }>>(await this.g("/contacts-for-context", { topic, limit }), "contacts") ?? []); }
  async listContactsNotContactedSince(days: number, limit: number) { return (pick<Array<{ id: string; display_name: string; last_contacted_at: string | null }>>(await this.g("/not-contacted", { days, limit }), "contacts") ?? []); }
  async listFollowupDueContacts(onOrBefore: string) { return (pick<Array<{ id: string; display_name: string; follow_up_at: string }>>(await this.g("/followup-due-contacts", { on_or_before: onOrBefore }), "contacts") ?? []); }

  async logVendorCommunication(input: Parameters<typeof vendorCommsDb.logVendorCommunication>[0]) { return pick(await this.post("/vendor-comms", input), "communication"); }
  async listVendorCommunications(companyId: string, opts: Parameters<typeof vendorCommsDb.listVendorCommunications>[1] = {}) { return (pick<unknown[]>(await this.g("/vendor-comms", { company_id: companyId, ...stripUndefined(opts as Record<string, unknown>) } as QueryParams), "communications") ?? []); }
  async listMissingInvoices() { return (pick<unknown[]>(await this.g("/vendor-comms/missing-invoices"), "communications") ?? []); }
  async listPendingFollowUps() { return (pick<unknown[]>(await this.g("/vendor-comms/pending-follow-ups"), "communications") ?? []); }
  async markFollowUpDone(id: string) { return pick(await this.post(`/vendor-comms/${this.enc(id)}/mark-done`), "communication"); }

  async createContactTask(input: Parameters<typeof contactTasksDb.createContactTask>[0]) { return pick(await this.post("/tasks", input), "task"); }
  async listContactTasks(opts: Parameters<typeof contactTasksDb.listContactTasks>[0] = {}) { return (pick<unknown[]>(await this.g("/tasks", stripUndefined(opts as Record<string, unknown>) as QueryParams), "tasks") ?? []); }
  async updateContactTask(id: string, input: Parameters<typeof contactTasksDb.updateContactTask>[1]) { return pick(await this.patch(`/tasks/${this.enc(id)}`, input), "task"); }
  async deleteContactTask(id: string) { await this.del(`/tasks/${this.enc(id)}`); }
  async listOverdueTasks() { return (pick<unknown[]>(await this.g("/tasks/overdue"), "tasks") ?? []); }
  async checkEscalations() { return (pick<unknown[]>(await this.g("/tasks/escalations"), "escalations") ?? []); }

  async createApplication(input: Parameters<typeof applicationsDb.createApplication>[0]) { return pick(await this.post("/applications", input), "application"); }
  async listApplications(opts: Parameters<typeof applicationsDb.listApplications>[0] = {}) { return (pick<unknown[]>(await this.g("/applications", stripUndefined(opts as Record<string, unknown>) as QueryParams), "applications") ?? []); }
  async updateApplication(id: string, input: Parameters<typeof applicationsDb.updateApplication>[1]) { return pick(await this.patch(`/applications/${this.enc(id)}`, input), "application"); }
  async listFollowUpDueApplications() { return (pick<unknown[]>(await this.g("/applications/follow-up-due"), "applications") ?? []); }

  async addOrgMember(input: Parameters<typeof orgMembersDb.addOrgMember>[0]) { return pick(await this.post("/org-members", input), "org_member"); }
  async listOrgMembers(companyId: string) { return (pick<unknown[]>(await this.g("/org-members", { company_id: companyId }), "org_members") ?? []); }
  async updateOrgMember(id: string, input: Parameters<typeof orgMembersDb.updateOrgMember>[1]) { return pick(await this.patch(`/org-members/${this.enc(id)}`, input), "org_member"); }
  async removeOrgMember(id: string) { await this.del(`/org-members/${this.enc(id)}`); }
  async listOrgMembersForContact(contactId: string) { return (pick<unknown[]>(await this.g("/org-members", { contact_id: contactId }), "org_members") ?? []); }

  async createDeal(input: Parameters<typeof dealsDb.createDeal>[0]) { return pick(await this.post("/deals", input), "deal"); }
  async getDeal(id: string) { return pick(await this.gMaybe(`/deals/${this.enc(id)}`), "deal") ?? null; }
  async listDeals(opts: Parameters<typeof dealsDb.listDeals>[0] = {}) { return (pick<unknown[]>(await this.g("/deals", stripUndefined(opts as Record<string, unknown>) as QueryParams), "deals") ?? []); }
  async updateDeal(id: string, input: Parameters<typeof dealsDb.updateDeal>[1]) { return pick(await this.patch(`/deals/${this.enc(id)}`, input), "deal") ?? null; }
  async deleteDeal(id: string) { await this.del(`/deals/${this.enc(id)}`); }

  async logEvent(input: Parameters<typeof eventsDb.logEvent>[0]) { return pick(await this.post("/events", input), "event"); }
  async listEvents(opts: Parameters<typeof eventsDb.listEvents>[0] = {}) { return (pick<unknown[]>(await this.g("/events", stripUndefined(opts as Record<string, unknown>) as QueryParams), "events") ?? []); }
  async deleteEvent(id: string) { await this.del(`/events/${this.enc(id)}`); }

  async getFieldHistory(contactId: string, fieldName?: string) { return (pick<unknown[]>(await this.g(`/contacts/${this.enc(contactId)}/field-history`, fieldName ? { field_name: fieldName } : undefined), "history") ?? []); }
  async getContactAt(contactId: string, timestamp: string) { return (pick<Record<string, string>>(await this.g(`/contacts/${this.enc(contactId)}/field-at`, { timestamp }), "fields") ?? {}); }

  async addJobEntry(contactId: string, input: Parameters<typeof jobHistoryDb.addJobEntry>[1]) { return pick(await this.post(`/contacts/${this.enc(contactId)}/job-history`, input), "job"); }
  async getJobHistory(contactId: string) { return (pick<unknown[]>(await this.g(`/contacts/${this.enc(contactId)}/job-history`), "job_history") ?? []); }

  async saveLearning(contactId: string, input: Parameters<typeof learningsDb.saveLearning>[1]) { return pick(await this.post(`/contacts/${this.enc(contactId)}/learnings`, input), "learning"); }
  async getLearnings(contactId: string, opts: Parameters<typeof learningsDb.getLearnings>[1] = {}) { return (pick<Array<{ confidence: number; type: string; content: string }>>(await this.g(`/contacts/${this.enc(contactId)}/learnings`, stripUndefined(opts as Record<string, unknown>) as QueryParams), "learnings") ?? []); }
  async searchLearnings(query: string, opts: Parameters<typeof learningsDb.searchLearnings>[1] = {}) { return (pick<Array<{ contact_id: string; type: string; confidence: number; content: string }>>(await this.g("/learnings/search", { q: query, ...stripUndefined(opts as Record<string, unknown>) } as QueryParams), "learnings") ?? []); }
  async confirmLearning(learningId: string) { await this.post(`/learnings/${this.enc(learningId)}/confirm`); }
  async getStaleLearnings(daysOld: number, minConfidence: number) { return (pick<unknown[]>(await this.g("/learnings/stale", { days_old: daysOld, min_confidence: minConfidence }), "learnings") ?? []); }
  async runLearningMaintenance() { const r = await this.post("/learnings/maintenance") as { decayed_count?: number; potential_contradictions?: unknown[] }; return { decayed_count: Number(r?.decayed_count ?? 0), potential_contradictions: r?.potential_contradictions ?? [] }; }

  async acquireContactLock(contactId: string, agentName: string, ttlSeconds?: number, reason?: string, sessionId?: string) { return this.post("/locks", { contact_id: contactId, agent_name: agentName, ttl_seconds: ttlSeconds, reason, session_id: sessionId }); }
  async releaseContactLock(contactId: string, agentName: string) { const r = await this.del(`/locks/${this.enc(contactId)}`, { agent_name: agentName }) as { released?: boolean }; return Boolean(r?.released); }
  async checkContactLock(contactId: string) { return pick(await this.g(`/locks/${this.enc(contactId)}`), "lock") ?? null; }
  async logAgentActivity(contactId: string, agentName: string, action: string, details?: string, sessionId?: string) { await this.post("/activity", { contact_id: contactId, agent_name: agentName, action, details, session_id: sessionId }); }
  async getAgentActivity(contactId: string, limit: number) { return (pick<unknown[]>(await this.g("/activity", { contact_id: contactId, limit }), "activity") ?? []); }

  async computeRelationshipStrength(contactId: string) { const r = await this.g(`/graph/strength/${this.enc(contactId)}`) as { strength?: number }; return Number(r?.strength ?? 0); }
  async findWarmPath(fromContactId: string, toContactId: string) { return (pick<unknown[]>(await this.g("/graph/warm-path", { from: fromContactId, to: toContactId }), "path") ?? []); }
  async findConnectionsAtCompany(companyId: string) { return (pick<unknown[]>(await this.g(`/graph/company/${this.enc(companyId)}`), "connections") ?? []); }
  async detectCoolingRelationships() { return (pick<Array<{ display_name: string; days_since: number }>>(await this.g("/graph/cooling"), "cooling") ?? []); }

  async resolveContactIdentity(partial: Parameters<typeof identityDb.resolveByPartial>[0]) { return (pick<Array<{ contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>>(await this.post("/identity/resolve", partial), "matches") ?? []); }
  async addContactIdentity(contactId: string, system: string, externalId: string, externalUrl?: string, confidence: "verified" | "inferred" = "inferred") { return pick(await this.post("/identity", { contact_id: contactId, system, external_id: externalId, external_url: externalUrl, confidence }), "identity"); }
  async getContactIdentities(contactId: string) { return (pick<unknown[]>(await this.g("/identity", { contact_id: contactId }), "identities") ?? []); }

  async semanticSearch(): Promise<never> { return unavailable("semanticSearch"); }
  async embedContact(): Promise<never> { return unavailable("embedContact"); }
  async embedAllContacts(): Promise<never> { return unavailable("embedAllContacts"); }

  async getRelationshipSignals(contactId: string) { return (pick<Array<{ signal_type: string; reason: string; days_since_contact: number | null }>>(await this.g("/signals", { contact_id: contactId }), "signals") ?? []); }
  async getGhostContacts() { return (pick<Array<{ display_name: string; days_since_contact: number | null }>>(await this.g("/signals/ghost"), "signals") ?? []); }
  async getWarmingContacts() { return (pick<Array<{ display_name: string; days_since_contact: number | null }>>(await this.g("/signals/warming"), "signals") ?? []); }
  async recomputeSignals() { const r = await this.post("/signals/recompute") as { updated?: number }; return { updated: Number(r?.updated ?? 0) }; }

  async getFreshnessScore(contactId: string) { return pick(await this.g(`/freshness/${this.enc(contactId)}`), "freshness") as never; }
  async getStaleContacts(threshold: number) { return (pick<Array<{ contact_id: string; display_name: string; score: number }>>(await this.g("/freshness/stale", { threshold }), "contacts") ?? []); }
  async markFieldVerified(contactId: string, fieldName: string, source?: string) { await this.post("/freshness/verify", { contact_id: contactId, field_name: fieldName, source }); }

  async addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: Parameters<typeof orgChartDb.addOrgChartEdge>[3], inferred = false) { return pick(await this.post("/org-chart", { company_id: companyId, contact_a_id: contactAId, contact_b_id: contactBId, edge_type: edgeType, inferred }), "edge"); }
  async listOrgChart(companyId: string) { return (pick<Array<{ contact_a_name: string; contact_b_name: string; edge_type: string }>>(await this.g("/org-chart", { company_id: companyId }), "edges") ?? []); }
  async setDealContactRole(dealId: string, contactId: string, accountRole: Parameters<typeof orgChartDb.setDealContactRole>[2]) { return pick(await this.post(`/deals/${this.enc(dealId)}/roles`, { contact_id: contactId, account_role: accountRole }), "role"); }
  async getDealTeam(dealId: string) { return (pick<Array<{ display_name: string; account_role: string; job_title?: string }>>(await this.g(`/deals/${this.enc(dealId)}/team`), "team") ?? []); }
  async getCoverageGaps(companyId: string) { return pick(await this.g(`/org-chart/coverage/${this.enc(companyId)}`), "coverage"); }

  async getRecentContactEvents(since?: string, eventTypes?: string[]) { return (pick<unknown[]>(await this.g("/recent-events", { since, types: eventTypes?.length ? eventTypes.join(",") : undefined }), "events") ?? []); }

  // Documents / health are encrypted with on-box vault key material — not exposed to the cloud.
  async addDocument(): Promise<never> { return unavailable("addDocument"); }
  async getDocument(): Promise<never> { return unavailable("getDocument"); }
  async listDocuments(): Promise<never> { return unavailable("listDocuments"); }
  async deleteDocument(): Promise<never> { return unavailable("deleteDocument"); }
  async getDocumentFilePath(): Promise<never> { return unavailable("getDocumentFilePath"); }

  async setHealthData(): Promise<never> { return unavailable("setHealthData"); }
  async getHealthData(): Promise<never> { return unavailable("getHealthData"); }
  async deleteHealthData(): Promise<never> { return unavailable("deleteHealthData"); }

  async createAudience(input: Parameters<typeof audiencesDb.createAudience>[0]) { return pick(await this.post("/audiences", input), "audience") as never; }
  async getAudience(idOrSlug: string) { return pick(await this.g(`/audiences/${this.enc(idOrSlug)}`), "audience") as never; }
  async listAudiences() { return (pick<Array<{ audience_id: string; name: string; match: string; consent_policy: string; predicates: unknown[]; suppression_synced_at?: string | null }>>(await this.g("/audiences"), "audiences") ?? []); }
  async updateAudience(idOrSlug: string, input: Parameters<typeof audiencesDb.updateAudience>[1]) { return pick(await this.patch(`/audiences/${this.enc(idOrSlug)}`, input), "audience"); }
  async deleteAudience(idOrSlug: string) { await this.del(`/audiences/${this.enc(idOrSlug)}`); }
  async resolveAudience(idOrSlug: string, channel: Parameters<typeof audiencesDb.resolveAudience>[1]) { return pick(await this.g(`/audiences/${this.enc(idOrSlug)}/resolve`, { channel }), "resolution") as never; }
  async setContactConsent(contactId: string, channel: Parameters<typeof audiencesDb.setContactConsent>[1], status: Parameters<typeof audiencesDb.setContactConsent>[2], source?: string) { return pick(await this.post("/consent", { contact_id: contactId, channel, status, source }), "consent") as never; }
  async listContactConsent(contactId: string) { return (pick<Array<{ channel: string; status: string; source?: string | null; updated_at: string }>>(await this.g("/consent", { contact_id: contactId }), "consent") ?? []); }
  async suppressAddress(input: Parameters<typeof audiencesDb.suppressAddress>[0]) { return pick(await this.post("/suppressions", input), "suppression") as never; }
  async unsuppressAddress(channel: Parameters<typeof audiencesDb.unsuppressAddress>[0], address: string) { await this.del("/suppressions", { channel: channel as unknown as string, address }); }
  async listSuppressions(opts: Parameters<typeof audiencesDb.listSuppressions>[0] = {}) { return (pick<Array<{ address: string; channel: string; reason?: string | null; synced_at?: string | null }>>(await this.g("/suppressions", stripUndefined(opts as Record<string, unknown>) as QueryParams), "suppressions") ?? []); }
  async syncSuppressions(): Promise<never> { return unavailable("syncSuppressions"); }

  async generateBrief(contactId: string) { const r = await this.g(`/contacts/${this.enc(contactId)}/brief-text`) as { text?: string }; return String(r?.text ?? ""); }
  async getContactCard(contactId: string) { return pick(await this.g(`/contacts/${this.enc(contactId)}/card`), "card") as object; }
  async getContactBrief(contactId: string, taskContext?: string) { return pick(await this.g(`/contacts/${this.enc(contactId)}/brief`, taskContext ? { context: taskContext } : undefined), "brief") as object; }
  async assembleContext(contactIds: string[], format: Parameters<typeof contextLib.assembleContext>[1]) { return pick(await this.post("/assemble-context", { contact_ids: contactIds, format }), "context") as object; }
  async getUpcomingItems(days: number) { return (pick<unknown[]>(await this.g("/upcoming", { days }), "items") ?? []); }
  async getNetworkStats() { return pick(await this.g("/network-stats"), "stats") as never; }
  async listContactAudit() { return (pick<unknown[]>(await this.g("/contact-audit"), "audit") ?? []); }
  async getContactTimeline(contactId: string, limit: number) { return (pick<Array<{ type: string; date?: string | null; title: string; body?: string | null }>>(await this.g(`/contacts/${this.enc(contactId)}/timeline`, { limit }), "timeline") ?? []); }
  async ingestMeetingParticipants(): Promise<never> { return unavailable("ingestMeetingParticipants"); }

  // Images are on-box filesystem (or S3 in cloud, not yet wired); not exposed via /v1.
  async saveImage(): Promise<never> { return unavailable("saveImage"); }
  async getImagePath(): Promise<never> { return unavailable("getImagePath"); }
  async getImageAsBase64(): Promise<never> { return unavailable("getImageAsBase64"); }
  async deleteImage(): Promise<never> { return unavailable("deleteImage"); }
  async listImages(): Promise<never> { return unavailable("listImages"); }

  // Vault key material is on-box only; cloud mode has no vault to init/unlock.
  async initVault(): Promise<never> { return unavailable("initVault"); }
  async unlockVault(): Promise<never> { return unavailable("unlockVault"); }
  async lockVault(): Promise<never> { return unavailable("lockVault"); }
  async isVaultInitialized() { return false; }
  async isVaultUnlocked() { return false; }
  async vaultStatus() { return (pick<{ initialized: boolean; unlocked: boolean; document_count: number }>(await this.g("/vault-status"), "vault") ?? { initialized: false, unlocked: false, document_count: 0 }); }

  async saveFeedback(): Promise<never> { return unavailable("saveFeedback"); }
  // No on-box tables when pointed at the cloud; transport status conveys state.
  async storageStatus(): Promise<null> { return null; }
  // No local webhook delivery registry when pointed at the cloud.
  async listActiveWebhooks() { return []; }
}

let cached: Store | undefined;

/**
 * Resolve the single Store for this process. Memoized. Returns an ApiStore when
 * the self_hosted/cloud client-flip env is set (URL + key), else a LocalStore.
 * Throws if cloud was requested but is misconfigured — callers never silently
 * read/write the wrong dataset.
 */
export function getStore(env: Record<string, string | undefined> = process.env): Store {
  if (cached !== undefined) return cached;
  const resolved = resolveStorageClient("contacts", env);
  cached = resolved.transport === "cloud-http" ? new ApiStore(resolved.client) : new LocalStore();
  return cached;
}

/** Test hook: drop the memoized Store so a new env can be resolved. */
export function resetStoreCache(): void {
  cached = undefined;
}

// Storage-status shape returned by `Store.storageStatus()` (on-box table rows).
export type { ContactsStorageStatus, StorageTableStatus } from "../db/storage.js";
