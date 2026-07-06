import { existsSync } from "fs";
import { join, resolve, relative } from "path";
import { getDatabase } from "../db/database.js";
import {
  createContact,
  getContact,
  updateContact,
  deleteContact,
  listContacts,
  searchContacts,
} from "../db/contacts.js";
import {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
  listCompanies,
} from "../db/companies.js";
import {
  createTag,
  listTags,
  deleteTag,
} from "../db/tags.js";
import type {
  CreateContactInput,
  UpdateContactInput,
  CreateCompanyInput,
  UpdateCompanyInput,
} from "../types/index.js";
import { importContacts } from "../lib/import.js";
import { exportContacts } from "../lib/export.js";
import { getImagePath, saveImage, deleteImage, getImagesDir } from "../lib/images.js";
import { getDocumentsDir } from "../lib/vault.js";
import { handleMcpRequest, healthPayload } from "../mcp/http.js";
import { buildServer } from "../mcp/index.js";
import {
  auditServerAccess,
  authenticateContactsRequest,
  redactContactForExport,
  type ContactsPrincipal,
  type ContactsScope,
} from "./security.js";

const DASHBOARD_DIST = join(import.meta.dir, "../../dashboard/dist");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function getSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function requireScope(req: Request, scope: ContactsScope): ContactsPrincipal | Response {
  const result = authenticateContactsRequest(req, scope);
  if (!result.ok || !result.principal) {
    return apiError(result.message ?? "Unauthorized", result.status ?? 401);
  }
  return result.principal;
}

function isResponse(value: ContactsPrincipal | Response): value is Response {
  return value instanceof Response;
}

function privateFileHeaders(contentType?: string): HeadersInit {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function isSafeEntityId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) && !id.includes("..") && !id.includes("/");
}

function isPathInside(baseDir: string, filePath: string): boolean {
  const base = resolve(baseDir);
  const file = resolve(filePath);
  const rel = relative(base, file);
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/") && !rel.includes("..\\"));
}

// ─── /api/contacts ────────────────────────────────────────────────────────────

async function handleContacts(req: Request, url: URL, segments: string[]): Promise<Response> {
  const method = req.method;
  const id = segments[2];
  const principal = requireScope(req, method === "GET" ? "contacts:read" : "contacts:write");
  if (isResponse(principal)) return principal;

  if (method === "GET" && !id) {
    const q = url.searchParams.get("q");
    if (q) {
      const contacts = searchContacts(q);
      return json(contacts);
    }
    const result = listContacts({
      tag_id: url.searchParams.get("tag_id") ?? url.searchParams.get("tag") ?? undefined,
      company_id: url.searchParams.get("company_id") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "50", 10),
      offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
    });
    return json(result);
  }

  if (method === "POST" && !id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    try {
      const contact = createContact(body as CreateContactInput);
      auditServerAccess("server.contact.created", { contact_id: contact.id }, principal);
      return json(contact, 201);
    } catch (err) {
      return apiError(err instanceof Error ? err.message : "Failed to create contact");
    }
  }

  if (method === "GET" && id) {
    try {
      const contact = getContact(id);
      return json(contact);
    } catch {
      return apiError("Contact not found", 404);
    }
  }

  if (method === "PATCH" && id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    try {
      const contact = updateContact(id, body as UpdateContactInput);
      auditServerAccess("server.contact.updated", { contact_id: id }, principal);
      return json(contact);
    } catch {
      return apiError("Contact not found", 404);
    }
  }

  if (method === "DELETE" && id) {
    try {
      deleteContact(id);
      auditServerAccess("server.contact.deleted", { contact_id: id }, principal);
      return json({ ok: true });
    } catch {
      return apiError("Contact not found", 404);
    }
  }

  return apiError("Method not allowed", 405);
}

// ─── /api/companies ───────────────────────────────────────────────────────────

async function handleCompanies(req: Request, url: URL, segments: string[]): Promise<Response> {
  const method = req.method;
  const id = segments[2];
  const principal = requireScope(req, method === "GET" ? "companies:read" : "companies:write");
  if (isResponse(principal)) return principal;

  if (method === "GET" && !id) {
    const result = listCompanies({
      tag_id: url.searchParams.get("tag_id") ?? undefined,
      industry: url.searchParams.get("industry") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "50", 10),
      offset: parseInt(url.searchParams.get("offset") ?? "0", 10),
    });
    return json(result);
  }

  if (method === "POST" && !id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    try {
      const company = createCompany(body as CreateCompanyInput);
      auditServerAccess("server.company.created", { company_id: company.id }, principal);
      return json(company, 201);
    } catch (err) {
      return apiError(err instanceof Error ? err.message : "Failed to create company");
    }
  }

  if (method === "GET" && id) {
    const company = getCompany(id);
    if (!company) return apiError("Company not found", 404);
    return json(company);
  }

  if (method === "PATCH" && id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    try {
      const company = updateCompany(id, body as UpdateCompanyInput);
      auditServerAccess("server.company.updated", { company_id: id }, principal);
      return json(company);
    } catch {
      return apiError("Company not found", 404);
    }
  }

  if (method === "DELETE" && id) {
    try {
      deleteCompany(id);
      auditServerAccess("server.company.deleted", { company_id: id }, principal);
      return json({ ok: true });
    } catch {
      return apiError("Company not found", 404);
    }
  }

  return apiError("Method not allowed", 405);
}

