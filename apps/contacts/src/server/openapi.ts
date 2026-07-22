/**
 * OpenAPI 3.1 document for the versioned `/v1` cloud API. This is the SINGLE
 * source of truth the typed SDK is generated from (see scripts/generate-sdk.ts)
 * and is served live at `GET /openapi.json` and `GET /v1/openapi.json`.
 */
import { getPackageVersion } from "../lib/package-version.js";

const contactSchema = {
  type: "object",
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
