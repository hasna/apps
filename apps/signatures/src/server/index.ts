#!/usr/bin/env bun
import {
  createDocument,
  getDocumentByIdOrSlug,
  listDocuments,
  updateDocument,
  deleteDocument,
} from "../db/documents.js";
import {
  createSignature,
  getSignatureById,
  listSignatures,
} from "../db/signatures.js";
import { createProject, listProjects } from "../db/projects.js";
import { createCollection, listCollections } from "../db/collections.js";
import { createTag, listTags } from "../db/tags.js";
import {
  createSignatureField,
  listFieldsForDocument,
  deleteFieldsForDocument,
} from "../db/signature-fields.js";
import { listPlacementsForDocument } from "../db/signature-placements.js";
import {
  createSigningSession,
  getSessionById,
  getSessionByToken,
  listSigningSessions,
  updateSessionAttachment,
  updateSessionStatus,
} from "../db/signing-sessions.js";
import { createPerson, getPersonByIdOrEmail, listPeople } from "../db/people.js";
import { getSigningCertificateBySession, listSigningCertificates } from "../db/certificates.js";
import { listProviderEvidence } from "../db/provider-evidence.js";
import { getStats } from "../db/stats.js";
import { search } from "../lib/search.js";
import { detectSignatureFields } from "../lib/pdf-detector.js";
import { generateTextSignature, generateDrawingSignature } from "../lib/signature-gen.js";
import { storeDocument } from "../lib/files.js";
import { signWithBrowseruse, registerSigningSession } from "../lib/connector-integration.js";
import { shareDocument, receiveDocument } from "../lib/attachments-integration.js";
import { getSetting, setSetting, getAllSettings } from "../db/settings.js";
import { createDocumentFromMarkdown, sendDocumentForSignature, sendDocumentWithProvider, signDocumentLocally } from "../lib/workflow.js";
import { setupSigningDomain } from "../lib/domain-integration.js";
import { getPackageVersion } from "../lib/package-info.js";
import { handleMetadataArgs } from "../lib/metadata-args.js";
import type { RecipientStatus, SessionStatus, SignerType } from "../types/index.js";

const PORT = parseInt(process.env["PORT"] ?? "19440", 10);

if (handleMetadataArgs(process.argv.slice(2), {
  command: "signatures-serve",
  description: "Start the signatures HTTP API server.",
  usage: "signatures-serve",
  options: [
    "  PORT=<n>       HTTP port environment override (default 19440)",
  ],
})) {
  process.exit(0);
}