// ─── /api/tags ────────────────────────────────────────────────────────────────

async function handleTags(req: Request, _url: URL, segments: string[]): Promise<Response> {
  const method = req.method;
  const id = segments[2];
  const principal = requireScope(req, method === "GET" ? "tags:read" : "tags:write");
  if (isResponse(principal)) return principal;

  if (method === "GET" && !id) {
    return json(listTags());
  }

  if (method === "POST" && !id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    const b = body as { name?: string; color?: string; description?: string };
    if (!b.name) return apiError("name is required");
    const tag = createTag({ name: b.name, color: b.color, description: b.description });
    auditServerAccess("server.tag.created", { tag_id: tag.id }, principal);
    return json(tag, 201);
  }

  if (method === "DELETE" && id) {
    try {
      deleteTag(id);
      auditServerAccess("server.tag.deleted", { tag_id: id }, principal);
      return json({ ok: true });
    } catch {
      return apiError("Tag not found", 404);
    }
  }

  return apiError("Method not allowed", 405);
}

// ─── /api/stats ───────────────────────────────────────────────────────────────

function handleStats(req: Request): Response {
  const principal = requireScope(req, "stats:read");
  if (isResponse(principal)) return principal;
  const db = getDatabase();
  const contactCount = (db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number }).count;
  const companyCount = (db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number }).count;
  const tagCount = (db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number }).count;
  return json({ contacts: contactCount, companies: companyCount, tags: tagCount });
}

// ─── /api/import ──────────────────────────────────────────────────────────────

async function handleImport(req: Request): Promise<Response> {
  const principal = requireScope(req, "contacts:import");
  if (isResponse(principal)) return principal;
  const body = await parseJson(req);
  if (!body || typeof body !== "object") return apiError("Invalid body");
  const { format, data } = body as { format?: string; data?: string };
  if (!format || !data) return apiError("format and data are required");
  if (!["json", "csv", "vcf"].includes(format)) return apiError("format must be json, csv, or vcf");

  try {
    const inputs = await importContacts(format as "json" | "csv" | "vcf", data);
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
    auditServerAccess("server.contacts.imported", { imported: importedCount, errors: errors.length }, principal);
    return json({ imported: importedCount, errors: errors.length, error_details: errors });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Import failed");
  }
}

// ─── /api/export ──────────────────────────────────────────────────────────────

