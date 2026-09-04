/**
 * The ONE storage abstraction for @hasna/contacts.
 *
 * Every CLI command, MCP tool, and SDK method routes reads and writes through a
 * single `Store` interface backed by one transport: authenticated HTTPS `/v1`.
 * The URL is explicit and the API key comes from the shared contracts
 * credential seam. Missing or invalid configuration is terminal; it never
 * selects or imports the retired SQLite implementation. Legacy preservation is
 * an explicit byte-copy workflow outside this store.
 *
 * NO command, tool, or SDK method may import `getDatabase`/`bun:sqlite` or issue
 * a raw `fetch`. Direct HTTP lives only inside ApiStore.
 *
 * Operations that the `/v1` API does not yet expose throw a clear
 * `ApiUnavailableError` in ApiStore rather than silently falling back to local
 * SQLite — a loud failure, never a split brain. Adding the missing `/v1` route
 * to `src/server` (+ an ECS redeploy) is the only way to enable them in the
 * cloud; there is deliberately no per-command local fallback.
 */
import type { ContactsStorageStatus } from "../types/store-dto.js";
import type * as Dto from "../types/store-dto.js";
import { resolveContactsStorageClient, type StorageClient, type QueryParams } from "../cloud/http-storage.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";

// ── Convenience shorthands for input / result types (track the db layer) ──
type CreateContactInput = Dto.contactsCreateContactInput0;
type UpdateContactInput = Dto.contactsUpdateContactInput1;
type ContactListOptions = Dto.contactsListContactsInput0;
type ContactListResult = Awaited<Dto.contactsListContactsResult>;
type Contact = Dto.contactsGetContactResult;
type CreateEmailInput = Dto.contactsAddEmailToContactInput1;
type CreatePhoneInput = Dto.contactsAddPhoneToContactInput1;

type CreateCompanyInput = Dto.companiesCreateCompanyInput0;
type UpdateCompanyInput = Dto.companiesUpdateCompanyInput1;
type CompanyListOptions = Dto.companiesListCompaniesInput0;
type CompanyListResult = Awaited<Dto.companiesListCompaniesResult>;

type CreateTagInput = Dto.tagsCreateTagInput0;

type CreateGroupInput = Dto.groupsCreateGroupInput1;
type UpdateGroupInput = Dto.groupsUpdateGroupInput2;

type CreateRelationshipInput = Dto.relationshipsCreateRelationshipInput0;
type ListRelationshipsOptions = Dto.relationshipsListRelationshipsInput0;
type CreateCompanyRelationshipInput = Dto.relationshipsCreateCompanyRelationshipInput0;
type ListCompanyRelationshipsOptions = Dto.relationshipsListCompanyRelationshipsInput0;

type ListActivityOptions = Dto.activityListActivityInput0;

export interface ContactsStats {
  contacts: number;
  companies: number;
  tags: number;
  groups: number;
}

/** Thrown when an operation is requested but the canonical HTTPS API does not
 * `/v1` server does not expose it yet. Never silently falls back to local. */
export class ApiUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `contacts: '${operation}' is not available through the canonical /v1 API. ` +
        `Add the endpoint to src/server and redeploy. Local fallback is retired; the client ` +
        `will never read or write on-box SQLite.`,
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
 * The single authenticated HTTPS storage contract.
 */
export interface Store {
  readonly mode: "api";

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
  /** Retired backup hook; the HTTPS store throws ApiUnavailableError. */
  flushForBackup(): Promise<void>;

  // ── Extended domains (CRM / intelligence / audiences) ──────────────────────
  // Every method the crm / advanced / audience CLI commands and MCP tools need.
  // Unsupported HTTPS operations throw ApiUnavailableError until /v1 exposes
  // them — never a silent local write.

  // Contacts extras
  listColdContacts(days: number): Promise<unknown[]>;
  findOrCreateContact(input: CreateContactInput): Promise<{ contact: Contact; created: boolean }>;
  findContactsForContext(topic: string, limit: number): Promise<Array<{ id: string; display_name: string; job_title: string | null; reason: string }>>;
  listContactsNotContactedSince(days: number, limit: number): Promise<Array<{ id: string; display_name: string; last_contacted_at: string | null }>>;
  listFollowupDueContacts(onOrBefore: string): Promise<Array<{ id: string; display_name: string; follow_up_at: string }>>;

  // Vendor communications
  logVendorCommunication(input: Dto.vendorCommsLogVendorCommunicationInput0): Promise<unknown>;
  listVendorCommunications(companyId: string, opts?: Dto.vendorCommsListVendorCommunicationsInput1): Promise<unknown[]>;
  listMissingInvoices(): Promise<unknown[]>;
  listPendingFollowUps(): Promise<unknown[]>;
  markFollowUpDone(id: string): Promise<unknown>;

