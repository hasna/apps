/**
 * CRM handlers: gmail import, google contacts sync, workload, org members,
 * vendor communications, contact tasks, applications, entities, cold contacts,
 * upcoming, stats, audit, deals, events, timeline, enrich, context, webhook,
 * bulk tags, DNC, export.
 *
 * Every handler routes storage through the single `Store` abstraction
 * (getStore()). No handler touches SQLite (`getDatabase`) or performs raw HTTP
 * against the storage backend. External integrations (Gmail, Google People,
 * Exa, outbound webhooks) are legitimate network calls kept in the handler.
 */
import type { ToolHandler } from "./types.js";
import type {
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
import { getStore } from "../../store/index.js";
import { extractContactsFromGmail } from "../../lib/gmail-import.js";
import {
  pullGoogleContactsAsInputs,
  pushContactToGoogle,
  searchGoogleContacts,
  googlePersonToContactInput,
} from "../../lib/google-contacts.js";
import { exportContacts } from "../../lib/export.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const crmHandlers: Record<string, ToolHandler> = {
  import_contacts_from_gmail: async (a) => {
    const store = getStore();
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
        const existing = await store.findContactByEmailAddress(email);
        if (existing) {
          skipped++;
          continue;
        }

        const contact = await store.createContact(contact_input);

        // Add to group if specified
        if (a.group_id && typeof a.group_id === "string") {
          try {
            await store.addContactToGroup(contact.id, a.group_id as string);
          } catch {
            // non-fatal
          }
        }

        // Auto-link to company if we have a hint
        if (company_hint) {
          await store.autoLinkContactToCompany(contact.id);
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
    const store = getStore();
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
        const existing = await store.findContactByEmailAddress(primaryEmail);
        if (existing) { skipped++; continue; }

        await store.createContact(input);
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
    const contact = await getStore().getContact(a.contact_id as string);
    if (!contact) return { content: [{ type: "text", text: `Contact not found: ${a.contact_id}` }], isError: true };
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

  get_contact_workload: async (a) => {
    const store = getStore();
    const { contact_id } = a as { contact_id: string };
    const contact = await store.getContact(contact_id);
    if (!contact) return { content: [{ type: "text", text: `Contact not found: ${contact_id}` }], isError: true };
    const companyRels = await store.listCompanyRelationships({ contact_id });
    const activeTasks = await store.listContactTasks({ contact_id, status: 'pending' });
    const overdueTasks = (await store.listOverdueTasks() as Array<{ contact_id: string }>).filter((t) => t.contact_id === contact_id);
    const orgMemberships = await store.listOrgMembersForContact(contact_id);
    const daysSince = contact.last_contacted_at
      ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000)
      : null;
    return json({
      contact,
      company_relationships: companyRels,
      active_tasks: activeTasks,
      overdue_tasks: overdueTasks,
      org_memberships: orgMemberships,
      days_since_last_contact: daysSince,
      total_entities_managed: (companyRels as unknown[]).length,
    });
  },

  list_overdue_contact_tasks: async () => json(await getStore().listOverdueTasks()),

  check_escalations: async () => json(await getStore().checkEscalations()),

  add_org_member: async (a) => {
    const input: CreateOrgMemberInput = {
      company_id: a.company_id as string,
      contact_id: a.contact_id as string,
      title: a.title as string | undefined,
      specialization: a.specialization as string | undefined,
      office_phone: a.office_phone as string | undefined,
      response_sla_hours: a.response_sla_hours as number | undefined,
      notes: a.notes as string | undefined,
    };
    return json(await getStore().addOrgMember(input));
  },

  list_org_members: async (a) => json(await getStore().listOrgMembers(a.company_id as string)),

  update_org_member: async (a) => {
    const { id: memberId, ...memberRest } = a;
    const input: UpdateOrgMemberInput = {
      title: memberRest.title as string | null | undefined,
      specialization: memberRest.specialization as string | null | undefined,
      office_phone: memberRest.office_phone as string | null | undefined,
      response_sla_hours: memberRest.response_sla_hours as number | null | undefined,
      notes: memberRest.notes as string | null | undefined,
    };
    return json(await getStore().updateOrgMember(memberId as string, input));
  },

  remove_org_member: async (a) => {
    await getStore().removeOrgMember(a.id as string);
    return json({ deleted: true });
  },

  log_vendor_communication: async (a) => {
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
    return json(await getStore().logVendorCommunication(input));
  },

  list_vendor_communications: async (a) =>
    json(await getStore().listVendorCommunications(a.company_id as string, {
      type: a.type as CreateVendorCommunicationInput["type"],
      status: a.status as CreateVendorCommunicationInput["status"],
    })),

  list_missing_invoices: async () => json(await getStore().listMissingInvoices()),

  list_pending_followups: async () => json(await getStore().listPendingFollowUps()),

  mark_followup_done: async (a) => json(await getStore().markFollowUpDone(a.id as string)),

  create_contact_task: async (a) => {
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
    return json(await getStore().createContactTask(input));
  },

  list_contact_tasks: async (a) =>
    json(await getStore().listContactTasks({
      contact_id: a.contact_id as string | undefined,
      entity_id: a.entity_id as string | undefined,
      status: a.status as UpdateContactTaskInput["status"],
      priority: a.priority as UpdateContactTaskInput["priority"],
    })),

  update_contact_task: async (a) => {
    const { id: taskId, ...taskRest } = a;
    const input: UpdateContactTaskInput = {
      title: taskRest.title as string | undefined,
      status: taskRest.status as UpdateContactTaskInput["status"],
      deadline: taskRest.deadline as string | null | undefined,
      priority: taskRest.priority as UpdateContactTaskInput["priority"],
      description: taskRest.description as string | null | undefined,
      escalation_rules: taskRest.escalation_rules as UpdateContactTaskInput["escalation_rules"],
    };
    return json(await getStore().updateContactTask(taskId as string, input));
  },

  delete_contact_task: async (a) => {
    await getStore().deleteContactTask(a.id as string);
    return json({ deleted: true });
  },

  create_application: async (a) => {
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
    return json(await getStore().createApplication(input));
  },

  list_applications: async (a) =>
    json(await getStore().listApplications({
      type: a.type as CreateApplicationInput["type"],
      status: a.status as CreateApplicationInput["status"],
      provider_company_id: a.provider_company_id as string | undefined,
    })),

  update_application: async (a) => {
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
    return json(await getStore().updateApplication(appId as string, input));
  },

  get_followup_due_applications: async () => json(await getStore().listFollowUpDueApplications()),

  list_owned_entities: async () => {
    const result = await getStore().listCompanies({ limit: 200 });
    const owned = (result.companies as Array<{ is_owned_entity: boolean }>).filter((c) => c.is_owned_entity);
    return json(owned);
  },

  get_entity_team: async (a) => {
    const store = getStore();
    const company = await store.getCompany(a.company_id as string);
    const team = await store.listCompanyRelationships({ company_id: a.company_id as string });
    return json({ company, team });
  },

  list_cold_contacts: async (a) => json({ contacts: await getStore().listColdContacts((a.days as number | undefined) ?? 30) }),

  get_upcoming: async (a) => json({ items: await getStore().getUpcomingItems((a.days as number | undefined) ?? 7) }),

  get_network_stats: async () => json(await getStore().getNetworkStats()),

  audit_contacts: async (a) => {
    const results = (await getStore().listContactAudit()).slice(0, (a.limit as number | undefined) ?? 20);
    return json({ results });
  },

  create_deal: async (a) =>
    json(await getStore().createDeal({
      title: a.title as string,
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
      stage: a.stage as DealStage | undefined,
      value_usd: a.value_usd as number | undefined,
      currency: a.currency as string | undefined,
      close_date: a.close_date as string | undefined,
      notes: a.notes as string | undefined,
    })),

  get_deal: async (a) => json(await getStore().getDeal(a.id as string)),

  list_deals: async (a) =>
    json({ deals: await getStore().listDeals({
      stage: a.stage as DealStage | undefined,
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
    }) }),

  update_deal: async (a) => {
    const { id: dealId, ...dealRest } = a;
    return json(await getStore().updateDeal(dealId as string, {
      title: dealRest.title as string | undefined,
      stage: dealRest.stage as DealStage | undefined,
      value_usd: dealRest.value_usd as number | undefined,
      close_date: dealRest.close_date as string | undefined,
      notes: dealRest.notes as string | undefined,
    }));
  },

  delete_deal: async (a) => {
    await getStore().deleteDeal(a.id as string);
    return json({ deleted: true });
  },

  log_event: async (a) =>
    json(await getStore().logEvent({
      title: a.title as string,
      type: a.type as EventType | undefined,
      event_date: a.event_date as string,
      duration_min: a.duration_min as number | undefined,
      contact_ids: a.contact_ids as string[] | undefined,
      company_id: a.company_id as string | undefined,
      notes: a.notes as string | undefined,
      outcome: a.outcome as string | undefined,
      deal_id: a.deal_id as string | undefined,
    })),

  list_events: async (a) =>
    json({ events: await getStore().listEvents({
      contact_id: a.contact_id as string | undefined,
      company_id: a.company_id as string | undefined,
      type: a.type as EventType | undefined,
      date_from: a.date_from as string | undefined,
      date_to: a.date_to as string | undefined,
    }) }),

  delete_event: async (a) => {
    await getStore().deleteEvent(a.id as string);
    return json({ deleted: true });
  },

  get_contact_timeline: async (a) =>
    json({ items: await getStore().getContactTimeline(a.contact_id as string, (a.limit as number | undefined) ?? 50) }),

  enrich_contact: async (a) => {
    const contact = await getStore().getContact(a.contact_id as string);
    if (!contact) return { content: [{ type: "text", text: `Contact not found: ${a.contact_id}` }], isError: true };
    const exaKey = process.env['EXA_API_KEY'];
    if (!exaKey) {
      return json({ error: 'Set EXA_API_KEY to use enrichment', contact_id: a.contact_id, suggestions: [] });
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
    return json({ contact_id: a.contact_id, contact_name: contact.display_name, suggestions, raw_results: data.results?.slice(0, 3) });
  },

  get_contacts_for_context: async (a) => {
    const { topic, limit = 10 } = a as { topic: string; limit?: number };
    const results = await getStore().findContactsForContext(topic, limit);
    return json({ topic, results });
  },

  set_reminder: async (a) => {
    const store = getStore();
    await store.updateContact(a.contact_id as string, { follow_up_at: a.remind_at as string });
    if (a.note) {
      await store.addNote(a.contact_id as string, `Reminder (${a.remind_at}): ${a.note}`, undefined);
    }
    return json({ set: true, contact_id: a.contact_id, remind_at: a.remind_at });
  },

  check_and_fire_webhooks: async () => {
    const store = getStore();
    const webhooks = await store.listActiveWebhooks();
    if (!webhooks.length) {
      return json({ fired: [], message: 'no active webhooks' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const fired: Array<{ webhook_id: string; event_type: string; status: number }> = [];
    for (const wh of webhooks) {
      let payload: Record<string, unknown> | null = null;
      if (wh.event_type === 'contact.stale') {
        const stale = await store.listContactsNotContactedSince(30, 50);
        if (stale.length > 0) payload = { event: 'contact.stale', contacts: stale, fired_at: new Date().toISOString() };
      } else if (wh.event_type === 'task.overdue') {
        const overdue = await store.listOverdueTasks() as unknown[];
        if (overdue.length > 0) payload = { event: 'task.overdue', tasks: overdue, fired_at: new Date().toISOString() };
      } else if (wh.event_type === 'followup.due') {
        const due = await store.listFollowupDueContacts(today);
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
    return json({ fired });
  },

  bulk_tag_contacts: async (a) => {
    const store = getStore();
    const tagInput = a.tag_id_or_name as string;
    const action = a.action as 'add' | 'remove';
    // Resolve tag ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tagInput);
    let tagId = isUuid ? tagInput : null;
    let tagName = tagInput;
    if (!tagId) {
      const tag = await store.getTagByName(tagInput) as { id: string; name: string } | null;
      if (!tag) return { content: [{ type: "text", text: `Tag not found: ${tagInput}` }], isError: true };
      tagId = tag.id;
      tagName = tag.name;
    }
    // Get contact IDs
    let contactIds: string[] = (a.contact_ids as string[] | undefined) ?? [];
    if (a.query && typeof a.query === 'string') {
      const found = await store.searchContacts(a.query as string);
      contactIds = [...contactIds, ...found.map((c: { id: string }) => c.id)];
    }
    // De-duplicate
    contactIds = [...new Set(contactIds)];
    let taggedCount = 0;
    for (const cid of contactIds) {
      try {
        if (action === 'add') {
          await store.addTagToContact(cid, tagId);
        } else {
          await store.removeTagFromContact(cid, tagId);
        }
        taggedCount++;
      } catch {
        // skip individual errors
      }
    }
    return json({ tagged_count: taggedCount, tag_name: tagName, action });
  },

  set_do_not_contact: async (a) => {
    const store = getStore();
    await store.updateContact(a.contact_id as string, { do_not_contact: a.do_not_contact as boolean });
    if (a.reason && !!(a.do_not_contact)) {
      await store.addNote(a.contact_id as string, `DNC: ${a.reason}`, undefined);
    }
    return json({ set: true, contact_id: a.contact_id, do_not_contact: a.do_not_contact });
  },

  export_contacts: async (a) => {
    const store = getStore();
    const format = a.format as "json" | "csv" | "vcf";
    const contactIds = a.contact_ids as string[] | undefined;
    const updatedSince = a.updated_since as string | undefined;
    let contactList;
    if (contactIds && contactIds.length > 0) {
      contactList = (await Promise.all(contactIds.map((id) => store.getContact(id)))).filter((c): c is NonNullable<typeof c> => c != null);
    } else {
      contactList = (await store.listContacts({ limit: 10000, ...(updatedSince ? { last_contacted_after: updatedSince } : {}) })).contacts;
    }
    const output = await exportContacts(format, contactList);
    return { content: [{ type: "text", text: output }] };
  },
};
