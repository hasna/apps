import { existsSync } from "fs";
import { join } from "path";
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

// ─── /api/contacts ────────────────────────────────────────────────────────────

async function handleContacts(req: Request, url: URL, segments: string[]): Promise<Response> {
  const method = req.method;
  const id = segments[2];

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
      return json(contact);
    } catch {
      return apiError("Contact not found", 404);
    }
  }

  if (method === "DELETE" && id) {
    try {
      deleteContact(id);
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
      return json(company);
    } catch {
      return apiError("Company not found", 404);
    }
  }

  if (method === "DELETE" && id) {
    try {
      deleteCompany(id);
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

  if (method === "GET" && !id) {
    return json(listTags());
  }

  if (method === "POST" && !id) {
    const body = await parseJson(req);
    if (!body || typeof body !== "object") return apiError("Invalid body");
    const b = body as { name?: string; color?: string; description?: string };
    if (!b.name) return apiError("name is required");
    const tag = createTag({ name: b.name, color: b.color, description: b.description });
    return json(tag, 201);
  }

  if (method === "DELETE" && id) {
    try {
      deleteTag(id);
      return json({ ok: true });
    } catch {
      return apiError("Tag not found", 404);
    }
  }

  return apiError("Method not allowed", 405);
}

// ─── /api/stats ───────────────────────────────────────────────────────────────

function handleStats(): Response {
  const db = getDatabase();
  const contactCount = (db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number }).count;
  const companyCount = (db.prepare("SELECT COUNT(*) as count FROM companies").get() as { count: number }).count;
  const tagCount = (db.prepare("SELECT COUNT(*) as count FROM tags").get() as { count: number }).count;
  return json({ contacts: contactCount, companies: companyCount, tags: tagCount });
}

// ─── /api/import ──────────────────────────────────────────────────────────────

async function handleImport(req: Request): Promise<Response> {
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
    return json({ imported: importedCount, errors: errors.length, error_details: errors });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Import failed");
  }
}

// ─── /api/export ──────────────────────────────────────────────────────────────

async function handleExport(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json") as "json" | "csv" | "vcf";
  if (!["json", "csv", "vcf"].includes(format)) return apiError("format must be json, csv, or vcf");

  const { contacts } = listContacts({ limit: 100000 });
  const output = await exportContacts(format, contacts);

  const contentTypes: Record<string, string> = {
    json: "application/json",
    csv: "text/csv",
    vcf: "text/vcard",
  };

  return new Response(output, {
    headers: {
      "Content-Type": contentTypes[format] ?? "text/plain",
      "Content-Disposition": `attachment; filename="contacts.${format}"`,
    },
  });
}

// ─── Static file serving ──────────────────────────────────────────────────────

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;
  return new Response(Bun.file(filePath));
}

// ─── Main server ──────────────────────────────────────────────────────────────

export function startServer(port: number): void {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const segments = getSegments(url);

      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
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
              response = handleStats();
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
            default:
              response = apiError("Not found", 404);
          }
        } else {
          // Serve dashboard static files
          const filePath = join(DASHBOARD_DIST, url.pathname === "/" ? "index.html" : url.pathname);
          response = serveStaticFile(filePath) ??
            serveStaticFile(join(DASHBOARD_DIST, "index.html")) ??
            new Response("Not Found", { status: 404 });
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
    },
  });

  console.log(`Contacts server running at http://localhost:${port}`);
}