  // Contact tasks
  createContactTask(input: Dto.contactTasksCreateContactTaskInput0): Promise<unknown>;
  listContactTasks(opts?: Dto.contactTasksListContactTasksInput0): Promise<unknown[]>;
  updateContactTask(id: string, input: Dto.contactTasksUpdateContactTaskInput1): Promise<unknown>;
  deleteContactTask(id: string): Promise<void>;
  listOverdueTasks(): Promise<unknown[]>;
  checkEscalations(): Promise<unknown[]>;

  // Applications
  createApplication(input: Dto.applicationsCreateApplicationInput0): Promise<unknown>;
  listApplications(opts?: Dto.applicationsListApplicationsInput0): Promise<unknown[]>;
  updateApplication(id: string, input: Dto.applicationsUpdateApplicationInput1): Promise<unknown>;
  listFollowUpDueApplications(): Promise<unknown[]>;

  // Org members
  addOrgMember(input: Dto.orgMembersAddOrgMemberInput0): Promise<unknown>;
  listOrgMembers(companyId: string): Promise<unknown[]>;
  updateOrgMember(id: string, input: Dto.orgMembersUpdateOrgMemberInput1): Promise<unknown>;
  removeOrgMember(id: string): Promise<void>;
  listOrgMembersForContact(contactId: string): Promise<unknown[]>;

  // Deals
  createDeal(input: Dto.dealsCreateDealInput0): Promise<unknown>;
  getDeal(id: string): Promise<unknown | null>;
  listDeals(opts?: Dto.dealsListDealsInput0): Promise<unknown[]>;
  updateDeal(id: string, input: Dto.dealsUpdateDealInput1): Promise<unknown | null>;
  deleteDeal(id: string): Promise<void>;

  // Events
  logEvent(input: Dto.eventsLogEventInput0): Promise<unknown>;
  listEvents(opts?: Dto.eventsListEventsInput0): Promise<unknown[]>;
  deleteEvent(id: string): Promise<void>;

  // Field history
  getFieldHistory(contactId: string, fieldName?: string): Promise<unknown[]>;
  getContactAt(contactId: string, timestamp: string): Promise<Record<string, string>>;

  // Job history
  addJobEntry(contactId: string, input: Dto.jobHistoryAddJobEntryInput1): Promise<unknown>;
  getJobHistory(contactId: string): Promise<unknown[]>;

  // Learnings
  saveLearning(contactId: string, input: Dto.learningsSaveLearningInput1): Promise<unknown>;
  getLearnings(contactId: string, opts?: Dto.learningsGetLearningsInput1): Promise<Array<{ confidence: number; type: string; content: string }>>;
  searchLearnings(query: string, opts?: Dto.learningsSearchLearningsInput1): Promise<Array<{ contact_id: string; type: string; confidence: number; content: string }>>;
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
  resolveContactIdentity(partial: Dto.identityResolveByPartialInput0): Promise<Array<{ contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>>;
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
  getFreshnessScore(contactId: string): Promise<Dto.freshnessGetFreshnessScoreResult>;
  getStaleContacts(threshold: number): Promise<Array<{ contact_id: string; display_name: string; score: number }>>;
  markFieldVerified(contactId: string, fieldName: string, source?: string): Promise<void>;

  // Org chart / deal teams
  addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: Dto.orgChartAddOrgChartEdgeInput3, inferred?: boolean): Promise<unknown>;
  listOrgChart(companyId: string): Promise<Array<{ contact_a_name: string; contact_b_name: string; edge_type: string }>>;
  setDealContactRole(dealId: string, contactId: string, accountRole: Dto.orgChartSetDealContactRoleInput2): Promise<unknown>;
  getDealTeam(dealId: string): Promise<Array<{ display_name: string; account_role: string; job_title?: string }>>;
  getCoverageGaps(companyId: string): Promise<unknown>;

  // Recent activity events
  getRecentContactEvents(since?: string, eventTypes?: string[]): Promise<unknown[]>;

  // Documents (encrypted vault)
  addDocument(input: Dto.documentsAddDocumentInput0): Promise<unknown>;
  getDocument(id: string): Promise<unknown>;
  listDocuments(contactId: string): Promise<Array<{ doc_type: string; label?: string | null; has_file: boolean; expires_at?: string | null; created_at: string }>>;
  deleteDocument(id: string): Promise<void>;
  getDocumentFilePath(id: string): Promise<string | null>;

