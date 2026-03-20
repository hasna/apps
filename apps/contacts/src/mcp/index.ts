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
} from "../db/relationships.js";
import { listActivity } from "../db/activity.js";
import { findEmailDuplicates, findNameDuplicates } from "../lib/dedup.js";
import { importContacts } from "../lib/import.js";
import { exportContacts } from "../lib/export.js";

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
          project_id: { type: "string", description: "Associate contact with a project ID" },
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
          project_id: { type: "string", description: "Project ID to associate this contact with (null to clear)" },
          source: { type: "string", enum: ["manual", "import", "linkedin", "github", "twitter", "email", "calendar", "crm", "other"] },
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
      description: "Export contacts to CSV, vCard (.vcf), or JSON format. Optionally specify contact_ids to export a subset; omit to export all contacts.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv", "vcf"] },
          contact_ids: { type: "array", items: { type: "string" }, description: "Specific contact IDs to export (omit for all)" },
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
      description: "Append a timestamped note to a contact's notes field. Fast and ergonomic — no need for full update_contact. Note is appended as '\\n\\n[YYYY-MM-DD] text' to existing notes.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          note: { type: "string" },
        },
        required: ["contact_id", "note"],
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
        },
        required: ["name"],
      },
    },
    {
      name: "list_groups",
      description: "List all groups with their member counts.",
      inputSchema: { type: "object", properties: {} },
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
      description: "Update a group's name or description.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
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
      description: "Add a contact to a group.",
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
        };
        const contact = createContact(input);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
      }

      case "get_contact": {
        const contact = getContact(a.id as string);
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
          emails_add: rest.emails_add as UpdateContactInput["emails_add"],
          phones_add: rest.phones_add as UpdateContactInput["phones_add"],
        };
        const contact = updateContact(id as string, input);
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
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

      case "export_contacts": {
        const format = a.format as "json" | "csv" | "vcf";
        const contactIds = a.contact_ids as string[] | undefined;
        let contactList;
        if (contactIds && contactIds.length > 0) {
          contactList = contactIds.map((id) => getContact(id));
        } else {
          contactList = listContacts({ limit: 10000 }).contacts;
        }
        const output = await exportContacts(format, contactList);
        return { content: [{ type: "text", text: output }] };
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
        const contactId = a.contact_id as string;
        const note = a.note as string;
        const existing = getContact(contactId);
        const dateStr = new Date().toISOString().slice(0, 10);
        const existingNotes = existing.notes ?? "";
        const updatedNotes = existingNotes ? `${existingNotes}\n\n[${dateStr}] ${note}` : `[${dateStr}] ${note}`;
        const contact = updateContact(contactId, { notes: updatedNotes });
        return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
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
        const group = createGroup(db, { name: a.name as string, description: a.description as string | undefined });
        return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
      }

      case "list_groups": {
        const db = getDatabase();
        const groups = listGroups(db);
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
        const group = updateGroup(db, groupId as string, { name: groupRest.name as string | undefined, description: groupRest.description as string | undefined });
        return { content: [{ type: "text", text: JSON.stringify(group, null, 2) }] };
      }

      case "delete_group": {
        const db = getDatabase();
        deleteGroup(db, a.id as string);
        return { content: [{ type: "text", text: `Group ${a.id} deleted successfully` }] };
      }

      case "add_contact_to_group": {
        const db = getDatabase();
        const result = addContactToGroup(db, a.contact_id as string, a.group_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
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