const ADMIN_TOKEN_ENV_KEYS = ["OPEN_SIGNATURES_ADMIN_TOKEN", "SIGNATURES_ADMIN_TOKEN"] as const;
const ALLOWED_ORIGINS_ENV_KEYS = ["OPEN_SIGNATURES_ALLOWED_ORIGINS", "SIGNATURES_ALLOWED_ORIGINS"] as const;
const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const CORS_ALLOW_HEADERS = "Content-Type, Authorization, X-Open-Signatures-Admin-Token";
const ADMIN_AUTH_CHALLENGE = "Bearer realm=\"signatures-admin\"";
const ADMIN_API_TOKEN = readFirstEnv(ADMIN_TOKEN_ENV_KEYS);
const ALLOWED_CORS_ORIGINS = resolveAllowedOrigins();
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readFirstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function resolveAllowedOrigins(): Set<string> {
  const configured = readFirstEnv(ALLOWED_ORIGINS_ENV_KEYS);
  if (configured) {
    return new Set(configured.split(",").map((origin) => origin.trim()).filter(Boolean));
  }
  return new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://[::1]:${PORT}`,
  ]);
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers({ "Vary": "Origin" });
  const origin = req.headers.get("Origin");
  if (origin && isAllowedOrigin(req, origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
    headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function preflight(req: Request): Response {
  const origin = req.headers.get("Origin");
  if (origin && !isAllowedOrigin(req, origin)) {
    return new Response(null, { status: 403, headers: { "Vary": "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

function isAllowedOrigin(req: Request, origin: string): boolean {
  return origin === new URL(req.url).origin || ALLOWED_CORS_ORIGINS.has(origin);
}

function responseHeaders(req: Request, contentType: string, extraHeaders?: HeadersInit): Headers {
  const headers = corsHeaders(req);
  headers.set("Content-Type", contentType);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function jsonResponse(req: Request, data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: responseHeaders(req, "application/json", extraHeaders),
  });
}

function errorResponse(req: Request, message: string, status = 400, extraHeaders?: HeadersInit): Response {
  return jsonResponse(req, { error: message }, status, extraHeaders);
}

function htmlResponse(req: Request, body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: responseHeaders(req, "text/html; charset=utf-8"),
  });
}

function isPublicRoute(path: string, method: string): boolean {
  return (path === "/health" && method === "GET")
    || (method === "GET" && /^\/sign\/[^/]+$/.test(path))
    || (method === "POST" && /^\/api\/sign\/[^/]+$/.test(path));
}

function isAdminApiRoute(path: string, method: string): boolean {
  return path.startsWith("/api/") && !isPublicRoute(path, method);
}

function readAdminCredential(req: Request): string | undefined {
  const auth = req.headers.get("Authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return req.headers.get("X-Open-Signatures-Admin-Token")?.trim() || undefined;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let diff = actualBytes.length ^ expectedBytes.length;
  for (let i = 0; i < length; i++) {
    diff |= (actualBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }
  return diff === 0;
}

function requireAdminApiAuth(
  req: Request,
  path: string,
  method: string,
  error: (message: string, status?: number, extraHeaders?: HeadersInit) => Response
): Response | undefined {
  if (!isAdminApiRoute(path, method)) return undefined;
  if (!ADMIN_API_TOKEN) {
    return error(
      "Admin API authentication is not configured. Set OPEN_SIGNATURES_ADMIN_TOKEN or SIGNATURES_ADMIN_TOKEN.",
      503,
      { "WWW-Authenticate": ADMIN_AUTH_CHALLENGE }
    );
  }
  const credential = readAdminCredential(req);
  if (!credential || !constantTimeEqual(credential, ADMIN_API_TOKEN)) {
    return error("Unauthorized", 401, { "WWW-Authenticate": ADMIN_AUTH_CHALLENGE });
  }
  return undefined;
}

function rejectDisallowedOrigin(
  req: Request,
  error: (message: string, status?: number) => Response
): Response | undefined {
  const origin = req.headers.get("Origin");
  if (origin && !isAllowedOrigin(req, origin)) {
    return error("Origin is not allowed", 403);
  }
  return undefined;
}

function requireJsonApiRequest(
  req: Request,
  path: string,
  method: string,
  error: (message: string, status?: number) => Response
): Response | undefined {
  if (!path.startsWith("/api/") || !UNSAFE_METHODS.has(method) || method === "DELETE") {
    return undefined;
  }
  const contentType = req.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return error("Content-Type must be application/json", 415);
  }
  return undefined;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json() as unknown;
  } catch {
    return {};
  }
}

function renderSigningPage(input: {
  token: string;
  documentName: string;
  sessionId: string;
  status: string;
  signerName?: string;
  signerEmail?: string;
  fieldCount: number;
  certificatePath?: string;
  signedDocumentPath?: string;
}): string {
  const completed = input.status === "completed";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.documentName)} - Sign</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #657184; --line: #d8dee8; --blue: #2563eb; --green: #0f8f61; --amber: #b26a00; --bg: #f6f8fb; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); letter-spacing: 0; }
    main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
    .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 12px 32px rgba(23, 32, 51, 0.08); overflow: hidden; }
    header { padding: 24px; border-bottom: 1px solid var(--line); }
    h1 { font-size: 24px; line-height: 1.2; margin: 0 0 8px; }
    .meta { color: var(--muted); font-size: 14px; display: flex; flex-wrap: wrap; gap: 10px 18px; }
    form, .done { padding: 24px; display: grid; gap: 16px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; font-weight: 600; }
    input { min-height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 9px 11px; font: inherit; color: var(--ink); background: #fff; }
    button { min-height: 42px; border: 0; border-radius: 6px; background: var(--blue); color: #fff; font: inherit; font-weight: 700; cursor: pointer; padding: 10px 14px; }
    button:disabled { opacity: 0.58; cursor: progress; }
    .status { border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; color: #fff; background: var(--amber); }
    .status.completed { background: var(--green); }
    .result { min-height: 20px; color: var(--muted); font-size: 14px; }
    .error { color: #b42318; }
    .paths { display: grid; gap: 8px; color: var(--muted); font-size: 13px; word-break: break-all; }
    @media (max-width: 520px) { main { margin: 16px auto; width: calc(100vw - 24px); } header, form, .done { padding: 18px; } }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <header>
        <h1>${escapeHtml(input.documentName)}</h1>
        <div class="meta">
          <span>${escapeHtml(input.sessionId)}</span>
          <span>${input.fieldCount} field${input.fieldCount === 1 ? "" : "s"}</span>
          <span class="status ${completed ? "completed" : ""}">${escapeHtml(input.status)}</span>
        </div>
      </header>
      ${completed ? `
        <div class="done">
          <strong>Completed</strong>
          <div class="paths">
            ${input.signedDocumentPath ? `<span>Signed PDF: ${escapeHtml(input.signedDocumentPath)}</span>` : ""}
            ${input.certificatePath ? `<span>Certificate: ${escapeHtml(input.certificatePath)}</span>` : ""}
          </div>
        </div>
      ` : `
        <form id="sign-form">
          <label>Name <input name="signer_name" autocomplete="name" value="${escapeHtml(input.signerName)}" required></label>
          <label>Email <input name="signer_email" autocomplete="email" type="email" value="${escapeHtml(input.signerEmail)}"></label>
          <label>Signature <input name="signature_text" autocomplete="off" value="${escapeHtml(input.signerName)}" required></label>
          <button type="submit">Sign Document</button>
          <div class="result" id="result"></div>
        </form>
      `}
    </section>
  </main>
  <script>
    const form = document.getElementById("sign-form");
    const result = document.getElementById("result");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      result.className = "result";
      result.textContent = "Signing...";
      const body = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/sign/${escapeHtml(input.token)}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        result.className = "result error";
        result.textContent = payload.error || "Signing failed";
        button.disabled = false;
        return;
      }
      result.textContent = "Completed. Certificate: " + (payload.certificate_path || "created");
      window.setTimeout(() => window.location.reload(), 900);
    });
  </script>
</body>
</html>`;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const json = (data: unknown, status = 200, extraHeaders?: HeadersInit) => jsonResponse(req, data, status, extraHeaders);
    const error = (message: string, status = 400, extraHeaders?: HeadersInit) => errorResponse(req, message, status, extraHeaders);
    const html = (body: string, status = 200) => htmlResponse(req, body, status);

    // CORS preflight
    if (method === "OPTIONS") {
      return preflight(req);
    }

    const authError = requireAdminApiAuth(req, path, method, error);
    if (authError) return authError;
    const originError = rejectDisallowedOrigin(req, error);
    if (originError) return originError;
    const contentTypeError = requireJsonApiRequest(req, path, method, error);
    if (contentTypeError) return contentTypeError;

    try {
      // Health
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: getPackageVersion(), port: PORT });
      }

      // Stats
      if (path === "/api/stats" && method === "GET") {
        return json(getStats());
      }

      const signPageMatch = path.match(/^\/sign\/([^/]+)$/);
      if (signPageMatch && method === "GET") {
        const token = signPageMatch[1]!;
        const session = getSessionByToken(token);
        const doc = getDocumentByIdOrSlug(session.document_id);
        const fields = listFieldsForDocument(doc.id);
        return html(renderSigningPage({
          token,
          documentName: doc.name,
          sessionId: session.id,
          status: session.status,
          signerName: session.signer_name,
          signerEmail: session.signer_email,
          fieldCount: fields.length,
          certificatePath: session.certificate_path,
          signedDocumentPath: session.signed_document_path,
        }));
      }

      const signApiMatch = path.match(/^\/api\/sign\/([^/]+)$/);
      if (signApiMatch && method === "POST") {
        const token = signApiMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const session = getSessionByToken(token);
        if (session.status === "completed") return error("Signing session is already completed", 409);

        const doc = getDocumentByIdOrSlug(session.document_id);
        const signerName = (body["signer_name"] as string | undefined) ?? session.signer_name ?? "Signer";
        const signerEmail = (body["signer_email"] as string | undefined) ?? session.signer_email;
        const signatureText = (body["signature_text"] as string | undefined) ?? signerName;
        const existingSignatureId = body["signature_id"] as string | undefined;
        let signatureId = existingSignatureId;

        if (!signatureId) {
          const generated = await generateTextSignature(signatureText);
          const signature = createSignature({
            name: signerName,
            type: "text",
            font_family: "Dancing Script",
            font_size: 48,
            color: "#111827",
            text_value: signatureText,
            image_path: generated.svg_path,
            width: generated.width,
            height: generated.height,
          });
          signatureId = signature.id;
        }

        const result = await signDocumentLocally({
          documentId: doc.id,
          sessionId: session.id,
          signatureId,
          signerName,
          signerEmail,
          signerType: session.signer_type,
          agentId: session.agent_id,
          agentProvider: session.agent_provider,
          agentRunId: session.agent_run_id,
          agentThreadId: session.agent_thread_id,
          agentPolicyId: session.agent_policy_id,
          agentReason: session.agent_reason,
          role: session.role,
        });
        return json({ success: true, ...result });
      }

      // Search
      if (path === "/api/search" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        if (!q) return error("q parameter required");
        return json(search(q));
      }

      // People
      if (path === "/api/people") {
        if (method === "GET") {
          return json(listPeople({
            query: url.searchParams.get("q") ?? undefined,
            signer_type: url.searchParams.get("signer_type") as SignerType | undefined,
          }));
        }
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          if (!body["name"]) return error("name is required");
          return json(createPerson({
            name: body["name"] as string,
            email: body["email"] as string | undefined,
            phone: body["phone"] as string | undefined,
            company: body["company"] as string | undefined,
            role: body["role"] as string | undefined,
            signer_type: body["signer_type"] as Parameters<typeof createPerson>[0]["signer_type"],
            agent_id: body["agent_id"] as string | undefined,
            agent_provider: body["agent_provider"] as string | undefined,
            metadata: body["metadata"] as Record<string, unknown> | undefined,
          }), 201);
        }
      }

      // Signing sessions
      if (path === "/api/sessions" && method === "GET") {
        const status = url.searchParams.get("status") as SessionStatus | null;
        return json(listSigningSessions({
          document_id: url.searchParams.get("document_id") ?? undefined,
          status: status ?? undefined,
          signer_type: url.searchParams.get("signer_type") as SignerType | undefined,
          recipient_status: url.searchParams.get("recipient_status") as RecipientStatus | undefined,
          limit: parseInt(url.searchParams.get("limit") ?? "100"),
          offset: parseInt(url.searchParams.get("offset") ?? "0"),
        }));
      }

      const personMatch = path.match(/^\/api\/people\/([^/]+)$/);
      if (personMatch && method === "GET") {
        return json(getPersonByIdOrEmail(decodeURIComponent(personMatch[1]!)));
      }

      // Documents
      if (path === "/api/documents") {
        if (method === "GET") {
          const docs = listDocuments({
            project_id: url.searchParams.get("project_id") ?? undefined,
            collection_id: url.searchParams.get("collection_id") ?? undefined,
            status: url.searchParams.get("status") as "draft" | undefined,
            limit: parseInt(url.searchParams.get("limit") ?? "100"),
            offset: parseInt(url.searchParams.get("offset") ?? "0"),
          });
          return json(docs);
        }
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          const filePath = body["file_path"] as string;
          if (!filePath) return error("file_path is required");
          const stored = storeDocument(filePath);
          const doc = createDocument({
            name: (body["name"] as string) ?? stored.file_name,
            file_path: stored.file_path,
            file_name: stored.file_name,
            file_size: stored.file_size,
            description: body["description"] as string | undefined,
            project_id: body["project_id"] as string | undefined,
            collection_id: body["collection_id"] as string | undefined,
            status: body["status"] as "draft" | undefined,
          });
          return json(doc, 201);
        }
      }

      if (path === "/api/documents/from-markdown" && method === "POST") {
        const body = await parseBody(req) as Record<string, unknown>;
        const filePath = body["file_path"] as string;
        if (!filePath) return error("file_path is required");
        const result = await createDocumentFromMarkdown({
          filePath,
          name: body["name"] as string | undefined,
          variables: body["variables"] as Record<string, unknown> | undefined,
          signerName: body["signer_name"] as string | undefined,
          signerEmail: body["signer_email"] as string | undefined,
          signerType: body["signer_type"] as Parameters<typeof createDocumentFromMarkdown>[0]["signerType"],
        });
        return json(result, 201);
      }

      const docMatch = path.match(/^\/api\/documents\/([^/]+)$/);
      if (docMatch) {
        const id = docMatch[1]!;
        if (method === "GET") {
          return json(getDocumentByIdOrSlug(id));
        }
        if (method === "PUT") {
          const body = await parseBody(req) as Record<string, unknown>;
          const doc = updateDocument(id, body as Parameters<typeof updateDocument>[1]);
          return json(doc);
        }
        if (method === "DELETE") {
          deleteDocument(id);
          return json({ success: true });
        }
      }

      const docSignMatch = path.match(/^\/api\/documents\/([^/]+)\/sign$/);
      if (docSignMatch && method === "POST") {
        const id = docSignMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const sigId = body["signature_id"] as string;
        if (!sigId) return error("signature_id is required");
        const result = await signDocumentLocally({
          documentId: id,
          signatureId: sigId,
          sessionId: body["session_id"] as string | undefined,
          personIdOrEmail: body["person"] as string | undefined,
          signerName: body["signer_name"] as string | undefined,
          signerEmail: body["signer_email"] as string | undefined,
          signerType: body["signer_type"] as Parameters<typeof signDocumentLocally>[0]["signerType"],
          agentId: body["agent_id"] as string | undefined,
          agentProvider: body["agent_provider"] as string | undefined,
          agentRunId: body["agent_run_id"] as string | undefined,
          agentThreadId: body["agent_thread_id"] as string | undefined,
          agentPolicyId: body["agent_policy_id"] as string | undefined,
          agentReason: body["agent_reason"] as string | undefined,
          agentInputHash: body["agent_input_hash"] as string | undefined,
          agentOutputHash: body["agent_output_hash"] as string | undefined,
          role: body["role"] as string | undefined,
          signingOrder: body["signing_order"] as number | undefined,
          parallelGroup: body["parallel_group"] as number | undefined,
          fieldId: body["field_id"] as string | undefined,
          page: body["page"] as number | undefined,
          x: body["x"] as number | undefined,
          y: body["y"] as number | undefined,
          width: body["width"] as number | undefined,
          height: body["height"] as number | undefined,
          certificate: body["certificate"] as boolean | undefined,
        });
        return json({ success: true, ...result });
      }

      const docSendMatch = path.match(/^\/api\/documents\/([^/]+)\/send$/);
      if (docSendMatch && method === "POST") {
        const id = docSendMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const result = await sendDocumentForSignature({
          documentId: id,
          personIdOrEmail: body["person"] as string | undefined,
          signerName: body["signer_name"] as string | undefined,
          signerEmail: body["signer_email"] as string | undefined,
          signerType: body["signer_type"] as Parameters<typeof sendDocumentForSignature>[0]["signerType"],
          agentId: body["agent_id"] as string | undefined,
          agentProvider: body["agent_provider"] as string | undefined,
          agentRunId: body["agent_run_id"] as string | undefined,
          agentThreadId: body["agent_thread_id"] as string | undefined,
          agentPolicyId: body["agent_policy_id"] as string | undefined,
          agentReason: body["agent_reason"] as string | undefined,
          role: body["role"] as string | undefined,
          signingOrder: body["signing_order"] as number | undefined,
          parallelGroup: body["parallel_group"] as number | undefined,
          fromEmail: body["from"] as string | undefined,
          baseUrl: body["base_url"] as string | undefined,
          expiry: body["expiry"] as string | undefined,
          dryRunEmail: body["dry_run_email"] as boolean | undefined,
        });
        return json(result, 201);
      }

      const providerSendMatch = path.match(/^\/api\/documents\/([^/]+)\/provider-send$/);
      if (providerSendMatch && method === "POST") {
        const id = providerSendMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const recipient = body["recipient"] as Record<string, unknown> | undefined;
        if (!recipient?.["email"]) return error("recipient.email is required");
        const provider = (body["provider"] as string | undefined) ?? "pandadoc";
        if (!body["signature_level"]) return error("signature_level is required: ses, aes, qes, eseal, or qeseal");
        const result = await sendDocumentWithProvider({
          documentId: id,
          provider,
          apiKey: (body["api_key"] as string | undefined) ?? getSetting(`${provider}_api_key`) ?? getSetting("pandadoc_api_key") ?? undefined,
          documentUrl: body["document_url"] as string | undefined,
          recipient: {
            email: recipient["email"] as string,
            name: (recipient["name"] as string | undefined) ?? recipient["email"] as string,
            role: (recipient["role"] as string | undefined) ?? "Signer",
          },
          signerType: body["signer_type"] as Parameters<typeof sendDocumentWithProvider>[0]["signerType"],
          signatureLevel: body["signature_level"] as Parameters<typeof sendDocumentWithProvider>[0]["signatureLevel"],
          subject: body["subject"] as string | undefined,
          message: body["message"] as string | undefined,
          silent: body["silent"] as boolean | undefined,
          connectors: {
            apiUrl: (body["connectors_api_url"] as string | undefined) ?? getSetting("connectors_api_url") ?? undefined,
            apiKey: (body["connectors_api_key"] as string | undefined) ?? getSetting("connectors_api_key") ?? undefined,
            serverUrl: (body["connectors_server_url"] as string | undefined) ?? getSetting("connectors_server_url") ?? undefined,
            accountId: body["connectors_account"] as string | undefined,
            profileName: body["connectors_profile"] as string | undefined,
          },
          dryRun: body["dry_run"] as boolean | undefined,
        });
        return json(result, result.provider.status === "failed" ? 502 : 201);
      }

      const docConnectorSignMatch = path.match(/^\/api\/documents\/([^/]+)\/connector-sign$/);
      if (docConnectorSignMatch && method === "POST") {
        const id = docConnectorSignMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const connectorName = body["connector_name"] as string | undefined;
        if (!connectorName) return error("connector_name is required");
        const url = body["url"] as string | undefined;

        let session;
        if (connectorName === "browseruse" && url) {
          session = signWithBrowseruse(id, url, {
            signer_name: body["signer_name"] as string | undefined,
            signer_email: body["signer_email"] as string | undefined,
            metadata: body["metadata"] as Record<string, unknown> | undefined,
          });
        } else {
          session = registerSigningSession({
            document_id: id,
            connector_name: connectorName,
            signer_name: body["signer_name"] as string | undefined,
            signer_email: body["signer_email"] as string | undefined,
            signing_url: url,
            metadata: body["metadata"] as Record<string, unknown> | undefined,
          });
        }
        return json(session, 201);
      }

      const docDetectMatch = path.match(/^\/api\/documents\/([^/]+)\/detect$/);
      if (docDetectMatch && method === "POST") {
        const id = docDetectMatch[1]!;
        const doc = getDocumentByIdOrSlug(id);
        deleteFieldsForDocument(doc.id);
        const detected = await detectSignatureFields(doc.file_path);
        const fields = [];
        for (const f of detected) {
          fields.push(createSignatureField({ ...f, document_id: doc.id }));
        }
        return json(fields);
      }

      const certificateMatch = path.match(/^\/api\/sessions\/([^/]+)\/certificate$/);
      if (certificateMatch && method === "GET") {
        return json(getSigningCertificateBySession(certificateMatch[1]!));
      }

      if (path === "/api/certificates" && method === "GET") {
        return json(listSigningCertificates(url.searchParams.get("document_id") ?? undefined));
      }

      if (path === "/api/provider-evidence" && method === "GET") {
        return json(listProviderEvidence({
          document_id: url.searchParams.get("document_id") ?? undefined,
          session_id: url.searchParams.get("session_id") ?? undefined,
          provider: url.searchParams.get("provider") ?? undefined,
          limit: parseInt(url.searchParams.get("limit") ?? "100"),
          offset: parseInt(url.searchParams.get("offset") ?? "0"),
        }));
      }

      if (path === "/api/domains/setup" && method === "POST") {
        const body = await parseBody(req) as Record<string, unknown>;
        if (!body["domain"]) return error("domain is required");
        return json(setupSigningDomain({
          domain: body["domain"] as string,
          subdomain: body["subdomain"] as string | undefined,
          target: body["target"] as string | undefined,
          buy: body["buy"] as boolean | undefined,
          dryRun: body["dry_run"] as boolean | undefined,
        }));
      }

      // Signatures
      if (path === "/api/signatures") {
        if (method === "GET") {
          return json(listSignatures());
        }
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          const type = body["type"] as string;

          if (type === "text") {
            const text = (body["text_value"] as string) ?? (body["name"] as string);
            const result = await generateTextSignature(
              text,
              body["font_family"] as string | undefined,
              body["font_size"] as number | undefined,
              body["color"] as string | undefined
            );
            const sig = createSignature({
              name: body["name"] as string,
              type: "text",
              font_family: (body["font_family"] as string) ?? "Dancing Script",
              font_size: (body["font_size"] as number) ?? 48,
              color: (body["color"] as string) ?? "#000000",
              text_value: text,
              image_path: result.svg_path,
              width: result.width,
              height: result.height,
            });
            return json(sig, 201);
          }

          if (type === "drawing") {
            const desc = body["drawing_description"] as string;
            if (!desc) return error("drawing_description required for drawing type");
            const result = await generateDrawingSignature(desc);
            const sig = createSignature({
              name: body["name"] as string,
              type: "drawing",
              image_path: result.image_path,
              image_prompt: desc,
              width: result.width,
              height: result.height,
            });
            return json(sig, 201);
          }

          const sig = createSignature({
            name: body["name"] as string,
            type: (body["type"] as "text" | "image" | "drawing") ?? "image",
            font_size: (body["font_size"] as number) ?? 48,
            color: (body["color"] as string) ?? "#000000",
            text_value: body["text_value"] as string | undefined,
          });
          return json(sig, 201);
        }
      }

      const sigMatch = path.match(/^\/api\/signatures\/([^/]+)$/);
      if (sigMatch && method === "GET") {
        return json(getSignatureById(sigMatch[1]!));
      }

      // Projects
      if (path === "/api/projects") {
        if (method === "GET") return json(listProjects());
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          return json(createProject({ name: body["name"] as string, description: body["description"] as string | undefined, color: body["color"] as string | undefined }), 201);
        }
      }

      // Collections
      if (path === "/api/collections") {
        if (method === "GET") return json(listCollections(url.searchParams.get("project_id") ?? undefined));
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          return json(createCollection({ name: body["name"] as string, description: body["description"] as string | undefined, project_id: body["project_id"] as string | undefined }), 201);
        }
      }

      // Tags
      if (path === "/api/tags") {
        if (method === "GET") return json(listTags());
        if (method === "POST") {
          const body = await parseBody(req) as Record<string, unknown>;
          return json(createTag({ name: body["name"] as string, color: body["color"] as string | undefined }), 201);
        }
      }

      // Share document
      const docShareMatch = path.match(/^\/api\/documents\/([^/]+)\/share$/);
      if (docShareMatch && method === "POST") {
        const id = docShareMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const doc = getDocumentByIdOrSlug(id);

        const session = createSigningSession({
          document_id: doc.id,
          signer_name: body["signer_name"] as string | undefined,
          signer_email: body["signer_email"] as string | undefined,
          signer_type: body["signer_type"] as Parameters<typeof createSigningSession>[0]["signer_type"],
          agent_id: body["agent_id"] as string | undefined,
          agent_provider: body["agent_provider"] as string | undefined,
          agent_run_id: body["agent_run_id"] as string | undefined,
          agent_thread_id: body["agent_thread_id"] as string | undefined,
          agent_policy_id: body["agent_policy_id"] as string | undefined,
          agent_reason: body["agent_reason"] as string | undefined,
          role: body["role"] as string | undefined,
          signing_order: body["signing_order"] as number | undefined,
          parallel_group: body["parallel_group"] as number | undefined,
          recipient_status: "available",
          source: "local",
        });

        const shared = await shareDocument(doc.file_path, doc.file_name, {
          expiry: body["expiry"] as string | undefined,
        });

        updateSessionAttachment(session.id, {
          attachment_id: shared.attachmentId,
          share_link: shared.shareLink,
          share_expires_at: shared.expiresAt,
        });

        return json({ session_id: session.id, share_link: shared.shareLink }, 201);
      }

      // Session link
      const sessionLinkMatch = path.match(/^\/api\/sessions\/([^/]+)\/link$/);
      if (sessionLinkMatch && method === "GET") {
        const id = sessionLinkMatch[1]!;
        const session = getSessionById(id);
        return json({ session_id: session.id, share_link: session.share_link ?? null, expires_at: session.share_expires_at ?? null });
      }

      // Session receive
      const sessionReceiveMatch = path.match(/^\/api\/sessions\/([^/]+)\/receive$/);
      if (sessionReceiveMatch && method === "POST") {
        const id = sessionReceiveMatch[1]!;
        const body = await parseBody(req) as Record<string, unknown>;
        const attachmentId = body["attachment_id"] as string;
        if (!attachmentId) return error("attachment_id is required");

        const session = getSessionById(id);
        const doc = getDocumentByIdOrSlug(session.document_id);

        const signedPath = doc.file_path.replace(/([^/]+)\.pdf$/i, "signed-$1.pdf");
        await receiveDocument(attachmentId, signedPath);

        updateSessionStatus(session.id, "completed");
        updateDocument(doc.id, { status: "completed" });

        return json({ success: true, session_id: session.id });
      }

      // Config
      if (path === "/api/config") {
        if (method === "GET") {
          const all = getAllSettings();
          // Mask sensitive keys
          const masked: Record<string, string> = {};
          for (const [k, v] of Object.entries(all)) {
            masked[k] = k.toLowerCase().includes("key") || k.toLowerCase().includes("secret") ? "***" : v;
          }
          return json(masked);
        }
        if (method === "PUT") {
          const body = await parseBody(req) as Record<string, unknown>;
          const key = body["key"] as string;
          const value = body["value"] as string;
          if (!key || !value) return error("key and value are required");
          setSetting(key, value);
          return json({ success: true, key });
        }
      }

      return error("Not found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404
        : message.includes("already exists") ? 409
        : 500;
      return error(message, status);
    }
  },
});

console.log(`signatures server running on http://localhost:${PORT}`);
