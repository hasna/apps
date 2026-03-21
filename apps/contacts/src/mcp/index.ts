#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CreateContactInput,
  UpdateContactInput,
  CreateCompanyInput,
  UpdateCompanyInput,
  CreateTagInput,
  CreateRelationshipInput,
  RelationshipType,
} from "../types/index.js";
import { getDatabase } from "../db/database.js";
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
} from "../db/contacts.js";
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
} from "../db/groups.js";
import { getTagByName } from "../db/tags.js";
import {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
  listCompanies,
  searchCompanies,
  archiveCompany,
  unarchiveCompany,
} from "../db/companies.js";
import {
  createTag,
  listTags,
  deleteTag,
  addTagToContact,
  removeTagFromContact,
  addTagToCompany,
  removeTagFromCompany,
} from "../db/tags.js";
import {
  createRelationship,
  listRelationships,
  deleteRelationship,
  createCompanyRelationship,
  listCompanyRelationships,
  deleteCompanyRelationship,
} from "../db/relationships.js";
import { listActivity } from "../db/activity.js";
import { addNote, listNotes, deleteNote, getNote, listNotesForContactAtCompany } from "../db/notes.js";
import { findEmailDuplicates, findNameDuplicates } from "../lib/dedup.js";
import { importContacts } from "../lib/import.js";
import { exportContacts } from "../lib/export.js";
import { extractContactsFromGmail } from "../lib/gmail-import.js";
import {
  pullGoogleContactsAsInputs,
  pushContactToGoogle,
  searchGoogleContacts,
  googlePersonToContactInput,
} from "../lib/google-contacts.js";
import { ConnectorNotInstalledError, ConnectorAuthError } from "../lib/connector.js";
import type {
  CreateOrgMemberInput,
  UpdateOrgMemberInput,
  CreateVendorCommunicationInput,
  CreateContactTaskInput,
  UpdateContactTaskInput,
  CreateApplicationInput,
  UpdateApplicationInput,
} from "../types/index.js";
// DB layer functions — implemented in parallel by db agent
import {
  addOrgMember,
  listOrgMembers,
  updateOrgMember,
  removeOrgMember,
  listOrgMembersForContact,
} from "../db/org-members.js";
import {
  logVendorCommunication,
  listVendorCommunications,
  listMissingInvoices,
  listPendingFollowUps,
  markFollowUpDone,
} from "../db/vendor-comms.js";
import {
  createContactTask,
  listContactTasks,
  updateContactTask,
  deleteContactTask,
  listOverdueTasks,
  checkEscalations,
} from "../db/contact-tasks.js";
import {
  createApplication,
  listApplications,
  updateApplication,
  listFollowUpDue as getFollowUpDueApplications,
} from "../db/applications.js";
// New imports for v0.4.0 features — parallel agent creates these files
import { generateBrief } from "../lib/brief.js";
import { listColdContacts } from "../db/contacts.js";
import { getUpcomingItems } from "../lib/upcoming.js";
import { getNetworkStats } from "../lib/stats.js";
import { listContactAudit } from "../lib/audit.js";
import {
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  deleteDeal,
} from "../db/deals.js";
import {
  logEvent,
  listEvents,
  deleteEvent,
} from "../db/events.js";
import { getContactTimeline } from "../lib/timeline.js";
// ─── v0.5.0 imports ────────────────────────────────────────────────────────────
import { getFieldHistory, getContactAt } from "../db/field-history.js";
import { addJobEntry, getJobHistory } from "../db/job-history.js";
import { saveLearning, getLearnings, searchLearnings, confirmLearning, decayLearnings, deleteLearning } from "../db/learnings.js";
import type { CreateLearningInput } from "../db/learnings.js";
import { acquireLock, releaseLock, checkLock, logAgentActivity, getAgentActivity } from "../db/coordination.js";
import { computeRelationshipStrength, findWarmPath, findConnectionsAtCompany, detectCoolingRelationships } from "../db/graph.js";
import { resolveByPartial, addIdentity, getIdentities } from "../db/identity.js";
import { semanticSearch, embedAllContacts, embedContact } from "../lib/embeddings.js";
import { getRelationshipSignals, getGhostContacts, getWarmingContacts, recomputeAllSignals } from "../db/signals.js";
import { getContactCard, getContactBrief as getContactBriefContext, assembleContext } from "../lib/context.js";
import { parseEmailSignature, extractContactsFromEmailThread } from "../lib/signature-parser.js";
import { ingestMeetingParticipants } from "../lib/meeting-capture.js";
import { getFreshnessScore, getStaleContacts, markFieldVerified } from "../db/freshness.js";
import { addOrgChartEdge, listOrgChart, setDealContactRole, getDealTeam, getCoverageGaps } from "../db/org-chart.js";
import type { OrgEdgeType, AccountRole } from "../db/org-chart.js";
import { saveImage, getImagePath, getImageAsBase64, deleteImage } from "../lib/images.js";
// ─── v0.6.0 imports ────────────────────────────────────────────────────────────
import { initVault, unlockVault, lockVault, isVaultUnlocked, isVaultInitialized } from "../lib/vault.js";
import { addDocument, getDocument, listDocuments, deleteDocument, DOCUMENT_TYPES } from "../db/documents.js";
import type { DocumentType } from "../db/documents.js";
import { setHealthData, getHealthData, deleteHealthData } from "../db/health.js";
import type { SetHealthInput } from "../db/health.js";
import { scanDocument } from "../lib/document-scanner.js";

