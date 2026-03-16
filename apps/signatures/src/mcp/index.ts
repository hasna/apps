#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
import {
  createProject,
  listProjects,
} from "../db/projects.js";
import {
  createCollection,
  listCollections,
} from "../db/collections.js";
import {
  createTag,
  listTags,
} from "../db/tags.js";
import {
  createSignatureField,
  listFieldsForDocument,
  deleteFieldsForDocument,
} from "../db/signature-fields.js";
import { createPlacement, listPlacementsForDocument } from "../db/signature-placements.js";
import { createSigningSession } from "../db/signing-sessions.js";
import { getStats } from "../db/stats.js";
import { searchDocuments } from "../lib/search.js";
import { signPdf } from "../lib/pdf-signer.js";
import { detectSignatureFields } from "../lib/pdf-detector.js";
import { generateTextSignature, generateDrawingSignature } from "../lib/signature-gen.js";
import { storeDocument } from "../lib/files.js";
import { updateDocument as updateDoc } from "../db/documents.js";

const server = new Server(
  { name: "signatures", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "signatures_document_save",
      description: "Create or update a document",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID for update" },
          name: { type: "string" },
          file_path: { type: "string", description: "Path to the PDF file" },
          description: { type: "string" },
          project_id: { type: "string" },
          collection_id: { type: "string" },
          status: { type: "string", enum: ["draft", "pending", "completed", "cancelled"] },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "signatures_document_get",
      description: "Get a document by ID or slug",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "signatures_document_list",
      description: "List documents with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          collection_id: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
        },
      },
    },
    {
      name: "signatures_document_delete",
      description: "Delete a document",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "signatures_document_search",
      description: "Full-text search documents",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" }, limit: { type: "number" } },
        required: ["q"],
      },
    },
    {
      name: "signatures_sign",
      description: "Sign a document at a position",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          signature_id: { type: "string" },
          page: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          field_id: { type: "string" },
          signer_name: { type: "string" },
          signer_email: { type: "string" },
        },
        required: ["document_id", "signature_id"],
      },
    },
    {
      name: "signatures_signature_create",
      description: "Create a signature (text rendered with Google Font, or drawing via OpenAI)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["text", "image", "drawing"] },
          font_family: { type: "string" },
          font_size: { type: "number" },
          color: { type: "string" },
          text_value: { type: "string" },
          drawing_description: { type: "string" },
        },
        required: ["name", "type"],
      },
    },
    {
      name: "signatures_signature_get",
      description: "Get a signature by ID",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "signatures_signature_list",
      description: "List all signatures",
      inputSchema: {
        type: "object",
        properties: { type: { type: "string" } },
      },
    },
    {
      name: "signatures_project_save",
      description: "Create or update a project",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
        },
      },
    },
    {
      name: "signatures_project_list",
      description: "List all projects",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "signatures_collection_save",
      description: "Create or update a collection",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          project_id: { type: "string" },
        },
      },
    },
    {
      name: "signatures_collection_list",
      description: "List all collections",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "string" } },
      },
    },
    {
      name: "signatures_tag_save",
      description: "Create a tag",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "signatures_tag_list",
      description: "List all tags",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "signatures_detect_fields",
      description: "Detect signature fields in a PDF",
      inputSchema: {
        type: "object",
        properties: { document_id: { type: "string" } },
        required: ["document_id"],
      },
    },
    {
      name: "signatures_stats",
      description: "Get system statistics",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "signatures_document_save": {
        const a = args as Record<string, unknown>;
        if (a["id"]) {
          const doc = updateDocument(a["id"] as string, {
            name: a["name"] as string | undefined,
            description: a["description"] as string | undefined,
            project_id: a["project_id"] as string | undefined,
            collection_id: a["collection_id"] as string | undefined,
            status: a["status"] as "draft" | "pending" | "completed" | "cancelled" | undefined,
          });
          return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
        }

        const filePath = a["file_path"] as string;
        const stored = storeDocument(filePath);
        const doc = createDocument({
          name: (a["name"] as string) ?? stored.file_name,
          file_path: stored.file_path,
          file_name: stored.file_name,
          file_size: stored.file_size,
          description: a["description"] as string | undefined,
          project_id: a["project_id"] as string | undefined,
          collection_id: a["collection_id"] as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      case "signatures_document_get": {
        const doc = getDocumentByIdOrSlug(((args as Record<string, string>)["id"])!);
        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      case "signatures_document_list": {
        const a = args as Record<string, unknown>;
        const docs = listDocuments({
          project_id: a["project_id"] as string | undefined,
          collection_id: a["collection_id"] as string | undefined,
          status: a["status"] as "draft" | undefined,
          limit: a["limit"] as number | undefined,
          offset: a["offset"] as number | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
      }

      case "signatures_document_delete": {
        deleteDocument(((args as Record<string, string>)["id"])!);
        return { content: [{ type: "text", text: '{"success": true}' }] };
      }

      case "signatures_document_search": {
        const a = args as Record<string, unknown>;
        const results = searchDocuments(
          a["q"] as string,
          a["limit"] as number | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "signatures_sign": {
        const a = args as Record<string, unknown>;
        const doc = getDocumentByIdOrSlug(a["document_id"] as string);
        const sig = getSignatureById(a["signature_id"] as string);

        const page = (a["page"] as number) ?? 1;
        const x = (a["x"] as number) ?? 10;
        const y = (a["y"] as number) ?? 80;

        // Create session
        const session = createSigningSession({
          document_id: doc.id,
          signer_name: a["signer_name"] as string | undefined,
          signer_email: a["signer_email"] as string | undefined,
          source: "local",
        });

        // Create placement
        const placement = createPlacement({
          document_id: doc.id,
          signature_id: sig.id,
          field_id: a["field_id"] as string | undefined,
          page,
          x,
          y,
          width: a["width"] as number | undefined,
          height: a["height"] as number | undefined,
        });

        // Sign the PDF
        const result = await signPdf({
          document_path: doc.file_path,
          document_name: doc.file_name,
          placements: [{ placement, signature: sig }],
        });

        // Update document status
        updateDoc(doc.id, { status: "completed" });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  output_path: result.output_path,
                  pages_signed: result.pages_signed,
                  placement_id: placement.id,
                  session_id: session.id,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "signatures_signature_create": {
        const a = args as Record<string, unknown>;
        const type = a["type"] as string;

        if (type === "text") {
          const text = a["text_value"] as string ?? a["name"] as string;
          const result = await generateTextSignature(
            text,
            a["font_family"] as string | undefined,
            a["font_size"] as number | undefined,
            a["color"] as string | undefined
          );
          const sig = createSignature({
            name: a["name"] as string,
            type: "text",
            font_family: a["font_family"] as string | undefined ?? "Dancing Script",
            font_size: a["font_size"] as number | undefined ?? 48,
            color: a["color"] as string | undefined ?? "#000000",
            text_value: text,
            image_path: result.svg_path,
            width: result.width,
            height: result.height,
          });
          return { content: [{ type: "text", text: JSON.stringify(sig, null, 2) }] };
        }

        if (type === "drawing") {
          const description = a["drawing_description"] as string;
          if (!description) throw new Error("drawing_description is required for drawing type");
          const result = await generateDrawingSignature(description);
          const sig = createSignature({
            name: a["name"] as string,
            type: "drawing",
            image_path: result.image_path,
            image_prompt: description,
            width: result.width,
            height: result.height,
          });
          return { content: [{ type: "text", text: JSON.stringify(sig, null, 2) }] };
        }

        // image type - just create a record without generating
        const sig = createSignature({
          name: a["name"] as string,
          type: "image",
          font_size: a["font_size"] as number | undefined ?? 48,
          color: a["color"] as string | undefined ?? "#000000",
          text_value: a["text_value"] as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(sig, null, 2) }] };
      }

      case "signatures_signature_get": {
        const sig = getSignatureById(((args as Record<string, string>)["id"])!);
        return { content: [{ type: "text", text: JSON.stringify(sig, null, 2) }] };
      }

      case "signatures_signature_list": {
        const a = args as Record<string, unknown>;
        const sigs = listSignatures(a["type"] as "text" | "image" | "drawing" | undefined);
        return { content: [{ type: "text", text: JSON.stringify(sigs, null, 2) }] };
      }

      case "signatures_project_save": {
        const a = args as Record<string, unknown>;
        const project = createProject({
          name: a["name"] as string,
          description: a["description"] as string | undefined,
          color: a["color"] as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
      }

      case "signatures_project_list": {
        const projects = listProjects();
        return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
      }

      case "signatures_collection_save": {
        const a = args as Record<string, unknown>;
        const col = createCollection({
          name: a["name"] as string,
          description: a["description"] as string | undefined,
          project_id: a["project_id"] as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(col, null, 2) }] };
      }

      case "signatures_collection_list": {
        const a = args as Record<string, unknown>;
        const cols = listCollections(a["project_id"] as string | undefined);
        return { content: [{ type: "text", text: JSON.stringify(cols, null, 2) }] };
      }

      case "signatures_tag_save": {
        const a = args as Record<string, unknown>;
        const tag = createTag({
          name: a["name"] as string,
          color: a["color"] as string | undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(tag, null, 2) }] };
      }

      case "signatures_tag_list": {
        const tags = listTags();
        return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
      }

      case "signatures_detect_fields": {
        const a = args as Record<string, unknown>;
        const doc = getDocumentByIdOrSlug(a["document_id"] as string);

        // Remove old detected fields
        deleteFieldsForDocument(doc.id);

        const detected = await detectSignatureFields(doc.file_path);
        const fields = [];

        for (const f of detected) {
          const field = createSignatureField({
            document_id: doc.id,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            field_type: f.field_type,
            label: f.label,
            detected: 1,
          });
          fields.push(field);
        }

        return { content: [{ type: "text", text: JSON.stringify(fields, null, 2) }] };
      }

      case "signatures_stats": {
        const stats = getStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
