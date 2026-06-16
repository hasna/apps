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
import { createSigningSession, updateSessionAttachment, getSessionById } from "../db/signing-sessions.js";
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
import {
  createDocumentFromMarkdown,
  sendDocumentForSignature,
  signDocumentLocally,
} from "../lib/workflow.js";
import { setupSigningDomain } from "../lib/domain-integration.js";
import { sendWithProvider } from "../lib/provider-integration.js";

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

program
  .name("open-signatures")
  .description("Open-source agreement and e-signature workflows")
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
  .command("from-markdown <file>")
  .description("Render a Markdown template to PDF and add it as a document")
  .option("--name <name>", "Document name")
  .option("--var <key=value...>", "Template variable; repeatable", collect, [])
  .option("--signer-name <name>", "Signer name for signer.* variables")
  .option("--signer-email <email>", "Signer email for signer.* variables")
  .option("--json", "Output as JSON")
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const result = await createDocumentFromMarkdown({
        filePath: file,
        name: opts["name"] as string | undefined,
        variables: parseCliVariables(opts["var"] as string[] | undefined),
        signerName: opts["signerName"] as string | undefined,
        signerEmail: opts["signerEmail"] as string | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green("✓ Markdown rendered and added"));
        console.log(`  Document: ${chalk.cyan(result.document_id)}`);
        console.log(`  PDF:      ${result.document_path}`);
        console.log(`  HTML:     ${result.html_path}`);
        if (result.fields.length > 0) {
          console.log(`  Fields:   ${result.fields.map((f) => `${f.id}${f.anchor ? `:${f.anchor}` : ""}`).join(", ")}`);
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
  .option("--session <id>", "Existing signing session to complete")
  .option("--no-certificate", "Do not generate completion certificate")
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

      const result = await signDocumentLocally({
        documentId: doc.id,
        signatureId: sigId,
        sessionId: opts["session"] as string | undefined,
        personIdOrEmail: opts["person"] as string | undefined,
        signerName: opts["signerName"] as string | undefined,
        signerEmail: opts["signerEmail"] as string | undefined,
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

const personCmd = program.command("person").alias("people").description("People and signer contacts");

personCmd
  .command("add <name>")
  .description("Add a person/contact")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--company <company>", "Company")
  .option("--role <role>", "Role/title")
  .option("--json", "Output as JSON")
  .action((name: string, opts: Record<string, unknown>) => {
    try {
      const person = createPerson({
        name,
        email: opts["email"] as string | undefined,
        phone: opts["phone"] as string | undefined,
        company: opts["company"] as string | undefined,
        role: opts["role"] as string | undefined,
      });
      if (opts["json"]) {
        console.log(JSON.stringify(person, null, 2));
      } else {
        console.log(chalk.green("✓ Person added"));
        console.log(`  ID:    ${chalk.cyan(person.id)}`);
        console.log(`  Name:  ${person.name}`);
        if (person.email) console.log(`  Email: ${person.email}`);
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
  .option("--json", "Output as JSON")
  .action((opts: Record<string, unknown>) => {
    try {
      const people = listPeople({ query: opts["query"] as string | undefined });
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
        console.log(`${chalk.cyan(person.id)}  ${person.name}${person.email ? `  <${person.email}>` : ""}`);
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
      }
    } catch (err) {
      console.error(chalk.red("Error:"), err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ── certificate ──────────────────────────────────────────────────────────────

const certificateCmd = program.command("certificate").description("Completion certificate commands");

certificateCmd
  .command("get <session-id>")
  .description("Get the completion certificate for a session")
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
  .description("Create/send a provider envelope, currently PandaDoc-compatible")
  .option("--provider <name>", "Provider name", "pandadoc")
  .option("--api-key <key>", "Provider API key; defaults to config pandadoc_api_key")
  .requiredOption("--recipient <email>", "Recipient email")
  .option("--recipient-name <name>", "Recipient name")
  .option("--document-url <url>", "Public document URL instead of local file upload")
  .option("--subject <subject>", "Provider email subject")
  .option("--message <message>", "Provider email message")
  .option("--silent", "Ask provider not to send recipient notifications")
  .option("--dry-run", "Prepare request without sending")
  .option("--json", "Output as JSON")
  .action(async (idOrSlug: string, opts: Record<string, unknown>) => {
    try {
      const doc = getDocumentByIdOrSlug(idOrSlug);
      const recipientEmail = opts["recipient"] as string;
      const result = await sendWithProvider({
        provider: opts["provider"] as string,
        apiKey: (opts["apiKey"] as string | undefined) ?? getSetting("pandadoc_api_key") ?? undefined,
        documentName: doc.name,
        documentPath: opts["documentUrl"] ? undefined : doc.file_path,
        documentUrl: opts["documentUrl"] as string | undefined,
        recipients: [{
          email: recipientEmail,
          name: (opts["recipientName"] as string | undefined) ?? recipientEmail,
          role: "Signer",
        }],
        subject: opts["subject"] as string | undefined,
        message: opts["message"] as string | undefined,
        silent: !!opts["silent"],
        dryRun: !!opts["dryRun"],
      });
      if (opts["json"]) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.status === "failed" ? chalk.red("Provider send failed") : chalk.green(`✓ Provider status: ${result.status}`));
        if (result.remote_document_id) console.log(`  Remote ID: ${chalk.cyan(result.remote_document_id)}`);
        if (result.error) console.log(`  Error: ${result.error}`);
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
