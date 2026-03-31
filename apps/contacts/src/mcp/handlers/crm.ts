/**
 * CRM handlers: gmail import, google contacts sync, workload, org members,
 * vendor communications, contact tasks, applications, entities, cold contacts,
 * upcoming, stats, audit, deals, events, timeline, enrich, context, webhook,
 * bulk tags, DNC, export.
 */
import type { ToolHandler } from "./types.js";
import type {
  CreateContactInput,
  UpdateContactInput,
  CreateOrgMemberInput,
  UpdateOrgMemberInput,
  CreateVendorCommunicationInput,
  CreateContactTaskInput,
  UpdateContactTaskInput,
  CreateApplicationInput,
  UpdateApplicationInput,
  DealStage,
  EventType,
} from "../../types/index.js";
import { getDatabase } from "../../db/database.js";
import {
  createContact,
  getContact,
  updateContact,
  listContacts,
  searchContacts,
  listColdContacts,
  autoLinkContactToCompany,
} from "../../db/contacts.js";
import { getCompany, listCompanies } from "../../db/companies.js";
import {
  addTagToContact,
  removeTagFromContact,
  getTagByName,
} from "../../db/tags.js";
import { listCompanyRelationships } from "../../db/relationships.js";
import { addNote } from "../../db/notes.js";
import { extractContactsFromGmail } from "../../lib/gmail-import.js";
import {
  pullGoogleContactsAsInputs,
  pushContactToGoogle,
  searchGoogleContacts,
  googlePersonToContactInput,
} from "../../lib/google-contacts.js";
import {
  addOrgMember,
  listOrgMembers,
  updateOrgMember,
  removeOrgMember,
  listOrgMembersForContact,
} from "../../db/org-members.js";
import {
  logVendorCommunication,
  listVendorCommunications,
  listMissingInvoices,
  listPendingFollowUps,
  markFollowUpDone,
} from "../../db/vendor-comms.js";
import {
  createContactTask,
  listContactTasks,
  updateContactTask,
  deleteContactTask,
  listOverdueTasks,
  checkEscalations,
} from "../../db/contact-tasks.js";
import {
  createApplication,
  listApplications,
  updateApplication,
  listFollowUpDue as getFollowUpDueApplications,
} from "../../db/applications.js";
import { generateBrief } from "../../lib/brief.js";
import { getUpcomingItems } from "../../lib/upcoming.js";
import { getNetworkStats } from "../../lib/stats.js";
import { listContactAudit } from "../../lib/audit.js";
import {
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  deleteDeal,
} from "../../db/deals.js";
import {
  logEvent,
  listEvents,
  deleteEvent,
} from "../../db/events.js";
import { getContactTimeline } from "../../lib/timeline.js";
import { exportContacts } from "../../lib/export.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const crmHandlers: Record<string, ToolHandler> = {
  import_contacts_from_gmail: async (a) => {
    const db = getDatabase();
    const extracted = await extractContactsFromGmail({
      query: a.query as string,
      max_messages: a.max_messages as number | undefined,
      gmail_profile: a.gmail_profile as string | undefined,
      tag_ids: a.tag_ids as string[] | undefined,
      group_id: a.group_id as string | undefined,
    });

    if (a.dry_run) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ dry_run: true, would_import: extracted.length, contacts: extracted }, null, 2),
        }],
      };
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const { email, contact_input, company_hint } of extracted) {
      try {
        // Check if contact already exists by email
        const emailRow = db.prepare(
          `SELECT contact_id FROM emails WHERE LOWER(address) = LOWER(?) AND contact_id IS NOT NULL LIMIT 1`
        ).get(email) as { contact_id: string } | null;

        if (emailRow) {
          skipped++;
          continue;
        }

        const contact = createContact(contact_input);

        // Add to group if specified
        if (a.group_id && typeof a.group_id === "string") {
          try {
            db.prepare(
              `INSERT OR IGNORE INTO contact_groups (contact_id, group_id) VALUES (?, ?)`
            ).run(contact.id, a.group_id as string);
          } catch {
            // non-fatal
          }
        }

        // Auto-link to company if we have a hint
        if (company_hint) {
          autoLinkContactToCompany(contact.id);
        }

        imported++;
      } catch (err) {
        errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ imported, skipped, errors: errors.length, error_details: errors }, null, 2),
      }],
    };
  },

  sync_from_google_contacts: async (a) => {
    const db = getDatabase();
    const googleProfile = a.google_profile as string | undefined;
    const inputs = await pullGoogleContactsAsInputs({
      query: a.query as string | undefined,
      page_size: a.page_size as number | undefined,
      profile: googleProfile ?? "default",
    });

    // Apply extra fields to each input
    const enriched = inputs.map((inp) => ({
      ...inp,
      ...(a.tag_ids ? { tag_ids: a.tag_ids as string[] } : {}),
      ...(a.project_id ? { project_id: a.project_id as string } : {}),
    }));

    if (a.dry_run) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ dry_run: true, would_import: enriched.length, contacts: enriched }, null, 2),
        }],
      };
    }

    let imported = 0;
    let skipped = 0;
    const syncErrors: string[] = [];

    for (const input of enriched) {
      const primaryEmail = input.emails?.[0]?.address;
      if (!primaryEmail) { skipped++; continue; }

      try {
        const existing = db.prepare(
          `SELECT contact_id FROM emails WHERE LOWER(address) = LOWER(?) AND contact_id IS NOT NULL LIMIT 1`
        ).get(primaryEmail) as { contact_id: string } | null;

        if (existing) { skipped++; continue; }

        createContact(input);
        imported++;
      } catch (err) {
        syncErrors.push(`${primaryEmail}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ imported, skipped, errors: syncErrors.length, error_details: syncErrors }, null, 2),
      }],
    };
  },

  push_contact_to_google: async (a) => {
    const contact = getContact(a.contact_id as string);
    const result = await pushContactToGoogle(contact, {
      profile: (a.google_profile as string | undefined) ?? "default",
      update_existing: a.update_existing as boolean | undefined,
    });
    return { content: [{ type: "text", text: JSON.stringify({ ...result, contact_id: contact.id }, null, 2) }] };
  },

  search_google_contacts: async (a) => {
    const people = await searchGoogleContacts(a.query as string, {
      profile: (a.google_profile as string | undefined) ?? "default",
    });
    const mapped = people.map((p) => ({
      google: p,
      as_contact_input: googlePersonToContactInput(p),
    }));
    return { content: [{ type: "text", text: JSON.stringify(mapped, null, 2) }] };
  },

  get_contact_workload: (a) => {
    const db = getDatabase();
    const { contact_id } = a as { contact_id: string };
    const contact = getContact(contact_id);
    const companyRels = listCompanyRelationships({ contact_id }, db);
    const activeTasks = listContactTasks({ contact_id, status: 'pending' }, db);
    const overdueTasks = listOverdueTasks(db).filter((t: { contact_id: string }) => t.contact_id === contact_id);
    const orgMemberships = listOrgMembersForContact(contact_id, db);
    const daysSince = contact.last_contacted_at
      ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000)
      : null;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          contact,
          company_relationships: companyRels,
          active_tasks: activeTasks,
          overdue_tasks: overdueTasks,
          org_memberships: orgMemberships,
          days_since_last_contact: daysSince,
          total_entities_managed: companyRels.length,
        }, null, 2),
      }],
    };
  },

  list_overdue_contact_tasks: () => {
    const db = getDatabase();
    const overdue = listOverdueTasks(db);
    return { content: [{ type: "text", text: JSON.stringify(overdue, null, 2) }] };
  },

  check_escalations: () => {
    const db = getDatabase();
    const escalations = checkEscalations(db);
    return { content: [{ type: "text", text: JSON.stringify(escalations, null, 2) }] };
  },

  add_org_member: (a) => {
    const db = getDatabase();
    const input: CreateOrgMemberInput = {
      company_id: a.company_id as string,
      contact_id: a.contact_id as string,
      title: a.title as string | undefined,
      specialization: a.specialization as string | undefined,
      office_phone: a.office_phone as string | undefined,
      response_sla_hours: a.response_sla_hours as number | undefined,
      notes: a.notes as string | undefined,
    };
    const member = addOrgMember(input, db);
    return { content: [{ type: "text", text: JSON.stringify(member, null, 2) }] };
  },

  list_org_members: (a) => {
    const db = getDatabase();
    const members = listOrgMembers(a.company_id as string, db);
    return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
  },

  update_org_member: (a) => {
    const db = getDatabase();
    const { id: memberId, ...memberRest } = a;
    const input: UpdateOrgMemberInput = {
      title: memberRest.title as string | null | undefined,
      specialization: memberRest.specialization as string | null | undefined,
      office_phone: memberRest.office_phone as string | null | undefined,
      response_sla_hours: memberRest.response_sla_hours as number | null | undefined,
      notes: memberRest.notes as string | null | undefined,
    };
    const updated = updateOrgMember(memberId as string, input, db);
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  },

  remove_org_member: (a) => {
    const db = getDatabase();
    removeOrgMember(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
  },

  log_vendor_communication: (a) => {
    const db = getDatabase();
    const input: CreateVendorCommunicationInput = {
      company_id: a.company_id as string,
      contact_id: a.contact_id as string | undefined,
      comm_date: (a.comm_date as string | undefined) ?? new Date().toISOString().slice(0, 10),
      type: a.type as CreateVendorCommunicationInput["type"],
      direction: a.direction as CreateVendorCommunicationInput["direction"],
      subject: a.subject as string | undefined,
      body: a.body as string | undefined,
      status: a.status as CreateVendorCommunicationInput["status"],
      invoice_amount: a.invoice_amount as number | undefined,
      invoice_currency: a.invoice_currency as string | undefined,
      invoice_ref: a.invoice_ref as string | undefined,
      follow_up_date: a.follow_up_date as string | undefined,
    };
    const comm = logVendorCommunication(input, db);
    return { content: [{ type: "text", text: JSON.stringify(comm, null, 2) }] };
  },

  list_vendor_communications: (a) => {
    const db = getDatabase();
    const comms = listVendorCommunications(
      a.company_id as string,
      {
        type: a.type as CreateVendorCommunicationInput["type"],
        status: a.status as CreateVendorCommunicationInput["status"],
      },
      db
    );
    return { content: [{ type: "text", text: JSON.stringify(comms, null, 2) }] };
  },

  list_missing_invoices: () => {
    const db = getDatabase();
    const missing = listMissingInvoices(db);
    return { content: [{ type: "text", text: JSON.stringify(missing, null, 2) }] };
  },

  list_pending_followups: () => {
    const db = getDatabase();
    const pending = listPendingFollowUps(db);
    return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
  },

  mark_followup_done: (a) => {
    const db = getDatabase();
    const updated = markFollowUpDone(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  },

  create_contact_task: (a) => {
    const db = getDatabase();
    const input: CreateContactTaskInput = {
      title: a.title as string,
      contact_id: a.contact_id as string,
      description: a.description as string | undefined,
      assigned_by: a.assigned_by as string | undefined,
      deadline: a.deadline as string | undefined,
      priority: a.priority as CreateContactTaskInput["priority"],
      entity_id: a.entity_id as string | undefined,
      escalation_rules: a.escalation_rules as CreateContactTaskInput["escalation_rules"],
      linked_todos_task_id: a.linked_todos_task_id as string | undefined,
    };
    const task = createContactTask(input, db);
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },

  list_contact_tasks: (a) => {
    const db = getDatabase();
    const tasks = listContactTasks({
      contact_id: a.contact_id as string | undefined,
      entity_id: a.entity_id as string | undefined,
      status: a.status as UpdateContactTaskInput["status"],
      priority: a.priority as UpdateContactTaskInput["priority"],
    }, db);
    return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
  },

  update_contact_task: (a) => {
    const db = getDatabase();
    const { id: taskId, ...taskRest } = a;
    const input: UpdateContactTaskInput = {
      title: taskRest.title as string | undefined,
      status: taskRest.status as UpdateContactTaskInput["status"],
      deadline: taskRest.deadline as string | null | undefined,
      priority: taskRest.priority as UpdateContactTaskInput["priority"],
      description: taskRest.description as string | null | undefined,
      escalation_rules: taskRest.escalation_rules as UpdateContactTaskInput["escalation_rules"],
    };
    const updated = updateContactTask(taskId as string, input, db);
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  },

  delete_contact_task: (a) => {
    const db = getDatabase();
    deleteContactTask(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
  },

  create_application: (a) => {
    const db = getDatabase();
    const input: CreateApplicationInput = {
      program_name: a.program_name as string,
      type: a.type as CreateApplicationInput["type"],
      value_usd: a.value_usd as number | undefined,
      provider_company_id: a.provider_company_id as string | undefined,
      primary_contact_id: a.primary_contact_id as string | undefined,
      status: a.status as CreateApplicationInput["status"],
      submitted_date: a.submitted_date as string | undefined,
      follow_up_date: a.follow_up_date as string | undefined,
      notes: a.notes as string | undefined,
      method: a.method as CreateApplicationInput["method"],
      form_url: a.form_url as string | undefined,
    };
    const app = createApplication(input, db);
    return { content: [{ type: "text", text: JSON.stringify(app, null, 2) }] };
  },

  list_applications: (a) => {
    const db = getDatabase();
    const apps = listApplications({
      type: a.type as CreateApplicationInput["type"],
      status: a.status as CreateApplicationInput["status"],
      provider_company_id: a.provider_company_id as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  },

  update_application: (a) => {
    const db = getDatabase();
    const { id: appId, ...appRest } = a;
    const input: UpdateApplicationInput = {
      program_name: appRest.program_name as string | undefined,
      type: appRest.type as UpdateApplicationInput["type"],
      value_usd: appRest.value_usd as number | null | undefined,
      provider_company_id: appRest.provider_company_id as string | null | undefined,
      primary_contact_id: appRest.primary_contact_id as string | null | undefined,
      status: appRest.status as UpdateApplicationInput["status"],
      submitted_date: appRest.submitted_date as string | null | undefined,
      decision_date: appRest.decision_date as string | null | undefined,
      follow_up_date: appRest.follow_up_date as string | null | undefined,
      notes: appRest.notes as string | null | undefined,
      method: appRest.method as UpdateApplicationInput["method"],
      form_url: appRest.form_url as string | null | undefined,
    };
    const updated = updateApplication(appId as string, input, db);
    return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
  },

  get_followup_due_applications: () => {
    const db = getDatabase();
    const apps = getFollowUpDueApplications(db);
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  },

  list_owned_entities: () => {
    const result = listCompanies({ limit: 200 });
    const owned = result.companies.filter((c: { is_owned_entity: boolean }) => c.is_owned_entity);
    return { content: [{ type: "text", text: JSON.stringify(owned, null, 2) }] };
  },

  get_entity_team: (a) => {
    const db = getDatabase();
    const company = getCompany(a.company_id as string);
    const team = listCompanyRelationships({ company_id: a.company_id as string }, db);
    return { content: [{ type: "text", text: JSON.stringify({ company, team }, null, 2) }] };
  },

  list_cold_contacts: (a) => {
    const db = getDatabase();
    const contacts = listColdContacts((a.days as number | undefined) ?? 30, db);
    return { content: [{ type: "text", text: JSON.stringify({ contacts }, null, 2) }] };
  },

  get_upcoming: (a) => {
    const db = getDatabase();
    const items = getUpcomingItems((a.days as number | undefined) ?? 7, db);
    return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
  },

  get_network_stats: () => {
    const db = getDatabase();
    const stats = getNetworkStats(db);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  },

  audit_contacts: async (a) => {
    const db = getDatabase();
    const results = (await listContactAudit(db)).slice(0, (a.limit as number | undefined) ?? 20);
    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
  },

  create_deal: (a) => {
    const db = getDatabase();
    const deal = createDeal({
      title: a.title as string,
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
      stage: a.stage as DealStage | undefined,
      value_usd: a.value_usd as number | undefined,
      currency: a.currency as string | undefined,
      close_date: a.close_date as string | undefined,
      notes: a.notes as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  },

  get_deal: (a) => {
    const db = getDatabase();
    const deal = getDeal(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  },

  list_deals: (a) => {
    const db = getDatabase();
    const deals = listDeals({
      stage: a.stage as DealStage | undefined,
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify({ deals }, null, 2) }] };
  },

  update_deal: (a) => {
    const db = getDatabase();
    const { id: dealId, ...dealRest } = a;
    const deal = updateDeal(dealId as string, {
      title: dealRest.title as string | undefined,
      stage: dealRest.stage as DealStage | undefined,
      value_usd: dealRest.value_usd as number | undefined,
      close_date: dealRest.close_date as string | undefined,
      notes: dealRest.notes as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
  },

  delete_deal: (a) => {
    const db = getDatabase();
    deleteDeal(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
  },

  log_event: (a) => {
    const db = getDatabase();
    const event = logEvent({
      title: a.title as string,
      type: a.type as EventType | undefined,
      event_date: a.event_date as string,
      duration_min: a.duration_min as number | undefined,
      contact_ids: a.contact_ids as string[] | undefined,
      company_id: a.company_id as string | undefined,
      notes: a.notes as string | undefined,
      outcome: a.outcome as string | undefined,
      deal_id: a.deal_id as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
  },

  list_events: (a) => {
    const db = getDatabase();
    const events = listEvents({
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
      type: a.type as EventType | undefined,
      date_from: a.date_from as string | undefined,
      date_to: a.date_to as string | undefined,
    }, db);
    return { content: [{ type: "text", text: JSON.stringify({ events }, null, 2) }] };
  },

  delete_event: (a) => {
    const db = getDatabase();
    deleteEvent(a.id as string, db);
    return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
  },

  get_contact_timeline: (a) => {
    const db = getDatabase();
    const items = getContactTimeline(a.contact_id as string, (a.limit as number | undefined) ?? 50, db);
    return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
  },

  enrich_contact: async (a) => {
    const db = getDatabase();
    const contact = getContact(a.contact_id as string);
    const exaKey = process.env['EXA_API_KEY'];
    if (!exaKey) {
      return { content: [{ type: "text", text: JSON.stringify({ error: 'Set EXA_API_KEY to use enrichment', contact_id: a.contact_id, suggestions: [] }, null, 2) }] };
    }
    const query = `${contact.display_name} ${(contact.emails as Array<{ address: string }> | undefined)?.[0]?.address ?? ''} site:linkedin.com OR site:twitter.com OR site:github.com`;
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': exaKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query, num_results: 5 }),
    });
    const data = await res.json() as { results?: Array<{ url?: string }> };
    const suggestions: Record<string, string> = {};
    const socialProfiles = (contact as unknown as Record<string, unknown>).social_profiles as Array<{ platform: string }> | undefined;
    for (const r of (data.results ?? [])) {
      if (r.url?.includes('linkedin.com') && !socialProfiles?.find(s => s.platform === 'linkedin')) suggestions['linkedin'] = r.url;
      if (r.url?.includes('twitter.com') && !socialProfiles?.find(s => s.platform === 'twitter')) suggestions['twitter'] = r.url;
      if (r.url?.includes('github.com') && !socialProfiles?.find(s => s.platform === 'github')) suggestions['github'] = r.url;
    }
    void db; // db used for getContact above
    return { content: [{ type: "text", text: JSON.stringify({ contact_id: a.contact_id, contact_name: contact.display_name, suggestions, raw_results: data.results?.slice(0, 3) }, null, 2) }] };
  },

  get_contacts_for_context: (a) => {
    const db = getDatabase();
    const { topic, limit = 10 } = a as { topic: string; limit?: number };
    const byTitle = db.query(`SELECT c.id, c.display_name, c.job_title, 'job_title' as reason FROM contacts c WHERE c.job_title LIKE ? AND c.archived=0 LIMIT 20`).all(`%${topic}%`) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const byNotes = db.query(`SELECT c.id, c.display_name, c.job_title, 'notes' as reason FROM contacts c WHERE c.notes LIKE ? AND c.archived=0 LIMIT 10`).all(`%${topic}%`) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const byCompany = db.query(`SELECT c.id, c.display_name, c.job_title, 'company' as reason FROM contacts c JOIN companies co ON c.company_id = co.id WHERE (co.name LIKE ? OR co.industry LIKE ?) AND c.archived=0 LIMIT 10`).all(`%${topic}%`, `%${topic}%`) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const bySpec = db.query(`SELECT c.id, c.display_name, c.job_title, om.specialization as reason FROM contacts c JOIN org_members om ON c.id = om.contact_id WHERE om.specialization LIKE ? LIMIT 10`).all(`%${topic}%`) as Array<{ id: string; display_name: string; job_title: string | null; reason: string }>;
    const seen = new Set<string>();
    const results = [...byTitle, ...bySpec, ...byCompany, ...byNotes].filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, limit);
    return { content: [{ type: "text", text: JSON.stringify({ topic, results }, null, 2) }] };
  },

  set_reminder: (a) => {
    const db = getDatabase();
    updateContact(a.contact_id as string, { follow_up_at: a.remind_at as string });
    if (a.note) {
      addNote(a.contact_id as string, `Reminder (${a.remind_at}): ${a.note}`, undefined, db);
    }
    return { content: [{ type: "text", text: JSON.stringify({ set: true, contact_id: a.contact_id, remind_at: a.remind_at }, null, 2) }] };
  },

  check_and_fire_webhooks: async (a) => {
    const db = getDatabase();
    let webhooks: Array<{ id: string; event_type: string; url: string; secret?: string | null }> = [];
    try {
      webhooks = db.query(`SELECT id, event_type, url, secret FROM webhooks WHERE active=1`).all() as typeof webhooks;
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ fired: [], message: 'webhooks table not available' }, null, 2) }] };
    }
    const today = new Date().toISOString().slice(0, 10);
    const fired: Array<{ webhook_id: string; event_type: string; status: number }> = [];
    for (const wh of webhooks) {
      let payload: Record<string, unknown> | null = null;
      if (wh.event_type === 'contact.stale') {
        const stale = db.query(`SELECT id, display_name, last_contacted_at FROM contacts WHERE (last_contacted_at IS NULL OR last_contacted_at < date('now', '-30 days')) AND archived=0 LIMIT 50`).all() as Array<{ id: string; display_name: string; last_contacted_at: string | null }>;
        if (stale.length > 0) payload = { event: 'contact.stale', contacts: stale, fired_at: new Date().toISOString() };
      } else if (wh.event_type === 'task.overdue') {
        const overdue = listOverdueTasks(db);
        if (overdue.length > 0) payload = { event: 'task.overdue', tasks: overdue, fired_at: new Date().toISOString() };
      } else if (wh.event_type === 'followup.due') {
        const due = db.query(`SELECT id, display_name, follow_up_at FROM contacts WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND archived=0`).all(today) as Array<{ id: string; display_name: string; follow_up_at: string }>;
        if (due.length > 0) payload = { event: 'followup.due', contacts: due, fired_at: new Date().toISOString() };
      }
      if (payload) {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (wh.secret) {
          const crypto = await import('node:crypto');
          const sig = crypto.createHmac('sha256', wh.secret).update(JSON.stringify(payload)).digest('hex');
          headers['x-contacts-signature'] = `sha256=${sig}`;
        }
        try {
          const resp = await fetch(wh.url, { method: 'POST', headers, body: JSON.stringify(payload) });
          fired.push({ webhook_id: wh.id, event_type: wh.event_type, status: resp.status });
        } catch {
          fired.push({ webhook_id: wh.id, event_type: wh.event_type, status: 0 });
        }
      }
    }
    return { content: [{ type: "text", text: JSON.stringify({ fired }, null, 2) }] };
  },

  bulk_tag_contacts: (a) => {
    const db = getDatabase();
    const tagInput = a.tag_id_or_name as string;
    const action = a.action as 'add' | 'remove';
    // Resolve tag ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tagInput);
    let tagId = isUuid ? tagInput : null;
    let tagName = tagInput;
    if (!tagId) {
      const tag = getTagByName(tagInput, db);
      if (!tag) return { content: [{ type: "text", text: `Tag not found: ${tagInput}` }], isError: true };
      tagId = tag.id;
      tagName = tag.name;
    }
    // Get contact IDs
    let contactIds: string[] = (a.contact_ids as string[] | undefined) ?? [];
    if (a.query && typeof a.query === 'string') {
      const found = searchContacts(a.query as string);
      contactIds = [...contactIds, ...found.map((c: { id: string }) => c.id)];
    }
    // De-duplicate
    contactIds = [...new Set(contactIds)];
    let taggedCount = 0;
    for (const cid of contactIds) {
      try {
        if (action === 'add') {
          addTagToContact(cid, tagId);
        } else {
          removeTagFromContact(cid, tagId);
        }
        taggedCount++;
      } catch {
        // skip individual errors
      }
    }
    return { content: [{ type: "text", text: JSON.stringify({ tagged_count: taggedCount, tag_name: tagName, action }, null, 2) }] };
  },

  set_do_not_contact: (a) => {
    const db = getDatabase();
    updateContact(a.contact_id as string, { do_not_contact: a.do_not_contact as boolean });
    if (a.reason && !!(a.do_not_contact)) {
      addNote(a.contact_id as string, `DNC: ${a.reason}`, undefined, db);
    }
    return { content: [{ type: "text", text: JSON.stringify({ set: true, contact_id: a.contact_id, do_not_contact: a.do_not_contact }, null, 2) }] };
  },

  export_contacts: async (a) => {
    const format = a.format as "json" | "csv" | "vcf";
    const contactIds = a.contact_ids as string[] | undefined;
    const updatedSince = a.updated_since as string | undefined;
    let contactList;
    if (contactIds && contactIds.length > 0) {
      contactList = contactIds.map((id) => getContact(id));
    } else {
      contactList = listContacts({ limit: 10000, ...(updatedSince ? { last_contacted_after: updatedSince } : {}) }).contacts;
    }
    const output = await exportContacts(format, contactList);
    return { content: [{ type: "text", text: output }] };
  },
};
