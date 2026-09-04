/**
 * Advanced / intelligence handlers: field history, job history, learnings,
 * coordination (locks), graph, identity, embeddings, signals, freshness,
 * org chart, deal teams, context, signatures, meeting capture, images,
 * vault, documents, health, feedback, and agent registry.
 *
 * Every handler routes storage through the single `Store` abstraction
 * (getStore()). No handler touches SQLite (`getDatabase`) directly. Pure
 * computation helpers (signature parsing, AI document scanning) stay as direct
 * imports because they never touch the storage backend.
 */
import type { ToolHandler } from "./types.js";
import { getStore } from "../../store/index.js";
import type { CreateLearningInput } from "../../db/learnings.js";
import type { OrgEdgeType, AccountRole } from "../../db/org-chart.js";
import type { DocumentType } from "../../db/documents.js";
import type { SetHealthInput } from "../../db/health.js";
import {
  parseEmailSignature,
  extractContactsFromEmailThread,
} from "../../lib/signature-parser.js";
import { scanDocument } from "../../lib/document-scanner.js";

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

// --- in-memory agent registry ---
interface _ContactsAgent {
  id: string;
  name: string;
  session_id?: string;
  last_seen_at: string;
  project_id?: string;
}
const _contactsAgents = new Map<string, _ContactsAgent>();

