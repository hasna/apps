#!/usr/bin/env node
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
import { createPlacement, listPlacementsForDocument } from "../db/signature-placements.js";
import { createSigningSession } from "../db/signing-sessions.js";
import { getStats } from "../db/stats.js";
import { search } from "../lib/search.js";
import { signPdf } from "../lib/pdf-signer.js";
import { detectSignatureFields } from "../lib/pdf-detector.js";
import { generateTextSignature, generateDrawingSignature } from "../lib/signature-gen.js";
import { storeDocument } from "../lib/files.js";

const PORT = parseInt(process.env["PORT"] ?? "19440", 10);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json() as unknown;
  } catch {
    return {};
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Health
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: "0.1.0", port: PORT });
      }

      // Stats
      if (path === "/api/stats" && method === "GET") {
        return json(getStats());
      }

      // Search
      if (path === "/api/search" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        if (!q) return error("q parameter required");
        return json(search(q));
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
        const doc = getDocumentByIdOrSlug(id);
        const sigId = body["signature_id"] as string;
        if (!sigId) return error("signature_id is required");
        const sig = getSignatureById(sigId);

        const page = (body["page"] as number) ?? 1;
        const x = (body["x"] as number) ?? 10;
        const y = (body["y"] as number) ?? 80;

        const session = createSigningSession({
          document_id: doc.id,
          signer_name: body["signer_name"] as string | undefined,
          signer_email: body["signer_email"] as string | undefined,
          source: "local",
        });

        const placement = createPlacement({
          document_id: doc.id,
          signature_id: sig.id,
          field_id: body["field_id"] as string | undefined,
          page,
          x,
          y,
          width: body["width"] as number | undefined,
          height: body["height"] as number | undefined,
        });

        const result = await signPdf({
          document_path: doc.file_path,
          document_name: doc.file_name,
          placements: [{ placement, signature: sig }],
        });

        updateDocument(doc.id, { status: "completed" });

        return json({
          success: true,
          output_path: result.output_path,
          pages_signed: result.pages_signed,
          placement_id: placement.id,
          session_id: session.id,
        });
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

console.log(`open-signatures server running on http://localhost:${PORT}`);
