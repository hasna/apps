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
  updateContact,
  deleteContact,
  listContacts,
  searchContacts,
  mergeContacts,
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
} from "../db/groups.js";
import { getTagByName } from "../db/tags.js";
import {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
  listCompanies,
  searchCompanies,
} from "../db/companies.js";
import {
  createTag,
  listTags,
  deleteTag,
  addTagToContact,
  removeTagFromContact,
} from "../db/tags.js";
import {
  createRelationship,
  listRelationships,
  deleteRelationship,
} from "../db/relationships.js";
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
      description: "Update an existing contact's fields. Only provided fields are changed; omitted fields remain unchanged. Supports all contact fields including last_contacted_at, website, preferred_contact_method.",
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
          source: { type: "string", enum: ["manual", "import", "linkedin", "github", "twitter", "email", "calendar", "crm", "other"] },
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
      description: "List contacts with optional filters. Supports filtering by company, tag, or source. Returns paginated results with total count.",
      inputSchema: {
        type: "object",
        properties: {
          company_id: { type: "string" },
          tag_id: { type: "string", description: "Filter by tag ID" },
          limit: { type: "number", description: "Max results (default 50)" },
          offset: { type: "number" },
          order_by: { type: "string", enum: ["display_name", "created_at", "updated_at"] },
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
      description: "List companies with optional filters by industry or tag. Returns paginated results with total count.",
      inputSchema: {
        type: "object",
        properties: {
          tag_id: { type: "string" },
          industry: { type: "string" },
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
          source: rest.source as UpdateContactInput["source"],
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
          limit: a.limit as number | undefined,
          offset: a.offset as number | undefined,
          order_by: a.order_by as "display_name" | "created_at" | "updated_at" | undefined,
          order_dir: a.order_dir as "asc" | "desc" | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "search_contacts": {
        const contacts = searchContacts(a.query as string);
        return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
      }

      case "create_company": {
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
          tag_ids: a.tag_ids as string[] | undefined,
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
        // Search by email first
        const emailAddresses = (a.emails as Array<{ address: string }> | undefined)?.map(e => e.address) ?? [];
        let found = null;
        for (const addr of emailAddresses) {
          const emailRow = db.prepare(`SELECT contact_id FROM emails WHERE address = ? AND contact_id IS NOT NULL LIMIT 1`).get(addr) as { contact_id: string } | null;
          if (emailRow) {
            found = getContact(emailRow.contact_id);
            break;
          }
        }
        // Search by display_name if no email match
        if (!found && a.display_name) {
          const results = searchContacts(a.display_name as string);
          if (results.length > 0) found = results[0]!;
        }
        if (found) {
          return { content: [{ type: "text", text: JSON.stringify({ contact: found, found: true, created: false }, null, 2) }] };
        }
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
          emails: a.emails as CreateContactInput["emails"],
          phones: a.phones as CreateContactInput["phones"],
          addresses: a.addresses as CreateContactInput["addresses"],
          social_profiles: a.social_profiles as CreateContactInput["social_profiles"],
          tag_ids: a.tag_ids as string[] | undefined,
          source: a.source as CreateContactInput["source"],
        };
        const contact = createContact(input);
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
        addContactToGroup(db, a.contact_id as string, a.group_id as string);
        return { content: [{ type: "text", text: `Contact ${a.contact_id} added to group ${a.group_id}` }] };
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
