// Frozen pre-isolation public signatures from 7a24052a2. Type-only imports
// never execute or ship; every method except the corrected null status must
// remain exactly equal. The production declaration closure is tested below.
import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import type { Store, ContactsStorageStatus as PublicStatus } from "./index.js";
import type * as contactsDb from "../db/contacts.js";
import type * as companiesDb from "../db/companies.js";
import type * as tagsDb from "../db/tags.js";
import type * as groupsDb from "../db/groups.js";
import type * as relationshipsDb from "../db/relationships.js";
import type * as activityDb from "../db/activity.js";
import type * as vendorCommsDb from "../db/vendor-comms.js";
import type * as contactTasksDb from "../db/contact-tasks.js";
import type * as applicationsDb from "../db/applications.js";
import type * as orgMembersDb from "../db/org-members.js";
import type * as dealsDb from "../db/deals.js";
import type * as eventsDb from "../db/events.js";
import type * as jobHistoryDb from "../db/job-history.js";
import type * as learningsDb from "../db/learnings.js";
import type * as identityDb from "../db/identity.js";
import type * as freshnessDb from "../db/freshness.js";
import type * as orgChartDb from "../db/org-chart.js";
import type * as documentsDb from "../db/documents.js";
import type * as healthDb from "../db/health.js";
import type * as audiencesDb from "../db/audiences.js";
import type * as statsLib from "../lib/stats.js";
import type * as meetingCaptureLib from "../lib/meeting-capture.js";
import type * as contextLib from "../lib/context.js";
import type * as mailerySyncLib from "../lib/mailery-sync.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";
import type { ContactsStorageStatus } from "../db/storage.js";
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
export interface LegacyStore {
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

  // There are no on-box client tables. Connection status is exposed separately.
  storageStatus(): Promise<ContactsStorageStatus | null>;

  // Webhooks (local delivery registry — reads only; delivery stays in caller)
  listActiveWebhooks(): Promise<Array<{ id: string; event_type: string; url: string; secret?: string | null }>>;
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _SameMethods = Assert<Equal<keyof Store, keyof LegacyStore>>;
type _SameSignatures = Assert<Equal<Omit<Store, "storageStatus">, Omit<LegacyStore, "storageStatus">>>;
type _TruthfulStatus = Assert<Equal<Awaited<ReturnType<Store["storageStatus"]>>, null>>;
type _ExportedStatus = Assert<Equal<PublicStatus, null>>;

function declarationClosure(entries: string[], emitted: Map<string, string>): string[] {
  const seen = new Set<string>();
  function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const text = emitted.get(file);
    if (text === undefined) throw new Error(`Missing public declaration ${file}`);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function walk(node: ts.Node) {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text;
      if (specifier) {
        expect(specifier).not.toMatch(/(?:^|\/)db\/|sqlite|postgres|storage-kit/);
        if (specifier.startsWith(".")) {
          const base = resolve(dirname(file), specifier).replace(/\.js$/, "");
          const target = [base + ".d.ts", base + "/index.d.ts"].find((file) => emitted.has(file));
          if (!target) throw new Error(`Missing public declaration ${specifier} from ${file}`);
          visit(target);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  entries.forEach(visit);
  return [...seen];
}

test("public root and SDK declaration closures contain no persistence implementation", () => {
  const root = resolve(import.meta.dir, "../..");
  const dist = root + "/dist";
  const config = ts.getParsedCommandLineOfConfigFile(root + "/tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => { throw new Error("Invalid typecheck configuration"); } });
  if (!config) throw new Error("Missing typecheck configuration");
  const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: dist });
  // Bun erases type assertions, so execute the checker here as well as in
  // typecheck. This also proves the frozen method-signature equality above.
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
  const emitted = new Map<string, string>();
  const result = program.emit(undefined, (file, text) => emitted.set(file, text));
  expect(result.emitSkipped).toBe(false);
  const files = declarationClosure([dist + "/index.d.ts", dist + "/sdk/index.d.ts"], emitted);
  expect(files.length).toBeGreaterThan(2);
  expect(files.some((file) => file.endsWith("/types/store-dto.d.ts"))).toBe(true);
}, 30_000);
