/**
 * OpenAPI 3.1 document for the versioned `/v1` cloud API. This is the SINGLE
 * source of truth the typed SDK is generated from (see scripts/generate-sdk.ts)
 * and is served live at `GET /openapi.json` and `GET /v1/openapi.json`.
 */
import { getPackageVersion } from "../lib/package-version.js";

const contactSchema = {
  type: "object",
  required: ["tags"],
  properties: {
    id: { type: "string" },
    first_name: { type: "string" },
    last_name: { type: "string" },
    display_name: { type: "string" },
    nickname: { type: "string", nullable: true },
    company_id: { type: "string", nullable: true },
    job_title: { type: "string", nullable: true },
    notes: { type: "string", nullable: true },
    source: { type: "string" },
    status: { type: "string" },
    sensitivity: { type: "string" },
    archived: { type: "boolean" },
    priority: { type: "number" },
    tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const companySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    domain: { type: "string", nullable: true },
    industry: { type: "string", nullable: true },
    size: { type: "string", nullable: true },
    founded_year: { type: "number", nullable: true },
    notes: { type: "string", nullable: true },
    is_owned_entity: { type: "boolean" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const tagSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
    description: { type: "string", nullable: true },
    created_at: { type: "string" },
  },
} as const;

function objResponse(props: Record<string, unknown>) {
  return {
    "200": {
      content: { "application/json": { schema: { type: "object", properties: props } } },
    },
  };
}

export function buildV1OpenApiDocument(version = getPackageVersion()) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Contacts V1 API",
      version,
      description:
        "Versioned cloud API for @hasna/contacts (A1 pure-remote). Authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`. Read routes require `contacts:read`; write routes require `contacts:write`.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Contact: contactSchema,
        Company: companySchema,
        Tag: tagSchema,
        CreateContactInput: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            display_name: { type: "string" },
            nickname: { type: "string" },
            company_id: { type: "string" },
            job_title: { type: "string" },
            notes: { type: "string" },
            source: { type: "string" },
            status: { type: "string" },
            sensitivity: { type: "string" },
          },
        },
        UpdateContactInput: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            display_name: { type: "string" },
            nickname: { type: "string" },
            company_id: { type: "string" },
            job_title: { type: "string" },
            notes: { type: "string" },
            status: { type: "string" },
          },
        },
        CreateCompanyInput: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            domain: { type: "string" },
            industry: { type: "string" },
            size: { type: "string" },
            founded_year: { type: "number" },
            notes: { type: "string" },
            is_owned_entity: { type: "boolean" },
          },
        },
        UpdateCompanyInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            domain: { type: "string" },
            industry: { type: "string" },
            notes: { type: "string" },
          },
        },
        CreateTagInput: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            color: { type: "string" },
            description: { type: "string" },
          },
        },
        UpdateTagInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            color: { type: "string" },
            description: { type: "string" },
          },
        },
        ProjectIdsInput: {
          type: "object",
          required: ["project_ids"],
          properties: {
            project_ids: {
              type: "array",
              items: { type: "string", minLength: 1 },
              uniqueItems: true,
            },
          },
        },
        ContactProjectMembershipSnapshot: {
          type: "object",
          required: ["contact_id", "project_id", "linked", "version"],
          properties: {
            contact_id: { type: "string" },
            project_id: { type: "string" },
            linked: { type: "boolean" },
            version: { type: "string" },
          },
        },
        ContactProjectMembershipMutationInput: {
          type: "object",
          required: ["operation_id", "step_id", "expected_version"],
          properties: {
            operation_id: { type: "string", minLength: 1 },
            step_id: { type: "string", minLength: 1 },
            expected_version: { type: "string", minLength: 1 },
          },
        },
        ContactProjectMembershipMutationResult: {
          type: "object",
          required: ["outcome", "operation_id", "step_id", "before", "after", "receipt_id"],
          properties: {
            outcome: { type: "string", enum: ["accepted", "duplicate_of_accepted"] },
            operation_id: { type: "string" },
            step_id: { type: "string" },
            before: { $ref: "#/components/schemas/ContactProjectMembershipSnapshot" },
            after: { $ref: "#/components/schemas/ContactProjectMembershipSnapshot" },
            receipt_id: { type: "string" },
          },
        },
        ContactProjectMembershipListResult: {
          type: "object",
          required: ["project_id", "contact_ids", "complete", "membership_revision"],
          properties: {
            project_id: { type: "string" },
            contact_ids: { type: "array", items: { type: "string" } },
            complete: { type: "boolean", const: true },
            membership_revision: { type: "string" },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/contacts": {
        get: {
          operationId: "listContacts",
          summary: "List contacts",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "company_id", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "tag_id", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "number" } },
            { name: "offset", in: "query", schema: { type: "number" } },
          ],
          responses: objResponse({
            contacts: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
            count: { type: "number" },
          }),
        },
        post: {
          operationId: "createContact",
          summary: "Create a contact",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateContactInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { contact: { $ref: "#/components/schemas/Contact" } } },
                },
              },
            },
          },
        },
      },
      "/v1/contacts/{id}": {
        get: {
          operationId: "getContact",
          summary: "Get a contact by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ contact: { $ref: "#/components/schemas/Contact" } }),
        },
        patch: {
          operationId: "updateContact",
          summary: "Update a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateContactInput" } } },
          },
          responses: objResponse({ contact: { $ref: "#/components/schemas/Contact" } }),
        },
        delete: {
          operationId: "deleteContact",
          summary: "Delete a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ deleted: { type: "boolean" }, id: { type: "string" } }),
        },
      },
      "/v1/companies": {
        get: {
          operationId: "listCompanies",
          summary: "List companies",
          parameters: [
            { name: "industry", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "number" } },
            { name: "offset", in: "query", schema: { type: "number" } },
          ],
          responses: objResponse({
            companies: { type: "array", items: { $ref: "#/components/schemas/Company" } },
            count: { type: "number" },
          }),
        },
        post: {
          operationId: "createCompany",
          summary: "Create a company",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateCompanyInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { company: { $ref: "#/components/schemas/Company" } } },
                },
              },
            },
          },
        },
      },
      "/v1/companies/{id}": {
        get: {
          operationId: "getCompany",
          summary: "Get a company by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ company: { $ref: "#/components/schemas/Company" } }),
        },
        patch: {
          operationId: "updateCompany",
          summary: "Update a company",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateCompanyInput" } } },
          },
          responses: objResponse({ company: { $ref: "#/components/schemas/Company" } }),
        },
        delete: {
          operationId: "deleteCompany",
          summary: "Delete a company",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ deleted: { type: "boolean" }, id: { type: "string" } }),
        },
      },
      "/v1/tags": {
        get: {
          operationId: "listTags",
          summary: "List tags",
          parameters: [{ name: "name", in: "query", schema: { type: "string" } }],
          responses: objResponse({
            tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
            count: { type: "number" },
          }),
        },
        post: {
          operationId: "createTag",
          summary: "Create a tag",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTagInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { tag: { $ref: "#/components/schemas/Tag" } } },
                },
              },
            },
          },
        },
      },
      "/v1/tags/{id}": {
        get: {
          operationId: "getTag",
          summary: "Get a tag by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ tag: { $ref: "#/components/schemas/Tag" } }),
        },
        patch: {
          operationId: "updateTag",
          summary: "Update a tag",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTagInput" } } },
          },
          responses: objResponse({ tag: { $ref: "#/components/schemas/Tag" } }),
        },
        delete: {
          operationId: "deleteTag",
          summary: "Delete a tag",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: objResponse({ deleted: { type: "boolean" }, id: { type: "string" } }),
        },
      },
      "/v1/contacts/{contact_id}/tags/{tag_id}": {
        put: {
          operationId: "addTagToContact",
          summary: "Attach a tag to a contact idempotently",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
            { name: "tag_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            attached: { type: "boolean" },
            contact_id: { type: "string" },
            tag_id: { type: "string" },
          }),
        },
        delete: {
          operationId: "removeTagFromContact",
          summary: "Remove a tag from a contact",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
            { name: "tag_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            removed: { type: "boolean" },
            contact_id: { type: "string" },
            tag_id: { type: "string" },
          }),
        },
      },
      "/v1/contacts/{contact_id}/projects": {
        get: {
          operationId: "getContactProjectIds",
          summary: "List project ids attached to a contact",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            contact_id: { type: "string" },
            project_ids: { type: "array", items: { type: "string" } },
          }),
        },
        put: {
          operationId: "setContactProjects",
          summary: "Atomically replace a contact's project memberships",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectIdsInput" } } },
          },
          responses: objResponse({
            contact_id: { type: "string" },
            project_ids: { type: "array", items: { type: "string" } },
          }),
        },
      },
      "/v1/contacts/{contact_id}/projects/{project_id}": {
        put: {
          operationId: "linkContactToProject",
          summary: "Attach a contact to a project idempotently",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            attached: { type: "boolean" },
            contact_id: { type: "string" },
            project_id: { type: "string" },
          }),
        },
        delete: {
          operationId: "unlinkContactFromProject",
          summary: "Detach a contact from a project",
          parameters: [
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            removed: { type: "boolean" },
            contact_id: { type: "string" },
            project_id: { type: "string" },
          }),
        },
      },
      "/v1/projects/{project_id}/contacts": {
        get: {
          operationId: "listContactIdsByProject",
          summary: "List contact ids attached to a project",
          parameters: [
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: objResponse({
            project_id: { type: "string" },
            contact_ids: { type: "array", items: { type: "string" } },
          }),
        },
      },
      "/v1/projects/{project_id}/contact-memberships": {
        get: {
          operationId: "listContactProjectMemberships",
          summary: "List the complete authoritative contact membership collection for a project",
          parameters: [
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
            { name: "max_items", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContactProjectMembershipListResult" },
                },
              },
            },
          },
        },
      },
      "/v1/projects/{project_id}/contact-memberships/{contact_id}": {
        get: {
          operationId: "readContactProjectMembership",
          summary: "Read one authoritative contact-project membership snapshot",
          parameters: [
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContactProjectMembershipSnapshot" },
                },
              },
            },
          },
        },
      },
      "/v1/projects/{project_id}/contact-memberships/{contact_id}/attach": {
        post: {
          operationId: "attachContactProjectMembership",
          summary: "Attach a contact to a project under expected-version CAS with a replay-safe receipt",
          parameters: [
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContactProjectMembershipMutationInput" },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContactProjectMembershipMutationResult" },
                },
              },
            },
          },
        },
      },
      "/v1/projects/{project_id}/contact-memberships/{contact_id}/detach": {
        post: {
          operationId: "detachContactProjectMembership",
          summary: "Detach a contact from a project under expected-version CAS with a replay-safe receipt",
          parameters: [
            { name: "project_id", in: "path", required: true, schema: { type: "string" } },
            { name: "contact_id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContactProjectMembershipMutationInput" },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContactProjectMembershipMutationResult" },
                },
              },
            },
          },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getStats",
          summary: "Aggregate counts",
          responses: objResponse({
            contacts: { type: "number" },
            companies: { type: "number" },
            tags: { type: "number" },
          }),
        },
      },
    },
  };
}