  // Health
  setHealthData(contactId: string, input: Dto.healthSetHealthDataInput1): Promise<unknown>;
  getHealthData(contactId: string): Promise<Dto.healthGetHealthDataResult>;
  deleteHealthData(contactId: string): Promise<void>;

  // Audiences / consent / suppression
  createAudience(input: Dto.audiencesCreateAudienceInput0): Promise<{ id: string; audience_id: string }>;
  getAudience(idOrSlug: string): Promise<Dto.audiencesGetAudienceResult>;
  listAudiences(): Promise<Array<{ audience_id: string; name: string; match: string; consent_policy: string; predicates: unknown[]; suppression_synced_at?: string | null }>>;
  updateAudience(idOrSlug: string, input: Dto.audiencesUpdateAudienceInput1): Promise<unknown>;
  deleteAudience(idOrSlug: string): Promise<void>;
  resolveAudience(idOrSlug: string, channel: Dto.audiencesResolveAudienceInput1): Promise<Dto.audiencesResolveAudienceResult>;
  setContactConsent(contactId: string, channel: Dto.audiencesSetContactConsentInput1, status: Dto.audiencesSetContactConsentInput2, source?: string): Promise<{ channel: string; status: string }>;
  listContactConsent(contactId: string): Promise<Array<{ channel: string; status: string; source?: string | null; updated_at: string }>>;
  suppressAddress(input: Dto.audiencesSuppressAddressInput0): Promise<{ address: string; channel: string }>;
  unsuppressAddress(channel: Dto.audiencesUnsuppressAddressInput0, address: string): Promise<void>;
  listSuppressions(opts?: Dto.audiencesListSuppressionsInput0): Promise<Array<{ address: string; channel: string; reason?: string | null; synced_at?: string | null }>>;
  syncSuppressions(dryRun?: boolean): Promise<Awaited<Dto.mailerySyncSyncSuppressionsResult>>;

  // Context / briefs / stats (lib layer, db-backed)
  generateBrief(contactId: string): Promise<string>;
  getContactCard(contactId: string): Promise<object>;
  getContactBrief(contactId: string, taskContext?: string): Promise<object>;
  assembleContext(contactIds: string[], format: Dto.contextAssembleContextInput1): Promise<object>;
  getUpcomingItems(days: number): Promise<unknown[]>;
  getNetworkStats(): Promise<Dto.statsGetNetworkStatsResult>;
  listContactAudit(): Promise<unknown[]>;
  getContactTimeline(contactId: string, limit: number): Promise<Array<{ type: string; date?: string | null; title: string; body?: string | null }>>;
  ingestMeetingParticipants(input: Dto.meetingCaptureIngestMeetingParticipantsInput0): Promise<{ created: number; updated: number; contact_ids: string[] }>;

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

  // There are no on-box client tables. Connection status is exposed separately.
  storageStatus(): Promise<null>;

  // Webhooks (local delivery registry — reads only; delivery stays in caller)
  listActiveWebhooks(): Promise<Array<{ id: string; event_type: string; url: string; secret?: string | null }>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ApiStore — canonical HTTPS /v1 transport. Bearer key only.
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

  async logVendorCommunication(input: Dto.vendorCommsLogVendorCommunicationInput0) { return pick(await this.post("/vendor-comms", input), "communication"); }
  async listVendorCommunications(companyId: string, opts: Dto.vendorCommsListVendorCommunicationsInput1 = {}) { return (pick<unknown[]>(await this.g("/vendor-comms", { company_id: companyId, ...stripUndefined(opts as Record<string, unknown>) } as QueryParams), "communications") ?? []); }
  async listMissingInvoices() { return (pick<unknown[]>(await this.g("/vendor-comms/missing-invoices"), "communications") ?? []); }
  async listPendingFollowUps() { return (pick<unknown[]>(await this.g("/vendor-comms/pending-follow-ups"), "communications") ?? []); }
  async markFollowUpDone(id: string) { return pick(await this.post(`/vendor-comms/${this.enc(id)}/mark-done`), "communication"); }

  async createContactTask(input: Dto.contactTasksCreateContactTaskInput0) { return pick(await this.post("/tasks", input), "task"); }
  async listContactTasks(opts: Dto.contactTasksListContactTasksInput0 = {}) { return (pick<unknown[]>(await this.g("/tasks", stripUndefined(opts as Record<string, unknown>) as QueryParams), "tasks") ?? []); }
  async updateContactTask(id: string, input: Dto.contactTasksUpdateContactTaskInput1) { return pick(await this.patch(`/tasks/${this.enc(id)}`, input), "task"); }
  async deleteContactTask(id: string) { await this.del(`/tasks/${this.enc(id)}`); }
  async listOverdueTasks() { return (pick<unknown[]>(await this.g("/tasks/overdue"), "tasks") ?? []); }
  async checkEscalations() { return (pick<unknown[]>(await this.g("/tasks/escalations"), "escalations") ?? []); }

