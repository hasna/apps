#!/usr/bin/env bun
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
import { createSigningSession, updateSessionAttachment, getSessionById, listSigningSessions } from "../db/signing-sessions.js";
import { getStats } from "../db/stats.js";
import { storeDocument } from "../lib/files.js";
import { detectSignatureFields, detectSignatureFieldsOnPage, isCerebrasConfigured } from "../lib/pdf-detector.js";
import { shareDocument } from "../lib/attachments-integration.js";
import { getSetting, setSetting } from "../db/settings.js";
import { createPerson, listPeople, getPersonByIdOrEmail } from "../db/people.js";
import { getSigningCertificateBySession } from "../db/certificates.js";
import {
  generateTextSignature,
  generateDrawingSignature,
} from "../lib/signature-gen.js";
import { parseCliVariables } from "../lib/markdown-template.js";
import type { RecipientStatus, SessionStatus, SignerType } from "../types/index.js";
import {
  createDocumentFromMarkdown,
  sendDocumentForSignature,
  sendDocumentWithProvider,
  signDocumentLocally,
} from "../lib/workflow.js";
import { setupSigningDomain } from "../lib/domain-integration.js";
import { getPackageVersion } from "../lib/package-info.js";

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseIntOption(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferSignerType(opts: Record<string, unknown>): "human" | "agent" | undefined {
  const explicit = opts["signerType"] as string | undefined;
  if (explicit === "human" || explicit === "agent") return explicit;
  const personRef = opts["person"] as string | undefined;
  if (!personRef) return undefined;
  try {
    return getPersonByIdOrEmail(personRef).signer_type;
  } catch {
    return undefined;
  }
}

function createAgentAttestationSignature(opts: Record<string, unknown>): string {
  const label =
    (opts["signerName"] as string | undefined)
    ?? (opts["agentId"] as string | undefined)
    ?? (opts["person"] as string | undefined)
    ?? "Agent";
  const sig = createSignature({
    name: `${label} attestation`,
    type: "text",
    font_family: "Helvetica",
    font_size: 14,
    color: "#1f2937",
    text_value: `Agent attestation: ${label}`,
  });
  return sig.id;
}

program
  .name("signatures")
  .description("Open-source agreement and e-signature workflows")
  .version(getPackageVersion());

// ── document ─────────────────────────────────────────────────────────────────

const documentCmd = program.command("document").description("Document commands");

documentCmd
  .command("add <file>")
  .description("Add a document")
  .option("--name <name>", "Document name")
  .option("--project <id>", "Project ID")
  .option("--collection <id>", "Collection ID")
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
  .command("from-markdown <file>")
  .description("Render a Markdown template to PDF and add it as a document")
  .option("--name <name>", "Document name")
  .option("--var <key=value...>", "Template variable; repeatable", collect, [])
  .option("--signer-name <name>", "Signer name for signer.* variables")
  .option("--signer-email <email>", "Signer email for signer.* variables")
  .option("--signer-type <type>", "Default signer type for signature anchors: human|agent", "human")
  .option("--json", "Output as JSON")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const result = await createDocumentFromMarkdown({
        filePath: file,
        name: opts["name"] as string | undefined,
        variables: parseCliVariables(opts["var"] as string[] | undefined),
        signerName: opts["signerName"] as string | undefined,
        signerEmail: opts["signerEmail"] as string | undefined,
        signerType: opts["signerType"] as Parameters<typeof createDocumentFromMarkdown>[0]["signerType"],
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green("✓ Markdown rendered and added"));
        console.log(`  Document: ${chalk.cyan(result.document_id)}`);
        console.log(`  PDF:      ${result.document_path}`);
        console.log(`  HTML:     ${result.html_path}`);
        if (result.fields.length > 0) {
          console.log("  Fields:");
          for (const field of result.fields) {
            console.log(`    ${chalk.cyan(field.id)}${field.anchor ? `:${field.anchor}` : ""}  ${field.signer_type ?? "human"}  order:${field.signing_order ?? 1}${field.role ? `  role:${field.role}` : ""}`);
          }
        }
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
  .option("--signer-name <name>", "Signer name")
  .option("--signer-email <email>", "Signer email")
  .option("--person <id-or-email>", "Saved person to use as signer")
  .option("--signer-type <type>", "Signer type: human|agent")
  .option("--agent-id <id>", "Agent identifier for agent signer")
  .option("--agent-provider <provider>", "Agent runtime/provider name")
  .option("--agent-run-id <id>", "Agent run identifier")
  .option("--agent-thread-id <id>", "Agent thread/session identifier")
  .option("--agent-policy-id <id>", "Policy that allowed this agent signature")
  .option("--agent-reason <text>", "Reason/attestation text for an agent signature")
  .option("--agent-input-hash <sha256>", "Hash of the input the agent reviewed")
  .option("--agent-output-hash <sha256>", "Hash of the agent decision/output")
  .option("--role <role>", "Signer role for routing")
  .option("--signing-order <n>", "Signing order group")
  .option("--parallel-group <n>", "Parallel signing group")
  .option("--session <id>", "Existing signing session to complete")
  .option("--no-certificate", "Do not generate completion certificate")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const doc = getDocumentByIdOrSlug(idOrSlug);
      let sigId = opts["signature"] as string | undefined;
      if (!sigId) {
        if (inferSignerType(opts) === "agent") {
          sigId = createAgentAttestationSignature(opts);
        }
      }
      if (!sigId) {
        const sigs = listSignatures();
        if (sigs.length === 0) {
          console.error(chalk.red("No signatures found. Create one with: signatures signature create"));
          process.exit(1);
        }
        console.error(chalk.red("--signature is required. Available signatures:"));
        for (const s of sigs) {
          console.error(`  ${s.id}  ${s.name}`);
        }
        process.exit(1);
      }

      const result = await signDocumentLocally({
        documentId: doc.id,
        signatureId: sigId,
        sessionId: opts["session"] as string | undefined,
        personIdOrEmail: opts["person"] as string | undefined,
        signerName: opts["signerName"] as string | undefined,
        signerEmail: opts["signerEmail"] as string | undefined,
        signerType: opts["signerType"] as Parameters<typeof signDocumentLocally>[0]["signerType"],
        agentId: opts["agentId"] as string | undefined,
        agentProvider: opts["agentProvider"] as string | undefined,
        agentRunId: opts["agentRunId"] as string | undefined,
        agentThreadId: opts["agentThreadId"] as string | undefined,
        agentPolicyId: opts["agentPolicyId"] as string | undefined,
        agentReason: opts["agentReason"] as string | undefined,
        agentInputHash: opts["agentInputHash"] as string | undefined,
        agentOutputHash: opts["agentOutputHash"] as string | undefined,
        role: opts["role"] as string | undefined,
        signingOrder: parseIntOption(opts["signingOrder"]),
        parallelGroup: parseIntOption(opts["parallelGroup"]),
        fieldId: opts["field"] as string | undefined,
        page: opts["page"] ? parseInt(opts["page"] as string, 10) : undefined,
        x: opts["x"] ? parseFloat(opts["x"] as string) : undefined,
        y: opts["y"] ? parseFloat(opts["y"] as string) : undefined,
        width: opts["width"] ? parseFloat(opts["width"] as string) : undefined,
        height: opts["height"] ? parseFloat(opts["height"] as string) : undefined,
        certificate: opts["certificate"] as boolean | undefined,
      });

      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green("✓ Document signed"));
        console.log(`  Output: ${chalk.cyan(result.output_path)}`);
        if (result.certificate_path) {
          console.log(`  Certificate: ${chalk.cyan(result.certificate_path)}`);
        }
        console.log(`  Signer: ${result.session.signer_type}${result.session.agent_id ? ` (${result.session.agent_id})` : ""}`);
        console.log(`  Pages: ${result.pages_signed.join(", ")}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

documentCmd
  .command("send <id-or-slug>")
  .description("Create a signing session and optionally send an email invitation")
  .option("--person <id-or-email>", "Saved person to send to")
  .option("--signer-name <name>", "Signer name")
  .option("--signer-email <email>", "Signer email")
  .option("--signer-type <type>", "Signer type: human|agent")
  .option("--agent-id <id>", "Agent identifier for agent signer")
  .option("--agent-provider <provider>", "Agent runtime/provider name")
  .option("--agent-run-id <id>", "Agent run identifier")
  .option("--agent-thread-id <id>", "Agent thread/session identifier")
  .option("--agent-policy-id <id>", "Policy that allowed this agent session")
  .option("--agent-reason <text>", "Reason/attestation text for an agent session")
  .option("--role <role>", "Signer role for routing")
  .option("--signing-order <n>", "Signing order group")
  .option("--parallel-group <n>", "Parallel signing group")
  .option("--from <email>", "Sender email for open-emails delivery")
  .option("--base-url <url>", "Public signing base URL", "http://localhost:19440")
  .option("--expiry <expiry>", "Attachment share expiry", "7d")
  .option("--dry-run-email", "Preview open-emails send without sending")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const result = await sendDocumentForSignature({
        documentId: idOrSlug,
        personIdOrEmail: opts["person"] as string | undefined,
        signerName: opts["signerName"] as string | undefined,
        signerEmail: opts["signerEmail"] as string | undefined,
        signerType: opts["signerType"] as Parameters<typeof sendDocumentForSignature>[0]["signerType"],
        agentId: opts["agentId"] as string | undefined,
        agentProvider: opts["agentProvider"] as string | undefined,
        agentRunId: opts["agentRunId"] as string | undefined,
        agentThreadId: opts["agentThreadId"] as string | undefined,
        agentPolicyId: opts["agentPolicyId"] as string | undefined,
        agentReason: opts["agentReason"] as string | undefined,
        role: opts["role"] as string | undefined,
        signingOrder: parseIntOption(opts["signingOrder"]),
        parallelGroup: parseIntOption(opts["parallelGroup"]),
        fromEmail: opts["from"] as string | undefined,
        baseUrl: opts["baseUrl"] as string | undefined,
        expiry: opts["expiry"] as string | undefined,
        dryRunEmail: !!opts["dryRunEmail"],
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green("✓ Signing session created"));
        console.log(`  Session: ${chalk.cyan(result.session.id)}`);
        console.log(`  Signer:  ${result.session.signer_type}${result.session.agent_id ? ` (${result.session.agent_id})` : ""}`);
        console.log(`  URL:     ${chalk.cyan(result.signing_url)}`);
        if (result.share_link) console.log(`  Share:   ${chalk.cyan(result.share_link)}`);
        if (result.email?.error) console.log(chalk.yellow(`  Email:   ${result.email.error}`));
        else if (result.email) console.log(`  Email:   ${result.email.dry_run ? "dry run" : "sent"}`);
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
  .option("--image <path>", "Image file path for image signatures")
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
        image_path: opts["image"] as string | undefined,
        font_size: parseInt(opts["fontSize"] as string ?? "48"),
        color: opts["color"] as string ?? "#000000",
      });

      if (opts["json"]) {
        console.log(JSON.stringify(sig, null, 2));
      } else {
        console.log(chalk.green("✓ Signature created"));
        console.log(`  ID: ${chalk.cyan(sig.id)}`);
        if (sig.image_path) console.log(`  Image: ${sig.image_path}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── people ───────────────────────────────────────────────────────────────────

const personCmd = program.command("person").aliases(["people", "signer", "signers"]).description("People, agents, and signer contacts");

personCmd
  .command("add <name>")
  .description("Add a person/contact")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--company <company>", "Company")
  .option("--role <role>", "Role/title")
  .option("--type <type>", "Signer type: human|agent", "human")
  .option("--signer-type <type>", "Signer type: human|agent")
  .option("--agent-id <id>", "Stable agent identifier")
  .option("--agent-provider <provider>", "Agent runtime/provider name")
  .option("--json", "Output as JSON")
  .action((name: string, opts: Record<string, unknown>) => {
    try {
      const person = createPerson({
        name,
        email: opts["email"] as string | undefined,
        phone: opts["phone"] as string | undefined,
        company: opts["company"] as string | undefined,
        role: opts["role"] as string | undefined,
        signer_type: ((opts["signerType"] as string | undefined) ?? opts["type"]) as Parameters<typeof createPerson>[0]["signer_type"],
        agent_id: opts["agentId"] as string | undefined,
        agent_provider: opts["agentProvider"] as string | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(person, null, 2));
      } else {
        console.log(chalk.green("✓ Person added"));
        console.log(`  ID:    ${chalk.cyan(person.id)}`);
        console.log(`  Name:  ${person.name}`);
        console.log(`  Type:  ${person.signer_type}`);
        if (person.email) console.log(`  Email: ${person.email}`);
        if (person.agent_id) console.log(`  Agent: ${person.agent_id}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

personCmd
  .command("list")
  .description("List people")
  .option("--query <query>", "Search query")
  .option("--type <type>", "Filter signer type: human|agent")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const people = listPeople({
        query: opts["query"] as string | undefined,
        signer_type: opts["type"] as SignerType | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(people, null, 2));
        return;
      }
      if (people.length === 0) {
        console.log(chalk.yellow("No people found"));
        return;
      }
      console.log(chalk.bold(`\nPeople (${people.length})\n`));
      for (const person of people) {
        console.log(`${chalk.cyan(person.id)}  [${person.signer_type}]  ${person.name}${person.email ? `  <${person.email}>` : ""}${person.agent_id ? `  agent:${person.agent_id}` : ""}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

personCmd
  .command("get <id-or-email>")
  .description("Show a person by ID or email")
  .option("--json", "Output as JSON")
  .action((idOrEmail: string, opts: Record<string, unknown>) => {
    try {
      const person = getPersonByIdOrEmail(idOrEmail);
      if (opts["json"]) {
        console.log(JSON.stringify(person, null, 2));
      } else {
        console.log(`${chalk.cyan(person.id)}  ${person.name}`);
        if (person.email) console.log(`  Email:   ${person.email}`);
        if (person.phone) console.log(`  Phone:   ${person.phone}`);
        if (person.company) console.log(`  Company: ${person.company}`);
        if (person.role) console.log(`  Role:    ${person.role}`);
        console.log(`  Type:    ${person.signer_type}`);
        if (person.agent_id) console.log(`  Agent:   ${person.agent_id}`);
        if (person.agent_provider) console.log(`  Runtime: ${person.agent_provider}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── certificate ──────────────────────────────────────────────────────────────

const certificateCmd = program.command("certificate").description("Local signer-evidence and document-completion certificate commands");

certificateCmd
  .command("get <session-id>")
  .description("Get the local evidence/completion certificate for a session")
  .option("--json", "Output as JSON")
  .action((sessionId: string, opts: Record<string, unknown>) => {
    try {
      const certificate = getSigningCertificateBySession(sessionId);
      if (opts["json"]) {
        console.log(JSON.stringify(certificate, null, 2));
      } else {
        console.log(chalk.green("✓ Certificate found"));
        console.log(`  ID:    ${chalk.cyan(certificate.id)}`);
        console.log(`  Path:  ${certificate.certificate_path}`);
        console.log(`  Code:  ${certificate.verification_code}`);
        if (certificate.metadata?.["certificate_kind"]) console.log(`  Kind:  ${certificate.metadata["certificate_kind"]}`);
        if (certificate.metadata?.["document_complete"] !== undefined) console.log(`  Done:  ${certificate.metadata["document_complete"] ? "document complete" : "session evidence"}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── sessions ────────────────────────────────────────────────────────────────

const sessionCmd = program.command("session").alias("sessions").description("Signing session workflow commands");

sessionCmd
  .command("list")
  .description("List signing sessions")
  .option("--document <id>", "Filter by document")
  .option("--status <status>", "Filter by session status")
  .option("--signer-type <type>", "Filter signer type: human|agent")
  .option("--recipient-status <status>", "Filter recipient status")
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const sessions = listSigningSessions({
        document_id: opts["document"] as string | undefined,
        status: opts["status"] as SessionStatus | undefined,
        signer_type: opts["signerType"] as SignerType | undefined,
        recipient_status: opts["recipientStatus"] as RecipientStatus | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }
      if (sessions.length === 0) {
        console.log(chalk.yellow("No sessions found"));
        return;
      }
      console.log(chalk.bold(`\nSessions (${sessions.length})\n`));
      for (const session of sessions) {
        console.log(`${chalk.cyan(session.id)}  [${session.status}/${session.recipient_status}]  ${session.signer_type}  order:${session.signing_order}  ${session.signer_name ?? session.signer_email ?? session.agent_id ?? "unassigned"}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── domain ───────────────────────────────────────────────────────────────────

const domainCmd = program.command("domain").description("Signing domain setup via open-domains");

domainCmd
  .command("setup <domain>")
  .description("Configure or buy a signing domain through the domains CLI")
  .option("--subdomain <name>", "Signing subdomain", "sign")
  .option("--target <target>", "CNAME target", "localhost")
  .option("--buy", "Buy/register the domain before DNS setup")
  .option("--dry-run", "Print domains CLI commands without running them")
  .option("--json", "Output as JSON")
  .action((domain: string, opts: Record<string, unknown>) => {
    try {
      const result = setupSigningDomain({
        domain,
        subdomain: opts["subdomain"] as string | undefined,
        target: opts["target"] as string | undefined,
        buy: !!opts["buy"],
        dryRun: !!opts["dryRun"],
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.configured ? chalk.green("✓ Domain configured") : chalk.yellow("Domain setup prepared"));
        console.log(result.output);
        if (result.error) console.log(chalk.red(result.error));
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── provider ────────────────────────────────────────────────────────────────

const providerCmd = program.command("provider").description("External provider integrations");

providerCmd
  .command("send <id-or-slug>")
  .description("Create/send a provider envelope through connectors or provider API")
  .option("--provider <name>", "Provider name", "pandadoc")
  .option("--api-key <key>", "Provider API key; defaults to config pandadoc_api_key")
  .requiredOption("--recipient <email>", "Recipient email")
  .option("--recipient-name <name>", "Recipient name")
  .option("--signer-type <type>", "Signer type recorded for provider evidence: human|agent")
  .requiredOption("--signature-level <level>", "Signature level: ses|aes|qes|eseal|qeseal")
  .option("--document-url <url>", "Public document URL instead of local file upload")
  .option("--subject <subject>", "Provider email subject")
  .option("--message <message>", "Provider email message")
  .option("--connectors-api-url <url>", "Hosted @hasna/connectors API URL")
  .option("--connectors-api-key <key>", "Hosted @hasna/connectors API key")
  .option("--connectors-server-url <url>", "Local connectors-serve URL")
  .option("--connectors-account <id>", "Hosted connectors account id")
  .option("--connectors-profile <name>", "Connectors profile name")
  .option("--silent", "Ask provider not to send recipient notifications")
  .option("--dry-run", "Prepare request without sending")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const recipientEmail = opts["recipient"] as string;
      const provider = opts["provider"] as string;
      const result = await sendDocumentWithProvider({
        documentId: idOrSlug,
        provider,
        apiKey: (opts["apiKey"] as string | undefined) ?? getSetting(`${provider}_api_key`) ?? getSetting("pandadoc_api_key") ?? undefined,
        recipient: {
          email: recipientEmail,
          name: (opts["recipientName"] as string | undefined) ?? recipientEmail,
          role: "Signer",
        },
        signerType: opts["signerType"] as Parameters<typeof sendDocumentWithProvider>[0]["signerType"],
        signatureLevel: opts["signatureLevel"] as Parameters<typeof sendDocumentWithProvider>[0]["signatureLevel"],
        documentUrl: opts["documentUrl"] as string | undefined,
        subject: opts["subject"] as string | undefined,
        message: opts["message"] as string | undefined,
        silent: !!opts["silent"],
        connectors: {
          apiUrl: (opts["connectorsApiUrl"] as string | undefined) ?? getSetting("connectors_api_url") ?? undefined,
          apiKey: (opts["connectorsApiKey"] as string | undefined) ?? getSetting("connectors_api_key") ?? undefined,
          serverUrl: (opts["connectorsServerUrl"] as string | undefined) ?? getSetting("connectors_server_url") ?? undefined,
          accountId: opts["connectorsAccount"] as string | undefined,
          profileName: opts["connectorsProfile"] as string | undefined,
        },
        dryRun: !!opts["dryRun"],
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.provider.status === "failed" ? chalk.red("Provider send failed") : chalk.green(`✓ Provider status: ${result.provider.status}`));
        console.log(`  Session:  ${chalk.cyan(result.session.id)}`);
        console.log(`  Evidence: ${chalk.cyan(result.evidence.id)}`);
        console.log(`  Level:    ${result.evidence.signature_level}`);
        if (result.provider.remote_document_id) console.log(`  Remote ID: ${chalk.cyan(result.provider.remote_document_id)}`);
        if (result.provider.connector_slug) console.log(`  Connector: ${result.provider.connector_slug}:${result.provider.operation}`);
        if (result.provider.error) console.log(`  Error: ${result.provider.error}`);
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

providerCmd
  .command("evidence <id-or-slug>")
  .description("List provider evidence for a document")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const { listProviderEvidence } = await import("../db/provider-evidence.js");
      const doc = getDocumentByIdOrSlug(idOrSlug);
      const evidence = listProviderEvidence({ document_id: doc.id });
      if (opts["json"]) {
        console.log(JSON.stringify(evidence, null, 2));
      } else if (evidence.length === 0) {
        console.log(chalk.yellow("No provider evidence found"));
      } else {
        for (const item of evidence) {
          console.log(`${chalk.cyan(item.id)}  ${item.provider}  ${item.signature_level}  ${item.status}/${item.validation_status}`);
        }
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
