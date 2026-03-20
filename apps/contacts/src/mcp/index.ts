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
      description: "Create a new contact",
      inputSchema: {
        type: "object",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          display_name: { type: "string", description: "Display name" },
          nickname: { type: "string" },
          job_title: { type: "string" },
          company_id: { type: "string" },
          notes: { type: "string" },
          birthday: { type: "string", description: "YYYY-MM-DD" },
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
          source: { type: "string" },
        },
      },
    },
    {
      name: "get_contact",
      description: "Get a contact by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_contact",
      description: "Update an existing contact",
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
          birthday: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_contact",
      description: "Delete a contact by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_contacts",
      description: "List contacts with optional filters",
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
      description: "Full-text search across contacts",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "create_company",
      description: "Create a new company",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: { type: "string" },
          description: { type: "string" },
          industry: { type: "string" },
          size: { type: "string" },
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
      description: "Get a company by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_company",
      description: "Update an existing company",
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
      description: "Delete a company by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "list_companies",
      description: "List companies with optional filters",
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
      description: "Search companies by name or domain",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "create_tag",
      description: "Create a new tag",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string", description: "Hex color (e.g. #FF5733)" },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "list_tags",
      description: "List all tags",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "delete_tag",
      description: "Delete a tag by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "add_tag_to_contact",
      description: "Add a tag to a contact",
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
      description: "Remove a tag from a contact",
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
      description: "Add a relationship between two contacts",
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
      description: "List all relationships for a contact",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
    },
    {
      name: "delete_relationship",
      description: "Delete a relationship by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "merge_contacts",
      description: "Merge two contacts — keeps one, removes the other, merging all data",
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
      description: "Import contacts from CSV, vCard, or JSON format",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv", "vcf"] },
          data: { type: "string" },
        },
        required: ["format", "data"],
      },
    },
    {
      name: "export_contacts",
      description: "Export contacts to CSV, vCard, or JSON format",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["json", "csv", "vcf"] },
          contact_ids: { type: "array", items: { type: "string" } },
        },
        required: ["format"],
      },
    },
    {
      name: "get_stats",
      description: "Get database statistics (counts of contacts, companies, tags)",
      inputSchema: { type: "object", properties: {} },
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
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ contacts: contactCount, companies: companyCount, tags: tagCount }, null, 2),
          }],
        };
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
