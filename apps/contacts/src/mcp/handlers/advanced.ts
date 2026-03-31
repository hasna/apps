/**
 * Advanced / intelligence handlers: field history, job history, learnings,
 * coordination (locks), graph, identity, embeddings, signals, freshness,
 * org chart, deal teams, context, signatures, meeting capture, images,
 * vault, documents, health, feedback, and agent registry.
 */
import type { ToolHandler } from "./types.js";
import { getDatabase } from "../../db/database.js";
import { getContact, updateContact } from "../../db/contacts.js";
import { getCompany, updateCompany } from "../../db/companies.js";
import { getFieldHistory, getContactAt } from "../../db/field-history.js";
import { addJobEntry, getJobHistory } from "../../db/job-history.js";
import {
  saveLearning,
  getLearnings,
  searchLearnings,
  confirmLearning,
  decayLearnings,
} from "../../db/learnings.js";
import type { CreateLearningInput } from "../../db/learnings.js";
import {
  acquireLock,
  releaseLock,
  checkLock,
  logAgentActivity,
  getAgentActivity,
} from "../../db/coordination.js";
import {
  computeRelationshipStrength,
  findWarmPath,
  findConnectionsAtCompany,
  detectCoolingRelationships,
} from "../../db/graph.js";
import { resolveByPartial, addIdentity, getIdentities } from "../../db/identity.js";
import { semanticSearch, embedAllContacts } from "../../lib/embeddings.js";
import {
  getRelationshipSignals,
  getGhostContacts,
  getWarmingContacts,
  recomputeAllSignals,
} from "../../db/signals.js";
import {
  getContactCard,
  getContactBrief as getContactBriefContext,
  assembleContext,
} from "../../lib/context.js";
import {
  parseEmailSignature,
  extractContactsFromEmailThread,
} from "../../lib/signature-parser.js";
import { ingestMeetingParticipants } from "../../lib/meeting-capture.js";
import { getFreshnessScore, getStaleContacts, markFieldVerified } from "../../db/freshness.js";
import {
  addOrgChartEdge,
  listOrgChart,
  setDealContactRole,
  getDealTeam,
  getCoverageGaps,
} from "../../db/org-chart.js";
import type { OrgEdgeType, AccountRole } from "../../db/org-chart.js";
import { saveImage, getImageAsBase64, deleteImage } from "../../lib/images.js";
import { initVault, unlockVault, lockVault, isVaultUnlocked, isVaultInitialized } from "../../lib/vault.js";
import { addDocument, getDocument, listDocuments, deleteDocument } from "../../db/documents.js";
import type { DocumentType } from "../../db/documents.js";
import { setHealthData, getHealthData, deleteHealthData } from "../../db/health.js";
import type { SetHealthInput } from "../../db/health.js";
import { scanDocument } from "../../lib/document-scanner.js";
import { generateBrief } from "../../lib/brief.js";
import { addNote } from "../../db/notes.js";
import { listOverdueTasks } from "../../db/contact-tasks.js";

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
  get_field_history: (a) => {
    const db = getDatabase();
    const history = getFieldHistory(a.contact_id as string, a.field_name as string | undefined, db);
    return json({ history });
  },

  get_contact_at: (a) => {
    const db = getDatabase();
    const snapshot = getContactAt(a.contact_id as string, a.timestamp as string, db);
    return json({ contact_id: a.contact_id, timestamp: a.timestamp, snapshot });
  },

  // ─── Job history ────────────────────────────────────────────────────────────
  get_job_history: (a) => {
    const db = getDatabase();
    const history = getJobHistory(a.contact_id as string, db);
    return json({ history });
  },

  add_job_entry: (a) => {
    const db = getDatabase();
    const entry = addJobEntry(
      a.contact_id as string,
      {
        company_name: a.company_name as string,
        title: a.title as string | undefined,
        start_date: a.start_date as string | undefined,
        end_date: a.end_date as string | undefined,
        is_current: a.is_current as boolean | undefined,
      },
      db,
    );
    return json(entry);
  },

  // ─── Learnings ──────────────────────────────────────────────────────────────
  save_learning: (a) => {
    const db = getDatabase();
    const input: CreateLearningInput = {
      content: a.content as string,
      type: a.type as CreateLearningInput["type"] | undefined,
      confidence: a.confidence as number | undefined,
      importance: a.importance as number | undefined,
      learned_by: a.learned_by as string | undefined,
      visibility: a.visibility as CreateLearningInput["visibility"] | undefined,
      tags: a.tags as string[] | undefined,
    };
    const learning = saveLearning(a.contact_id as string, input, db);
    return json(learning);
  },

  get_learnings: (a) => {
    const db = getDatabase();
    const learnings = getLearnings(a.contact_id as string, {
      type: a.type as string | undefined,
      min_importance: a.min_importance as number | undefined,
    }, db);
    return json({ learnings });
  },

  search_learnings: (a) => {
    const db = getDatabase();
    const results = searchLearnings(a.query as string, {
      type: a.type as string | undefined,
      contact_id: a.contact_id as string | undefined,
    }, db);
    return json({ results });
  },

  confirm_learning: (a) => {
    const db = getDatabase();
    confirmLearning(a.learning_id as string, a.agent_name as string, db);
    return json({ confirmed: true });
  },

  get_stale_learnings: (a) => {
    const db = getDatabase();
    const daysOld = (a.days_old as number | undefined) ?? 30;
    const minConf = (a.min_confidence as number | undefined) ?? 0;
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    const rows = db
      .query(
        `SELECT * FROM contact_learnings WHERE confirmed_count=0 AND created_at<? AND confidence>=? ORDER BY confidence ASC LIMIT 50`,
      )
      .all(cutoff, minConf) as unknown[];
    return json({ stale_learnings: rows });
  },

  run_learning_maintenance: (a) => {
    const db = getDatabase();
    const decayed = decayLearnings(db);
    const duplicates = db
      .query(
        `SELECT contact_id, COUNT(*) as cnt FROM contact_learnings GROUP BY contact_id, LOWER(SUBSTR(content,1,30)) HAVING cnt > 1`,
      )
      .all() as unknown[];
    return json({ decayed_count: decayed, potential_contradictions: duplicates });
  },

  // ─── Coordination (locks) ──────────────────────────────────────────────────
  acquire_contact_lock: (a) => {
    const db = getDatabase();
    const result = acquireLock(
      a.contact_id as string,
      a.agent_name as string,
      a.ttl_seconds as number | undefined,
      a.reason as string | undefined,
      a.session_id as string | undefined,
      db,
    );
    return json(result);
  },

  release_contact_lock: (a) => {
    const db = getDatabase();
    const released = releaseLock(a.contact_id as string, a.agent_name as string, db);
    return json({ released });
  },

  check_contact_lock: (a) => {
    const db = getDatabase();
    const lock = checkLock(a.contact_id as string, db);
    return json({ locked: !!lock, lock });
  },

  log_agent_activity: (a) => {
    const db = getDatabase();
    logAgentActivity(
      a.contact_id as string,
      a.agent_name as string,
      a.action as string,
      a.details as string | undefined,
      a.session_id as string | undefined,
      db,
    );
    return json({ logged: true });
  },

  get_contact_agent_activity: (a) => {
    const db = getDatabase();
    const activity = getAgentActivity(a.contact_id as string, (a.limit as number | undefined) ?? 20, db);
    return json({ activity });
  },

  // ─── Graph / relationship intelligence ─────────────────────────────────────
  get_relationship_strength: (a) => {
    const db = getDatabase();
    const score = computeRelationshipStrength(a.contact_id as string, db);
    return json({ contact_id: a.contact_id, strength_score: score });
  },

  find_warm_path: (a) => {
    const db = getDatabase();
    const path = findWarmPath(a.from_contact_id as string, a.to_contact_id as string, db);
    return json({ path, hops: path.length });
  },

  find_connections_at_company: (a) => {
    const db = getDatabase();
    const connections = findConnectionsAtCompany(a.company_id as string, db);
    return json({ connections });
  },

  get_cooling_relationships: (a) => {
    const db = getDatabase();
    const cooling = detectCoolingRelationships(db);
    return json({ cooling });
  },

  // ─── Identity resolution ───────────────────────────────────────────────────
  resolve_contact_identity: (a) => {
    const db = getDatabase();
    const matches = resolveByPartial(
      {
        email: a.email as string | undefined,
        name: a.name as string | undefined,
        linkedin_url: a.linkedin_url as string | undefined,
        phone: a.phone as string | undefined,
      },
      db,
    );
    return json({ matches });
  },

  add_contact_identity: (a) => {
    const db = getDatabase();
    const identity = addIdentity(
      a.contact_id as string,
      a.system as string,
      a.external_id as string,
      a.external_url as string | undefined,
      (a.confidence as "verified" | "inferred" | undefined) ?? "inferred",
      db,
    );
    return json(identity);
  },

  get_contact_identities: (a) => {
    const db = getDatabase();
    const identities = getIdentities(a.contact_id as string, db);
    return json({ identities });
  },

  // ─── Embeddings / semantic search ──────────────────────────────────────────
  semantic_search_contacts: (a) => {
    const db = getDatabase();
    const results = semanticSearch(a.query as string, (a.limit as number | undefined) ?? 10, db);
    const enriched = results.map((r) => {
      try {
        return { ...r, contact: getContact(r.contact_id) };
      } catch {
        return r;
      }
    });
    return json({ results: enriched });
  },

  embed_all_contacts: async (a) => {
    const db = getDatabase();
    const count = await embedAllContacts(db);
    return json({ embedded: count });
  },

  // ─── Signals ───────────────────────────────────────────────────────────────
  get_relationship_signals: (a) => {
    const db = getDatabase();
    const signals = getRelationshipSignals(a.contact_id as string, db);
    return json({ signals });
  },

  get_ghost_contacts: (a) => {
    const db = getDatabase();
    const ghosts = getGhostContacts(db);
    return json({ ghosts });
  },

  get_warming_contacts: (a) => {
    const db = getDatabase();
    const warming = getWarmingContacts(db);
    return json({ warming });
  },

  recompute_signals: (a) => {
    const db = getDatabase();
    const result = recomputeAllSignals(db);
    return json(result);
  },

  // ─── Context / briefs ──────────────────────────────────────────────────────
  get_contact_card: (a) => {
    const db = getDatabase();
    const card = getContactCard(a.contact_id as string, db);
    return json(card);
  },

  get_contact_brief: (a) => {
    const db = getDatabase();
    const taskContext = (a.task_context as string | undefined) ?? (a.format as string | undefined);
    if (taskContext) {
      const brief = getContactBriefContext(a.contact_id as string, taskContext, db);
      return json(brief);
    }
    const brief = generateBrief(a.contact_id as string, db);
    return json({ brief });
  },

  assemble_context: async (a) => {
    const db = getDatabase();
    const ctx = await assembleContext(
      a.contact_ids as string[],
      ((a.format as string | undefined) ?? "meeting_prep") as
        | "meeting_prep"
        | "deal_review"
        | "outreach"
        | "research",
      db,
    );
    return json(ctx);
  },

  // ─── Signature parsing / email ingestion ───────────────────────────────────
  parse_email_signature: (a) => {
    const parsed = parseEmailSignature(a.signature_text as string);
    return json(parsed);
  },

  ingest_email_participants: async (a) => {
    const db = getDatabase();
    const participants = a.participants as Array<{
      name?: string;
      email: string;
      signature?: string;
    }>;
    const extracted = extractContactsFromEmailThread(participants);
    let created = 0;
    let updated = 0;
    const contacts: unknown[] = [];
    const { findOrCreateContact: findOrCreate } = await import("../../db/contacts.js");
    for (const ci of extracted) {
      try {
        const result = await findOrCreate(
          {
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
          },
          db,
        );
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
  ingest_meeting_participants: async (a) => {
    const db = getDatabase();
    const result = await ingestMeetingParticipants(
      {
        title: a.title as string,
        event_date: a.event_date as string,
        attendees: a.attendees as Array<{ name: string; email: string }>,
        context: a.context as string | undefined,
      },
      db,
    );
    return json(result);
  },

  // ─── Freshness ─────────────────────────────────────────────────────────────
  get_freshness_score: (a) => {
    const db = getDatabase();
    const score = getFreshnessScore(a.contact_id as string, db);
    return json(score);
  },

  get_stale_contacts: (a) => {
    const db = getDatabase();
    const contacts = getStaleContacts((a.threshold as number | undefined) ?? 40, db);
    return json({ contacts });
  },

  mark_field_verified: (a) => {
    const db = getDatabase();
    markFieldVerified(a.contact_id as string, a.field_name as string, a.source as string | undefined, db);
    return json({ verified: true });
  },

  // ─── Org chart ─────────────────────────────────────────────────────────────
  add_org_chart_edge: (a) => {
    const db = getDatabase();
    const edge = addOrgChartEdge(
      a.company_id as string,
      a.contact_a_id as string,
      a.contact_b_id as string,
      a.edge_type as OrgEdgeType,
      false,
      db,
    );
    return json(edge);
  },

  get_org_chart: (a) => {
    const db = getDatabase();
    const edges = listOrgChart(a.company_id as string, db);
    return json({ company_id: a.company_id, edges });
  },

  // ─── Deal teams ────────────────────────────────────────────────────────────
  set_deal_contact_role: (a) => {
    const db = getDatabase();
    const role = setDealContactRole(
      a.deal_id as string,
      a.contact_id as string,
      a.account_role as AccountRole,
      db,
    );
    return json(role);
  },

  get_deal_team: (a) => {
    const db = getDatabase();
    const team = getDealTeam(a.deal_id as string, db);
    return json({ deal_id: a.deal_id, team });
  },

  get_coverage_gaps: (a) => {
    const db = getDatabase();
    const gaps = getCoverageGaps(a.company_id as string, db);
    return json(gaps);
  },

  // ─── Recent events ─────────────────────────────────────────────────────────
  get_recent_contact_events: (a) => {
    const db = getDatabase();
    const since = a.since as string | undefined;
    const eventTypes = a.event_types as string[] | undefined;
    let sql = `SELECT * FROM activity_log WHERE 1=1`;
    const params: string[] = [];
    if (since) {
      sql += ` AND created_at >= ?`;
      params.push(since);
    }
    if (eventTypes?.length) {
      sql += ` AND action IN (${eventTypes.map(() => "?").join(",")})`;
      params.push(...eventTypes);
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const events = db.query(sql).all(...params) as unknown[];
    return json({ events });
  },

  // ─── Image management ─────────────────────────────────────────────────────
  set_contact_photo: (a) => {
    const { contact_id, image, format } = a as {
      contact_id: string;
      image: string;
      format?: string;
    };
    getContact(contact_id);
    const filename = saveImage(contact_id, image, { format });
    updateContact(contact_id, { avatar_url: `~/.hasna/contacts/images/${filename}` });
    return json({
      ok: true,
      contact_id,
      filename,
      avatar_url: `~/.hasna/contacts/images/${filename}`,
    });
  },

  get_contact_photo: (a) => {
    const { contact_id } = a as { contact_id: string };
    const dataUri = getImageAsBase64(contact_id);
    if (!dataUri) return json({ contact_id, has_photo: false, data: null });
    return json({ contact_id, has_photo: true, data: dataUri });
  },

  delete_contact_photo: (a) => {
    const { contact_id } = a as { contact_id: string };
    const deleted = deleteImage(contact_id);
    if (deleted) updateContact(contact_id, { avatar_url: null });
    return json({ ok: true, deleted });
  },

  set_company_logo: (a) => {
    const { company_id, image, format } = a as {
      company_id: string;
      image: string;
      format?: string;
    };
    getCompany(company_id);
    const filename = saveImage(company_id, image, { format });
    updateCompany(company_id, { logo_url: `~/.hasna/contacts/images/${filename}` });
    return json({
      ok: true,
      company_id,
      filename,
      logo_url: `~/.hasna/contacts/images/${filename}`,
    });
  },

  get_company_logo: (a) => {
    const { company_id } = a as { company_id: string };
    const dataUri = getImageAsBase64(company_id);
    if (!dataUri) return json({ company_id, has_logo: false, data: null });
    return json({ company_id, has_logo: true, data: dataUri });
  },

  delete_company_logo: (a) => {
    const { company_id } = a as { company_id: string };
    const deleted = deleteImage(company_id);
    if (deleted) updateCompany(company_id, { logo_url: null });
    return json({ ok: true, deleted });
  },

  // ─── Sensitivity ───────────────────────────────────────────────────────────
  set_sensitivity: (a) => {
    updateContact(a.contact_id as string, {
      sensitivity: a.sensitivity as "normal" | "confidential" | "restricted",
    });
    return json({ ok: true, contact_id: a.contact_id, sensitivity: a.sensitivity });
  },

  // ─── Vault ─────────────────────────────────────────────────────────────────
  vault_init: (a) => {
    initVault(a.passphrase as string);
    return json({ ok: true, message: "Vault initialized and unlocked" });
  },

  vault_unlock: (a) => {
    const ok = unlockVault(a.passphrase as string);
    if (!ok) return { content: [{ type: "text", text: "Invalid passphrase" }], isError: true };
    return json({ ok: true, message: "Vault unlocked" });
  },

  vault_lock: () => {
    lockVault();
    return json({ ok: true, message: "Vault locked" });
  },

  vault_status: () => {
    const initialized = isVaultInitialized();
    const unlocked = isVaultUnlocked();
    const db = getDatabase();
    let docCount = 0;
    try {
      docCount = (db.query("SELECT COUNT(*) as n FROM contact_documents").get() as { n: number }).n;
    } catch {
      /* table may not exist */
    }
    return json({ initialized, unlocked, document_count: docCount });
  },

  // ─── Documents ─────────────────────────────────────────────────────────────
  add_document: (a) => {
    const doc = addDocument({
      contact_id: a.contact_id as string,
      doc_type: a.doc_type as DocumentType,
      label: a.label as string | undefined,
      value: a.value as string,
      file_path: a.file_path as string | undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
      expires_at: a.expires_at as string | undefined,
    });
    return json(doc);
  },

  list_documents: (a) => {
    const docs = listDocuments(a.contact_id as string);
    return json(docs);
  },

  get_document: (a) => {
    const doc = getDocument(a.document_id as string);
    return json(doc);
  },

  get_document_file: (a) => {
    const db = getDatabase();
    const row = db
      .query(`SELECT encrypted_file_path FROM contact_documents WHERE id = ?`)
      .get(a.document_id as string) as { encrypted_file_path: string | null } | null;
    if (!row)
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Document not found" }) }],
        isError: true,
      };
    const filePath = row.encrypted_file_path;
    return json({ document_id: a.document_id, file_path: filePath, has_file: !!filePath });
  },

  delete_document: (a) => {
    deleteDocument(a.document_id as string);
    return json({ deleted: true });
  },

  scan_document: async (a) => {
    const result = await scanDocument(a.image as string, a.doc_type as string | undefined);
    if (a.auto_save && a.contact_id && isVaultUnlocked()) {
      try {
        const doc = addDocument({
          contact_id: a.contact_id as string,
          doc_type: (result.document_type as DocumentType) || "other",
          label: `Scanned ${result.document_type}`,
          value: JSON.stringify(result.fields),
          metadata: { raw_text: result.raw_text, confidence: result.confidence },
        });
        return json({ scan: result, saved_document: doc });
      } catch (saveErr) {
        return json({
          scan: result,
          save_error: saveErr instanceof Error ? saveErr.message : String(saveErr),
        });
      }
    }
    return json(result);
  },

  // ─── Health data ───────────────────────────────────────────────────────────
  set_health_data: (a) => {
    const health = setHealthData(a.contact_id as string, {
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
    });
    return json(health);
  },

  get_health_data: (a) => {
    const health = getHealthData(a.contact_id as string);
    return json(health);
  },

  delete_health_data: (a) => {
    deleteHealthData(a.contact_id as string);
    return json({ deleted: true });
  },

  // ─── Feedback ──────────────────────────────────────────────────────────────
  send_feedback: (a) => {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
    ).run(
      a.message as string,
      (a.email as string) || null,
      (a.category as string) || "general",
      "0.1.0",
    );
    return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
  },

  // ─── Agent registry ────────────────────────────────────────────────────────
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
      return {
        content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }],
        isError: true,
      };
    ag.last_seen_at = new Date().toISOString();
    return json({ agent_id: ag.id, last_seen_at: ag.last_seen_at });
  },

  set_focus: (a) => {
    const ag = _contactsAgents.get(String(a.agent_id ?? ""));
    if (!ag)
      return {
        content: [{ type: "text", text: `Agent not found: ${a.agent_id}` }],
        isError: true,
      };
    ag.project_id = a.project_id ? String(a.project_id) : undefined;
    return json({ agent_id: ag.id, project_id: ag.project_id ?? null });
  },

  list_agents: () => {
    return json([..._contactsAgents.values()]);
  },
};