const server = new Server(
  { name: "contacts", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_contact",
      description: "Create a new contact. Provide at minimum display_name or first_name+last_name. Emails, phones, addresses, and social_profiles are arrays of objects. relationship_type values: colleague|friend|family|reports_to|mentor|investor|partner|client|vendor|other. source values: manual|import|linkedin|github|twitter|email|calendar|crm|other.",
      inputSchema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          display_name: { type: "string", description: "Display name (auto-generated from first+last if omitted)" },
          nickname: { type: "string" },
          job_title: { type: "string" },
          company_id: { type: "string" },
          notes: { type: "string" },
          birthday: { type: "string", description: "YYYY-MM-DD" },
          website: { type: "string", description: "Personal or professional website URL" },
          last_contacted_at: { type: "string", description: "ISO 8601 datetime of last contact" },
          preferred_contact_method: { type: "string", enum: ["email", "phone", "telegram", "whatsapp", "linkedin", "twitter", "other"] },
          status: { type: "string", enum: ["active", "pending_reply", "converted", "closed", "other"], description: "Contact lifecycle status (default: active)" },
          follow_up_at: { type: "string", description: "ISO 8601 datetime to follow up with this contact" },
          project_id: { type: "string", description: "Primary project ID (single). Use project_ids for multiple." },
          project_ids: { type: "array", items: { type: "string" }, description: "Associate contact with multiple todos project IDs" },
          emails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                address: { type: "string" },
                type: { type: "string", enum: ["work", "personal", "other"] },
                is_primary: { type: "boolean" },
              },
              required: ["address"],
            },
          },
          phones: {
            type: "array",
            items: {
              type: "object",
              properties: {
                number: { type: "string" },
                type: { type: "string", enum: ["mobile", "work", "home", "fax", "whatsapp", "other"] },
                is_primary: { type: "boolean" },
              },
              required: ["number"],
            },
          },
          addresses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["physical", "mailing", "billing", "virtual", "other"] },
                street: { type: "string" },
                city: { type: "string" },
                state: { type: "string" },
                zip: { type: "string" },
                country: { type: "string" },
                is_primary: { type: "boolean" },
              },
            },
          },
          social_profiles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                platform: { type: "string", enum: ["twitter", "linkedin", "github", "instagram", "telegram", "discord", "youtube", "tiktok", "bluesky", "facebook", "whatsapp", "snapchat", "reddit", "other"] },
                handle: { type: "string" },
                url: { type: "string" },
                is_primary: { type: "boolean" },
              },
              required: ["platform"],
            },
          },
          tag_ids: { type: "array", items: { type: "string" }, description: "Tag IDs to assign" },
          source: { type: "string", enum: ["manual", "import", "linkedin", "github", "twitter", "email", "calendar", "crm", "other"] },
          sensitivity: { type: "string", enum: ["normal", "confidential", "restricted"], description: "Contact sensitivity level (default: normal)" },
        },
      },
    },
    {
      name: "get_contact",
      description: "Get a contact by ID, returning all details including emails, phones, addresses, social profiles, tags, and company.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_contact",
      description: "Update an existing contact's fields. Only provided fields are changed. Supports all contact fields including status, follow_up_at, project_id. Use emails_add/phones_add to append new contact methods without replacing existing ones.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          display_name: { type: "string" },
          nickname: { type: "string" },
          job_title: { type: "string" },
          company_id: { type: "string" },
          notes: { type: "string" },
          birthday: { type: "string", description: "YYYY-MM-DD" },
          website: { type: "string" },
          last_contacted_at: { type: "string", description: "ISO 8601 datetime of last contact" },
          preferred_contact_method: { type: "string", enum: ["email", "phone", "telegram", "whatsapp", "linkedin", "twitter", "other"] },
          status: { type: "string", enum: ["active", "pending_reply", "converted", "closed", "other"] },
          follow_up_at: { type: "string", description: "ISO 8601 datetime for follow-up reminder (null to clear)" },
          project_id: { type: "string", description: "Primary project ID (single, null to clear)" },
          project_ids: { type: "array", items: { type: "string" }, description: "Replace all project links with this array of todos project IDs" },
          source: { type: "string", enum: ["manual", "import", "linkedin", "github", "twitter", "email", "calendar", "crm", "other"] },
          sensitivity: { type: "string", enum: ["normal", "confidential", "restricted"] },
          emails_add: { type: "array", items: { type: "object", properties: { address: { type: "string" }, type: { type: "string" }, is_primary: { type: "boolean" } }, required: ["address"] }, description: "New email addresses to append (duplicates are skipped)" },
          phones_add: { type: "array", items: { type: "object", properties: { number: { type: "string" }, type: { type: "string" }, country_code: { type: "string" }, is_primary: { type: "boolean" } }, required: ["number"] }, description: "New phone numbers to append (duplicates are skipped)" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_contact",
      description: "Permanently delete a contact by ID. All associated emails, phones, addresses, tags, and relationships are also deleted.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_contacts",
      description: "List contacts with optional filters. Supports filtering by company, tag(s), source, status, project, follow-up due, last_contacted date range, and archived state. Returns paginated results with total count.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          tag_id: { type: "string", description: "Filter by a single tag ID" },
          tag_ids: { type: "array", items: { type: "string" }, description: "Filter by multiple tag IDs (AND logic — contact must have all tags)" },
          source: { type: "string", enum: ["manual", "import", "linkedin", "github", "twitter", "email", "calendar", "crm", "other"] },
          status: { type: "string", enum: ["active", "pending_reply", "converted", "closed", "other"] },
          project_id: { type: "string", description: "Filter by project ID" },
          archived: { type: "boolean", description: "Include archived contacts (default false)" },
          include_restricted: { type: "boolean", description: "Include restricted-sensitivity contacts (default false)" },
          follow_up_due: { type: "boolean", description: "Only return contacts whose follow_up_at is in the past" },
          last_contacted_after: { type: "string", description: "ISO 8601 date — only contacts last contacted after this date" },
          last_contacted_before: { type: "string", description: "ISO 8601 date — only contacts last contacted before this date" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number" },
          order_by: { type: "string", enum: ["display_name", "created_at", "updated_at", "last_contacted_at", "follow_up_at"] },
          order_dir: { type: "string", enum: ["asc", "desc"] },
        },
      },
    },
    {
      name: "search_contacts",
      description: "Full-text search across contacts by name, nickname, notes, job title, and more. Also searches email addresses and phone numbers. Returns up to 50 results.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "create_company",
      description: "Create a new company/organization. Attach emails, phones, addresses, and social_profiles as arrays. Tag with tag_ids.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: { type: "string", description: "Primary domain, e.g. acme.com" },
          description: { type: "string" },
          industry: { type: "string" },
          size: { type: "string", description: "e.g. '1-10', '11-50', '51-200', '201-500', '500+'" },
          founded_year: { type: "number" },
          notes: { type: "string" },
          emails: { type: "array", items: { type: "object" } },
          phones: { type: "array", items: { type: "object" } },
          addresses: { type: "array", items: { type: "object" } },
          social_profiles: { type: "array", items: { type: "object" } },
          tag_ids: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
    {
      name: "get_company",
      description: "Get a company by ID, including all emails, phones, addresses, social profiles, tags, and employee count.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_company",
      description: "Update an existing company's fields. Only provided fields are changed; omitted fields remain unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          domain: { type: "string" },
          description: { type: "string" },
          industry: { type: "string" },
          size: { type: "string" },
          founded_year: { type: "number" },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_company",
      description: "Permanently delete a company by ID. Contacts that belong to this company will have their company_id cleared.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_companies",
      description: "List companies with optional filters by industry, tag, project, or archived state. Returns paginated results with total count.",
      inputSchema: {
        type: "object",
        properties: {
          tag_id: { type: "string" },
          industry: { type: "string" },
          project_id: { type: "string", description: "Filter by project ID" },
          archived: { type: "boolean", description: "Include archived companies (default false)" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    {
      name: "search_companies",
      description: "Search companies by name or domain using full-text search. Returns up to 50 matches.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "create_tag",
      description: "Create a new tag for categorizing contacts and companies. Tags are shared across contacts and companies.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string", description: "Hex color (e.g. #FF5733). Defaults to indigo." },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "list_tags",
      description: "List all available tags with their colors and descriptions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "delete_tag",
      description: "Delete a tag by ID. The tag will be removed from all contacts and companies it was applied to.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "add_tag_to_contact",
      description: "Apply an existing tag to a contact. Use list_tags to find tag IDs.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          tag_id: { type: "string" },
        },
        required: ["contact_id", "tag_id"],
      },
    },
    {
      name: "remove_tag_from_contact",
      description: "Remove a tag from a contact. The tag itself is not deleted.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          tag_id: { type: "string" },
        },
        required: ["contact_id", "tag_id"],
      },
    },
    {
      name: "add_relationship",
      description: "Link two contacts with a typed relationship. relationship_type: colleague (work peer), friend (personal), family (relative), reports_to (A reports to B), mentor (A mentors B), investor (A invests in B), partner (business partner), client, vendor, other.",
      inputSchema: {
        type: "object",
        properties: {
          contact_a_id: { type: "string" },
          contact_b_id: { type: "string" },
          relationship_type: {
            type: "string",
            enum: ["colleague", "friend", "family", "reports_to", "mentor", "investor", "partner", "client", "vendor", "other"],
          },
          notes: { type: "string" },
        },
        required: ["contact_a_id", "contact_b_id", "relationship_type"],
      },
    },
    {
      name: "list_relationships",
      description: "List all relationships for a contact, showing both directions (where contact is A or B).",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "delete_relationship",
      description: "Delete a relationship by its ID. Use list_relationships to find relationship IDs.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "merge_contacts",
      description: "Merge two contacts into one — all emails, phones, addresses, tags, and relationships from merge_id are moved to keep_id, then merge_id is deleted. Fields missing in keep_id are filled from merge_id.",
      inputSchema: {
        type: "object",
        properties: {
          keep_id: { type: "string" },
          merge_id: { type: "string" },
        },
        required: ["keep_id", "merge_id"],
      },
    },
    {
      name: "import_contacts",
      description: "Import contacts from CSV (Google Contacts format), vCard (.vcf, v3/v4), or JSON array. Pass raw file contents as the data string. format: 'csv'|'vcf'|'json'.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv", "vcf"] },
          data: { type: "string", description: "Raw file contents (CSV text, vCard text, or JSON array string)" },
        },
        required: ["format", "data"],
      },
    },
    {
      name: "export_contacts",
      description: "Export contacts to CSV, vCard (.vcf), or JSON format. Optionally specify contact_ids to export a subset; omit to export all contacts. Use updated_since to export only contacts updated after a date.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv", "vcf"] },
          contact_ids: { type: "array", items: { type: "string" }, description: "Specific contact IDs to export (omit for all)" },
          updated_since: { type: "string", description: "ISO 8601 date — only export contacts updated/contacted after this date" },
        },
        required: ["format"],
      },
    },
    {
      name: "get_stats",
      description: "Get database statistics: total counts of contacts, companies, tags, and groups.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "log_interaction",
      description: "Record a contact interaction — sets last_contacted_at to now (or a provided date) and optionally appends a timestamped note. Use this to track when you last spoke with someone.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          note: { type: "string", description: "Optional note about the interaction to append to the contact's notes" },
          date: { type: "string", description: "ISO 8601 datetime (defaults to now)" },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "find_or_create_contact",
      description: "Find an existing contact by email or name, or create a new one if not found. Returns { contact, found: boolean, created: boolean }. The #1 tool for agent workflows — avoids duplicate creation. Searches by email first (exact match), then by display_name.",
      inputSchema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          display_name: { type: "string" },
          nickname: { type: "string" },
          job_title: { type: "string" },
          company_id: { type: "string" },
          notes: { type: "string" },
          birthday: { type: "string" },
          website: { type: "string" },
          last_contacted_at: { type: "string" },
          preferred_contact_method: { type: "string", enum: ["email", "phone", "telegram", "whatsapp", "linkedin", "twitter", "other"] },
          emails: { type: "array", items: { type: "object", properties: { address: { type: "string" }, type: { type: "string" }, is_primary: { type: "boolean" } }, required: ["address"] } },
          phones: { type: "array", items: { type: "object" } },
          addresses: { type: "array", items: { type: "object" } },
          social_profiles: { type: "array", items: { type: "object" } },
          tag_ids: { type: "array", items: { type: "string" } },
          source: { type: "string" },
        },
      },
    },
    {
      name: "upsert_contact",
      description: "Update a contact if one with matching email exists, otherwise create a new one. Returns { contact, action: 'created'|'updated' }. Ideal for syncing data from external sources. Requires email in the emails array or as a top-level email field.",
      inputSchema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          display_name: { type: "string" },
          nickname: { type: "string" },
          job_title: { type: "string" },
          company_id: { type: "string" },
          notes: { type: "string" },
          birthday: { type: "string" },
          website: { type: "string" },
          last_contacted_at: { type: "string" },
          preferred_contact_method: { type: "string", enum: ["email", "phone", "telegram", "whatsapp", "linkedin", "twitter", "other"] },
          email: { type: "string", description: "Primary email address (alternative to emails array)" },
          emails: { type: "array", items: { type: "object", properties: { address: { type: "string" }, type: { type: "string" }, is_primary: { type: "boolean" } }, required: ["address"] } },
          phones: { type: "array", items: { type: "object" } },
          addresses: { type: "array", items: { type: "object" } },
          social_profiles: { type: "array", items: { type: "object" } },
          tag_ids: { type: "array", items: { type: "string" } },
          source: { type: "string" },
        },
      },
    },
    {
      name: "add_note",
      description: "Add a structured timestamped note to a contact. Returns the note object with id, body, created_at. Optionally scope the note to a specific company context.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          note: { type: "string", description: "Note text/body" },
          created_by: { type: "string", description: "Agent or user who created the note (optional)" },
          company_id: { type: "string", description: "Optional company context — scope this note to a specific contact-company pair" },
        },
        required: ["contact_id", "note"],
      },
    },
    {
      name: "list_notes",
      description: "List all structured notes for a contact, ordered by date ascending. Optionally filter by company_id to show only notes scoped to that contact-company pair.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          company_id: { type: "string", description: "Optional company ID — if provided, only returns notes scoped to this contact-company pair" },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "delete_note",
      description: "Delete a specific note by its ID.",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string" } },
        required: ["note_id"],
      },
    },
    {
      name: "link_contact_to_project",
      description: "Associate a contact with a todos project ID. Contacts can belong to multiple projects.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          project_id: { type: "string", description: "Todos project ID" },
        },
        required: ["contact_id", "project_id"],
      },
    },
    {
      name: "unlink_contact_from_project",
      description: "Remove the association between a contact and a todos project.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          project_id: { type: "string" },
        },
        required: ["contact_id", "project_id"],
      },
    },
    {
      name: "list_contacts_by_project",
      description: "List all contacts linked to a specific todos project ID.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          limit: { type: "number", description: "Max results (default 100)" },
          offset: { type: "number" },
        },
        required: ["project_id"],
      },
    },
    {
      name: "list_contacts_by_company",
      description: "List all contacts belonging to a specific company. Equivalent to list_contacts with company_id filter but more ergonomic.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number" },
        },
        required: ["company_id"],
      },
    },
    {
      name: "list_contacts_by_tag",
      description: "List all contacts with a specific tag. Accepts either a tag ID (UUID) or a tag name string.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Tag name or tag ID (UUID)" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number" },
        },
        required: ["tag"],
      },
    },
    {
      name: "create_group",
      description: "Create a new group for organizing contacts. Groups are named collections that can hold multiple contacts.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          project_id: { type: "string", description: "Associate this group with a todos project ID" },
        },
        required: ["name"],
      },
    },
    {
      name: "list_groups",
      description: "List all groups with their member counts.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Filter groups by todos project ID" },
        },
      },
    },
    {
      name: "get_group",
      description: "Get a group by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_group",
      description: "Update a group's name, description, or project association.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          project_id: { type: "string", description: "Associate with a todos project ID (null to clear)" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_group",
      description: "Delete a group by ID. Contacts in the group are not deleted — only the group itself.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "add_contact_to_group",
      description: "Add one or more contacts to a group. Pass contact_id for a single contact, or contact_ids (array) for bulk.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "Single contact ID (use contact_ids for bulk)" },
          contact_ids: { type: "array", items: { type: "string" }, description: "Multiple contact IDs to add at once" },
          group_id: { type: "string" },
        },
        required: ["group_id"],
      },
    },
    {
      name: "remove_contact_from_group",
      description: "Remove a contact from a group.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          group_id: { type: "string" },
        },
        required: ["contact_id", "group_id"],
      },
    },
    {
      name: "list_contacts_in_group",
      description: "List all contact IDs in a group.",
      inputSchema: {
        type: "object",
        properties: { group_id: { type: "string" } },
        required: ["group_id"],
      },
    },
    {
      name: "list_groups_for_contact",
      description: "List all groups that a contact belongs to.",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "get_contact_by_email",
      description: "Fast lookup of a contact by exact email address. Returns null if not found. Unlike search_contacts, this is a precise read-only lookup with no side effects.",
      inputSchema: {
        type: "object",
        properties: { email: { type: "string", description: "Exact email address to look up" } },
        required: ["email"],
      },
    },
    {
      name: "add_email_to_contact",
      description: "Append a new email address to a contact. Idempotent — silently skips if the email already exists on this contact.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          address: { type: "string" },
          type: { type: "string", enum: ["work", "personal", "other"] },
          is_primary: { type: "boolean" },
        },
        required: ["contact_id", "address"],
      },
    },
    {
      name: "add_phone_to_contact",
      description: "Append a new phone number to a contact. Idempotent — silently skips if the number already exists on this contact.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          number: { type: "string" },
          type: { type: "string", enum: ["mobile", "work", "home", "fax", "whatsapp", "other"] },
          country_code: { type: "string" },
          is_primary: { type: "boolean" },
        },
        required: ["contact_id", "number"],
      },
    },
    {
      name: "archive_contact",
      description: "Soft-delete a contact by setting archived=true. Archived contacts are excluded from list_contacts and search_contacts by default. Use unarchive_contact to restore.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "unarchive_contact",
      description: "Restore an archived contact. Sets archived=false so the contact reappears in lists and searches.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "archive_company",
      description: "Soft-delete a company by setting archived=true. Archived companies are excluded from list_companies by default.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "unarchive_company",
      description: "Restore an archived company. Sets archived=false.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "find_duplicates",
      description: "Scan contacts for potential duplicates — by shared email address (exact) or by similar display name (Levenshtein distance ≤ 2). Returns groups of contact IDs that may be the same person.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_interactions",
      description: "List activity log entries for a contact or company. Shows all logged interactions, creates, updates, and merges in reverse chronological order.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          company_id: { type: "string" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number" },
        },
      },
    },
    {
      name: "add_tag_to_company",
      description: "Apply an existing tag to a company. Use list_tags to find tag IDs.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          tag_id: { type: "string" },
        },
        required: ["company_id", "tag_id"],
      },
    },
    {
      name: "remove_tag_from_company",
      description: "Remove a tag from a company. The tag itself is not deleted.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          tag_id: { type: "string" },
        },
        required: ["company_id", "tag_id"],
      },
    },
    {
      name: "add_company_to_group",
      description: "Add a company to a group. Returns { added, already_member } — idempotent.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          group_id: { type: "string" },
        },
        required: ["company_id", "group_id"],
      },
    },
    {
      name: "remove_company_from_group",
      description: "Remove a company from a group.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          group_id: { type: "string" },
        },
        required: ["company_id", "group_id"],
      },
    },
    {
      name: "list_companies_in_group",
      description: "List all company IDs in a group.",
      inputSchema: {
        type: "object",
        properties: { group_id: { type: "string" } },
        required: ["group_id"],
      },
    },
    {
      name: "list_groups_for_company",
      description: "List all groups that a company belongs to.",
      inputSchema: {
        type: "object",
        properties: { company_id: { type: "string" } },
        required: ["company_id"],
      },
    },
    {
      name: "bulk_create_contacts",
      description: "Create multiple contacts in one call. Each item in the contacts array follows the same schema as create_contact. Returns { created, errors }.",
      inputSchema: {
        type: "object",
        properties: {
          contacts: {
            type: "array",
            items: { type: "object" },
            description: "Array of contact input objects (same schema as create_contact)",
          },
        },
        required: ["contacts"],
      },
    },
    {
      name: "auto_link_to_company",
      description: "Auto-link a contact to a company by matching the contact's email domain against known company domains. Only sets company_id if the contact has no company yet and a matching company exists. Returns the updated contact, or null if no match.",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "add_company_relationship",
      description: "Declare a typed relationship between a contact and a company. relationship_type: client|vendor|partner|employee|contractor|investor|advisor|tax_preparer|bank_manager|attorney|registered_agent|accountant|payroll_specialist|insurance_broker|other. Supports optional start_date, end_date, is_primary, and status fields.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          company_id: { type: "string" },
          relationship_type: { type: "string", enum: ["client", "vendor", "partner", "employee", "contractor", "investor", "advisor", "tax_preparer", "bank_manager", "attorney", "registered_agent", "accountant", "payroll_specialist", "insurance_broker", "other"] },
          notes: { type: "string" },
          start_date: { type: "string", description: "ISO date when the relationship began (YYYY-MM-DD)" },
          end_date: { type: "string", description: "ISO date when the relationship ended (YYYY-MM-DD)" },
          is_primary: { type: "boolean", description: "Whether this is the primary contact for this relationship type at this company" },
          status: { type: "string", enum: ["active", "inactive", "ended"], description: "Relationship status (default: active)" },
        },
        required: ["contact_id", "company_id", "relationship_type"],
      },
    },
    {
      name: "list_company_relationships",
      description: "List typed contact↔company relationships, optionally filtered by contact, company, or type.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          company_id: { type: "string" },
          relationship_type: { type: "string" },
        },
      },
    },
    {
      name: "delete_company_relationship",
      description: "Delete a contact↔company relationship by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "import_contacts_from_gmail",
      description: "Extract unique contacts from Gmail messages matching a search query and batch-upsert them. Requires connect-gmail auth login first. Returns { imported, skipped, errors }.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query, e.g. 'from:(company.com) newer_than:30d'" },
          max_messages: { type: "number", description: "Max messages to scan (default 200, max 500)" },
          gmail_profile: { type: "string", description: "connect-gmail profile to use (default: 'default')" },
          tag_ids: { type: "array", items: { type: "string" }, description: "Tag IDs to apply to all imported contacts" },
          group_id: { type: "string", description: "Group ID to add all imported contacts to" },
          dry_run: { type: "boolean", description: "If true, extract contacts but do not save to database" },
        },
        required: ["query"],
      },
    },
    {
      name: "sync_from_google_contacts",
      description: "Pull contacts from Google Contacts (People API) and upsert them into the local database. Skips contacts that already exist by email. Requires connect-googlecontacts auth login. Returns { imported, skipped, errors }.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional search query to filter which Google Contacts to import" },
          page_size: { type: "number", description: "Contacts per page (default: connector default)" },
          google_profile: { type: "string", description: "connect-googlecontacts profile (default: 'default')" },
          tag_ids: { type: "array", items: { type: "string" }, description: "Tag IDs to apply to all imported contacts" },
          project_id: { type: "string", description: "Project ID to assign to all imported contacts" },
          dry_run: { type: "boolean", description: "Preview what would be imported without saving" },
        },
      },
    },
    {
      name: "push_contact_to_google",
      description: "Push a local contact to Google Contacts — creates a new Google contact (or updates if google_resource_name is stored in custom_fields). Requires connect-googlecontacts auth login.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string", description: "Local contact ID to push" },
          google_profile: { type: "string", description: "connect-googlecontacts profile (default: 'default')" },
          update_existing: { type: "boolean", description: "If true, update existing Google contact when google_resource_name is present in custom_fields" },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "search_google_contacts",
      description: "Search Google Contacts by name or email (read-only, does not import). Returns raw Google People API objects. Useful for lookup or preview before a push/sync.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          google_profile: { type: "string", description: "connect-googlecontacts profile (default: 'default')" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_contact_workload",
      description: "Get a comprehensive workload summary for a contact: entities/companies they manage, active tasks assigned to them, overdue tasks, pending applications they're linked to, days since last contact, org memberships with specializations. Essential for checking if a key contact is overloaded or responsive.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "list_overdue_contact_tasks",
      description: "List all contact tasks that are past their deadline and not yet completed/cancelled. Includes escalation rules so agents know who to escalate to.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "check_escalations",
      description: "Check all contact tasks with escalation rules to see which ones should be escalated now based on days overdue vs escalation thresholds. Returns tasks with the contact to escalate to.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "add_org_member",
      description: "Add a contact as an org member of a company (employee, team member) with optional title, specialization, office phone, SLA hours, and notes.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          contact_id: { type: "string" },
          title: { type: "string" },
          specialization: { type: "string" },
          office_phone: { type: "string" },
          response_sla_hours: { type: "number" },
          notes: { type: "string" },
        },
        required: ["company_id", "contact_id"],
      },
    },
    {
      name: "list_org_members",
      description: "List all org members (contacts) of a company.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
        },
        required: ["company_id"],
      },
    },
    {
      name: "update_org_member",
      description: "Update an org member's title, specialization, office phone, SLA hours, or notes.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          specialization: { type: "string" },
          office_phone: { type: "string" },
          response_sla_hours: { type: "number" },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "remove_org_member",
      description: "Remove a contact from a company's org members by org member record ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "log_vendor_communication",
      description: "Log a vendor communication (email, invoice request, call, payment, etc.) for a company. Track invoice amounts, references, follow-up dates, and status.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          contact_id: { type: "string" },
          comm_date: { type: "string", description: "ISO date (defaults to today)" },
          type: { type: "string", enum: ["email", "call", "meeting", "invoice_request", "invoice_received", "payment", "dispute", "other"] },
          direction: { type: "string", enum: ["inbound", "outbound"] },
          subject: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["sent", "awaiting_response", "responded", "no_response", "resolved"] },
          invoice_amount: { type: "number" },
          invoice_currency: { type: "string" },
          invoice_ref: { type: "string" },
          follow_up_date: { type: "string", description: "ISO date for follow-up (YYYY-MM-DD)" },
        },
        required: ["company_id", "type"],
      },
    },
    {
      name: "list_vendor_communications",
      description: "List vendor communications for a company, optionally filtered by type or status.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          type: { type: "string", enum: ["email", "call", "meeting", "invoice_request", "invoice_received", "payment", "dispute", "other"] },
          status: { type: "string", enum: ["sent", "awaiting_response", "responded", "no_response", "resolved"] },
        },
        required: ["company_id"],
      },
    },
    {
      name: "list_missing_invoices",
      description: "List all invoice_request communications with no_response or awaiting_response status — vendors who haven't sent invoices yet.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_pending_followups",
      description: "List all vendor communications with follow_up_date on or before today that haven't been marked done.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "mark_followup_done",
      description: "Mark a vendor communication follow-up as done.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "create_contact_task",
      description: "Create a task assigned to a contact, with optional deadline, priority, entity link, escalation rules, and todos task link.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          contact_id: { type: "string" },
          description: { type: "string" },
          assigned_by: { type: "string" },
          deadline: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          entity_id: { type: "string", description: "Company/entity ID this task is for" },
          escalation_rules: { type: "array", items: { type: "object", properties: { after_days: { type: "number" }, escalate_to_contact_id: { type: "string" }, method: { type: "string", enum: ["email", "note", "both"] } }, required: ["after_days", "escalate_to_contact_id", "method"] } },
          linked_todos_task_id: { type: "string" },
        },
        required: ["title", "contact_id"],
      },
    },
    {
      name: "list_contact_tasks",
      description: "List contact tasks, optionally filtered by contact, entity, status, or priority.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          entity_id: { type: "string" },
          status: { type: "string", enum: ["pending", "awaiting_response", "in_progress", "completed", "cancelled", "escalated"] },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        },
      },
    },
    {
      name: "update_contact_task",
      description: "Update a contact task's title, status, deadline, priority, description, or escalation rules.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["pending", "awaiting_response", "in_progress", "completed", "cancelled", "escalated"] },
          deadline: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          description: { type: "string" },
          escalation_rules: { type: "array", items: { type: "object" } },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_contact_task",
      description: "Delete a contact task by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "create_application",
      description: "Create an application record (grant, AI credits, startup program, visa, trademark, tax filing, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          program_name: { type: "string" },
          type: { type: "string", enum: ["ai_credits", "grant", "startup_program", "visa", "trademark", "tax_filing", "loan", "other"] },
          value_usd: { type: "number" },
          provider_company_id: { type: "string" },
          primary_contact_id: { type: "string" },
          status: { type: "string", enum: ["draft", "submitted", "pending", "approved", "rejected", "follow_up_needed", "expired", "cancelled"] },
          submitted_date: { type: "string" },
          follow_up_date: { type: "string" },
          notes: { type: "string" },
          method: { type: "string", enum: ["email", "form", "typeform", "hubspot", "manual", "browser", "feathery", "other"] },
          form_url: { type: "string" },
        },
        required: ["program_name"],
      },
    },
    {
      name: "list_applications",
      description: "List applications, optionally filtered by type, status, or provider company.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["ai_credits", "grant", "startup_program", "visa", "trademark", "tax_filing", "loan", "other"] },
          status: { type: "string", enum: ["draft", "submitted", "pending", "approved", "rejected", "follow_up_needed", "expired", "cancelled"] },
          provider_company_id: { type: "string" },
        },
      },
    },
    {
      name: "update_application",
      description: "Update an application's program name, status, dates, value, notes, or other fields.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          program_name: { type: "string" },
          type: { type: "string", enum: ["ai_credits", "grant", "startup_program", "visa", "trademark", "tax_filing", "loan", "other"] },
          value_usd: { type: "number" },
          provider_company_id: { type: "string" },
          primary_contact_id: { type: "string" },
          status: { type: "string", enum: ["draft", "submitted", "pending", "approved", "rejected", "follow_up_needed", "expired", "cancelled"] },
          submitted_date: { type: "string" },
          decision_date: { type: "string" },
          follow_up_date: { type: "string" },
          notes: { type: "string" },
          method: { type: "string" },
          form_url: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "get_followup_due_applications",
      description: "List applications with follow_up_date on or before today that haven't been completed or cancelled.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_owned_entities",
      description: "List all companies marked as owned entities (is_owned_entity=true) — your legal entities, subsidiaries, and operating companies.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_entity_team",
      description: "Get the full team for an owned entity — all contacts linked via company_relationships, with their roles and primary status.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
        },
        required: ["company_id"],
      },
    },
    // ─── v0.4.0 tools ──────────────────────────────────────────────────────────
    {
      name: "get_contact_brief",
      description: "Generate a comprehensive pre-meeting briefing for a contact. Returns structured markdown covering: role/company, contact details, status, last contacted, open tasks, overdue items, entity relationships, recent notes, recent activity. Feed this to an AI before a meeting or call.",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "list_cold_contacts",
      description: "List contacts you haven't been in touch with for N days (default 30). Sorted by most neglected first. Use to identify who needs re-engagement. 'never' means last_contacted_at was never set.",
      inputSchema: {
        type: "object",
        properties: { days: { type: "number", description: "Days threshold (default 30)" } },
      },
    },
    {
      name: "get_upcoming",
      description: "Get a unified calendar of upcoming items: follow-ups due, birthdays, task deadlines, application follow-ups, vendor follow-ups. Default 7-day window. Returns items sorted by date with urgency (overdue/today/upcoming).",
      inputSchema: {
        type: "object",
        properties: { days: { type: "number", description: "Days ahead to show (default 7)" } },
      },
    },
    {
      name: "get_network_stats",
      description: "Get comprehensive network health stats: contact counts, cold contacts (30d/60d/never), data completeness, overdue tasks, pending applications, missing invoices, active deal pipeline value. The health dashboard for your network.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "audit_contacts",
      description: "Score all contacts for data completeness (0-100). Points: email +20, phone +15, company +15, last_contacted_at +20, tags +10, notes +10, job_title +10. Returns contacts sorted by score ascending (worst first) so you know who to enrich.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Number to show (default 20)" } },
      },
    },
    {
      name: "create_deal",
      description: "Create a new deal or opportunity, optionally linked to a contact and/or company.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          contact_id: { type: "string" },
          company_id: { type: "string" },
          stage: { type: "string", enum: ["prospecting", "qualified", "proposal", "negotiation", "won", "lost"], description: "Deal stage (default: prospecting)" },
          value_usd: { type: "number" },
          currency: { type: "string" },
          close_date: { type: "string", description: "Expected close date (YYYY-MM-DD)" },
          notes: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "get_deal",
      description: "Get a deal by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_deals",
      description: "List deals, optionally filtered by stage, contact, or company.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ["prospecting", "qualified", "proposal", "negotiation", "won", "lost"] },
          contact_id: { type: "string" },
          company_id: { type: "string" },
        },
      },
    },
    {
      name: "update_deal",
      description: "Update a deal's title, stage, value, close date, or notes.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          stage: { type: "string", enum: ["prospecting", "qualified", "proposal", "negotiation", "won", "lost"] },
          value_usd: { type: "number" },
          close_date: { type: "string" },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_deal",
      description: "Delete a deal by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "log_event",
      description: "Log a meeting, call, or interaction event with one or more contacts.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: ["meeting", "call", "email", "lunch", "conference", "demo", "other"] },
          event_date: { type: "string", description: "ISO date or datetime of the event" },
          duration_min: { type: "number", description: "Duration in minutes" },
          contact_ids: { type: "array", items: { type: "string" }, description: "Contact IDs who attended" },
          company_id: { type: "string" },
          notes: { type: "string" },
          outcome: { type: "string" },
          deal_id: { type: "string" },
        },
        required: ["title", "event_date"],
      },
    },
    {
      name: "list_events",
      description: "List events, optionally filtered by contact, company, type, or date range.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          company_id: { type: "string" },
          type: { type: "string" },
          date_from: { type: "string" },
          date_to: { type: "string" },
        },
      },
    },
    {
      name: "delete_event",
      description: "Delete an event by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "get_contact_timeline",
      description: "Get full chronological activity history for a contact: notes, events, tasks, vendor communications, interactions — all unified in reverse date order. The account history view.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          limit: { type: "number", description: "Max items (default 50)" },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "enrich_contact",
      description: "Search the web for missing contact data (LinkedIn, Twitter, GitHub, phone, company website) using the contact's name, email, and company. Returns SUGGESTIONS only — does not auto-apply. Review and apply with update_contact.",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "get_contacts_for_context",
      description: "Find contacts relevant to a topic or domain. Searches job titles, notes, specializations, company names, relationship types, tags, and org memberships. Returns ranked results with relevance reason. Essential for agents: 'who do I contact about trademark law?' → returns attorneys at Revision Legal.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Topic or domain to search for (e.g. 'trademark law', 'payroll', 'banking')" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["topic"],
      },
    },
    {
      name: "set_reminder",
      description: "Schedule a follow-up reminder for a contact. Sets follow_up_at to the specified date and adds a note with the reminder text. Will appear in get_upcoming results. Use: set_reminder({contact_id, remind_at: '2026-04-01', note: 'Check on invoice status'})",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          remind_at: { type: "string", description: "Reminder date (YYYY-MM-DD)" },
          note: { type: "string", description: "Optional reminder note" },
        },
        required: ["contact_id", "remind_at"],
      },
    },
    {
      name: "check_and_fire_webhooks",
      description: "Check all registered webhooks and fire any that match current conditions: contact.stale (last_contacted_at > 30 days), task.overdue (deadline passed), followup.due (follow_up_at <= today). Returns list of fired webhooks.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "bulk_tag_contacts",
      description: "Apply or remove a tag from multiple contacts at once. Either pass contact_ids array directly, or pass a search query and all matching contacts will be tagged. Returns count of contacts tagged.",
      inputSchema: {
        type: "object",
        properties: {
          tag_id_or_name: { type: "string", description: "Tag ID (UUID) or tag name to apply/remove" },
          action: { type: "string", enum: ["add", "remove"] },
          contact_ids: { type: "array", items: { type: "string" }, description: "Specific contact IDs (alternative to query)" },
          query: { type: "string", description: "Search query — all matching contacts will be tagged" },
        },
        required: ["tag_id_or_name", "action"],
      },
    },
    {
      name: "set_do_not_contact",
      description: "Mark a contact as do-not-contact (DNC). They will be excluded from list_contacts, cold, and upcoming results unless explicitly requested. Use for GDPR compliance or unsubscribes.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          do_not_contact: { type: "boolean" },
          reason: { type: "string", description: "Reason for DNC flag (optional)" },
        },
        required: ["contact_id", "do_not_contact"],
      },
    },
    // ─── v0.5.0 tools ──────────────────────────────────────────────────────────
    // Temporal tools (CON-00069/70)
    { name: "get_field_history", description: "Get the change history for one or all fields of a contact (temporal audit trail).", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, field_name: { type: "string", description: "Optional — filter to a single field" } }, required: ["contact_id"] } },
    { name: "get_contact_at", description: "Reconstruct a contact's profile as it was at a specific point in time, using field history.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, timestamp: { type: "string", description: "ISO 8601 datetime — reconstruct profile at this point in time" } }, required: ["contact_id", "timestamp"] } },
    { name: "get_job_history", description: "Get the employment timeline for a contact — all past and current job entries in reverse chronological order.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "add_job_entry", description: "Add a job history entry to a contact's employment timeline.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, company_name: { type: "string" }, title: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, is_current: { type: "boolean" } }, required: ["contact_id", "company_name"] } },
    // Learnings tools (CON-00071/82)
    { name: "save_learning", description: "Save a structured learning about a contact — preferences, facts, inferences, warnings, or signals. Include confidence (0-100) and importance (1-10).", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, content: { type: "string" }, type: { type: "string", enum: ["preference", "fact", "inference", "warning", "signal"] }, confidence: { type: "number" }, importance: { type: "number" }, learned_by: { type: "string" }, visibility: { type: "string", enum: ["private", "shared", "human"] }, tags: { type: "array", items: { type: "string" } } }, required: ["contact_id", "content"] } },
    { name: "get_learnings", description: "Get all learnings for a contact, optionally filtered by type and minimum importance.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, type: { type: "string", enum: ["preference", "fact", "inference", "warning", "signal"] }, min_importance: { type: "number" } }, required: ["contact_id"] } },
    { name: "search_learnings", description: "Cross-contact search across all learnings for a keyword or phrase.", inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string" }, contact_id: { type: "string", description: "Optional — limit to a specific contact" } }, required: ["query"] } },
    { name: "confirm_learning", description: "Confirm a learning as correct, boosting its confidence score.", inputSchema: { type: "object", properties: { learning_id: { type: "string" }, agent_name: { type: "string" } }, required: ["learning_id", "agent_name"] } },
    { name: "get_stale_learnings", description: "Find learnings that haven't been confirmed recently and may need review.", inputSchema: { type: "object", properties: { days_old: { type: "number" }, min_confidence: { type: "number" } } } },
    { name: "run_learning_maintenance", description: "Run decay (reduce confidence on old unconfirmed learnings) and contradiction detection across all learnings.", inputSchema: { type: "object", properties: {} } },
    // Coordination tools (CON-00072)
    { name: "acquire_contact_lock", description: "Acquire a write lock on a contact to prevent conflicts when multiple agents edit the same record. Returns {acquired, lock, held_by}.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, agent_name: { type: "string" }, ttl_seconds: { type: "number" }, reason: { type: "string" }, session_id: { type: "string" } }, required: ["contact_id", "agent_name"] } },
    { name: "release_contact_lock", description: "Release a contact write lock previously acquired by this agent.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, agent_name: { type: "string" } }, required: ["contact_id", "agent_name"] } },
    { name: "check_contact_lock", description: "Check if a contact is currently locked by any agent.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "log_agent_activity", description: "Log an agent action against a contact for audit/coordination purposes.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, agent_name: { type: "string" }, action: { type: "string" }, details: { type: "string" }, session_id: { type: "string" } }, required: ["contact_id", "agent_name", "action"] } },
    { name: "get_contact_agent_activity", description: "Get the recent agent activity log for a contact.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, limit: { type: "number" } }, required: ["contact_id"] } },
    // Graph tools (CON-00073)
    { name: "get_relationship_strength", description: "Compute and return the relationship strength score (0-100) for a contact based on interaction frequency and recency.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "find_warm_path", description: "Find the shortest warm introduction path between two contacts through the relationship graph.", inputSchema: { type: "object", properties: { from_contact_id: { type: "string" }, to_contact_id: { type: "string" } }, required: ["from_contact_id", "to_contact_id"] } },
    { name: "find_connections_at_company", description: "Find all contacts linked to a specific company, with relationship strength scores.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
    { name: "get_cooling_relationships", description: "Get all relationships that are cooling (no contact in 45+ days) — use to prioritize re-engagement outreach.", inputSchema: { type: "object", properties: {} } },
    // Identity tools (CON-00074)
    { name: "resolve_contact_identity", description: "Resolve a contact's identity from partial signals (email, name, LinkedIn URL, phone, or external system ID). Returns ranked matches with confidence scores.", inputSchema: { type: "object", properties: { email: { type: "string" }, name: { type: "string" }, linkedin_url: { type: "string" }, phone: { type: "string" }, system: { type: "string" }, external_id: { type: "string" } } } },
    { name: "add_contact_identity", description: "Register an external system identity (e.g. Salesforce ID, LinkedIn URL) for a contact.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, system: { type: "string" }, external_id: { type: "string" }, external_url: { type: "string" }, confidence: { type: "string", enum: ["verified", "inferred"] } }, required: ["contact_id", "system", "external_id"] } },
    { name: "get_contact_identities", description: "Get all registered external system identities for a contact.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    // Semantic search (CON-00075)
    { name: "semantic_search_contacts", description: "Search contacts by capability or context using TF-IDF semantic similarity — finds contacts based on meaning, not just keyword match.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
    { name: "embed_all_contacts", description: "Build TF-IDF embeddings for all contacts in the database — run once to enable semantic_search_contacts.", inputSchema: { type: "object", properties: {} } },
    // Signals (CON-00076)
    { name: "get_relationship_signals", description: "Get relationship health signals for a contact: warming/cooling/ghost/healthy status with reasons.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "get_ghost_contacts", description: "List contacts you haven't been in touch with for 180+ days — relationships at risk of becoming permanently cold.", inputSchema: { type: "object", properties: {} } },
    { name: "get_warming_contacts", description: "List contacts with rising interaction frequency — relationships gaining momentum.", inputSchema: { type: "object", properties: {} } },
    { name: "recompute_signals", description: "Recompute engagement_status for all contacts based on interaction counts and recency.", inputSchema: { type: "object", properties: {} } },
    // Context packaging (CON-00077)
    { name: "get_contact_card", description: "Get a minimal ~50-token contact summary: name, title, company, primary email and phone. Ideal for lists and agent context injection.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "assemble_context", description: "Assemble a multi-contact context package for meetings, deals, outreach, or research. Returns task-relevant briefs for each contact.", inputSchema: { type: "object", properties: { contact_ids: { type: "array", items: { type: "string" } }, format: { type: "string", enum: ["meeting_prep", "deal_review", "outreach", "research"] } }, required: ["contact_ids"] } },
    // Capture tools (CON-00078)
    { name: "parse_email_signature", description: "Parse an email signature text to extract contact fields (name, title, company, phone, email, LinkedIn, website). Does NOT create a contact.", inputSchema: { type: "object", properties: { signature_text: { type: "string" } }, required: ["signature_text"] } },
    { name: "ingest_email_participants", description: "Find or create contacts from email thread participants (with optional signatures). Returns { created, updated, contacts }.", inputSchema: { type: "object", properties: { participants: { type: "array", items: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, signature: { type: "string" } }, required: ["email"] } }, context: { type: "string" } }, required: ["participants"] } },
    { name: "ingest_meeting_participants", description: "Ingest meeting attendees: find-or-create contacts and log the meeting as an event. Returns { created, updated, contact_ids }.", inputSchema: { type: "object", properties: { title: { type: "string" }, event_date: { type: "string" }, attendees: { type: "array", items: { type: "object", properties: { name: { type: "string" }, email: { type: "string" } }, required: ["name", "email"] } }, context: { type: "string" } }, required: ["title", "event_date", "attendees"] } },
    // Freshness tools (CON-00079)
    { name: "get_freshness_score", description: "Get a per-field freshness and confidence breakdown for a contact — shows which fields are verified, stale, or missing.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "get_stale_contacts", description: "List contacts with low data completeness scores (below threshold). Default threshold: 40.", inputSchema: { type: "object", properties: { threshold: { type: "number", description: "Score threshold 0-100 (default 40)" } } } },
    { name: "mark_field_verified", description: "Mark a specific contact field as verified by a human or trusted source.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, field_name: { type: "string" }, source: { type: "string" } }, required: ["contact_id", "field_name"] } },
    // Org chart + deal team (CON-00080)
    { name: "add_org_chart_edge", description: "Add a relationship edge to the org chart for a company (reports_to, manages, peer, collaborates_with).", inputSchema: { type: "object", properties: { company_id: { type: "string" }, contact_a_id: { type: "string" }, contact_b_id: { type: "string" }, edge_type: { type: "string", enum: ["reports_to", "manages", "collaborates_with", "peer"] } }, required: ["company_id", "contact_a_id", "contact_b_id", "edge_type"] } },
    { name: "get_org_chart", description: "Get the org chart for a company as a list of directed edges with contact names.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
    { name: "set_deal_contact_role", description: "Assign a contact a buying committee role in a deal (economic_buyer, technical_evaluator, champion, blocker, influencer, user, sponsor, other).", inputSchema: { type: "object", properties: { deal_id: { type: "string" }, contact_id: { type: "string" }, account_role: { type: "string", enum: ["economic_buyer", "technical_evaluator", "champion", "blocker", "influencer", "user", "sponsor", "other"] } }, required: ["deal_id", "contact_id", "account_role"] } },
    { name: "get_deal_team", description: "Get the full buying committee for a deal with contact names and roles.", inputSchema: { type: "object", properties: { deal_id: { type: "string" } }, required: ["deal_id"] } },
    { name: "get_coverage_gaps", description: "Identify coverage gaps in a company account — missing economic buyer, technical evaluator, or org chart relationships.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
    // Events/subscriptions (CON-00081)
    { name: "get_recent_contact_events", description: "Polling fallback for change events — returns recent activity log entries, optionally filtered by event type or date.", inputSchema: { type: "object", properties: { since: { type: "string", description: "ISO 8601 datetime — only events after this date" }, event_types: { type: "array", items: { type: "string" } } } } },
    // Image management
    { name: "set_contact_photo", description: "Set a contact's profile photo. Provide either a local file path or base64-encoded image data (with or without data URI prefix). Stores image in ~/.contacts/images/ and updates avatar_url. Supported formats: jpg, png, gif, webp, svg, avif.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, image: { type: "string", description: "File path (e.g. /tmp/photo.jpg) OR base64 data (e.g. data:image/png;base64,...) OR raw base64 string" }, format: { type: "string", description: "Image format hint when using raw base64 (jpg, png, webp). Not needed for file paths or data URIs." } }, required: ["contact_id", "image"] } },
    { name: "get_contact_photo", description: "Get a contact's profile photo as base64 data URI. Returns null if no photo is set.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "delete_contact_photo", description: "Remove a contact's profile photo.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "set_company_logo", description: "Set a company's logo image. Provide either a local file path or base64-encoded image data. Stores image in ~/.contacts/images/ and updates logo_url.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, image: { type: "string", description: "File path or base64 data" }, format: { type: "string", description: "Image format hint for raw base64" } }, required: ["company_id", "image"] } },
    { name: "get_company_logo", description: "Get a company's logo as base64 data URI.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
    { name: "delete_company_logo", description: "Remove a company's logo image.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
    // ─── v0.6.0 tools ──────────────────────────────────────────────────────────
    // Sensitivity
    { name: "set_sensitivity", description: "Set a contact's sensitivity level (normal, confidential, restricted). Restricted contacts are hidden from list/search unless explicitly requested.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, sensitivity: { type: "string", enum: ["normal", "confidential", "restricted"] } }, required: ["contact_id", "sensitivity"] } },
    // Vault
    { name: "vault_init", description: "Initialize the encrypted document vault with a passphrase. Must be called before storing documents or health data.", inputSchema: { type: "object", properties: { passphrase: { type: "string" } }, required: ["passphrase"] } },
    { name: "vault_unlock", description: "Unlock the vault for this session with a passphrase.", inputSchema: { type: "object", properties: { passphrase: { type: "string" } }, required: ["passphrase"] } },
    { name: "vault_lock", description: "Lock the vault, clearing the encryption key from memory.", inputSchema: { type: "object", properties: {} } },
    { name: "vault_status", description: "Check vault initialization and lock status.", inputSchema: { type: "object", properties: {} } },
    // Documents
    { name: "add_document", description: "Store a document for a contact (passport, tax_id, medical_record, etc.). Text values are encrypted; file attachments are stored plain so agents can read them. Vault must be unlocked.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, doc_type: { type: "string", enum: [...DOCUMENT_TYPES] }, label: { type: "string" }, value: { type: "string", description: "Plaintext value (will be encrypted in DB)" }, file_path: { type: "string", description: "File to attach — stored PLAIN in ~/.contacts/documents/ for agent access" }, metadata: { type: "object" }, expires_at: { type: "string" } }, required: ["contact_id", "doc_type", "value"] } },
    { name: "list_documents", description: "List documents for a contact (metadata only — no decryption needed). Returns file_path for attachments so agents can read them directly.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "get_document", description: "Get a document with decrypted value and file_path. Vault must be unlocked for the text value; file is always accessible.", inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"] } },
    { name: "get_document_file", description: "Get the plain file path for a document attachment. Agents can read this file directly — it is NOT encrypted. Returns null if no file attached.", inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"] } },
    { name: "delete_document", description: "Delete a document and its file attachment.", inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"] } },
    // Document scanner
    { name: "scan_document", description: "Scan a document image using AI vision (OpenAI GPT-4o) to extract structured data. Optionally auto-save to vault.", inputSchema: { type: "object", properties: { image: { type: "string", description: "File path or base64 image data" }, doc_type: { type: "string", description: "Hint: passport, national_id, drivers_license, etc." }, contact_id: { type: "string", description: "Contact to associate scanned document with" }, auto_save: { type: "boolean", description: "Automatically save extracted data as a vault document" } }, required: ["image"] } },
    // Health data
    { name: "set_health_data", description: "Set or update health data for a contact. Vault must be unlocked.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, blood_type: { type: "string" }, allergies: { type: "array", items: { type: "string" } }, medical_conditions: { type: "array", items: { type: "string" } }, medications: { type: "array", items: { type: "string" } }, emergency_contacts: { type: "array", items: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, relationship: { type: "string" } }, required: ["name", "phone", "relationship"] } }, health_insurance_provider: { type: "string" }, health_insurance_id: { type: "string" }, primary_physician: { type: "string" }, primary_physician_phone: { type: "string" }, organ_donor: { type: "boolean" }, notes: { type: "string" } }, required: ["contact_id"] } },
    { name: "get_health_data", description: "Get health data for a contact. Vault must be unlocked.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "delete_health_data", description: "Delete all health data for a contact.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "create_contact": {
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
        // Link to multiple projects if project_ids array was provided
        if (Array.isArray(a.project_ids) && (a.project_ids as string[]).length > 0) {
          setContactProjects(contact.id, a.project_ids as string[]);
        }
        const projectIds = getContactProjectIds(contact.id);
        return { content: [{ type: "text", text: JSON.stringify({ ...contact, project_ids: projectIds }, null, 2) }] };
      }

      case "get_contact": {
        const contact = getContact(a.id as string);
        if (contact) {
          const projectIds = getContactProjectIds(contact.id);
          return { content: [{ type: "text", text: JSON.stringify({ ...contact, project_ids: projectIds }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "update_contact": {
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
        // Update project links if project_ids provided
        if (Array.isArray(rest.project_ids)) {
          setContactProjects(id as string, rest.project_ids as string[]);
        }
        const projectIds = getContactProjectIds(id as string);
        return { content: [{ type: "text", text: JSON.stringify({ ...contact, project_ids: projectIds }, null, 2) }] };
      }

      case "delete_contact": {
        deleteContact(a.id as string);
        return { content: [{ type: "text", text: `Contact ${a.id} deleted successfully` }] };
      }

      case "list_contacts": {
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
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "search_contacts": {
        const contacts = searchContacts(a.query as string);
        return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
      }

      case "create_company": {
        const rawTagIds = a.tag_ids;
        const tagIds: string[] | undefined = typeof rawTagIds === "string"
          ? (JSON.parse(rawTagIds) as string[])
          : rawTagIds as string[] | undefined;
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
        const company = createCompany(input);
        return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
      }

      case "get_company": {
        const company = getCompany(a.id as string);
        if (!company) {
          return { content: [{ type: "text", text: `Company not found: ${a.id}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
      }

      case "update_company": {
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
        const company = updateCompany(id as string, input);
        return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
      }

      case "delete_company": {
        deleteCompany(a.id as string);
        return { content: [{ type: "text", text: `Company ${a.id} deleted successfully` }] };
      }

      case "list_companies": {
        const result = listCompanies({
          tag_id: a.tag_id as string | undefined,
          industry: a.industry as string | undefined,
          project_id: a.project_id as string | undefined,
          archived: a.archived as boolean | undefined,
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "search_companies": {
        const companies = searchCompanies(a.query as string);
        return { content: [{ type: "text", text: JSON.stringify(companies, null, 2) }] };
      }

      case "create_tag": {
        const input: CreateTagInput = {
          name: a.name as string,
          color: a.color as string | undefined,
          description: a.description as string | undefined,
        };
        const tag = createTag(input);
        return { content: [{ type: "text", text: JSON.stringify(tag, null, 2) }] };
      }

      case "list_tags": {
        const tags = listTags();
        return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
      }

      case "delete_tag": {
        deleteTag(a.id as string);
        return { content: [{ type: "text", text: `Tag ${a.id} deleted successfully` }] };
      }

      case "add_tag_to_contact": {
        addTagToContact(a.contact_id as string, a.tag_id as string);
        return { content: [{ type: "text", text: `Tag ${a.tag_id} added to contact ${a.contact_id}` }] };
      }

      case "remove_tag_from_contact": {
        removeTagFromContact(a.contact_id as string, a.tag_id as string);
        return { content: [{ type: "text", text: `Tag ${a.tag_id} removed from contact ${a.contact_id}` }] };
      }

      case "add_relationship": {
        const input: CreateRelationshipInput = {
          contact_a_id: a.contact_a_id as string,
          contact_b_id: a.contact_b_id as string,
          relationship_type: a.relationship_type as RelationshipType,
          notes: a.notes as string | undefined,
        };
        const rel = createRelationship(input);
        return { content: [{ type: "text", text: JSON.stringify(rel, null, 2) }] };
      }

      case "list_relationships": {
        const rels = listRelationships({ contact_id: a.contact_id as string });
        return { content: [{ type: "text", text: JSON.stringify(rels, null, 2) }] };
      }

      case "delete_relationship": {
        deleteRelationship(a.id as string);
        return { content: [{ type: "text", text: `Relationship ${a.id} deleted successfully` }] };
      }

      case "merge_contacts": {
        const merged = mergeContacts(a.keep_id as string, a.merge_id as string);
        return { content: [{ type: "text", text: JSON.stringify(merged, null, 2) }] };
      }

      case "import_contacts": {
        const format = a.format as "json" | "csv" | "vcf";
        const data = a.data as string;
        const inputs = await importContacts(format, data);
        let importedCount = 0;
        const errors: string[] = [];
        for (const input of inputs) {
          try {
            createContact(input);
            importedCount++;
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ imported: importedCount, errors: errors.length, error_details: errors }, null, 2),
          }],
        };
      }

      case "get_stats": {
        const db = getDatabase();
        const contactCount = (db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number }).count;
        const companyCount = (db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number }).count;
        const tagCount = (db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number }).count;
        const groupCount = (db.prepare("SELECT COUNT(*) as count FROM groups").get() as { count: number }).count;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ contacts: contactCount, companies: companyCount, tags: tagCount, groups: groupCount }, null, 2),
          }],
        };
      }

      case "log_interaction": {
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
        const contact = updateContact(contactId, updateInput);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "find_or_create_contact": {
        const db = getDatabase();
        // Search by email first (exact match)
        const emailAddresses = (a.emails as Array<{ address: string }> | undefined)?.map(e => e.address) ?? [];
        let found = null;
        for (const addr of emailAddresses) {
          const emailRow = db.prepare(`SELECT contact_id FROM emails WHERE LOWER(address) = LOWER(?) AND contact_id IS NOT NULL LIMIT 1`).get(addr) as { contact_id: string } | null;
          if (emailRow) {
            found = getContact(emailRow.contact_id);
            break;
          }
        }
        // Fall back to fuzzy name search — try display_name, then build from first+last
        if (!found) {
          const nameQuery = (a.display_name as string | undefined)
            ?? (a.first_name || a.last_name ? `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() : null);
          if (nameQuery) {
            const results = searchContacts(nameQuery);
            if (results.length > 0) found = results[0]!;
          }
        }
        if (found) {
          return { content: [{ type: "text", text: JSON.stringify({ contact: found, found: true, created: false }, null, 2) }] };
        }
        const focInput: CreateContactInput = {
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
        };
        const contact = createContact(focInput);
        return { content: [{ type: "text", text: JSON.stringify({ contact, found: false, created: true }, null, 2) }] };
      }

      case "upsert_contact": {
        const db = getDatabase();
        // Gather all email addresses to search
        const upsertEmails = (a.emails as Array<{ address: string }> | undefined)?.map(e => e.address) ?? [];
        if (a.email) upsertEmails.unshift(a.email as string);
        let existingContact = null;
        for (const addr of upsertEmails) {
          const emailRow = db.prepare(`SELECT contact_id FROM emails WHERE address = ? AND contact_id IS NOT NULL LIMIT 1`).get(addr) as { contact_id: string } | null;
          if (emailRow) {
            existingContact = getContact(emailRow.contact_id);
            break;
          }
        }
        if (existingContact) {
          const updateInput: UpdateContactInput = {
            first_name: a.first_name as string | undefined,
            last_name: a.last_name as string | undefined,
            display_name: a.display_name as string | undefined,
            nickname: a.nickname as string | null | undefined,
            job_title: a.job_title as string | null | undefined,
            company_id: a.company_id as string | null | undefined,
            notes: a.notes as string | null | undefined,
            birthday: a.birthday as string | null | undefined,
            website: a.website as string | null | undefined,
            last_contacted_at: a.last_contacted_at as string | null | undefined,
            preferred_contact_method: a.preferred_contact_method as UpdateContactInput["preferred_contact_method"],
            source: a.source as UpdateContactInput["source"],
          };
          const updated = updateContact(existingContact.id, updateInput);
          return { content: [{ type: "text", text: JSON.stringify({ contact: updated, action: "updated" }, null, 2) }] };
        }
        const createInput: CreateContactInput = {
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
          emails: a.email
            ? [{ address: a.email as string, is_primary: true }, ...(a.emails as CreateContactInput["emails"] ?? [])]
            : a.emails as CreateContactInput["emails"],
          phones: a.phones as CreateContactInput["phones"],
          addresses: a.addresses as CreateContactInput["addresses"],
          social_profiles: a.social_profiles as CreateContactInput["social_profiles"],
          tag_ids: a.tag_ids as string[] | undefined,
          source: a.source as CreateContactInput["source"],
        };
        const created = createContact(createInput);
        return { content: [{ type: "text", text: JSON.stringify({ contact: created, action: "created" }, null, 2) }] };
      }

      case "add_note": {
        const noteObj = addNote(
          a.contact_id as string,
          a.note as string,
          a.created_by as string | undefined,
          undefined,
          a.company_id as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(noteObj, null, 2) }] };
      }

      case "list_notes": {
        const db = getDatabase();
        const companyId = a.company_id as string | undefined;
        const notes = companyId
          ? listNotesForContactAtCompany(a.contact_id as string, companyId, db)
          : listNotes(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
      }

      case "delete_note": {
        deleteNote(a.note_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      case "link_contact_to_project": {
        linkContactToProject(a.contact_id as string, a.project_id as string);
        const projectIds = getContactProjectIds(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ contact_id: a.contact_id, project_ids: projectIds }) }] };
      }

      case "unlink_contact_from_project": {
        unlinkContactFromProject(a.contact_id as string, a.project_id as string);
        const projectIds = getContactProjectIds(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ contact_id: a.contact_id, project_ids: projectIds }) }] };
      }

      case "list_contacts_by_project": {
        const db = getDatabase();
        const contactIds = listContactIdsByProject(a.project_id as string);
        const limit = (a.limit as number) ?? 100;
        const offset = (a.offset as number) ?? 0;
        const paged = contactIds.slice(offset, offset + limit);
        const contacts = paged.map(id => getContact(id, db)).filter(Boolean);
        return { content: [{ type: "text", text: JSON.stringify({ contacts, total: contactIds.length, project_id: a.project_id }, null, 2) }] };
      }

      case "list_contacts_by_company": {
        const result = listContacts({
          company_id: a.company_id as string,
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "list_contacts_by_tag": {
        const tagInput = a.tag as string;
        const db = getDatabase();
        // Determine if it's a UUID or a name
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tagInput);
        let tagId = isUuid ? tagInput : null;
        if (!tagId) {
          const tag = getTagByName(tagInput, db);
          if (!tag) return { content: [{ type: "text", text: `Tag not found: ${tagInput}` }], isError: true };
          tagId = tag.id;
        }
        const result = listContacts({
          tag_id: tagId,
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "create_group": {
        const db = getDatabase();
        const group = createGroup(db, { name: a.name as string, description: a.description as string | undefined, project_id: a.project_id as string | undefined });
        return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
      }

      case "list_groups": {
        const db = getDatabase();
        const groups = listGroups(db, a.project_id as string | undefined);
        return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
      }

      case "get_group": {
        const db = getDatabase();
        const group = getGroup(db, a.id as string);
        if (!group) return { content: [{ type: "text", text: `Group not found: ${a.id}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
      }

      case "update_group": {
        const db = getDatabase();
        const { id: groupId, ...groupRest } = a;
        const group = updateGroup(db, groupId as string, {
          name: groupRest.name as string | undefined,
          description: groupRest.description as string | undefined,
          project_id: groupRest.project_id as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
      }

      case "delete_group": {
        const db = getDatabase();
        deleteGroup(db, a.id as string);
        return { content: [{ type: "text", text: `Group ${a.id} deleted successfully` }] };
      }

      case "add_contact_to_group": {
        const db = getDatabase();
        const groupId = a.group_id as string;
        const ids: string[] = a.contact_ids
          ? (a.contact_ids as string[])
          : [a.contact_id as string];
        if (ids.length === 1) {
          const result = addContactToGroup(db, ids[0]!, groupId);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        let added = 0;
        const errors: string[] = [];
        for (const cid of ids) {
          try { addContactToGroup(db, cid, groupId); added++; }
          catch (e) { errors.push(`${cid}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        return { content: [{ type: "text", text: JSON.stringify({ added, errors: errors.length, error_details: errors }, null, 2) }] };
      }

      case "remove_contact_from_group": {
        const db = getDatabase();
        removeContactFromGroup(db, a.contact_id as string, a.group_id as string);
        return { content: [{ type: "text", text: `Contact ${a.contact_id} removed from group ${a.group_id}` }] };
      }

      case "list_contacts_in_group": {
        const db = getDatabase();
        const contactIds = listContactsInGroup(db, a.group_id as string);
        return { content: [{ type: "text", text: JSON.stringify(contactIds, null, 2) }] };
      }

      case "list_groups_for_contact": {
        const db = getDatabase();
        const groups = listGroupsForContact(db, a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
      }

      case "get_contact_by_email": {
        const contact = getContactByEmail(a.email as string);
        if (!contact) return { content: [{ type: "text", text: "null" }] };
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "add_email_to_contact": {
        const contact = addEmailToContact(a.contact_id as string, {
          address: a.address as string,
          type: a.type as "work" | "personal" | "other" | undefined,
          is_primary: a.is_primary as boolean | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "add_phone_to_contact": {
        const contact = addPhoneToContact(a.contact_id as string, {
          number: a.number as string,
          type: a.type as "mobile" | "work" | "home" | "fax" | "whatsapp" | "other" | undefined,
          country_code: a.country_code as string | undefined,
          is_primary: a.is_primary as boolean | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "archive_contact": {
        const contact = archiveContact(a.id as string);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "unarchive_contact": {
        const contact = unarchiveContact(a.id as string);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "archive_company": {
        const company = archiveCompany(a.id as string);
        return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
      }

      case "unarchive_company": {
        const company = unarchiveCompany(a.id as string);
        return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
      }

      case "find_duplicates": {
        const db = getDatabase();
        const byEmail = findEmailDuplicates(db);
        const byName = findNameDuplicates(db);
        return { content: [{ type: "text", text: JSON.stringify({ by_email: byEmail, by_name: byName }, null, 2) }] };
      }

      case "list_interactions": {
        const result = listActivity({
          contact_id: a.contact_id as string | undefined,
          company_id: a.company_id as string | undefined,
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "add_tag_to_company": {
        addTagToCompany(a.company_id as string, a.tag_id as string);
        return { content: [{ type: "text", text: `Tag ${a.tag_id} added to company ${a.company_id}` }] };
      }

      case "remove_tag_from_company": {
        removeTagFromCompany(a.company_id as string, a.tag_id as string);
        return { content: [{ type: "text", text: `Tag ${a.tag_id} removed from company ${a.company_id}` }] };
      }

      case "add_company_to_group": {
        const db = getDatabase();
        const result = addCompanyToGroup(db, a.company_id as string, a.group_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "remove_company_from_group": {
        const db = getDatabase();
        removeCompanyFromGroup(db, a.company_id as string, a.group_id as string);
        return { content: [{ type: "text", text: `Company ${a.company_id} removed from group ${a.group_id}` }] };
      }

      case "list_companies_in_group": {
        const db = getDatabase();
        const companyIds = listCompaniesInGroup(db, a.group_id as string);
        return { content: [{ type: "text", text: JSON.stringify(companyIds, null, 2) }] };
      }

      case "list_groups_for_company": {
        const db = getDatabase();
        const groups = listGroupsForCompany(db, a.company_id as string);
        return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
      }

      case "bulk_create_contacts": {
        const contacts = a.contacts as Record<string, unknown>[];
        let created = 0;
        const errors: string[] = [];
        for (const item of contacts) {
          try {
            createContact(item as CreateContactInput);
            created++;
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ created, errors: errors.length, error_details: errors }, null, 2) }] };
      }

      case "auto_link_to_company": {
        const contact = autoLinkContactToCompany(a.contact_id as string);
        if (!contact) return { content: [{ type: "text", text: "null" }] };
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "add_company_relationship": {
        const rel = createCompanyRelationship({
          contact_id: a.contact_id as string,
          company_id: a.company_id as string,
          relationship_type: a.relationship_type as "client" | "vendor" | "partner" | "employee" | "contractor" | "investor" | "advisor" | "tax_preparer" | "bank_manager" | "attorney" | "registered_agent" | "accountant" | "payroll_specialist" | "insurance_broker" | "other",
          notes: a.notes as string | undefined,
          start_date: a.start_date as string | undefined,
          end_date: a.end_date as string | undefined,
          is_primary: a.is_primary as boolean | undefined,
          status: a.status as "active" | "inactive" | "ended" | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(rel, null, 2) }] };
      }

      case "list_company_relationships": {
        const rels = listCompanyRelationships({
          contact_id: a.contact_id as string | undefined,
          company_id: a.company_id as string | undefined,
          relationship_type: a.relationship_type as "client" | "vendor" | "partner" | "employee" | "contractor" | "investor" | "advisor" | "other" | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(rels, null, 2) }] };
      }

      case "delete_company_relationship": {
        deleteCompanyRelationship(a.id as string);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      case "import_contacts_from_gmail": {
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
      }

      case "sync_from_google_contacts": {
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
      }

      case "push_contact_to_google": {
        const contact = getContact(a.contact_id as string);
        const result = await pushContactToGoogle(contact, {
          profile: (a.google_profile as string | undefined) ?? "default",
          update_existing: a.update_existing as boolean | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...result, contact_id: contact.id }, null, 2) }] };
      }

      case "search_google_contacts": {
        const people = await searchGoogleContacts(a.query as string, {
          profile: (a.google_profile as string | undefined) ?? "default",
        });
        const mapped = people.map((p) => ({
          google: p,
          as_contact_input: googlePersonToContactInput(p),
        }));
        return { content: [{ type: "text", text: JSON.stringify(mapped, null, 2) }] };
      }

      // ─── get_contact_workload ─────────────────────────────────────────────────
      case "get_contact_workload": {
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
      }

      case "list_overdue_contact_tasks": {
        const db = getDatabase();
        const overdue = listOverdueTasks(db);
        return { content: [{ type: "text", text: JSON.stringify(overdue, null, 2) }] };
      }

      case "check_escalations": {
        const db = getDatabase();
        const escalations = checkEscalations(db);
        return { content: [{ type: "text", text: JSON.stringify(escalations, null, 2) }] };
      }

      // ─── org_members ─────────────────────────────────────────────────────────
      case "add_org_member": {
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
      }

      case "list_org_members": {
        const db = getDatabase();
        const members = listOrgMembers(a.company_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
      }

      case "update_org_member": {
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
      }

      case "remove_org_member": {
        const db = getDatabase();
        removeOrgMember(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      // ─── vendor_communications ────────────────────────────────────────────────
      case "log_vendor_communication": {
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
      }

      case "list_vendor_communications": {
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
      }

      case "list_missing_invoices": {
        const db = getDatabase();
        const missing = listMissingInvoices(db);
        return { content: [{ type: "text", text: JSON.stringify(missing, null, 2) }] };
      }

      case "list_pending_followups": {
        const db = getDatabase();
        const pending = listPendingFollowUps(db);
        return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
      }

      case "mark_followup_done": {
        const db = getDatabase();
        const updated = markFollowUpDone(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
      }

      // ─── contact_tasks ────────────────────────────────────────────────────────
      case "create_contact_task": {
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
      }

      case "list_contact_tasks": {
        const db = getDatabase();
        const tasks = listContactTasks({
          contact_id: a.contact_id as string | undefined,
          entity_id: a.entity_id as string | undefined,
          status: a.status as UpdateContactTaskInput["status"],
          priority: a.priority as UpdateContactTaskInput["priority"],
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }

      case "update_contact_task": {
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
      }

      case "delete_contact_task": {
        const db = getDatabase();
        deleteContactTask(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      // ─── applications ─────────────────────────────────────────────────────────
      case "create_application": {
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
      }

      case "list_applications": {
        const db = getDatabase();
        const apps = listApplications({
          type: a.type as CreateApplicationInput["type"],
          status: a.status as CreateApplicationInput["status"],
          provider_company_id: a.provider_company_id as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
      }

      case "update_application": {
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
      }

      case "get_followup_due_applications": {
        const db = getDatabase();
        const apps = getFollowUpDueApplications(db);
        return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
      }

      case "list_owned_entities": {
        const result = listCompanies({ limit: 200 });
        const owned = result.companies.filter((c: { is_owned_entity: boolean }) => c.is_owned_entity);
        return { content: [{ type: "text", text: JSON.stringify(owned, null, 2) }] };
      }

      case "get_entity_team": {
        const db = getDatabase();
        const company = getCompany(a.company_id as string);
        const team = listCompanyRelationships({ company_id: a.company_id as string }, db);
        return { content: [{ type: "text", text: JSON.stringify({ company, team }, null, 2) }] };
      }

      // ─── v0.4.0 handlers ──────────────────────────────────────────────────────

      case "list_cold_contacts": {
        const db = getDatabase();
        const contacts = listColdContacts((a.days as number | undefined) ?? 30, db);
        return { content: [{ type: "text", text: JSON.stringify({ contacts }, null, 2) }] };
      }

      case "get_upcoming": {
        const db = getDatabase();
        const items = getUpcomingItems((a.days as number | undefined) ?? 7, db);
        return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
      }

      case "get_network_stats": {
        const db = getDatabase();
        const stats = getNetworkStats(db);
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }

      case "audit_contacts": {
        const db = getDatabase();
        const results = (await listContactAudit(db)).slice(0, (a.limit as number | undefined) ?? 20);
        return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
      }

      case "create_deal": {
        const db = getDatabase();
        const deal = createDeal({
          title: a.title as string,
          contact_id: a.contact_id as string | undefined,
          company_id: a.company_id as string | undefined,
          stage: a.stage as import("../types/index.js").DealStage | undefined,
          value_usd: a.value_usd as number | undefined,
          currency: a.currency as string | undefined,
          close_date: a.close_date as string | undefined,
          notes: a.notes as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
      }

      case "get_deal": {
        const db = getDatabase();
        const deal = getDeal(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
      }

      case "list_deals": {
        const db = getDatabase();
        const deals = listDeals({
          stage: a.stage as import("../types/index.js").DealStage | undefined,
          contact_id: a.contact_id as string | undefined,
          company_id: a.company_id as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify({ deals }, null, 2) }] };
      }

      case "update_deal": {
        const db = getDatabase();
        const { id: dealId, ...dealRest } = a;
        const deal = updateDeal(dealId as string, {
          title: dealRest.title as string | undefined,
          stage: dealRest.stage as import("../types/index.js").DealStage | undefined,
          value_usd: dealRest.value_usd as number | undefined,
          close_date: dealRest.close_date as string | undefined,
          notes: dealRest.notes as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(deal, null, 2) }] };
      }

      case "delete_deal": {
        const db = getDatabase();
        deleteDeal(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      case "log_event": {
        const db = getDatabase();
        const event = logEvent({
          title: a.title as string,
          type: a.type as import("../types/index.js").EventType | undefined,
          event_date: a.event_date as string,
          duration_min: a.duration_min as number | undefined,
          contact_ids: a.contact_ids as string[] | undefined,
          company_id: a.company_id as string | undefined,
          notes: a.notes as string | undefined,
          outcome: a.outcome as string | undefined,
          deal_id: a.deal_id as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
      }

      case "list_events": {
        const db = getDatabase();
        const events = listEvents({
          contact_id: a.contact_id as string | undefined,
          company_id: a.company_id as string | undefined,
          type: a.type as import("../types/index.js").EventType | undefined,
          date_from: a.date_from as string | undefined,
          date_to: a.date_to as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify({ events }, null, 2) }] };
      }

      case "delete_event": {
        const db = getDatabase();
        deleteEvent(a.id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      case "get_contact_timeline": {
        const db = getDatabase();
        const items = getContactTimeline(a.contact_id as string, (a.limit as number | undefined) ?? 50, db);
        return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
      }

      case "enrich_contact": {
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
      }

      case "get_contacts_for_context": {
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
      }

      case "set_reminder": {
        const db = getDatabase();
        updateContact(a.contact_id as string, { follow_up_at: a.remind_at as string });
        if (a.note) {
          addNote(a.contact_id as string, `Reminder (${a.remind_at}): ${a.note}`, undefined, db);
        }
        return { content: [{ type: "text", text: JSON.stringify({ set: true, contact_id: a.contact_id, remind_at: a.remind_at }, null, 2) }] };
      }

      case "check_and_fire_webhooks": {
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
      }

      case "bulk_tag_contacts": {
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
      }

      case "set_do_not_contact": {
        const db = getDatabase();
        updateContact(a.contact_id as string, { do_not_contact: a.do_not_contact as boolean });
        if (a.reason && !!(a.do_not_contact)) {
          addNote(a.contact_id as string, `DNC: ${a.reason}`, undefined, db);
        }
        return { content: [{ type: "text", text: JSON.stringify({ set: true, contact_id: a.contact_id, do_not_contact: a.do_not_contact }, null, 2) }] };
      }

      case "export_contacts": {
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
      }

      // ─── v0.5.0 handlers ──────────────────────────────────────────────────────

      case "get_field_history": {
        const db = getDatabase();
        const history = getFieldHistory(a.contact_id as string, a.field_name as string | undefined, db);
        return { content: [{ type: "text", text: JSON.stringify({ history }, null, 2) }] };
      }

      case "get_contact_at": {
        const db = getDatabase();
        const snapshot = getContactAt(a.contact_id as string, a.timestamp as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ contact_id: a.contact_id, timestamp: a.timestamp, snapshot }, null, 2) }] };
      }

      case "get_job_history": {
        const db = getDatabase();
        const history = getJobHistory(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ history }, null, 2) }] };
      }

      case "add_job_entry": {
        const db = getDatabase();
        const entry = addJobEntry(a.contact_id as string, {
          company_name: a.company_name as string,
          title: a.title as string | undefined,
          start_date: a.start_date as string | undefined,
          end_date: a.end_date as string | undefined,
          is_current: a.is_current as boolean | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
      }

      case "save_learning": {
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
        return { content: [{ type: "text", text: JSON.stringify(learning, null, 2) }] };
      }

      case "get_learnings": {
        const db = getDatabase();
        const learnings = getLearnings(a.contact_id as string, {
          type: a.type as string | undefined,
          min_importance: a.min_importance as number | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify({ learnings }, null, 2) }] };
      }

      case "search_learnings": {
        const db = getDatabase();
        const results = searchLearnings(a.query as string, {
          type: a.type as string | undefined,
          contact_id: a.contact_id as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
      }

      case "confirm_learning": {
        const db = getDatabase();
        confirmLearning(a.learning_id as string, a.agent_name as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ confirmed: true }) }] };
      }

      case "get_stale_learnings": {
        const db = getDatabase();
        const daysOld = (a.days_old as number | undefined) ?? 30;
        const minConf = (a.min_confidence as number | undefined) ?? 0;
        const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
        const rows = db.query(`SELECT * FROM contact_learnings WHERE confirmed_count=0 AND created_at<? AND confidence>=? ORDER BY confidence ASC LIMIT 50`).all(cutoff, minConf) as unknown[];
        return { content: [{ type: "text", text: JSON.stringify({ stale_learnings: rows }, null, 2) }] };
      }

      case "run_learning_maintenance": {
        const db = getDatabase();
        const decayed = decayLearnings(db);
        // Simple contradiction detection: find pairs with same contact_id and similar content patterns
        const duplicates = db.query(`SELECT contact_id, COUNT(*) as cnt FROM contact_learnings GROUP BY contact_id, LOWER(SUBSTR(content,1,30)) HAVING cnt > 1`).all() as unknown[];
        return { content: [{ type: "text", text: JSON.stringify({ decayed_count: decayed, potential_contradictions: duplicates }, null, 2) }] };
      }

      case "acquire_contact_lock": {
        const db = getDatabase();
        const result = acquireLock(
          a.contact_id as string,
          a.agent_name as string,
          a.ttl_seconds as number | undefined,
          a.reason as string | undefined,
          a.session_id as string | undefined,
          db,
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "release_contact_lock": {
        const db = getDatabase();
        const released = releaseLock(a.contact_id as string, a.agent_name as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ released }, null, 2) }] };
      }

      case "check_contact_lock": {
        const db = getDatabase();
        const lock = checkLock(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ locked: !!lock, lock }, null, 2) }] };
      }

      case "log_agent_activity": {
        const db = getDatabase();
        logAgentActivity(
          a.contact_id as string,
          a.agent_name as string,
          a.action as string,
          a.details as string | undefined,
          a.session_id as string | undefined,
          db,
        );
        return { content: [{ type: "text", text: JSON.stringify({ logged: true }) }] };
      }

      case "get_contact_agent_activity": {
        const db = getDatabase();
        const activity = getAgentActivity(a.contact_id as string, (a.limit as number | undefined) ?? 20, db);
        return { content: [{ type: "text", text: JSON.stringify({ activity }, null, 2) }] };
      }

      case "get_relationship_strength": {
        const db = getDatabase();
        const score = computeRelationshipStrength(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ contact_id: a.contact_id, strength_score: score }, null, 2) }] };
      }

      case "find_warm_path": {
        const db = getDatabase();
        const path = findWarmPath(a.from_contact_id as string, a.to_contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ path, hops: path.length }, null, 2) }] };
      }

      case "find_connections_at_company": {
        const db = getDatabase();
        const connections = findConnectionsAtCompany(a.company_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ connections }, null, 2) }] };
      }

      case "get_cooling_relationships": {
        const db = getDatabase();
        const cooling = detectCoolingRelationships(db);
        return { content: [{ type: "text", text: JSON.stringify({ cooling }, null, 2) }] };
      }

      case "resolve_contact_identity": {
        const db = getDatabase();
        const matches = resolveByPartial({
          email: a.email as string | undefined,
          name: a.name as string | undefined,
          linkedin_url: a.linkedin_url as string | undefined,
          phone: a.phone as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify({ matches }, null, 2) }] };
      }

      case "add_contact_identity": {
        const db = getDatabase();
        const identity = addIdentity(
          a.contact_id as string,
          a.system as string,
          a.external_id as string,
          a.external_url as string | undefined,
          (a.confidence as "verified" | "inferred" | undefined) ?? "inferred",
          db,
        );
        return { content: [{ type: "text", text: JSON.stringify(identity, null, 2) }] };
      }

      case "get_contact_identities": {
        const db = getDatabase();
        const identities = getIdentities(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ identities }, null, 2) }] };
      }

      case "semantic_search_contacts": {
        const db = getDatabase();
        const results = semanticSearch(a.query as string, (a.limit as number | undefined) ?? 10, db);
        const enriched = results.map(r => {
          try { return { ...r, contact: getContact(r.contact_id) }; }
          catch { return r; }
        });
        return { content: [{ type: "text", text: JSON.stringify({ results: enriched }, null, 2) }] };
      }

      case "embed_all_contacts": {
        const db = getDatabase();
        const count = await embedAllContacts(db);
        return { content: [{ type: "text", text: JSON.stringify({ embedded: count }) }] };
      }

      case "get_relationship_signals": {
        const db = getDatabase();
        const signals = getRelationshipSignals(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ signals }, null, 2) }] };
      }

      case "get_ghost_contacts": {
        const db = getDatabase();
        const ghosts = getGhostContacts(db);
        return { content: [{ type: "text", text: JSON.stringify({ ghosts }, null, 2) }] };
      }

      case "get_warming_contacts": {
        const db = getDatabase();
        const warming = getWarmingContacts(db);
        return { content: [{ type: "text", text: JSON.stringify({ warming }, null, 2) }] };
      }

      case "recompute_signals": {
        const db = getDatabase();
        const result = recomputeAllSignals(db);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "get_contact_card": {
        const db = getDatabase();
        const card = getContactCard(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(card, null, 2) }] };
      }

      case "get_contact_brief": {
        // Override v0.4.0 handler to support task_context and format params
        const db = getDatabase();
        const taskContext = (a.task_context as string | undefined) ?? (a.format as string | undefined);
        if (taskContext) {
          const brief = getContactBriefContext(a.contact_id as string, taskContext, db);
          return { content: [{ type: "text", text: JSON.stringify(brief, null, 2) }] };
        }
        const brief = generateBrief(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ brief }, null, 2) }] };
      }

      case "assemble_context": {
        const db = getDatabase();
        const ctx = await assembleContext(
          a.contact_ids as string[],
          (a.format as "meeting_prep" | "deal_review" | "outreach" | "research" | undefined) ?? "meeting_prep",
          db,
        );
        return { content: [{ type: "text", text: JSON.stringify(ctx, null, 2) }] };
      }

      case "parse_email_signature": {
        const parsed = parseEmailSignature(a.signature_text as string);
        return { content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }] };
      }

      case "ingest_email_participants": {
        const db = getDatabase();
        const participants = a.participants as Array<{ name?: string; email: string; signature?: string }>;
        const extracted = extractContactsFromEmailThread(participants);
        let created = 0;
        let updated = 0;
        const contacts = [];
        const { findOrCreateContact: findOrCreate } = await import('../db/contacts.js');
        for (const ci of extracted) {
          try {
            const result = await findOrCreate({
              display_name: ci.display_name,
              job_title: ci.job_title,
              website: ci.website,
              emails: ci.emails?.map(e => ({ address: e.address, type: e.type as import('../types/index.js').EmailType, is_primary: e.is_primary })),
              phones: ci.phones?.map(p => ({ number: p.number, type: p.type as import('../types/index.js').PhoneType, is_primary: p.is_primary })),
              social_profiles: ci.social_profiles?.map(s => ({ platform: 'linkedin' as const, url: s.url, is_primary: s.is_primary })),
              source: 'import' as const,
            }, db);
            contacts.push(result.contact);
            if (result.created) created++;
            else updated++;
          } catch { /* skip */ }
        }
        return { content: [{ type: "text", text: JSON.stringify({ created, updated, contacts }, null, 2) }] };
      }

      case "ingest_meeting_participants": {
        const db = getDatabase();
        const result = await ingestMeetingParticipants({
          title: a.title as string,
          event_date: a.event_date as string,
          attendees: a.attendees as Array<{ name: string; email: string }>,
          context: a.context as string | undefined,
        }, db);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "get_freshness_score": {
        const db = getDatabase();
        const score = getFreshnessScore(a.contact_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(score, null, 2) }] };
      }

      case "get_stale_contacts": {
        const db = getDatabase();
        const contacts = getStaleContacts((a.threshold as number | undefined) ?? 40, db);
        return { content: [{ type: "text", text: JSON.stringify({ contacts }, null, 2) }] };
      }

      case "mark_field_verified": {
        const db = getDatabase();
        markFieldVerified(a.contact_id as string, a.field_name as string, a.source as string | undefined, db);
        return { content: [{ type: "text", text: JSON.stringify({ verified: true }) }] };
      }

      case "add_org_chart_edge": {
        const db = getDatabase();
        const edge = addOrgChartEdge(
          a.company_id as string,
          a.contact_a_id as string,
          a.contact_b_id as string,
          a.edge_type as OrgEdgeType,
          false,
          db,
        );
        return { content: [{ type: "text", text: JSON.stringify(edge, null, 2) }] };
      }

      case "get_org_chart": {
        const db = getDatabase();
        const edges = listOrgChart(a.company_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ company_id: a.company_id, edges }, null, 2) }] };
      }

      case "set_deal_contact_role": {
        const db = getDatabase();
        const role = setDealContactRole(a.deal_id as string, a.contact_id as string, a.account_role as AccountRole, db);
        return { content: [{ type: "text", text: JSON.stringify(role, null, 2) }] };
      }

      case "get_deal_team": {
        const db = getDatabase();
        const team = getDealTeam(a.deal_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify({ deal_id: a.deal_id, team }, null, 2) }] };
      }

      case "get_coverage_gaps": {
        const db = getDatabase();
        const gaps = getCoverageGaps(a.company_id as string, db);
        return { content: [{ type: "text", text: JSON.stringify(gaps, null, 2) }] };
      }

      case "get_recent_contact_events": {
        const db = getDatabase();
        const since = a.since as string | undefined;
        const eventTypes = a.event_types as string[] | undefined;
        let sql = `SELECT * FROM activity_log WHERE 1=1`;
        const params: string[] = [];
        if (since) { sql += ` AND created_at >= ?`; params.push(since); }
        if (eventTypes?.length) {
          sql += ` AND action IN (${eventTypes.map(() => '?').join(',')})`;
          params.push(...eventTypes);
        }
        sql += ` ORDER BY created_at DESC LIMIT 100`;
        const events = db.query(sql).all(...params) as unknown[];
        return { content: [{ type: "text", text: JSON.stringify({ events }, null, 2) }] };
      }

      // ─── Image management ──────────────────────────────────────────────
      case "set_contact_photo": {
        const { contact_id, image, format } = a as { contact_id: string; image: string; format?: string };
        const contact = getContact(contact_id);
        const filename = saveImage(contact_id, image, { format });
        updateContact(contact_id, { avatar_url: `~/.contacts/images/${filename}` });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, contact_id, filename, avatar_url: `~/.contacts/images/${filename}` }) }] };
      }
      case "get_contact_photo": {
        const { contact_id } = a as { contact_id: string };
        const dataUri = getImageAsBase64(contact_id);
        if (!dataUri) return { content: [{ type: "text", text: JSON.stringify({ contact_id, has_photo: false, data: null }) }] };
        return { content: [{ type: "text", text: JSON.stringify({ contact_id, has_photo: true, data: dataUri }) }] };
      }
      case "delete_contact_photo": {
        const { contact_id } = a as { contact_id: string };
        const deleted = deleteImage(contact_id);
        if (deleted) updateContact(contact_id, { avatar_url: null });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, deleted }) }] };
      }
      case "set_company_logo": {
        const { company_id, image, format } = a as { company_id: string; image: string; format?: string };
        const co = getCompany(company_id);
        const filename = saveImage(company_id, image, { format });
        updateCompany(company_id, { logo_url: `~/.contacts/images/${filename}` });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, company_id, filename, logo_url: `~/.contacts/images/${filename}` }) }] };
      }
      case "get_company_logo": {
        const { company_id } = a as { company_id: string };
        const dataUri = getImageAsBase64(company_id);
        if (!dataUri) return { content: [{ type: "text", text: JSON.stringify({ company_id, has_logo: false, data: null }) }] };
        return { content: [{ type: "text", text: JSON.stringify({ company_id, has_logo: true, data: dataUri }) }] };
      }
      case "delete_company_logo": {
        const { company_id } = a as { company_id: string };
        const deleted = deleteImage(company_id);
        if (deleted) updateCompany(company_id, { logo_url: null });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, deleted }) }] };
      }

      // ─── v0.6.0 handlers ──────────────────────────────────────────────────────

      case "set_sensitivity": {
        const contact = updateContact(a.contact_id as string, { sensitivity: a.sensitivity as "normal" | "confidential" | "restricted" });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, contact_id: a.contact_id, sensitivity: a.sensitivity }) }] };
      }

      case "vault_init": {
        initVault(a.passphrase as string);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Vault initialized and unlocked" }) }] };
      }

      case "vault_unlock": {
        const ok = unlockVault(a.passphrase as string);
        if (!ok) return { content: [{ type: "text", text: "Invalid passphrase" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Vault unlocked" }) }] };
      }

      case "vault_lock": {
        lockVault();
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Vault locked" }) }] };
      }

      case "vault_status": {
        const initialized = isVaultInitialized();
        const unlocked = isVaultUnlocked();
        const db = getDatabase();
        let docCount = 0;
        try { docCount = (db.query("SELECT COUNT(*) as n FROM contact_documents").get() as { n: number }).n; } catch { /* table may not exist */ }
        return { content: [{ type: "text", text: JSON.stringify({ initialized, unlocked, document_count: docCount }) }] };
      }

      case "add_document": {
        const doc = addDocument({
          contact_id: a.contact_id as string,
          doc_type: a.doc_type as DocumentType,
          label: a.label as string | undefined,
          value: a.value as string,
          file_path: a.file_path as string | undefined,
          metadata: a.metadata as Record<string, unknown> | undefined,
          expires_at: a.expires_at as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      case "list_documents": {
        const docs = listDocuments(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
      }

      case "get_document": {
        const doc = getDocument(a.document_id as string);
        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      case "get_document_file": {
        const db = getDatabase();
        const row = db.query(`SELECT encrypted_file_path FROM contact_documents WHERE id = ?`).get(a.document_id as string) as { encrypted_file_path: string | null } | null;
        if (!row) return { content: [{ type: "text", text: JSON.stringify({ error: "Document not found" }) }], isError: true };
        const filePath = row.encrypted_file_path;
        return { content: [{ type: "text", text: JSON.stringify({ document_id: a.document_id, file_path: filePath, has_file: !!filePath }) }] };
      }

      case "delete_document": {
        deleteDocument(a.document_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      case "scan_document": {
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
            return { content: [{ type: "text", text: JSON.stringify({ scan: result, saved_document: doc }, null, 2) }] };
          } catch (saveErr) {
            return { content: [{ type: "text", text: JSON.stringify({ scan: result, save_error: saveErr instanceof Error ? saveErr.message : String(saveErr) }, null, 2) }] };
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "set_health_data": {
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
        return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
      }

      case "get_health_data": {
        const health = getHealthData(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
      }

      case "delete_health_data": {
        deleteHealthData(a.contact_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const msg = err instanceof ConnectorNotInstalledError || err instanceof ConnectorAuthError
      ? err.message
      : `Error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Contacts MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
