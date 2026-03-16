#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import {
  createDocument,
  listDocuments,
  getDocumentByIdOrSlug,
  updateDocument,
} from "../db/documents.js";
import {
  createSignature,
  listSignatures,
  getSignatureById,
} from "../db/signatures.js";
import {
  createProject,
  listProjects,
} from "../db/projects.js";
import {
  createCollection,
  listCollections,
} from "../db/collections.js";
import { listFieldsForDocument, deleteFieldsForDocument, createSignatureField } from "../db/signature-fields.js";
import { createPlacement } from "../db/signature-placements.js";
import { createSigningSession, updateSessionAttachment, getSessionById } from "../db/signing-sessions.js";
import { getStats } from "../db/stats.js";
import { storeDocument } from "../lib/files.js";
import { signPdf } from "../lib/pdf-signer.js";
import { detectSignatureFields, detectSignatureFieldsOnPage, isCerebrasConfigured } from "../lib/pdf-detector.js";
import { shareDocument } from "../lib/attachments-integration.js";
import { getSetting, setSetting } from "../db/settings.js";
import {
  generateTextSignature,
  generateDrawingSignature,
} from "../lib/signature-gen.js";

const program = new Command();

program
  .name("open-signatures")
  .description("Open source e-signature platform")
  .version("0.1.0");

// ── document ─────────────────────────────────────────────────────────────────

const documentCmd = program.command("document").description("Document commands");