  async createApplication(input: Dto.applicationsCreateApplicationInput0) { return pick(await this.post("/applications", input), "application"); }
  async listApplications(opts: Dto.applicationsListApplicationsInput0 = {}) { return (pick<unknown[]>(await this.g("/applications", stripUndefined(opts as Record<string, unknown>) as QueryParams), "applications") ?? []); }
  async updateApplication(id: string, input: Dto.applicationsUpdateApplicationInput1) { return pick(await this.patch(`/applications/${this.enc(id)}`, input), "application"); }
  async listFollowUpDueApplications() { return (pick<unknown[]>(await this.g("/applications/follow-up-due"), "applications") ?? []); }

  async addOrgMember(input: Dto.orgMembersAddOrgMemberInput0) { return pick(await this.post("/org-members", input), "org_member"); }
  async listOrgMembers(companyId: string) { return (pick<unknown[]>(await this.g("/org-members", { company_id: companyId }), "org_members") ?? []); }
  async updateOrgMember(id: string, input: Dto.orgMembersUpdateOrgMemberInput1) { return pick(await this.patch(`/org-members/${this.enc(id)}`, input), "org_member"); }
  async removeOrgMember(id: string) { await this.del(`/org-members/${this.enc(id)}`); }
  async listOrgMembersForContact(contactId: string) { return (pick<unknown[]>(await this.g("/org-members", { contact_id: contactId }), "org_members") ?? []); }

  async createDeal(input: Dto.dealsCreateDealInput0) { return pick(await this.post("/deals", input), "deal"); }
  async getDeal(id: string) { return pick(await this.gMaybe(`/deals/${this.enc(id)}`), "deal") ?? null; }
  async listDeals(opts: Dto.dealsListDealsInput0 = {}) { return (pick<unknown[]>(await this.g("/deals", stripUndefined(opts as Record<string, unknown>) as QueryParams), "deals") ?? []); }
  async updateDeal(id: string, input: Dto.dealsUpdateDealInput1) { return pick(await this.patch(`/deals/${this.enc(id)}`, input), "deal") ?? null; }
  async deleteDeal(id: string) { await this.del(`/deals/${this.enc(id)}`); }

  async logEvent(input: Dto.eventsLogEventInput0) { return pick(await this.post("/events", input), "event"); }
  async listEvents(opts: Dto.eventsListEventsInput0 = {}) { return (pick<unknown[]>(await this.g("/events", stripUndefined(opts as Record<string, unknown>) as QueryParams), "events") ?? []); }
  async deleteEvent(id: string) { await this.del(`/events/${this.enc(id)}`); }

  async getFieldHistory(contactId: string, fieldName?: string) { return (pick<unknown[]>(await this.g(`/contacts/${this.enc(contactId)}/field-history`, fieldName ? { field_name: fieldName } : undefined), "history") ?? []); }
  async getContactAt(contactId: string, timestamp: string) { return (pick<Record<string, string>>(await this.g(`/contacts/${this.enc(contactId)}/field-at`, { timestamp }), "fields") ?? {}); }

  async addJobEntry(contactId: string, input: Dto.jobHistoryAddJobEntryInput1) { return pick(await this.post(`/contacts/${this.enc(contactId)}/job-history`, input), "job"); }
  async getJobHistory(contactId: string) { return (pick<unknown[]>(await this.g(`/contacts/${this.enc(contactId)}/job-history`), "job_history") ?? []); }

  async saveLearning(contactId: string, input: Dto.learningsSaveLearningInput1) { return pick(await this.post(`/contacts/${this.enc(contactId)}/learnings`, input), "learning"); }
  async getLearnings(contactId: string, opts: Dto.learningsGetLearningsInput1 = {}) { return (pick<Array<{ confidence: number; type: string; content: string }>>(await this.g(`/contacts/${this.enc(contactId)}/learnings`, stripUndefined(opts as Record<string, unknown>) as QueryParams), "learnings") ?? []); }
  async searchLearnings(query: string, opts: Dto.learningsSearchLearningsInput1 = {}) { return (pick<Array<{ contact_id: string; type: string; confidence: number; content: string }>>(await this.g("/learnings/search", { q: query, ...stripUndefined(opts as Record<string, unknown>) } as QueryParams), "learnings") ?? []); }
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