async function handleExport(req: Request): Promise<Response> {
  const principal = requireScope(req, "contacts:export");
  if (isResponse(principal)) return principal;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json") as "json" | "csv" | "vcf";
  if (!["json", "csv", "vcf"].includes(format)) return apiError("format must be json, csv, or vcf");
  const includeSensitive = url.searchParams.get("include_sensitive") === "1" || url.searchParams.get("include_sensitive") === "true";
  if (includeSensitive) {
    const full = requireScope(req, "contacts:export:full");
    if (isResponse(full)) return full;
  }

  const { contacts } = listContacts({ limit: 100000 });
  const exported = includeSensitive ? contacts : contacts.map(redactContactForExport);
  const output = await exportContacts(format, exported);
  auditServerAccess("server.contacts.exported", { format, redacted: !includeSensitive, count: exported.length }, principal);

  const contentTypes: Record<string, string> = {
    json: "application/json",
    csv: "text/csv",
    vcf: "text/vcard",
  };

  return new Response(output, {
    headers: {
      "Content-Type": contentTypes[format] ?? "text/plain",
      "Content-Disposition": `attachment; filename="contacts.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ─── /api/documents/:id/file — serve plain document attachments ───────────────

function handleDocumentFiles(req: Request, segments: string[]): Response {
  const principal = requireScope(req, "documents:read");
  if (isResponse(principal)) return principal;
  const docId = segments[2]; // /api/documents/:id
  const sub = segments[3];   // /api/documents/:id/file

  if (!docId) return apiError("Document ID required");
  if (req.method !== "GET") return apiError("Method not allowed", 405);

  if (sub === "file") {
    const db = getDatabase();
    const row = db.query(`SELECT encrypted_file_path FROM contact_documents WHERE id = ?`).get(docId) as { encrypted_file_path: string | null } | null;
    if (!row?.encrypted_file_path || !isPathInside(getDocumentsDir(), row.encrypted_file_path) || !existsSync(row.encrypted_file_path)) {
      return new Response("No file attachment", { status: 404 });
    }
    auditServerAccess("server.document.file.read", { document_id: docId }, principal);
    return new Response(Bun.file(row.encrypted_file_path), {
      headers: privateFileHeaders(),
    });
  }

  return apiError("Use /api/documents/:id/file to get the attachment", 400);
}

// ─── /api/images ─────────────────────────────────────────────────────────────

async function handleImages(req: Request, _url: URL, segments: string[]): Promise<Response> {
  const entityId = segments[2]; // /api/images/:entity-id

  if (!entityId) return apiError("Entity ID required");
  if (!isSafeEntityId(entityId)) return apiError("Invalid entity ID", 400);

  // GET /api/images/:id — serve the image file
  if (req.method === "GET") {
    const principal = requireScope(req, "images:read");
    if (isResponse(principal)) return principal;
    const imagePath = getImagePath(entityId);
    if (!imagePath || !existsSync(imagePath)) {
      return new Response(null, { status: 404, headers: { "Content-Type": "text/plain" } });
    }
    return new Response(Bun.file(imagePath), {
      headers: privateFileHeaders(),
    });
  }

  // POST /api/images/:id — upload image (multipart form-data or base64 JSON)
  if (req.method === "POST") {
    const principal = requireScope(req, "images:write");
    if (isResponse(principal)) return principal;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("image") as File | null;
      if (!file) return apiError("No image file in form data");
      const ext = file.name?.split(".").pop() || "jpg";
      const buffer = Buffer.from(await file.arrayBuffer());
      const tmpPath = join(getImagesDir(), `_upload_${entityId}.${ext}`);
      const { writeFileSync: wfs } = await import("node:fs");
      wfs(tmpPath, buffer);
      try {
        const filename = saveImage(entityId, tmpPath);
        const { unlinkSync } = await import("node:fs");
        try { unlinkSync(tmpPath); } catch {}
        auditServerAccess("server.image.uploaded", { entity_id: entityId, filename }, principal);
        return json({ ok: true, entity_id: entityId, filename });
      } catch (e) {
        return apiError(e instanceof Error ? e.message : "Upload failed");
      }
    }

    // JSON body with base64
    const body = await parseJson(req) as { image?: string; format?: string } | null;
    if (!body?.image) return apiError("Provide image as base64 string or file upload");
    try {
      const filename = saveImage(entityId, body.image, { format: body.format });
      auditServerAccess("server.image.uploaded", { entity_id: entityId, filename }, principal);
      return json({ ok: true, entity_id: entityId, filename });
    } catch (e) {
      return apiError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  // DELETE /api/images/:id — remove image
  if (req.method === "DELETE") {
    const principal = requireScope(req, "images:write");
    if (isResponse(principal)) return principal;
    const deleted = deleteImage(entityId);
    auditServerAccess("server.image.deleted", { entity_id: entityId, deleted }, principal);
    return json({ ok: true, deleted });
  }

  return apiError("Method not allowed", 405);
}

// ─── Static file serving ──────────────────────────────────────────────────────

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;
  return new Response(Bun.file(filePath));
}

// ─── Main server ──────────────────────────────────────────────────────────────

export function createContactsRequestHandler(): (req: Request) => Promise<Response> {
  return async function fetch(req) {
      const url = new URL(req.url);
      const segments = getSegments(url);
      const localRequest = ["localhost", "127.0.0.1", "::1", "[::1]"].includes((req.headers.get("host") ?? url.host).split(":")[0] ?? "");

      const corsHeaders = {
        "Access-Control-Allow-Origin": localRequest ? "*" : "null",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Contacts-Token",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (url.pathname === "/health" && req.method === "GET") {
        return json(healthPayload("contacts"));
      }
      if (url.pathname === "/mcp") {
        const principal = requireScope(req, "mcp:access");
        if (isResponse(principal)) return principal;
        return handleMcpRequest(req, buildServer);
      }

      let response: Response;

      try {
        if (segments[0] === "api") {
          switch (segments[1]) {
            case "contacts":
              response = await handleContacts(req, url, segments);
              break;
            case "companies":
              response = await handleCompanies(req, url, segments);
              break;
            case "tags":
              response = await handleTags(req, url, segments);
              break;
            case "stats":
              response = handleStats(req);
              break;
            case "import":
              response = req.method === "POST"
                ? await handleImport(req)
                : apiError("Method not allowed", 405);
              break;
            case "export":
              response = req.method === "GET"
                ? await handleExport(req)
                : apiError("Method not allowed", 405);
              break;
            case "images":
              response = await handleImages(req, url, segments);
              break;
            case "documents":
              response = handleDocumentFiles(req, segments);
              break;
            default:
              response = apiError("Not found", 404);
          }
        } else {
          const principal = requireScope(req, "dashboard:read");
          if (isResponse(principal)) {
            response = principal;
          } else {
          // Serve dashboard static files
          const filePath = join(DASHBOARD_DIST, url.pathname === "/" ? "index.html" : url.pathname);
          response = serveStaticFile(filePath) ??
            serveStaticFile(join(DASHBOARD_DIST, "index.html")) ??
            new Response("Not Found", { status: 404 });
          }
        }
      } catch (err) {
        console.error("Request error:", err);
        response = apiError("Internal server error", 500);
      }

      // Attach CORS headers to the response
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        headers.set(k, v);
      }

      return new Response(response.body, { status: response.status, headers });
    };
}

// ─── Main server ──────────────────────────────────────────────────────────────

export function startServer(port: number): void {
  Bun.serve({
    port,
    fetch: createContactsRequestHandler(),
  });

  console.log(`Contacts server running at http://localhost:${port}`);
}
