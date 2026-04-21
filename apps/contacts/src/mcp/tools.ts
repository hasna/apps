/** Tool schema definitions for the Contacts MCP server. */
import { DOCUMENT_TYPES } from "../db/documents.js";
export const TOOL_DEFINITIONS = [
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
          stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost", "cancelled"], description: "Deal stage (default: lead)" },
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
          stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost", "cancelled"] },
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
          stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost", "cancelled"] },
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
    { name: "set_contact_photo", description: "Set a contact's profile photo. Provide either a local file path or base64-encoded image data (with or without data URI prefix). Stores image in ~/.hasna/contacts/images/ and updates avatar_url. Supported formats: jpg, png, gif, webp, svg, avif.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, image: { type: "string", description: "File path (e.g. /tmp/photo.jpg) OR base64 data (e.g. data:image/png;base64,...) OR raw base64 string" }, format: { type: "string", description: "Image format hint when using raw base64 (jpg, png, webp). Not needed for file paths or data URIs." } }, required: ["contact_id", "image"] } },
    { name: "get_contact_photo", description: "Get a contact's profile photo as base64 data URI. Returns null if no photo is set.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "delete_contact_photo", description: "Remove a contact's profile photo.", inputSchema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "set_company_logo", description: "Set a company's logo image. Provide either a local file path or base64-encoded image data. Stores image in ~/.hasna/contacts/images/ and updates logo_url.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, image: { type: "string", description: "File path or base64 data" }, format: { type: "string", description: "Image format hint for raw base64" } }, required: ["company_id", "image"] } },
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
    { name: "add_document", description: "Store a document for a contact (passport, tax_id, medical_record, etc.). Text values are encrypted; file attachments are stored plain so agents can read them. Vault must be unlocked.", inputSchema: { type: "object", properties: { contact_id: { type: "string" }, doc_type: { type: "string", enum: [...DOCUMENT_TYPES] }, label: { type: "string" }, value: { type: "string", description: "Plaintext value (will be encrypted in DB)" }, file_path: { type: "string", description: "File to attach — stored PLAIN in ~/.hasna/contacts/documents/ for agent access" }, metadata: { type: "object" }, expires_at: { type: "string" } }, required: ["contact_id", "doc_type", "value"] } },
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
    { name: "send_feedback", description: "Send feedback about this service", inputSchema: { type: "object", properties: { message: { type: "string" }, email: { type: "string" }, category: { type: "string", enum: ["bug", "feature", "general"] } }, required: ["message"] } },
    { name: "register_agent", description: "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.", inputSchema: { type: "object", properties: { name: { type: "string" }, session_id: { type: "string" } }, required: ["name"] } },
    { name: "heartbeat", description: "Update last_seen_at to signal agent is active.", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
    { name: "set_focus", description: "Set active project context for this agent session.", inputSchema: { type: "object", properties: { agent_id: { type: "string" }, project_id: { type: "string" } }, required: ["agent_id"] } },
    { name: "list_agents", description: "List all registered agents.", inputSchema: { type: "object", properties: {} } },
] as const;
