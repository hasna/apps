/**
 * Core contact handlers: CRUD, search, merge, bulk, tags, groups, relationships, notes, import/export basics.
 */
import type { ToolHandler } from "./types.js";
import type {
  CreateContactInput,
  UpdateContactInput,
  CreateCompanyInput,
  UpdateCompanyInput,
  CreateTagInput,
  CreateRelationshipInput,
  RelationshipType,
} from "../../types/index.js";
import { getDatabase } from "../../db/database.js";
import {
  createContact,
  getContact,
  getContactByEmail,
  updateContact,
  deleteContact,
  listContacts,
  searchContacts,
  mergeContacts,
  addEmailToContact,
  addPhoneToContact,
  archiveContact,
  unarchiveContact,
  autoLinkContactToCompany,
  linkContactToProject,
  unlinkContactFromProject,
  getContactProjectIds,
  setContactProjects,
  listContactIdsByProject,
} from "../../db/contacts.js";
import {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
  listCompanies,
  searchCompanies,
  archiveCompany,
  unarchiveCompany,
} from "../../db/companies.js";
import {
  createTag,
  listTags,
  deleteTag,
  addTagToContact,
  removeTagFromContact,
  addTagToCompany,
  removeTagFromCompany,
  getTagByName,
} from "../../db/tags.js";
import {
  createRelationship,
  listRelationships,
  deleteRelationship,
  createCompanyRelationship,
  listCompanyRelationships,
  deleteCompanyRelationship,
} from "../../db/relationships.js";
import { listActivity } from "../../db/activity.js";
import { addNote, listNotes, deleteNote, listNotesForContactAtCompany } from "../../db/notes.js";
import { findEmailDuplicates, findNameDuplicates } from "../../lib/dedup.js";
import { importContacts } from "../../lib/import.js";
import {
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
} from "../../db/groups.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const coreHandlers: Record<string, ToolHandler> = {
  create_contact: (a) => {
    const input: CreateContactInput = {
      first_name: a.first_name as string | undefined,
      last_name: a.last_name as string | undefined,
      display_name: a.display_name as string | undefined,
      nickname: a.nickname as string | undefined,
      job_title: a.job_title as string | undefined,
      company_id: a.company_id as string | undefined,
      notes: a.notes as string | undefined,
      birthday: a.birthday as string | undefined,
      website: a.website as string | undefined,
      last_contacted_at: a.last_contacted_at as string | undefined,
      preferred_contact_method: a.preferred_contact_method as CreateContactInput["preferred_contact_method"],
      status: a.status as CreateContactInput["status"],
      follow_up_at: a.follow_up_at as string | undefined,
      project_id: a.project_id as string | undefined,
      emails: a.emails as CreateContactInput["emails"],
      phones: a.phones as CreateContactInput["phones"],
      addresses: a.addresses as CreateContactInput["addresses"],
      social_profiles: a.social_profiles as CreateContactInput["social_profiles"],
      tag_ids: a.tag_ids as string[] | undefined,
      source: a.source as CreateContactInput["source"],
      sensitivity: a.sensitivity as CreateContactInput["sensitivity"],
    };
    const contact = createContact(input);
    if (Array.isArray(a.project_ids) && (a.project_ids as string[]).length > 0) {
      setContactProjects(contact.id, a.project_ids as string[]);
    }
    const projectIds = getContactProjectIds(contact.id);
    return json({ ...contact, project_ids: projectIds });
  },

  get_contact: (a) => {
    const contact = getContact(a.id as string);
    if (contact) {
      const projectIds = getContactProjectIds(contact.id);
      return json({ ...contact, project_ids: projectIds });
    }
    return json(contact);
  },

  update_contact: (a) => {
    const { id, ...rest } = a;
    const input: UpdateContactInput = {
      first_name: rest.first_name as string | undefined,
      last_name: rest.last_name as string | undefined,
      display_name: rest.display_name as string | undefined,
      nickname: rest.nickname as string | null | undefined,
      job_title: rest.job_title as string | null | undefined,
      company_id: rest.company_id as string | null | undefined,
      notes: rest.notes as string | null | undefined,
      birthday: rest.birthday as string | null | undefined,
      website: rest.website as string | null | undefined,
      last_contacted_at: rest.last_contacted_at as string | null | undefined,
      preferred_contact_method: rest.preferred_contact_method as UpdateContactInput["preferred_contact_method"],
      status: rest.status as UpdateContactInput["status"],
      follow_up_at: rest.follow_up_at as string | null | undefined,
      project_id: rest.project_id as string | null | undefined,
      source: rest.source as UpdateContactInput["source"],
      sensitivity: rest.sensitivity as UpdateContactInput["sensitivity"],
      emails_add: rest.emails_add as UpdateContactInput["emails_add"],
      phones_add: rest.phones_add as UpdateContactInput["phones_add"],
    };
    const contact = updateContact(id as string, input);
    if (Array.isArray(rest.project_ids)) {
      setContactProjects(id as string, rest.project_ids as string[]);
    }
    const projectIds = getContactProjectIds(id as string);
    return json({ ...contact, project_ids: projectIds });
  },

  delete_contact: (a) => {
    deleteContact(a.id as string);
    return { content: [{ type: "text", text: `Contact ${a.id} deleted successfully` }] };
  },

  list_contacts: (a) => {
    const result = listContacts({
      company_id: a.company_id as string | undefined,
      tag_id: a.tag_id as string | undefined,
      tag_ids: a.tag_ids as string[] | undefined,
      source: a.source as CreateContactInput["source"],
      status: a.status as "active" | "pending_reply" | "converted" | "closed" | "other" | undefined,
      project_id: a.project_id as string | undefined,
      archived: a.archived as boolean | undefined,
      include_restricted: a.include_restricted as boolean | undefined,
      follow_up_due: a.follow_up_due as boolean | undefined,
      last_contacted_after: a.last_contacted_after as string | undefined,
      last_contacted_before: a.last_contacted_before as string | undefined,
      limit: a.limit as number | undefined,
      offset: a.offset as number | undefined,
      order_by: a.order_by as "display_name" | "created_at" | "updated_at" | "last_contacted_at" | "follow_up_at" | undefined,
      order_dir: a.order_dir as "asc" | "desc" | undefined,
    });
    return json(result);
  },

  search_contacts: (a) => json(searchContacts(a.query as string)),

  create_company: (a) => {
    const rawTagIds = a.tag_ids;
    const tagIds: string[] | undefined = typeof rawTagIds === "string" ? (JSON.parse(rawTagIds) as string[]) : rawTagIds as string[] | undefined;
    const input: CreateCompanyInput = {
      name: a.name as string,
      domain: a.domain as string | undefined,
      description: a.description as string | undefined,
      industry: a.industry as string | undefined,
      size: a.size as string | undefined,
      founded_year: a.founded_year as number | undefined,
      notes: a.notes as string | undefined,
      emails: a.emails as CreateCompanyInput["emails"],
      phones: a.phones as CreateCompanyInput["phones"],
      addresses: a.addresses as CreateCompanyInput["addresses"],
      social_profiles: a.social_profiles as CreateCompanyInput["social_profiles"],
      tag_ids: tagIds,
    };
    return json(createCompany(input));
  },

  get_company: (a) => {
    const company = getCompany(a.id as string);
    if (!company) return { content: [{ type: "text", text: `Company not found: ${a.id}` }], isError: true };
    return json(company);
  },

  update_company: (a) => {
    const { id, ...rest } = a;
    const input: UpdateCompanyInput = {
      name: rest.name as string | undefined,
      domain: rest.domain as string | null | undefined,
      description: rest.description as string | null | undefined,
      industry: rest.industry as string | null | undefined,
      size: rest.size as string | null | undefined,
      founded_year: rest.founded_year as number | null | undefined,
      notes: rest.notes as string | null | undefined,
    };
    return json(updateCompany(id as string, input));
  },

  delete_company: (a) => {
    deleteCompany(a.id as string);
    return { content: [{ type: "text", text: `Company ${a.id} deleted successfully` }] };
  },

  list_companies: (a) => json(listCompanies({
    tag_id: a.tag_id as string | undefined,
    industry: a.industry as string | undefined,
    project_id: a.project_id as string | undefined,
    archived: a.archived as boolean | undefined,
    limit: a.limit as number | undefined,
    offset: a.offset as number | undefined,
  })),

  search_companies: (a) => json(searchCompanies(a.query as string)),

  create_tag: (a) => {
    const input: CreateTagInput = { name: a.name as string, color: a.color as string | undefined, description: a.description as string | undefined };
    return json(createTag(input));
  },

  list_tags: () => json(listTags()),

  delete_tag: (a) => {
    deleteTag(a.id as string);
    return { content: [{ type: "text", text: `Tag ${a.id} deleted successfully` }] };
  },

  add_tag_to_contact: (a) => {
    addTagToContact(a.contact_id as string, a.tag_id as string);
    return { content: [{ type: "text", text: `Tag ${a.tag_id} added to contact ${a.contact_id}` }] };
  },

  remove_tag_from_contact: (a) => {
    removeTagFromContact(a.contact_id as string, a.tag_id as string);
    return { content: [{ type: "text", text: `Tag ${a.tag_id} removed from contact ${a.contact_id}` }] };
  },

  add_relationship: (a) => {
    const input: CreateRelationshipInput = {
      contact_a_id: a.contact_a_id as string,
      contact_b_id: a.contact_b_id as string,
      relationship_type: a.relationship_type as RelationshipType,
      notes: a.notes as string | undefined,
    };
    return json(createRelationship(input));
  },

  list_relationships: (a) => json(listRelationships({ contact_id: a.contact_id as string })),

  delete_relationship: (a) => {
    deleteRelationship(a.id as string);
    return { content: [{ type: "text", text: `Relationship ${a.id} deleted successfully` }] };
  },

  merge_contacts: (a) => json(mergeContacts(a.keep_id as string, a.merge_id as string)),

  import_contacts: async (a) => {
    const format = a.format as "json" | "csv" | "vcf";
    const inputs = await importContacts(format, a.data as string);
    let importedCount = 0;
    const errors: string[] = [];
    for (const input of inputs) {
      try { createContact(input); importedCount++; } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
    }
    return json({ imported: importedCount, errors: errors.length, error_details: errors });
  },

  get_stats: () => {
    const db = getDatabase();
    const contactCount = (db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number }).count;
    const companyCount = (db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number }).count;
    const tagCount = (db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number }).count;
    const groupCount = (db.prepare("SELECT COUNT(*) as count FROM groups").get() as { count: number }).count;
    return json({ contacts: contactCount, companies: companyCount, tags: tagCount, groups: groupCount });
  },

  log_interaction: (a) => {
    const contactId = a.contact_id as string;
    const interactionDate = (a.date as string | undefined) ?? new Date().toISOString();
    const note = a.note as string | undefined;
    const existing = getContact(contactId);
    const updateInput: UpdateContactInput = { last_contacted_at: interactionDate };
    if (note) {
      const dateStr = interactionDate.slice(0, 10);
      const existingNotes = existing.notes ?? "";
      updateInput.notes = existingNotes ? `${existingNotes}\n\n[${dateStr}] ${note}` : `[${dateStr}] ${note}`;
    }
    return json(updateContact(contactId, updateInput));
  },

  find_or_create_contact: (a) => {
    const db = getDatabase();
    const emailAddresses = (a.emails as Array<{ address: string }> | undefined)?.map(e => e.address) ?? [];
    let found = null;
    for (const addr of emailAddresses) {
      const emailRow = db.prepare(`SELECT contact_id FROM emails WHERE LOWER(address) = LOWER(?) AND contact_id IS NOT NULL LIMIT 1`).get(addr) as { contact_id: string } | null;
      if (emailRow) { found = getContact(emailRow.contact_id); break; }
    }
    if (!found) {
      const nameQuery = (a.display_name as string | undefined) ?? (a.first_name || a.last_name ? `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() : null);
      if (nameQuery) { const results = searchContacts(nameQuery); if (results.length > 0) found = results[0]!; }
    }
    if (found) return json({ contact: found, found: true, created: false });
    const focInput: CreateContactInput = {
      first_name: a.first_name as string | undefined, last_name: a.last_name as string | undefined,
      display_name: a.display_name as string | undefined, nickname: a.nickname as string | undefined,
      job_title: a.job_title as string | undefined, company_id: a.company_id as string | undefined,
      notes: a.notes as string | undefined, birthday: a.birthday as string | undefined,
      website: a.website as string | undefined, last_contacted_at: a.last_contacted_at as string | undefined,
      preferred_contact_method: a.preferred_contact_method as CreateContactInput["preferred_contact_method"],
      status: a.status as CreateContactInput["status"], follow_up_at: a.follow_up_at as string | undefined,
      project_id: a.project_id as string | undefined, emails: a.emails as CreateContactInput["emails"],
      phones: a.phones as CreateContactInput["phones"], addresses: a.addresses as CreateContactInput["addresses"],
      social_profiles: a.social_profiles as CreateContactInput["social_profiles"],
      tag_ids: a.tag_ids as string[] | undefined, source: a.source as CreateContactInput["source"],
    };
    return json({ contact: createContact(focInput), found: false, created: true });
  },

  upsert_contact: (a) => {
    const db = getDatabase();
    const upsertEmails = (a.emails as Array<{ address: string }> | undefined)?.map(e => e.address) ?? [];
    if (a.email) upsertEmails.unshift(a.email as string);
    let existingContact = null;
    for (const addr of upsertEmails) {
      const emailRow = db.prepare(`SELECT contact_id FROM emails WHERE address = ? AND contact_id IS NOT NULL LIMIT 1`).get(addr) as { contact_id: string } | null;
      if (emailRow) { existingContact = getContact(emailRow.contact_id); break; }
    }
    if (existingContact) {
      const updateInput: UpdateContactInput = {
        first_name: a.first_name as string | undefined, last_name: a.last_name as string | undefined,
        display_name: a.display_name as string | undefined, nickname: a.nickname as string | null | undefined,
        job_title: a.job_title as string | null | undefined, company_id: a.company_id as string | null | undefined,
        notes: a.notes as string | null | undefined, birthday: a.birthday as string | null | undefined,
        website: a.website as string | null | undefined, last_contacted_at: a.last_contacted_at as string | null | undefined,
        preferred_contact_method: a.preferred_contact_method as UpdateContactInput["preferred_contact_method"],
        source: a.source as UpdateContactInput["source"],
      };
      return json({ contact: updateContact(existingContact.id, updateInput), action: "updated" });
    }
    const createInput: CreateContactInput = {
      first_name: a.first_name as string | undefined, last_name: a.last_name as string | undefined,
      display_name: a.display_name as string | undefined, nickname: a.nickname as string | undefined,
      job_title: a.job_title as string | undefined, company_id: a.company_id as string | undefined,
      notes: a.notes as string | undefined, birthday: a.birthday as string | undefined,
      website: a.website as string | undefined, last_contacted_at: a.last_contacted_at as string | undefined,
      preferred_contact_method: a.preferred_contact_method as CreateContactInput["preferred_contact_method"],
      emails: a.email ? [{ address: a.email as string, is_primary: true }, ...(a.emails as CreateContactInput["emails"] ?? [])] : a.emails as CreateContactInput["emails"],
      phones: a.phones as CreateContactInput["phones"], addresses: a.addresses as CreateContactInput["addresses"],
      social_profiles: a.social_profiles as CreateContactInput["social_profiles"],
      tag_ids: a.tag_ids as string[] | undefined, source: a.source as CreateContactInput["source"],
    };
    return json({ contact: createContact(createInput), action: "created" });
  },

  add_note: (a) => json(addNote(a.contact_id as string, a.note as string, a.created_by as string | undefined, undefined, a.company_id as string | undefined)),

  list_notes: (a) => {
    const db = getDatabase();
    const companyId = a.company_id as string | undefined;
    return json(companyId ? listNotesForContactAtCompany(a.contact_id as string, companyId, db) : listNotes(a.contact_id as string));
  },

  delete_note: (a) => { deleteNote(a.note_id as string); return json({ deleted: true }); },

  link_contact_to_project: (a) => {
    linkContactToProject(a.contact_id as string, a.project_id as string);
    return json({ contact_id: a.contact_id, project_ids: getContactProjectIds(a.contact_id as string) });
  },

  unlink_contact_from_project: (a) => {
    unlinkContactFromProject(a.contact_id as string, a.project_id as string);
    return json({ contact_id: a.contact_id, project_ids: getContactProjectIds(a.contact_id as string) });
  },

  list_contacts_by_project: (a) => {
    const db = getDatabase();
    const contactIds = listContactIdsByProject(a.project_id as string);
    const limit = (a.limit as number) ?? 100;
    const offset = (a.offset as number) ?? 0;
    const paged = contactIds.slice(offset, offset + limit);
    const contacts = paged.map(id => getContact(id, db)).filter(Boolean);
    return json({ contacts, total: contactIds.length, project_id: a.project_id });
  },

  list_contacts_by_company: (a) => json(listContacts({ company_id: a.company_id as string, limit: a.limit as number | undefined, offset: a.offset as number | undefined })),

  list_contacts_by_tag: (a) => {
    const tagInput = a.tag as string;
    const db = getDatabase();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tagInput);
    let tagId = isUuid ? tagInput : null;
    if (!tagId) {
      const tag = getTagByName(tagInput, db);
      if (!tag) return { content: [{ type: "text", text: `Tag not found: ${tagInput}` }], isError: true };
      tagId = tag.id;
    }
    return json(listContacts({ tag_id: tagId, limit: a.limit as number | undefined, offset: a.offset as number | undefined }));
  },

  create_group: (a) => { const db = getDatabase(); return json(createGroup(db, { name: a.name as string, description: a.description as string | undefined, project_id: a.project_id as string | undefined })); },
  list_groups: (a) => { const db = getDatabase(); return json(listGroups(db, a.project_id as string | undefined)); },
  get_group: (a) => { const db = getDatabase(); const g = getGroup(db, a.id as string); if (!g) return { content: [{ type: "text", text: `Group not found: ${a.id}` }], isError: true }; return json(g); },
  update_group: (a) => { const db = getDatabase(); const { id: gid, ...r } = a; return json(updateGroup(db, gid as string, { name: r.name as string | undefined, description: r.description as string | undefined, project_id: r.project_id as string | undefined })); },
  delete_group: (a) => { const db = getDatabase(); deleteGroup(db, a.id as string); return { content: [{ type: "text", text: `Group ${a.id} deleted successfully` }] }; },

  add_contact_to_group: (a) => {
    const db = getDatabase();
    const groupId = a.group_id as string;
    const ids: string[] = a.contact_ids ? (a.contact_ids as string[]) : [a.contact_id as string];
    if (ids.length === 1) return json(addContactToGroup(db, ids[0]!, groupId));
    let added = 0;
    const errors: string[] = [];
    for (const cid of ids) { try { addContactToGroup(db, cid, groupId); added++; } catch (e) { errors.push(`${cid}: ${e instanceof Error ? e.message : String(e)}`); } }
    return json({ added, errors: errors.length, error_details: errors });
  },

  remove_contact_from_group: (a) => { const db = getDatabase(); removeContactFromGroup(db, a.contact_id as string, a.group_id as string); return { content: [{ type: "text", text: `Contact ${a.contact_id} removed from group ${a.group_id}` }] }; },
  list_contacts_in_group: (a) => { const db = getDatabase(); return json(listContactsInGroup(db, a.group_id as string)); },
  list_groups_for_contact: (a) => { const db = getDatabase(); return json(listGroupsForContact(db, a.contact_id as string)); },
  get_contact_by_email: (a) => { const c = getContactByEmail(a.email as string); if (!c) return { content: [{ type: "text", text: "null" }] }; return json(c); },

  add_email_to_contact: (a) => json(addEmailToContact(a.contact_id as string, { address: a.address as string, type: a.type as "work" | "personal" | "other" | undefined, is_primary: a.is_primary as boolean | undefined })),
  add_phone_to_contact: (a) => json(addPhoneToContact(a.contact_id as string, { number: a.number as string, type: a.type as "mobile" | "work" | "home" | "fax" | "whatsapp" | "other" | undefined, country_code: a.country_code as string | undefined, is_primary: a.is_primary as boolean | undefined })),
  archive_contact: (a) => json(archiveContact(a.id as string)),
  unarchive_contact: (a) => json(unarchiveContact(a.id as string)),
  archive_company: (a) => json(archiveCompany(a.id as string)),
  unarchive_company: (a) => json(unarchiveCompany(a.id as string)),

  find_duplicates: () => { const db = getDatabase(); return json({ by_email: findEmailDuplicates(db), by_name: findNameDuplicates(db) }); },
  list_interactions: (a) => json(listActivity({ contact_id: a.contact_id as string | undefined, company_id: a.company_id as string | undefined, limit: a.limit as number | undefined, offset: a.offset as number | undefined })),
  add_tag_to_company: (a) => { addTagToCompany(a.company_id as string, a.tag_id as string); return { content: [{ type: "text", text: `Tag ${a.tag_id} added to company ${a.company_id}` }] }; },
  remove_tag_from_company: (a) => { removeTagFromCompany(a.company_id as string, a.tag_id as string); return { content: [{ type: "text", text: `Tag ${a.tag_id} removed from company ${a.company_id}` }] }; },
  add_company_to_group: (a) => { const db = getDatabase(); return json(addCompanyToGroup(db, a.company_id as string, a.group_id as string)); },
  remove_company_from_group: (a) => { const db = getDatabase(); removeCompanyFromGroup(db, a.company_id as string, a.group_id as string); return { content: [{ type: "text", text: `Company ${a.company_id} removed from group ${a.group_id}` }] }; },
  list_companies_in_group: (a) => { const db = getDatabase(); return json(listCompaniesInGroup(db, a.group_id as string)); },
  list_groups_for_company: (a) => { const db = getDatabase(); return json(listGroupsForCompany(db, a.company_id as string)); },

  bulk_create_contacts: (a) => {
    const contacts = a.contacts as Record<string, unknown>[];
    let created = 0;
    const errors: string[] = [];
    for (const item of contacts) { try { createContact(item as CreateContactInput); created++; } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); } }
    return json({ created, errors: errors.length, error_details: errors });
  },

  auto_link_to_company: (a) => { const c = autoLinkContactToCompany(a.contact_id as string); if (!c) return { content: [{ type: "text", text: "null" }] }; return json(c); },

  add_company_relationship: (a) => json(createCompanyRelationship({
    contact_id: a.contact_id as string, company_id: a.company_id as string,
    relationship_type: a.relationship_type as "client" | "vendor" | "partner" | "employee" | "contractor" | "investor" | "advisor" | "tax_preparer" | "bank_manager" | "attorney" | "registered_agent" | "accountant" | "payroll_specialist" | "insurance_broker" | "other",
    notes: a.notes as string | undefined, start_date: a.start_date as string | undefined,
    end_date: a.end_date as string | undefined, is_primary: a.is_primary as boolean | undefined,
    status: a.status as "active" | "inactive" | "ended" | undefined,
  })),

  list_company_relationships: (a) => json(listCompanyRelationships({
    contact_id: a.contact_id as string | undefined, company_id: a.company_id as string | undefined,
    relationship_type: a.relationship_type as "client" | "vendor" | "partner" | "employee" | "contractor" | "investor" | "advisor" | "other" | undefined,
  })),

  delete_company_relationship: (a) => { deleteCompanyRelationship(a.id as string); return json({ deleted: true }); },
};