  async resolveContactIdentity(partial: Dto.identityResolveByPartialInput0) { return (pick<Array<{ contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>>(await this.post("/identity/resolve", partial), "matches") ?? []); }
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

  async addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: Dto.orgChartAddOrgChartEdgeInput3, inferred = false) { return pick(await this.post("/org-chart", { company_id: companyId, contact_a_id: contactAId, contact_b_id: contactBId, edge_type: edgeType, inferred }), "edge"); }
  async listOrgChart(companyId: string) { return (pick<Array<{ contact_a_name: string; contact_b_name: string; edge_type: string }>>(await this.g("/org-chart", { company_id: companyId }), "edges") ?? []); }
  async setDealContactRole(dealId: string, contactId: string, accountRole: Dto.orgChartSetDealContactRoleInput2) { return pick(await this.post(`/deals/${this.enc(dealId)}/roles`, { contact_id: contactId, account_role: accountRole }), "role"); }
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

  async createAudience(input: Dto.audiencesCreateAudienceInput0) { return pick(await this.post("/audiences", input), "audience") as never; }
  async getAudience(idOrSlug: string) { return pick(await this.g(`/audiences/${this.enc(idOrSlug)}`), "audience") as never; }
  async listAudiences() { return (pick<Array<{ audience_id: string; name: string; match: string; consent_policy: string; predicates: unknown[]; suppression_synced_at?: string | null }>>(await this.g("/audiences"), "audiences") ?? []); }
  async updateAudience(idOrSlug: string, input: Dto.audiencesUpdateAudienceInput1) { return pick(await this.patch(`/audiences/${this.enc(idOrSlug)}`, input), "audience"); }
  async deleteAudience(idOrSlug: string) { await this.del(`/audiences/${this.enc(idOrSlug)}`); }
  async resolveAudience(idOrSlug: string, channel: Dto.audiencesResolveAudienceInput1) { return pick(await this.g(`/audiences/${this.enc(idOrSlug)}/resolve`, { channel }), "resolution") as never; }
  async setContactConsent(contactId: string, channel: Dto.audiencesSetContactConsentInput1, status: Dto.audiencesSetContactConsentInput2, source?: string) { return pick(await this.post("/consent", { contact_id: contactId, channel, status, source }), "consent") as never; }
  async listContactConsent(contactId: string) { return (pick<Array<{ channel: string; status: string; source?: string | null; updated_at: string }>>(await this.g("/consent", { contact_id: contactId }), "consent") ?? []); }
  async suppressAddress(input: Dto.audiencesSuppressAddressInput0) { return pick(await this.post("/suppressions", input), "suppression") as never; }
  async unsuppressAddress(channel: Dto.audiencesUnsuppressAddressInput0, address: string) { await this.del("/suppressions", { channel: channel as unknown as string, address }); }
  async listSuppressions(opts: Dto.audiencesListSuppressionsInput0 = {}) { return (pick<Array<{ address: string; channel: string; reason?: string | null; synced_at?: string | null }>>(await this.g("/suppressions", stripUndefined(opts as Record<string, unknown>) as QueryParams), "suppressions") ?? []); }
  async syncSuppressions(): Promise<never> { return unavailable("syncSuppressions"); }

  async generateBrief(contactId: string) { const r = await this.g(`/contacts/${this.enc(contactId)}/brief-text`) as { text?: string }; return String(r?.text ?? ""); }
  async getContactCard(contactId: string) { return pick(await this.g(`/contacts/${this.enc(contactId)}/card`), "card") as object; }
  async getContactBrief(contactId: string, taskContext?: string) { return pick(await this.g(`/contacts/${this.enc(contactId)}/brief`, taskContext ? { context: taskContext } : undefined), "brief") as object; }
  async assembleContext(contactIds: string[], format: Dto.contextAssembleContextInput1) { return pick(await this.post("/assemble-context", { contact_ids: contactIds, format }), "context") as object; }
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
 * Resolve the single Store for this process. Memoized. A usable explicit HTTPS
 * URL and credential are mandatory. The legacy LocalStore is never selected.
 */
export function getStore(env: Record<string, string | undefined> = process.env): Store {
  if (cached !== undefined) return cached;
  const resolved = resolveContactsStorageClient("contacts", env);
  cached = new ApiStore(resolved.client);
  return cached;
}

/** Test hook: drop the memoized Store so a new env can be resolved. */
export function resetStoreCache(): void {
  cached = undefined;
}

// Public status is null: the HTTPS client does not expose local table diagnostics.
export type { ContactsStorageStatus, StorageTableStatus } from "../types/store-dto.js";