documentCmd
  .command("add <file>")
  .description("Add a document")
  .option("--name <name>", "Document name")
  .option("--project <id>", "Project ID")
  .option("--collection <id>", "Collection ID")
  .option("--tags <tags>", "Comma-separated tag names")
  .option("--json", "Output as JSON")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const stored = storeDocument(file);
      const doc = createDocument({
        name: (opts["name"] as string) ?? stored.file_name,
        file_path: stored.file_path,
        file_name: stored.file_name,
        file_size: stored.file_size,
        project_id: opts["project"] as string | undefined,
        collection_id: opts["collection"] as string | undefined,
      });

      if (opts["json"]) {
        console.log(JSON.stringify(doc, null, 2));
      } else {
        console.log(chalk.green("✓ Document added"));
        console.log(`  ID:   ${chalk.cyan(doc.id)}`);
        console.log(`  Name: ${doc.name}`);
        console.log(`  Path: ${doc.file_path}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

documentCmd
  .command("list")
  .description("List documents")
  .option("--project <id>", "Filter by project")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const docs = listDocuments({
        project_id: opts["project"] as string | undefined,
        status: opts["status"] as "draft" | undefined,
      });

      if (opts["json"]) {
        console.log(JSON.stringify(docs, null, 2));
        return;
      }

      if (docs.length === 0) {
        console.log(chalk.yellow("No documents found"));
        return;
      }

      console.log(chalk.bold(`\nDocuments (${docs.length})\n`));
      for (const doc of docs) {
        const statusColor =
          doc.status === "completed" ? chalk.green
            : doc.status === "pending" ? chalk.yellow
            : doc.status === "cancelled" ? chalk.red
            : chalk.gray;
        console.log(`${chalk.cyan(doc.id)}  ${statusColor(`[${doc.status}]`)}  ${doc.name}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

documentCmd
  .command("sign <id-or-slug>")
  .description("Sign a document")
  .option("--signature <id>", "Signature ID")
  .option("--field <id>", "Field ID")
  .option("--page <n>", "Page number", "1")
  .option("--x <n>", "X position (percentage)", "10")
  .option("--y <n>", "Y position (percentage)", "80")
  .option("--width <n>", "Width (percentage)")
  .option("--height <n>", "Height (percentage)")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const doc = getDocumentByIdOrSlug(idOrSlug);
      const sigId = opts["signature"] as string;
      if (!sigId) {
        const sigs = listSignatures();
        if (sigs.length === 0) {
          console.error(chalk.red("No signatures found. Create one with: open-signatures signature create"));
          process.exit(1);
        }
        console.error(chalk.red("--signature is required. Available signatures:"));
        for (const s of sigs) {
          console.error(`  ${s.id}  ${s.name}`);
        }
        process.exit(1);
      }

      const sig = getSignatureById(sigId);
      const page = parseInt(opts["page"] as string);
      const x = parseFloat(opts["x"] as string);
      const y = parseFloat(opts["y"] as string);

      const session = createSigningSession({
        document_id: doc.id,
        source: "local",
      });

      const placement = createPlacement({
        document_id: doc.id,
        signature_id: sig.id,
        field_id: opts["field"] as string | undefined,
        page,
        x,
        y,
        width: opts["width"] ? parseFloat(opts["width"] as string) : undefined,
        height: opts["height"] ? parseFloat(opts["height"] as string) : undefined,
      });

      const result = await signPdf({
        document_path: doc.file_path,
        document_name: doc.file_name,
        placements: [{ placement, signature: sig }],
      });

      updateDocument(doc.id, { status: "completed" });

      if (opts["json"]) {
        console.log(JSON.stringify({ output_path: result.output_path, pages_signed: result.pages_signed }, null, 2));
      } else {
        console.log(chalk.green("✓ Document signed"));
        console.log(`  Output: ${chalk.cyan(result.output_path)}`);
        console.log(`  Pages: ${result.pages_signed.join(", ")}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

documentCmd
  .command("detect <id-or-slug>")
  .description("Detect signature fields in a document (uses Cerebras AI if configured)")
  .option("--page <n>", "Detect on specific page only")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const doc = getDocumentByIdOrSlug(idOrSlug);
      deleteFieldsForDocument(doc.id);

      const pageOpt = opts["page"] ? parseInt(opts["page"] as string, 10) : undefined;
      let detected;
      if (pageOpt !== undefined) {
        detected = await detectSignatureFieldsOnPage(doc.file_path, pageOpt);
      } else {
        detected = await detectSignatureFields(doc.file_path);
      }

      const fields = [];
      for (const f of detected) {
        fields.push(createSignatureField({ ...f, document_id: doc.id }));
      }

      if (opts["json"]) {
        console.log(JSON.stringify(fields, null, 2));
      } else {
        const mode = isCerebrasConfigured() ? chalk.cyan("Cerebras AI") : chalk.yellow("heuristic");
        console.log(chalk.green(`✓ Detected ${fields.length} signature field(s)`) + ` [${mode}]`);
        for (const f of fields) {
          console.log(`  ${chalk.cyan(f.id)}  Page ${f.page}  (${f.x.toFixed(1)}%, ${f.y.toFixed(1)}%)  ${f.field_type}`);
        }
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

documentCmd
  .command("share <id-or-slug>")
  .description("Upload document to attachments and create a shareable signing link")
  .option("--expiry <expiry>", "Link expiry e.g. 7d, 24h", "7d")
  .option("--signer-name <name>", "Signer name")
  .option("--signer-email <email>", "Signer email")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const doc = getDocumentByIdOrSlug(idOrSlug);

      const session = createSigningSession({
        document_id: doc.id,
        signer_name: opts["signerName"] as string | undefined,
        signer_email: opts["signerEmail"] as string | undefined,
        source: "local",
      });

      const shared = await shareDocument(doc.file_path, doc.file_name, {
        expiry: opts["expiry"] as string | undefined,
      });

      updateSessionAttachment(session.id, {
        attachment_id: shared.attachmentId,
        share_link: shared.shareLink,
        share_expires_at: shared.expiresAt,
      });

      if (opts["json"]) {
        console.log(JSON.stringify({
          session_id: session.id,
          share_link: shared.shareLink,
          expires_at: shared.expiresAt,
        }, null, 2));
      } else {
        console.log(chalk.green("✓ Document shared"));
        console.log(`  Session: ${chalk.cyan(session.id)}`);
        console.log(`  Link:    ${chalk.cyan(shared.shareLink)}`);
        if (shared.expiresAt) {
          console.log(`  Expires: ${shared.expiresAt}`);
        }
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── signature ─────────────────────────────────────────────────────────────────

const signatureCmd = program.command("signature").description("Signature commands");

signatureCmd
  .command("create")
  .description("Create a signature")
  .option("--name <name>", "Signer name")
  .option("--type <type>", "Type: text|drawing|image", "text")
  .option("--font <font>", "Google Font family name", "Dancing Script")
  .option("--font-size <n>", "Font size", "48")
  .option("--color <color>", "Color hex", "#000000")
  .option("--text <text>", "Text to render as signature")
  .option("--drawing <description>", "Description of signature for OpenAI generation")
  .option("--json", "Output as JSON")
  .action(async (opts: Record<string, unknown>) => {
    try {
      const name = opts["name"] as string ?? "My Signature";
      const type = opts["type"] as string;

      if (type === "text") {
        const text = opts["text"] as string ?? name;
        const result = await generateTextSignature(
          text,
          opts["font"] as string,
          parseInt(opts["fontSize"] as string),
          opts["color"] as string
        );
        const sig = createSignature({
          name,
          type: "text",
          font_family: opts["font"] as string,
          font_size: parseInt(opts["fontSize"] as string),
          color: opts["color"] as string,
          text_value: text,
          image_path: result.svg_path,
          width: result.width,
          height: result.height,
        });

        if (opts["json"]) {
          console.log(JSON.stringify(sig, null, 2));
        } else {
          console.log(chalk.green("✓ Text signature created"));
          console.log(`  ID:   ${chalk.cyan(sig.id)}`);
          console.log(`  SVG:  ${result.svg_path}`);
        }
        return;
      }

      if (type === "drawing") {
        const desc = opts["drawing"] as string;
        if (!desc) {
          console.error(chalk.red("--drawing <description> is required for drawing type"));
          process.exit(1);
        }
        console.log(chalk.yellow("Generating signature with OpenAI..."));
        const result = await generateDrawingSignature(desc);
        const sig = createSignature({
          name,
          type: "drawing",
          image_path: result.image_path,
          image_prompt: desc,
          width: result.width,
          height: result.height,
        });

        if (opts["json"]) {
          console.log(JSON.stringify(sig, null, 2));
        } else {
          console.log(chalk.green("✓ Drawing signature created"));
          console.log(`  ID:    ${chalk.cyan(sig.id)}`);
          console.log(`  Image: ${result.image_path}`);
        }
        return;
      }

      // image type
      const sig = createSignature({
        name,
        type: "image",
        font_size: parseInt(opts["fontSize"] as string ?? "48"),
        color: opts["color"] as string ?? "#000000",
      });

      if (opts["json"]) {
        console.log(JSON.stringify(sig, null, 2));
      } else {
        console.log(chalk.green("✓ Signature created"));
        console.log(`  ID: ${chalk.cyan(sig.id)}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

signatureCmd
  .command("list")
  .description("List signatures")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const sigs = listSignatures();
      if (opts["json"]) {
        console.log(JSON.stringify(sigs, null, 2));
        return;
      }
      if (sigs.length === 0) {
        console.log(chalk.yellow("No signatures found"));
        return;
      }
      console.log(chalk.bold(`\nSignatures (${sigs.length})\n`));
      for (const sig of sigs) {
        console.log(`${chalk.cyan(sig.id)}  [${sig.type}]  ${sig.name}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Project commands");

projectCmd
  .command("create <name>")
  .description("Create a project")
  .option("--description <desc>", "Project description")
  .option("--color <color>", "Color hex")
  .option("--json", "Output as JSON")
  .action((name: string, opts: Record<string, unknown>) => {
    try {
      const project = createProject({
        name,
        description: opts["description"] as string | undefined,
        color: opts["color"] as string | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(project, null, 2));
      } else {
        console.log(chalk.green(`✓ Project created: ${project.name}`));
        console.log(`  ID: ${chalk.cyan(project.id)}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

projectCmd
  .command("list")
  .description("List projects")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const projects = listProjects();
      if (opts["json"]) {
        console.log(JSON.stringify(projects, null, 2));
        return;
      }
      if (projects.length === 0) {
        console.log(chalk.yellow("No projects found"));
        return;
      }
      console.log(chalk.bold(`\nProjects (${projects.length})\n`));
      for (const p of projects) {
        console.log(`${chalk.cyan(p.id)}  ${p.name}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── collection ────────────────────────────────────────────────────────────────

const collectionCmd = program.command("collection").description("Collection commands");

collectionCmd
  .command("create <name>")
  .description("Create a collection")
  .option("--project <id>", "Project ID")
  .option("--description <desc>", "Description")
  .option("--json", "Output as JSON")
  .action((name: string, opts: Record<string, unknown>) => {
    try {
      const col = createCollection({
        name,
        project_id: opts["project"] as string | undefined,
        description: opts["description"] as string | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(col, null, 2));
      } else {
        console.log(chalk.green(`✓ Collection created: ${col.name}`));
        console.log(`  ID: ${chalk.cyan(col.id)}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── serve ─────────────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the REST API server")
  .option("--port <n>", "Port", "19440")
  .action((opts: Record<string, unknown>) => {
    process.env["PORT"] = opts["port"] as string;
    import("../server/index.js").catch(console.error);
  });

// ── stats ─────────────────────────────────────────────────────────────────────

program
  .command("stats")
  .description("Show statistics")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const stats = getStats();
      if (opts["json"]) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(chalk.bold("\nStatistics\n"));
      console.log(`  Documents:   ${chalk.cyan(stats.total_documents)}`);
      console.log(`  Signatures:  ${chalk.cyan(stats.total_signatures)}`);
      console.log(`  Projects:    ${chalk.cyan(stats.total_projects)}`);
      console.log(`  Collections: ${chalk.cyan(stats.total_collections)}`);
      console.log(`  Tags:        ${chalk.cyan(stats.total_tags)}`);
      console.log(`  Placements:  ${chalk.cyan(stats.total_placements)}`);
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── config ────────────────────────────────────────────────────────────────────

const configCmd = program.command("config").description("Configuration commands");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value (e.g. cerebras_api_key, cerebras_model)")
  .action((key: string, value: string) => {
    try {
      setSetting(key, value);
      const masked = key.toLowerCase().includes("key") || key.toLowerCase().includes("secret")
        ? "***"
        : value;
      console.log(chalk.green(`✓ Set ${key} = ${masked}`));
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

configCmd
  .command("get <key>")
  .description("Get a configuration value")
  .action((key: string) => {
    try {
      const value = getSetting(key);
      if (value === null) {
        console.log(chalk.yellow(`No value set for: ${key}`));
      } else {
        const display = key.toLowerCase().includes("key") || key.toLowerCase().includes("secret")
          ? "***"
          : value;
        console.log(`${key} = ${display}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse(process.argv);