export const advancedHandlers: Record<string, ToolHandler> = {
  // ─── Field history ──────────────────────────────────────────────────────────
  get_field_history: async (a) => json({ history: await getStore().getFieldHistory(a.contact_id as string, a.field_name as string | undefined) }),

  get_contact_at: async (a) => {
    const snapshot = await getStore().getContactAt(a.contact_id as string, a.timestamp as string);
    return json({ contact_id: a.contact_id, timestamp: a.timestamp, snapshot });
  },

  // ─── Job history ────────────────────────────────────────────────────────────
  get_job_history: async (a) => json({ history: await getStore().getJobHistory(a.contact_id as string) }),

  add_job_entry: async (a) =>
    json(await getStore().addJobEntry(a.contact_id as string, {
      company_name: a.company_name as string,
      title: a.title as string | undefined,
      start_date: a.start_date as string | undefined,
      end_date: a.end_date as string | undefined,
      is_current: a.is_current as boolean | undefined,
    })),

  // ─── Learnings ──────────────────────────────────────────────────────────────
  save_learning: async (a) => {
    const input: CreateLearningInput = {
      content: a.content as string,
      type: a.type as CreateLearningInput["type"] | undefined,
      confidence: a.confidence as number | undefined,
      importance: a.importance as number | undefined,
      learned_by: a.learned_by as string | undefined,
      visibility: a.visibility as CreateLearningInput["visibility"] | undefined,
      tags: a.tags as string[] | undefined,
    };
    return json(await getStore().saveLearning(a.contact_id as string, input));
  },

  get_learnings: async (a) =>
    json({ learnings: await getStore().getLearnings(a.contact_id as string, {
      type: a.type as string | undefined,
      min_importance: a.min_importance as number | undefined,
    }) }),

  search_learnings: async (a) =>
    json({ results: await getStore().searchLearnings(a.query as string, {
      type: a.type as string | undefined,
      contact_id: a.contact_id as string | undefined,
    }) }),

  confirm_learning: async (a) => {
    await getStore().confirmLearning(a.learning_id as string, a.agent_name as string);
    return json({ confirmed: true });
  },

  get_stale_learnings: async (a) =>
    json({ stale_learnings: await getStore().getStaleLearnings((a.days_old as number | undefined) ?? 30, (a.min_confidence as number | undefined) ?? 0) }),

  run_learning_maintenance: async () => json(await getStore().runLearningMaintenance()),

  // ─── Coordination (locks) ──────────────────────────────────────────────────
  acquire_contact_lock: async (a) =>
    json(await getStore().acquireContactLock(
      a.contact_id as string,
      a.agent_name as string,
      a.ttl_seconds as number | undefined,
      a.reason as string | undefined,
      a.session_id as string | undefined,
    )),

  release_contact_lock: async (a) =>
    json({ released: await getStore().releaseContactLock(a.contact_id as string, a.agent_name as string) }),

  check_contact_lock: async (a) => {
    const lock = await getStore().checkContactLock(a.contact_id as string);
    return json({ locked: !!lock, lock });
  },

  log_agent_activity: async (a) => {
    await getStore().logAgentActivity(
      a.contact_id as string,
      a.agent_name as string,
      a.action as string,
      a.details as string | undefined,
      a.session_id as string | undefined,
    );
    return json({ logged: true });
  },

  get_contact_agent_activity: async (a) =>
    json({ activity: await getStore().getAgentActivity(a.contact_id as string, (a.limit as number | undefined) ?? 20) }),

  // ─── Graph / relationship intelligence ─────────────────────────────────────
  get_relationship_strength: async (a) =>
    json({ contact_id: a.contact_id, strength_score: await getStore().computeRelationshipStrength(a.contact_id as string) }),

  find_warm_path: async (a) => {
    const path = await getStore().findWarmPath(a.from_contact_id as string, a.to_contact_id as string);
    return json({ path, hops: path.length });
  },

  find_connections_at_company: async (a) =>
    json({ connections: await getStore().findConnectionsAtCompany(a.company_id as string) }),

  get_cooling_relationships: async () => json({ cooling: await getStore().detectCoolingRelationships() }),

  // ─── Identity resolution ───────────────────────────────────────────────────
  resolve_contact_identity: async (a) =>
    json({ matches: await getStore().resolveContactIdentity({
      email: a.email as string | undefined,
      name: a.name as string | undefined,
      linkedin_url: a.linkedin_url as string | undefined,
      phone: a.phone as string | undefined,
    }) }),

  add_contact_identity: async (a) =>
    json(await getStore().addContactIdentity(
      a.contact_id as string,
      a.system as string,
      a.external_id as string,
      a.external_url as string | undefined,
      (a.confidence as "verified" | "inferred" | undefined) ?? "inferred",
    )),

  get_contact_identities: async (a) => json({ identities: await getStore().getContactIdentities(a.contact_id as string) }),

  // ─── Embeddings / semantic search ──────────────────────────────────────────
  semantic_search_contacts: async (a) => {
    const store = getStore();
    const results = await store.semanticSearch(a.query as string, (a.limit as number | undefined) ?? 10);
    const enriched = [];
    for (const r of results) {
      try {
        enriched.push({ ...r, contact: await store.getContact(r.contact_id) });
      } catch {
        enriched.push(r);
      }
    }
    return json({ results: enriched });
  },

  embed_all_contacts: async () => json({ embedded: await getStore().embedAllContacts() }),

  // ─── Signals ───────────────────────────────────────────────────────────────
  get_relationship_signals: async (a) => json({ signals: await getStore().getRelationshipSignals(a.contact_id as string) }),

  get_ghost_contacts: async () => json({ ghosts: await getStore().getGhostContacts() }),

  get_warming_contacts: async () => json({ warming: await getStore().getWarmingContacts() }),

  recompute_signals: async () => json(await getStore().recomputeSignals()),

  // ─── Context / briefs ──────────────────────────────────────────────────────
  get_contact_card: async (a) => json(await getStore().getContactCard(a.contact_id as string)),

  get_contact_brief: async (a) => {
    const store = getStore();
    const taskContext = (a.task_context as string | undefined) ?? (a.format as string | undefined);
    if (taskContext) {
      return json(await store.getContactBrief(a.contact_id as string, taskContext));
    }
    return json({ brief: await store.generateBrief(a.contact_id as string) });
  },

  assemble_context: async (a) =>
    json(await getStore().assembleContext(
      a.contact_ids as string[],
      ((a.format as string | undefined) ?? "meeting_prep") as
        | "meeting_prep"
        | "deal_review"
        | "outreach"
        | "research",
    )),

  // ─── Signature parsing / email ingestion ───────────────────────────────────
  parse_email_signature: (a) => json(parseEmailSignature(a.signature_text as string)),

  ingest_email_participants: async (a) => {
    const store = getStore();
    const participants = a.participants as Array<{
      name?: string;
      email: string;
      signature?: string;
    }>;
    const extracted = extractContactsFromEmailThread(participants);
    let created = 0;
    let updated = 0;
    const contacts: unknown[] = [];
    for (const ci of extracted) {
      try {
        const result = await store.findOrCreateContact({
          display_name: ci.display_name,
          job_title: ci.job_title,
          website: ci.website,
          emails: ci.emails?.map((e) => ({
            address: e.address,
            type: e.type as import("../../types/index.js").EmailType,
            is_primary: e.is_primary,
          })),
          phones: ci.phones?.map((p) => ({
            number: p.number,
            type: p.type as import("../../types/index.js").PhoneType,
            is_primary: p.is_primary,
          })),
          social_profiles: ci.social_profiles?.map((s) => ({
            platform: "linkedin" as const,
            url: s.url,
            is_primary: s.is_primary,
          })),
          source: "import" as const,
        });
        contacts.push(result.contact);
        if (result.created) created++;
        else updated++;
      } catch {
        /* skip */
      }
    }
    return json({ created, updated, contacts });
  },

  // ─── Meeting capture ───────────────────────────────────────────────────────
  ingest_meeting_participants: async (a) =>
    json(await getStore().ingestMeetingParticipants({
      title: a.title as string,
      event_date: a.event_date as string,
      attendees: a.attendees as Array<{ name: string; email: string }>,
      context: a.context as string | undefined,
    })),

  // ─── Freshness ─────────────────────────────────────────────────────────────
  get_freshness_score: async (a) => json(await getStore().getFreshnessScore(a.contact_id as string)),

  get_stale_contacts: async (a) => json({ contacts: await getStore().getStaleContacts((a.threshold as number | undefined) ?? 40) }),

  mark_field_verified: async (a) => {
    await getStore().markFieldVerified(a.contact_id as string, a.field_name as string, a.source as string | undefined);
    return json({ verified: true });
  },

  // ─── Org chart ─────────────────────────────────────────────────────────────
  add_org_chart_edge: async (a) =>
    json(await getStore().addOrgChartEdge(
      a.company_id as string,
      a.contact_a_id as string,
      a.contact_b_id as string,
      a.edge_type as OrgEdgeType,
      false,
    )),

  get_org_chart: async (a) => json({ company_id: a.company_id, edges: await getStore().listOrgChart(a.company_id as string) }),

  // ─── Deal teams ────────────────────────────────────────────────────────────
  set_deal_contact_role: async (a) =>
    json(await getStore().setDealContactRole(a.deal_id as string, a.contact_id as string, a.account_role as AccountRole)),

  get_deal_team: async (a) => json({ deal_id: a.deal_id, team: await getStore().getDealTeam(a.deal_id as string) }),

  get_coverage_gaps: async (a) => json(await getStore().getCoverageGaps(a.company_id as string)),

  // ─── Recent events ─────────────────────────────────────────────────────────
  get_recent_contact_events: async (a) =>
    json({ events: await getStore().getRecentContactEvents(a.since as string | undefined, a.event_types as string[] | undefined) }),

  // ─── Image management ─────────────────────────────────────────────────────
  set_contact_photo: async (a) => {
    const store = getStore();
    const { contact_id, image, format } = a as { contact_id: string; image: string; format?: string };
    await store.getContact(contact_id);
    const filename = await store.saveImage(contact_id, image, { format });
    const avatarUrl = filename;
    await store.updateContact(contact_id, { avatar_url: avatarUrl });
    return json({ ok: true, contact_id, filename, avatar_url: avatarUrl });
  },

  get_contact_photo: async (a) => {
    const { contact_id } = a as { contact_id: string };
    const dataUri = await getStore().getImageAsBase64(contact_id);
    if (!dataUri) return json({ contact_id, has_photo: false, data: null });
    return json({ contact_id, has_photo: true, data: dataUri });
  },

  delete_contact_photo: async (a) => {
    const store = getStore();
    const { contact_id } = a as { contact_id: string };
    const deleted = await store.deleteImage(contact_id);
    if (deleted) await store.updateContact(contact_id, { avatar_url: null });
    return json({ ok: true, deleted });
  },

  set_company_logo: async (a) => {
    const store = getStore();
    const { company_id, image, format } = a as { company_id: string; image: string; format?: string };
    await store.getCompany(company_id);
    const filename = await store.saveImage(company_id, image, { format });
    const logoUrl = filename;
    await store.updateCompany(company_id, { logo_url: logoUrl });
    return json({ ok: true, company_id, filename, logo_url: logoUrl });
  },

  get_company_logo: async (a) => {
    const { company_id } = a as { company_id: string };
    const dataUri = await getStore().getImageAsBase64(company_id);
    if (!dataUri) return json({ company_id, has_logo: false, data: null });
    return json({ company_id, has_logo: true, data: dataUri });
  },

  delete_company_logo: async (a) => {
    const store = getStore();
    const { company_id } = a as { company_id: string };
    const deleted = await store.deleteImage(company_id);
    if (deleted) await store.updateCompany(company_id, { logo_url: null });
    return json({ ok: true, deleted });
  },

  // ─── Sensitivity ───────────────────────────────────────────────────────────
  set_sensitivity: async (a) => {
    await getStore().updateContact(a.contact_id as string, {
      sensitivity: a.sensitivity as "normal" | "confidential" | "restricted",
    });
    return json({ ok: true, contact_id: a.contact_id, sensitivity: a.sensitivity });
  },

  // ─── Vault ─────────────────────────────────────────────────────────────────
  vault_init: async (a) => {
    await getStore().initVault(a.passphrase as string);
    return json({ ok: true, message: "Vault initialized and unlocked" });
  },

  vault_unlock: async (a) => {
    const ok = await getStore().unlockVault(a.passphrase as string);
    if (!ok) return { content: [{ type: "text", text: "Invalid passphrase" }], isError: true };
    return json({ ok: true, message: "Vault unlocked" });
  },

  vault_lock: async () => {
    await getStore().lockVault();
    return json({ ok: true, message: "Vault locked" });
  },

  vault_status: async () => {
    const status = await getStore().vaultStatus();
    return json({ initialized: status.initialized, unlocked: status.unlocked, document_count: status.document_count });
  },

  // ─── Documents ─────────────────────────────────────────────────────────────
  add_document: async (a) =>
    json(await getStore().addDocument({
      contact_id: a.contact_id as string,
      doc_type: a.doc_type as DocumentType,
      label: a.label as string | undefined,
      value: a.value as string,
      file_path: a.file_path as string | undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
      expires_at: a.expires_at as string | undefined,
    })),

  list_documents: async (a) => json(await getStore().listDocuments(a.contact_id as string)),

  get_document: async (a) => json(await getStore().getDocument(a.document_id as string)),

  get_document_file: async (a) => {
    const filePath = await getStore().getDocumentFilePath(a.document_id as string);
    return json({ document_id: a.document_id, file_path: filePath, has_file: !!filePath });
  },

  delete_document: async (a) => {
    await getStore().deleteDocument(a.document_id as string);
    return json({ deleted: true });
  },

  scan_document: async (a) => {
    const store = getStore();
    const result = await scanDocument(a.image as string, a.doc_type as string | undefined);
    if (a.auto_save && a.contact_id && (await store.isVaultUnlocked())) {
      try {
        const doc = await store.addDocument({
          contact_id: a.contact_id as string,
          doc_type: (result.document_type as DocumentType) || "other",
          label: `Scanned ${result.document_type}`,
          value: JSON.stringify(result.fields),
          metadata: { raw_text: result.raw_text, confidence: result.confidence },
        });
        return json({ scan: result, saved_document: doc });
      } catch (saveErr) {
        return json({ scan: result, save_error: saveErr instanceof Error ? saveErr.message : String(saveErr) });
      }
    }
    return json(result);
  },

  // ─── Health data ───────────────────────────────────────────────────────────
  set_health_data: async (a) =>
    json(await getStore().setHealthData(a.contact_id as string, {
      blood_type: a.blood_type as string | undefined,
      allergies: a.allergies as string[] | undefined,
      medical_conditions: a.medical_conditions as string[] | undefined,
      medications: a.medications as string[] | undefined,
      emergency_contacts: a.emergency_contacts as SetHealthInput["emergency_contacts"],
      health_insurance_provider: a.health_insurance_provider as string | undefined,
      health_insurance_id: a.health_insurance_id as string | undefined,
      primary_physician: a.primary_physician as string | undefined,
      primary_physician_phone: a.primary_physician_phone as string | undefined,
      organ_donor: a.organ_donor as boolean | undefined,
      notes: a.notes as string | undefined,
    })),

  get_health_data: async (a) => json(await getStore().getHealthData(a.contact_id as string)),

  delete_health_data: async (a) => {
    await getStore().deleteHealthData(a.contact_id as string);
    return json({ deleted: true });
  },

  // ─── Feedback ──────────────────────────────────────────────────────────────
  send_feedback: async (a) => {
    await getStore().saveFeedback(
      a.message as string,
      (a.email as string) || null,
      (a.category as string) || "general",
      "0.1.0",
    );
    return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
  },

  // ─── Agent registry (in-memory, no storage) ─────────────────────────────────
  register_agent: (a) => {
    const n = String(a.name ?? "");
    const existing = [..._contactsAgents.values()].find((x) => x.name === n);
    if (existing) {
      existing.last_seen_at = new Date().toISOString();
      if (a.session_id) existing.session_id = String(a.session_id);
      return json(existing);
    }
    const id = Math.random().toString(36).slice(2, 10);
    const ag: _ContactsAgent = {
      id,
      name: n,
      session_id: a.session_id ? String(a.session_id) : undefined,
      last_seen_at: new Date().toISOString(),
    };
    _contactsAgents.set(id, ag);
    return json(ag);
  },

  heartbeat: (a) => {
    const ag = _contactsAgents.get(String(a.agent_id ?? ""));
    if (!ag)
      return { content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }], isError: true };
    ag.last_seen_at = new Date().toISOString();
    return json({ agent_id: ag.id, last_seen_at: ag.last_seen_at });
  },

  set_focus: (a) => {
    const ag = _contactsAgents.get(String(a.agent_id ?? ""));
    if (!ag)
      return { content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }], isError: true };
    ag.project_id = a.project_id ? String(a.project_id) : undefined;
    return json({ agent_id: ag.id, project_id: ag.project_id ?? null });
  },

  list_agents: () => json([..._contactsAgents.values()]),
};
