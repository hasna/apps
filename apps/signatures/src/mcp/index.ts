#!/usr/bin/env bun
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
import { createSigningSession, updateSessionAttachment, updateSessionStatus, getSessionById } from "../db/signing-sessions.js";
import { getStats } from "../db/stats.js";
import { searchDocuments } from "../lib/search.js";
import { signPdf } from "../lib/pdf-signer.js";
import { detectSignatureFields } from "../lib/pdf-detector.js";
import { generateTextSignature, generateDrawingSignature } from "../lib/signature-gen.js";
import { storeDocument } from "../lib/files.js";
import { updateDocument as updateDoc } from "../db/documents.js";
import { signWithBrowseruse, registerSigningSession } from "../lib/connector-integration.js";
import { shareDocument, receiveDocument } from "../lib/attachments-integration.js";
import { getSetting, setSetting } from "../db/settings.js";
import { getDatabase } from "../db/database.js";
import { isCerebrasConfigured } from "../lib/pdf-detector.js";

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
    {
      name: "signatures_connector_sign",
      description: "Initiate a connector-driven signing session (e.g. browseruse for online doc signing). Records the session in the DB with source=browseruse or connector.",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "Document ID or slug" },
          connector_name: { type: "string", description: "Connector name, e.g. 'browseruse'" },
          url: { type: "string", description: "URL of the external signing portal" },
          signer_name: { type: "string" },
          signer_email: { type: "string" },
          metadata: { type: "object", description: "Extra metadata to persist with the session" },
        },
        required: ["document_id", "connector_name"],
      },
    },
    {
      name: "signatures_share_document",
      description: "Upload a document via attachments and create a shareable signing session link",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          signer_name: { type: "string" },
          signer_email: { type: "string" },
          expiry: { type: "string", description: "Link expiry e.g. '7d', '24h'" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "signatures_get_link",
      description: "Get the share link for a signing session",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" } },
        required: ["session_id"],
      },
    },
    {
      name: "signatures_receive_signed",
      description: "Download a signed document from an attachment and mark session complete",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          attachment_id: { type: "string" },
        },
        required: ["session_id", "attachment_id"],
      },
    },
    {
      name: "signatures_config_set",
      description: "Set a configuration setting (e.g. cerebras_api_key, cerebras_model)",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "signatures_config_get",
      description: "Get a configuration setting",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
    {
      name: "register_agent",
      description: "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "heartbeat",
      description: "Update last_seen_at to signal agent is active.",
      inputSchema: {
        type: "object",
        properties: { agent_id: { type: "string" } },
        required: ["agent_id"],
      },
    },
    {
      name: "set_focus",
      description: "Set active project context for this agent session.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          project_id: { type: "string" },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "list_agents",
      description: "List all registered agents.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "send_feedback",
      description: "Send feedback about this service",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          email: { type: "string" },
          category: { type: "string", enum: ["bug", "feature", "general"] },
        },
        required: ["message"],
      },
    },
  ],
}));

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "register_agent": {
        const a = args as Record<string, unknown>;
        const agentName = a["name"] as string;
        const existing = [..._agentReg.values()].find(x => x.name === agentName);
        if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text", text: JSON.stringify(existing) }] }; }
        const id = Math.random().toString(36).slice(2, 10);
        const ag = { id, name: agentName, last_seen_at: new Date().toISOString() };
        _agentReg.set(id, ag);
        return { content: [{ type: "text", text: JSON.stringify(ag) }] };
      }

      case "heartbeat": {
        const a = args as Record<string, unknown>;
        const ag = _agentReg.get(a["agent_id"] as string);
        if (!ag) return { content: [{ type: "text", text: `Agent not found: ${a["agent_id"]}` }], isError: true };
        ag.last_seen_at = new Date().toISOString();
        return { content: [{ type: "text", text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
      }

      case "set_focus": {
        const a = args as Record<string, unknown>;
        const ag = _agentReg.get(a["agent_id"] as string);
        if (!ag) return { content: [{ type: "text", text: `Agent not found: ${a["agent_id"]}` }], isError: true };
        (ag as any).project_id = a["project_id"] ?? undefined;
        return { content: [{ type: "text", text: a["project_id"] ? `Focus: ${a["project_id"]}` : "Focus cleared" }] };
      }

      case "list_agents": {
        const agents = [..._agentReg.values()];
        if (agents.length === 0) return { content: [{ type: "text", text: "No agents registered." }] };
        return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
      }

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

      case "signatures_connector_sign": {
        const a = args as Record<string, unknown>;
        const connectorName = a["connector_name"] as string;
        const url = a["url"] as string | undefined;

        let session;
        if (connectorName === "browseruse" && url) {
          session = signWithBrowseruse(a["document_id"] as string, url, {
            signer_name: a["signer_name"] as string | undefined,
            signer_email: a["signer_email"] as string | undefined,
            metadata: a["metadata"] as Record<string, unknown> | undefined,
          });
        } else {
          session = registerSigningSession({
            document_id: a["document_id"] as string,
            connector_name: connectorName,
            signer_name: a["signer_name"] as string | undefined,
            signer_email: a["signer_email"] as string | undefined,
            signing_url: url,
            metadata: a["metadata"] as Record<string, unknown> | undefined,
          });
        }
        return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
      }

      case "signatures_share_document": {
        const a = args as Record<string, unknown>;
        const doc = getDocumentByIdOrSlug(a["document_id"] as string);

        const session = createSigningSession({
          document_id: doc.id,
          signer_name: a["signer_name"] as string | undefined,
          signer_email: a["signer_email"] as string | undefined,
          source: "local",
        });

        const shared = await shareDocument(doc.file_path, doc.file_name, {
          expiry: a["expiry"] as string | undefined,
        });

        const updated = updateSessionAttachment(session.id, {
          attachment_id: shared.attachmentId,
          share_link: shared.shareLink,
          share_expires_at: shared.expiresAt,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              session_id: updated.id,
              share_link: updated.share_link,
              expires_at: updated.share_expires_at,
            }, null, 2),
          }],
        };
      }

      case "signatures_get_link": {
        const a = args as Record<string, unknown>;
        const session = getSessionById(a["session_id"] as string);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              session_id: session.id,
              share_link: session.share_link ?? null,
              expires_at: session.share_expires_at ?? null,
            }, null, 2),
          }],
        };
      }

      case "signatures_receive_signed": {
        const a = args as Record<string, unknown>;
        const session = getSessionById(a["session_id"] as string);
        const doc = getDocumentByIdOrSlug(session.document_id);

        const signedDir = doc.file_path.replace(/([^/]+)\.pdf$/i, "signed-$1.pdf");
        await receiveDocument(a["attachment_id"] as string, signedDir);

        updateSessionStatus(session.id, "completed");
        updateDoc(doc.id, { status: "completed" });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, session_id: session.id }, null, 2),
          }],
        };
      }

      case "signatures_config_set": {
        const a = args as Record<string, unknown>;
        setSetting(a["key"] as string, a["value"] as string);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, key: a["key"], value: a["value"] }, null, 2),
          }],
        };
      }

      case "signatures_config_get": {
        const a = args as Record<string, unknown>;
        const value = getSetting(a["key"] as string);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ key: a["key"], value }, null, 2),
          }],
        };
      }

      case "send_feedback": {
        const a = args as Record<string, unknown>;
        const db = getDatabase();
        db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [a["message"] as string, (a["email"] as string) || null, (a["category"] as string) || "general", "0.1.1"]);
        return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
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
