#!/usr/bin/env bun
import { program } from "commander";
import chalk from "chalk";
import {
  createContact,
  getContact,
  updateContact,
  deleteContact,
  listContacts,
  searchContacts,
  listRecentContacts,
} from "../db/contacts.js";
import {
  createCompany,
  getCompany,
  listCompanies,
} from "../db/companies.js";
import {
  createCompanyRelationship,
  listCompanyRelationships,
} from "../db/relationships.js";
import type {
  CompanyRelationshipType,
  ContactTask,
  ApplicationType,
  ApplicationStatus,
} from "../types/index.js";
import {
  logVendorCommunication,
  listVendorCommunications,
  listMissingInvoices,
  listPendingFollowUps,
  markFollowUpDone,
} from "../db/vendor-comms.js";
import {
  createContactTask,
  listContactTasks,
  updateContactTask,
  listOverdueTasks,
} from "../db/contact-tasks.js";
import {
  createApplication,
  listApplications,
  listFollowUpDue as getFollowUpDueApplications,
} from "../db/applications.js";
import { listOrgMembersForContact } from "../db/org-members.js";
import {
  createTag,
  listTags,
} from "../db/tags.js";
import {
  createGroup,
  getGroup,
  listGroups,
  addContactToGroup,
  removeContactFromGroup,
  listContactsInGroup,
} from "../db/groups.js";
import { getDatabase, getDbPath } from "../db/database.js";
import { importContacts } from "../lib/import.js";
import { exportContacts } from "../lib/export.js";
import { findEmailDuplicates, findNameDuplicates } from "../lib/dedup.js";
import { readConfig } from "../lib/config.js";
import type {
  CreateContactInput,
  ContactWithDetails,
  Group,
} from "../types/index.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync, mkdirSync, readdirSync } from "fs";
import { extname, join } from "path";

// ─── Table rendering ─────────────────────────────────────────────────────────

interface TableRow {
  [key: string]: string | undefined;
}

function renderTable(headers: string[], rows: TableRow[]): void {
  const colWidths: number[] = headers.map((h) => h.length);

  for (const row of rows) {
    headers.forEach((h, i) => {
      const val = String(row[h] ?? "");
      if (val.length > (colWidths[i] ?? 0)) colWidths[i] = val.length;
    });
  }

  const cappedWidths = colWidths.map((w) => Math.min(w, 40));

  const topBorder = "┌" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const midBorder = "┼" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┼";
  const bottomBorder = "└" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";

  console.log(chalk.gray(topBorder));
  console.log(
    "│" + headers.map((h, i) => " " + chalk.bold.cyan(h.padEnd(cappedWidths[i] ?? 0)) + " │").join("")
  );
  console.log(chalk.gray(midBorder));

  for (const row of rows) {
    console.log(
      "│" +
        headers
          .map((h, i) => {
            let val = String(row[h] ?? "");
            const width = cappedWidths[i] ?? 0;
            if (val.length > width) val = val.slice(0, width - 1) + "…";
            return " " + val.padEnd(width) + " │";
          })
          .join("")
    );
  }

  console.log(chalk.gray(bottomBorder));
}

// ─── Contact detail formatter ─────────────────────────────────────────────────

function formatContact(c: ContactWithDetails): void {
  console.log("\n" + chalk.bold.blue("━━━ Contact: ") + chalk.bold(c.display_name) + chalk.bold.blue(" ━━━"));
  console.log();

  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  if (name) console.log(chalk.gray("  Name:     ") + name);
  if (c.nickname) console.log(chalk.gray("  Nickname: ") + c.nickname);
  if (c.job_title) console.log(chalk.gray("  Title:    ") + c.job_title);
  if (c.company) console.log(chalk.gray("  Company:  ") + chalk.cyan(c.company.name));
  if (c.birthday) console.log(chalk.gray("  Birthday: ") + c.birthday);

  if (c.emails?.length) {
    console.log();
    console.log(chalk.yellow("  Emails:"));
    for (const e of c.emails) {
      const star = e.is_primary ? chalk.green(" ★") : "";
      console.log(`    ${chalk.gray(e.type.padEnd(10))} ${e.address}${star}`);
    }
  }

  if (c.phones?.length) {
    console.log();
    console.log(chalk.yellow("  Phones:"));
    for (const p of c.phones) {
      const star = p.is_primary ? chalk.green(" ★") : "";
      console.log(`    ${chalk.gray(p.type.padEnd(10))} ${p.number}${star}`);
    }
  }

  if (c.addresses?.length) {
    console.log();
    console.log(chalk.yellow("  Addresses:"));
    for (const a of c.addresses) {
      const parts = [a.street, a.city, a.state, a.country].filter(Boolean);
      console.log(`    ${chalk.gray(a.type.padEnd(10))} ${parts.join(", ")}`);
    }
  }

  if (c.social_profiles?.length) {
    console.log();
    console.log(chalk.yellow("  Social:"));
    for (const s of c.social_profiles) {
      console.log(`    ${chalk.gray(s.platform.padEnd(12))} ${s.handle ?? s.url ?? ""}`);
    }
  }

  if (c.tags?.length) {
    console.log();
    console.log(chalk.yellow("  Tags:     ") + c.tags.map((t) => chalk.magenta(`#${t.name}`)).join("  "));
  }

  if (c.notes) {
    console.log();
    console.log(chalk.yellow("  Notes:"));
    for (const line of c.notes.split("\n")) {
      console.log("    " + chalk.gray(line));
    }
  }

  console.log();
  console.log(chalk.gray(`  ID: ${c.id}  •  Created: ${c.created_at.slice(0, 10)}`));
  console.log();
}

// ─── Simple prompt via readline ───────────────────────────────────────────────

async function prompt(question: string): Promise<string> {
  process.stdout.write(chalk.cyan("? ") + question + " ");
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (data: Buffer) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(question + " [y/N]");
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

// ─── Program setup ─────────────────────────────────────────────────────────────

program
  .name("contacts")
  .description("Open Contacts — contact management for AI coding agents")
  .version("0.2.2");

// ─── contacts add ─────────────────────────────────────────────────────────────

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

program
  .command("add")
  .description("Add a new contact (interactive or via flags)")
  .option("--first <name>", "First name")
  .option("--last <name>", "Last name")
  .option("--display <name>", "Display name")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--title <title>", "Job title")
  .option("--company <id>", "Company ID")
  .option("--tag <tag>", "Tag name (can specify multiple times)", collect, [] as string[])
  .option("--note <text>", "Notes")
  .option("--website <url>", "Website URL")
  .action(async (opts: {
    first?: string;
    last?: string;
    display?: string;
    email?: string;
    phone?: string;
    title?: string;
    company?: string;
    tag: string[];
    note?: string;
    website?: string;
  }) => {
    // Non-interactive path: if --first/--last or --display provided, skip prompts
    if (opts.first || opts.last || opts.display) {
      const firstName = opts.first ?? "";
      const lastName = opts.last ?? "";
      const displayName = opts.display ?? (`${firstName} ${lastName}`.trim() || "Unnamed Contact");

      const input: CreateContactInput = {
        display_name: displayName,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        job_title: opts.title || undefined,
        notes: opts.note || undefined,
        website: opts.website || undefined,
        company_id: opts.company || undefined,
        emails: opts.email ? [{ address: opts.email, type: "work", is_primary: true }] : undefined,
        phones: opts.phone ? [{ number: opts.phone, type: "mobile", is_primary: true }] : undefined,
      };

      const contact = createContact(input);

      // Apply tags by name if provided
      if (opts.tag.length > 0) {
        const db = getDatabase();
        const allTags = listTags();
        for (const tagName of opts.tag) {
          const tag = allTags.find(t => t.name === tagName);
          if (tag) {
            db.run(`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`, [contact.id, tag.id]);
          } else {
            console.log(chalk.yellow(`  ! Tag not found: ${tagName} (skipped)`));
          }
        }
      }

      console.log(chalk.green(`\n✓ Contact created: ${contact.display_name} (${contact.id})\n`));
      return;
    }

    // Interactive path
    console.log(chalk.bold.blue("\nAdd New Contact\n"));

    const display_name = await prompt("Display name (required):");
    if (!display_name) {
      console.error(chalk.red("Display name is required."));
      process.exit(1);
    }

    const first_name = await prompt("First name:");
    const last_name = await prompt("Last name:");
    const job_title = await prompt("Job title:");
    const emailStr = await prompt("Email (e.g. alice@example.com):");
    const phoneStr = await prompt("Phone (e.g. +15551234):");
    const notes = await prompt("Notes:");

    const input: CreateContactInput = {
      display_name,
      first_name: first_name || undefined,
      last_name: last_name || undefined,
      job_title: job_title || undefined,
      notes: notes || undefined,
      emails: emailStr ? [{ address: emailStr, type: "work", is_primary: true }] : undefined,
      phones: phoneStr ? [{ number: phoneStr, type: "mobile", is_primary: true }] : undefined,
    };

    const contact = createContact(input);
    console.log(chalk.green(`\n✓ Contact created: ${contact.display_name} (${contact.id})\n`));
  });

// ─── contacts list ─────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List contacts")
  .option("--tag <tag_id>", "Filter by tag ID")
  .option("--company <id>", "Filter by company ID")
  .option("--limit <n>", "Max results", "50")
  .action(async (opts: { tag?: string; company?: string; limit: string }) => {
    const result = listContacts({
      tag_id: opts.tag,
      company_id: opts.company,
      limit: parseInt(opts.limit, 10),
    });

    if (result.contacts.length === 0) {
      console.log(chalk.gray("\nNo contacts found.\n"));
      return;
    }

    console.log();
    const rows = result.contacts.map((c) => ({
      Name: c.display_name,
      Company: c.company?.name ?? "",
      Email: c.emails?.[0]?.address ?? "",
      Phone: c.phones?.[0]?.number ?? "",
      Tags: c.tags?.map((t) => `#${t.name}`).join(" ") ?? "",
    }));

    renderTable(["Name", "Company", "Email", "Phone", "Tags"], rows);
    console.log(chalk.gray(`\n${result.total} contact(s) total, showing ${result.contacts.length}\n`));
  });

// ─── contacts show ─────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show full contact details")
  .action((id: string) => {
    const contact = getContact(id);
    formatContact(contact);
  });

// ─── contacts edit ─────────────────────────────────────────────────────────────

program
  .command("edit <id>")
  .description("Edit a contact (interactive or via flags)")
  .option("--first <name>", "First name")
  .option("--last <name>", "Last name")
  .option("--display <name>", "Display name")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--title <title>", "Job title")
  .option("--note <text>", "Notes")
  .option("--website <url>", "Website URL")
  .action(async (id: string, opts: {
    first?: string;
    last?: string;
    display?: string;
    email?: string;
    phone?: string;
    title?: string;
    note?: string;
    website?: string;
  }) => {
    const contact = getContact(id);

    // Non-interactive path: flags provided
    const hasFlags = opts.first || opts.last || opts.display || opts.email ||
      opts.phone || opts.title || opts.note || opts.website;

    if (hasFlags) {
      const updates: Record<string, string> = {};
      if (opts.first !== undefined) updates.first_name = opts.first;
      if (opts.last !== undefined) updates.last_name = opts.last;
      if (opts.display !== undefined) updates.display_name = opts.display;
      if (opts.title !== undefined) updates.job_title = opts.title;
      if (opts.note !== undefined) updates.notes = opts.note;
      if (opts.website !== undefined) updates.website = opts.website;

      const updated = updateContact(id, updates);

      // Add new email/phone if provided
      if (opts.email) {
        const db = getDatabase();
        const { uuid } = await import("../db/database.js");
        db.run(`INSERT INTO emails (id, contact_id, company_id, address, type, is_primary) VALUES (?, ?, NULL, ?, 'work', 0)`, [uuid(), id, opts.email]);
      }
      if (opts.phone) {
        const db = getDatabase();
        const { uuid } = await import("../db/database.js");
        db.run(`INSERT INTO phones (id, contact_id, company_id, number, country_code, type, is_primary) VALUES (?, ?, NULL, ?, NULL, 'mobile', 0)`, [uuid(), id, opts.phone]);
      }

      console.log(chalk.green(`\n✓ Contact updated: ${updated.display_name}\n`));
      formatContact(getContact(id));
      return;
    }

    // Interactive path
    console.log(chalk.bold.blue(`\nEditing: ${contact.display_name}\n`));
    console.log(chalk.gray("Press Enter to keep the current value.\n"));

    const display_name = await prompt(`Display name [${contact.display_name}]:`);
    const first_name = await prompt(`First name [${contact.first_name}]:`);
    const last_name = await prompt(`Last name [${contact.last_name}]:`);
    const job_title = await prompt(`Job title [${contact.job_title ?? ""}]:`);
    const website = await prompt(`Website [${contact.website ?? ""}]:`);
    const notes = await prompt(`Notes [${contact.notes ? contact.notes.slice(0, 30) + "..." : ""}]:`);

    const updates: Record<string, string> = {};
    if (display_name) updates.display_name = display_name;
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (job_title) updates.job_title = job_title;
    if (website) updates.website = website;
    if (notes) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      console.log(chalk.gray("\nNo changes made.\n"));
      return;
    }

    const updated = updateContact(id, updates);
    console.log(chalk.green(`\n✓ Contact updated: ${updated.display_name}\n`));
  });

// ─── contacts delete ──────────────────────────────────────────────────────────

program
  .command("delete <id>")
  .description("Delete a contact")
  .option("-f, --force", "Skip confirmation")
  .action(async (id: string, opts: { force?: boolean }) => {
    const contact = getContact(id);

    if (!opts.force) {
      const ok = await confirm(`Delete ${chalk.bold(contact.display_name)}?`);
      if (!ok) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    deleteContact(id);
    console.log(chalk.green(`\n✓ Contact deleted: ${contact.display_name}\n`));
  });

// ─── contacts search ──────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search contacts")
  .action((query: string) => {
    const contacts = searchContacts(query);

    if (contacts.length === 0) {
      console.log(chalk.gray(`\nNo contacts found for: "${query}"\n`));
      return;
    }

    console.log();
    const rows = contacts.map((c) => ({
      Name: c.display_name,
      Company: c.company?.name ?? "",
      Email: c.emails?.[0]?.address ?? "",
      Phone: c.phones?.[0]?.number ?? "",
      Tags: c.tags?.map((t) => `#${t.name}`).join(" ") ?? "",
    }));

    renderTable(["Name", "Company", "Email", "Phone", "Tags"], rows);
    console.log(chalk.gray(`\n${contacts.length} result(s) for "${query}"\n`));
  });

// ─── contacts companies ───────────────────────────────────────────────────────

const companiesCmd = program
  .command("companies")
  .description("Manage companies")
  .action(() => {
    const result = listCompanies({ limit: 50 });
    if (result.companies.length === 0) {
      console.log(chalk.gray("\nNo companies found.\n"));
      return;
    }
    console.log();
    const rows = result.companies.map((c) => ({
      Name: c.name,
      Domain: c.domain ?? "",
      Industry: c.industry ?? "",
      Size: c.size ?? "",
      Employees: String(c.employee_count),
    }));
    renderTable(["Name", "Domain", "Industry", "Size", "Employees"], rows);
    console.log(chalk.gray(`\n${result.total} company/companies\n`));
  });

companiesCmd
  .command("add")
  .description("Add a new company")
  .action(async () => {
    console.log(chalk.bold.blue("\nAdd New Company\n"));

    const name = await prompt("Company name (required):");
    if (!name) {
      console.error(chalk.red("Company name is required."));
      process.exit(1);
    }

    const domain = await prompt("Domain (e.g. acme.com):");
    const industry = await prompt("Industry:");
    const size = await prompt("Size (e.g. 1-10, 11-50):");
    const description = await prompt("Description:");

    const company = createCompany({
      name,
      domain: domain || undefined,
      industry: industry || undefined,
      size: size || undefined,
      description: description || undefined,
    });

    console.log(chalk.green(`\n✓ Company created: ${company.name} (${company.id})\n`));
  });

companiesCmd
  .command("show <id>")
  .description("Show company details")
  .action((id: string) => {
    const company = getCompany(id);
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${id}\n`));
      process.exit(1);
    }

    console.log("\n" + chalk.bold.blue("━━━ Company: ") + chalk.bold(company.name) + chalk.bold.blue(" ━━━"));
    console.log();
    if (company.domain) console.log(chalk.gray("  Domain:    ") + company.domain);
    if (company.industry) console.log(chalk.gray("  Industry:  ") + company.industry);
    if (company.size) console.log(chalk.gray("  Size:      ") + company.size);
    if (company.description) console.log(chalk.gray("  About:     ") + company.description);
    if (company.founded_year) console.log(chalk.gray("  Founded:   ") + company.founded_year);
    console.log(chalk.gray(`  Employees: ${company.employee_count}`));
    console.log(chalk.gray(`\n  ID: ${company.id}\n`));
  });

// ─── contacts tags ────────────────────────────────────────────────────────────

const tagsCmd = program
  .command("tags")
  .description("Manage tags")
  .action(() => {
    const tags = listTags();
    if (tags.length === 0) {
      console.log(chalk.gray("\nNo tags found.\n"));
      return;
    }
    console.log();
    for (const t of tags) {
      const swatch = t.color ? chalk.hex(t.color)("■") + " " : "  ";
      console.log(`  ${swatch}${chalk.magenta("#" + t.name)}  ${chalk.gray(t.description ?? "")}`);
    }
    console.log();
  });

tagsCmd
  .command("add")
  .description("Create a new tag")
  .action(async () => {
    console.log(chalk.bold.blue("\nAdd New Tag\n"));

    const name = await prompt("Tag name (required):");
    if (!name) {
      console.error(chalk.red("Tag name is required."));
      process.exit(1);
    }

    const color = await prompt("Color (hex, e.g. #FF5733 — optional):");
    const description = await prompt("Description (optional):");

    const tag = createTag({
      name,
      color: color || undefined,
      description: description || undefined,
    });

    console.log(chalk.green(`\n✓ Tag created: #${tag.name} (${tag.id})\n`));
  });

// ─── contacts import ──────────────────────────────────────────────────────────

program
  .command("import <file>")
  .description("Import contacts from CSV, vCard (.vcf), or JSON file")
  .action(async (file: string) => {
    if (!existsSync(file)) {
      console.error(chalk.red(`\nFile not found: ${file}\n`));
      process.exit(1);
    }

    const ext = extname(file).toLowerCase();
    const formatMap: Record<string, "csv" | "vcf" | "json"> = {
      ".csv": "csv",
      ".vcf": "vcf",
      ".vcard": "vcf",
      ".json": "json",
    };
    const format = formatMap[ext];
    if (!format) {
      console.error(chalk.red(`\nUnsupported file type: ${ext}. Use .csv, .vcf, or .json\n`));
      process.exit(1);
    }

    const data = readFileSync(file, "utf8");
    console.log(chalk.blue(`\nImporting ${format.toUpperCase()} from ${file}...\n`));

    const inputs = await importContacts(format, data);
    let created = 0;
    let errors = 0;

    for (const input of inputs) {
      try {
        createContact(input);
        created++;
      } catch (err) {
        errors++;
        console.log(
          chalk.red(`  ✗ ${input.display_name ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`)
        );
      }
    }

    console.log(
      chalk.green(`\n✓ Imported ${created} contact(s)`) +
        (errors > 0 ? chalk.red(`, ${errors} error(s)`) : "") +
        "\n"
    );
  });

// ─── contacts export ──────────────────────────────────────────────────────────

program
  .command("export")
  .description("Export contacts")
  .option("--format <fmt>", "Export format: csv, vcf, json", "json")
  .option("--output <file>", "Output file (default: stdout)")
  .action(async (opts: { format: string; output?: string }) => {
    const format = opts.format as "csv" | "vcf" | "json";
    if (!["csv", "vcf", "json"].includes(format)) {
      console.error(chalk.red(`\nInvalid format: ${format}. Use csv, vcf, or json\n`));
      process.exit(1);
    }

    const { contacts } = listContacts({ limit: 100000 });
    const output = await exportContacts(format, contacts);

    if (opts.output) {
      writeFileSync(opts.output, output, "utf8");
      console.log(chalk.green(`\n✓ Exported ${contacts.length} contact(s) to ${opts.output}\n`));
    } else {
      process.stdout.write(output);
    }
  });

// ─── contacts serve ───────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the HTTP server")
  .option("--port <n>", "Port to listen on", "19428")
  .action(async (opts: { port: string }) => {
    const { startServer } = await import("../server/serve.js");
    const port = parseInt(opts.port, 10);
    console.log(chalk.blue(`\nStarting contacts server on port ${port}...\n`));
    startServer(port);
  });

// ─── contacts mcp ─────────────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Print MCP server setup instructions")
  .action(() => {
    const config = JSON.stringify(
      { contacts: { command: "contacts-mcp", args: [], env: {} } },
      null,
      4
    );

    console.log(`
${chalk.bold.blue("━━━ Contacts MCP Server Setup ━━━")}

${chalk.bold("1. Install the package:")}
   ${chalk.cyan("npm install -g @hasna/contacts")}
   ${chalk.gray("or:")} ${chalk.cyan("bun add -g @hasna/contacts")}

${chalk.bold("2. Add to Claude Code (recommended):")}
   ${chalk.cyan("claude mcp add --transport stdio --scope user contacts -- contacts-mcp")}

${chalk.bold("3. Or add manually to ~/.claude.json:")}
   ${chalk.yellow(config)}

${chalk.bold("4. Restart Claude Code and verify with")} ${chalk.cyan("/mcp")}

${chalk.bold("Available tools (24 total):")}
  ${chalk.gray("Contacts: ")}${chalk.white("create_contact  get_contact  update_contact  delete_contact")}
  ${chalk.gray("          ")}${chalk.white("list_contacts   search_contacts  merge_contacts")}
  ${chalk.gray("Companies:")}${chalk.white("create_company  get_company  update_company  delete_company")}
  ${chalk.gray("          ")}${chalk.white("list_companies  search_companies")}
  ${chalk.gray("Tags:     ")}${chalk.white("create_tag  list_tags  delete_tag")}
  ${chalk.gray("          ")}${chalk.white("add_tag_to_contact  remove_tag_from_contact")}
  ${chalk.gray("Rels:     ")}${chalk.white("add_relationship  list_relationships  delete_relationship")}
  ${chalk.gray("I/O:      ")}${chalk.white("import_contacts  export_contacts  get_stats")}
`);
  });

// ─── contacts open ────────────────────────────────────────────────────────────

program
  .command("open [id]")
  .description("Open the web dashboard in browser")
  .action(async (id?: string) => {
    const port = 19428;
    const url = id ? `http://localhost:${port}/#/contacts/${id}` : `http://localhost:${port}`;
    const platform = process.platform;
    const opener = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    const proc = Bun.spawn([opener, url], { stdio: ["ignore", "ignore", "ignore"] });
    await proc.exited;
    console.log(chalk.green(`Opening ${url}`));
  });

// ─── contacts recent ──────────────────────────────────────────────────────────

program
  .command("recent")
  .description("Show recently added or modified contacts")
  .option("--limit <n>", "Number to show", "10")
  .action((opts: { limit: string }) => {
    const limit = parseInt(opts.limit, 10);
    const contacts = listRecentContacts(limit);

    if (contacts.length === 0) {
      console.log(chalk.gray("\nNo contacts found.\n"));
      return;
    }

    console.log();
    const rows = contacts.map((c) => ({
      Name: c.display_name,
      Company: c.company?.name ?? "",
      Email: c.emails?.[0]?.address ?? "",
      Phone: c.phones?.[0]?.number ?? "",
      Updated: c.updated_at.slice(0, 10),
    }));

    renderTable(["Name", "Company", "Email", "Phone", "Updated"], rows);
    console.log(chalk.gray(`\n${contacts.length} recent contact(s)\n`));
  });

// ─── contacts dupe ────────────────────────────────────────────────────────────

program
  .command("dupe")
  .description("Find potential duplicate contacts")
  .action(() => {
    const db = getDatabase();

    const emailDupes = findEmailDuplicates(db);
    const nameDupes = findNameDuplicates(db);

    let total = 0;

    if (emailDupes.length > 0) {
      console.log(chalk.bold.yellow("\nDuplicate Emails:\n"));
      for (const group of emailDupes) {
        console.log(`  ${chalk.cyan(group.email)}`);
        for (const cid of group.contact_ids) {
          try {
            const c = getContact(cid);
            console.log(`    ${chalk.gray(cid)}  ${c.display_name}`);
          } catch {
            console.log(`    ${chalk.gray(cid)}  (not found)`);
          }
        }
        console.log();
        total++;
      }
    }

    if (nameDupes.length > 0) {
      console.log(chalk.bold.yellow("Similar Names:\n"));
      for (const pair of nameDupes) {
        try {
          const a = getContact(pair.contact_ids[0]);
          const b = getContact(pair.contact_ids[1]);
          console.log(`  ${chalk.magenta(a.display_name)}  ↔  ${chalk.magenta(b.display_name)}  ${chalk.gray(`(distance: ${pair.similarity})`)}`);
          console.log(`    ${chalk.gray(pair.contact_ids[0])}  vs  ${chalk.gray(pair.contact_ids[1])}`);
          console.log();
          total++;
        } catch {
          // skip if either contact not found
        }
      }
    }

    if (total === 0) {
      console.log(chalk.green("\nNo duplicates found.\n"));
    } else {
      console.log(chalk.gray(`Found ${total} duplicate group(s). Use 'contacts show <id>' to inspect and 'contacts delete <id>' to clean up.\n`));
    }
  });

// ─── contacts log ─────────────────────────────────────────────────────────────

program
  .command("log <id>")
  .description("Log a contact interaction (sets last_contacted_at)")
  .option("--note <text>", "Note to append")
  .option("--date <YYYY-MM-DD>", "Date of contact (default: today)")
  .action((id: string, opts: { note?: string; date?: string }) => {
    const contact = getContact(id);
    const date = opts.date ?? new Date().toISOString().slice(0, 10);

    const updates: Record<string, string> = {
      last_contacted_at: date,
    };

    if (opts.note) {
      const existing = contact.notes ?? "";
      const separator = existing ? "\n" : "";
      updates.notes = `${existing}${separator}[${date}] ${opts.note}`;
    }

    const updated = updateContact(id, updates);
    console.log(chalk.green(`\n✓ Logged contact with ${updated.display_name} on ${date}\n`));
    if (opts.note) {
      console.log(chalk.gray(`  Note: ${opts.note}\n`));
    }
  });

// ─── contacts groups ──────────────────────────────────────────────────────────

const groupsCmd = program
  .command("groups")
  .description("Manage contact groups")
  .action(() => {
    const db = getDatabase();
    const groups = listGroups(db);
    if (groups.length === 0) {
      console.log(chalk.gray("\nNo groups found.\n"));
      return;
    }
    console.log();
    const rows = groups.map((g: Group) => ({
      ID: g.id,
      Name: g.name,
      Description: g.description ?? "",
      Members: String(g.member_count ?? 0),
    }));
    renderTable(["ID", "Name", "Description", "Members"], rows);
    console.log(chalk.gray(`\n${groups.length} group(s)\n`));
  });

groupsCmd
  .command("add")
  .description("Create a new group")
  .option("--name <name>", "Group name (required)")
  .option("--description <desc>", "Description")
  .action(async (opts: { name?: string; description?: string }) => {
    const db = getDatabase();
    let name = opts.name;
    if (!name) {
      name = await prompt("Group name (required):");
      if (!name) {
        console.error(chalk.red("Group name is required."));
        process.exit(1);
      }
    }
    const group = createGroup(db, { name, description: opts.description });
    console.log(chalk.green(`\n✓ Group created: ${group.name} (${group.id})\n`));
  });

groupsCmd
  .command("show <id>")
  .description("Show group details with members")
  .action((id: string) => {
    const db = getDatabase();
    const group = getGroup(db, id);
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${id}\n`));
      process.exit(1);
    }
    console.log("\n" + chalk.bold.blue("━━━ Group: ") + chalk.bold(group.name) + chalk.bold.blue(" ━━━"));
    if (group.description) console.log(chalk.gray("  Description: ") + group.description);
    console.log(chalk.gray(`  ID: ${group.id}`));
    console.log();

    const memberIds = listContactsInGroup(db, id);
    if (memberIds.length === 0) {
      console.log(chalk.gray("  No members.\n"));
      return;
    }

    console.log(chalk.yellow(`  Members (${memberIds.length}):\n`));
    for (const cid of memberIds) {
      try {
        const c = getContact(cid);
        console.log(`    ${chalk.bold(c.display_name)}  ${chalk.gray(cid)}`);
      } catch {
        console.log(`    ${chalk.gray(cid)}  (not found)`);
      }
    }
    console.log();
  });

groupsCmd
  .command("add-member <group-id> <contact-id>")
  .description("Add a contact to a group")
  .action((groupId: string, contactId: string) => {
    const db = getDatabase();
    const group = getGroup(db, groupId);
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${groupId}\n`));
      process.exit(1);
    }
    const contact = getContact(contactId);
    addContactToGroup(db, contactId, groupId);
    console.log(chalk.green(`\n✓ Added ${contact.display_name} to group ${group.name}\n`));
  });

groupsCmd
  .command("remove-member <group-id> <contact-id>")
  .description("Remove a contact from a group")
  .action((groupId: string, contactId: string) => {
    const db = getDatabase();
    const group = getGroup(db, groupId);
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${groupId}\n`));
      process.exit(1);
    }
    const contact = getContact(contactId);
    removeContactFromGroup(db, contactId, groupId);
    console.log(chalk.green(`\n✓ Removed ${contact.display_name} from group ${group.name}\n`));
  });

// ─── contacts init ────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Show setup info, stats, and configuration")
  .action(() => {
    const dbPath = getDbPath();
    const config = readConfig();

    console.log(chalk.bold.blue("\n━━━ Open Contacts Setup ━━━\n"));
    console.log(chalk.gray("  DB path:    ") + (config.db_path ?? dbPath));
    console.log();

    try {
      const db = getDatabase();
      const contactCount = (db.query("SELECT COUNT(*) as n FROM contacts").get() as { n: number }).n;
      const companyCount = (db.query("SELECT COUNT(*) as n FROM companies").get() as { n: number }).n;
      const tagCount = (db.query("SELECT COUNT(*) as n FROM tags").get() as { n: number }).n;

      console.log(chalk.bold("  Stats:"));
      console.log(`    ${chalk.cyan(String(contactCount))} contacts`);
      console.log(`    ${chalk.cyan(String(companyCount))} companies`);
      console.log(`    ${chalk.cyan(String(tagCount))} tags`);
    } catch {
      console.log(chalk.gray("  (Database not yet initialized)"));
    }

    console.log();
    console.log(chalk.bold("  MCP Setup (Claude Code):"));
    console.log("    " + chalk.cyan("claude mcp add --transport stdio --scope user contacts -- contacts-mcp"));
    console.log();
    console.log(chalk.bold("  Shell Completion (zsh):"));
    console.log("    " + chalk.cyan("contacts completion zsh > ~/.zsh/completions/_contacts"));
    console.log("    " + chalk.cyan("contacts completion bash >> ~/.bashrc"));
    console.log("    " + chalk.cyan("contacts completion fish > ~/.config/fish/completions/contacts.fish"));
    console.log();
  });

// ─── contacts backup ──────────────────────────────────────────────────────────

program
  .command("backup")
  .description("Backup the contacts database")
  .option("--output <path>", "Output path")
  .option("--list", "List existing backups")
  .action((opts: { output?: string; list?: boolean }) => {
    const backupDir = join(process.env["HOME"] || "~", ".contacts", "backups");

    if (opts.list) {
      if (!existsSync(backupDir)) {
        console.log(chalk.gray("\nNo backups found.\n"));
        return;
      }
      const files = readdirSync(backupDir)
        .filter((f) => f.endsWith(".db"))
        .sort()
        .reverse();
      if (files.length === 0) {
        console.log(chalk.gray("\nNo backups found.\n"));
        return;
      }
      console.log(chalk.bold.blue("\nExisting Backups:\n"));
      for (const f of files) {
        const filePath = join(backupDir, f);
        const size = statSync(filePath).size;
        const mtime = statSync(filePath).mtime.toISOString().slice(0, 19).replace("T", " ");
        console.log(`  ${chalk.cyan(f)}  ${chalk.gray(`${(size / 1024).toFixed(1)} KB  ${mtime}`)}`);
      }
      console.log();
      return;
    }

    const src = getDbPath();
    if (!existsSync(src)) {
      console.error(chalk.red(`\nDatabase not found: ${src}\n`));
      process.exit(1);
    }

    mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = opts.output || join(backupDir, `contacts-${ts}.db`);
    copyFileSync(src, dest);
    const size = statSync(dest).size;
    console.log(chalk.green(`\n✓ Backed up to ${dest} (${(size / 1024).toFixed(1)} KB)\n`));
  });

// ─── contacts completion ──────────────────────────────────────────────────────

program
  .command("completion <shell>")
  .description("Generate shell completion script (bash, zsh, fish)")
  .action((shell: string) => {
    const commands = [
      "add", "list", "show", "edit", "delete", "search", "recent", "dupe",
      "log", "open", "import", "export", "companies", "tags", "groups",
      "serve", "mcp", "init", "backup", "completion",
    ];
    if (shell === "zsh") {
      console.log(`#compdef contacts\n_contacts() {\n  local commands=(${commands.map(c => `'${c}'`).join(" ")})\n  _describe 'command' commands\n}\n_contacts "$@"`);
    } else if (shell === "bash") {
      console.log(`_contacts_completion() {\n  local cur=\${COMP_WORDS[COMP_CWORD]}\n  COMPREPLY=($(compgen -W "${commands.join(" ")}" -- "$cur"))\n}\ncomplete -F _contacts_completion contacts`);
    } else if (shell === "fish") {
      for (const c of commands) {
        console.log(`complete -c contacts -f -a ${c}`);
      }
    } else {
      console.error(chalk.red("Supported shells: bash, zsh, fish"));
    }
  });

// ─── contacts entities ────────────────────────────────────────────────────────

const entities = program.command('entities').description('Manage your owned legal entities');

entities
  .command('list')
  .description('List all owned legal entities')
  .action(() => {
    const db = getDatabase();
    const result = listCompanies({ limit: 200 }, db);
    const owned = result.companies.filter((c: { is_owned_entity: boolean }) => c.is_owned_entity);
    if (!owned.length) {
      console.log(chalk.yellow('No owned entities found. Add one with: contacts companies add'));
      return;
    }
    console.log();
    renderTable(
      ['Name', 'Type', 'Industry', 'Description'],
      owned.map((e: { name: string; entity_type?: string | null; industry?: string | null; description?: string | null }) => ({
        Name: e.name,
        Type: e.entity_type || 'operating',
        Industry: e.industry || '',
        Description: e.description || '',
      }))
    );
    console.log(chalk.gray(`\n${owned.length} owned entity/entities\n`));
  });

entities
  .command('show <id>')
  .description('Show entity with full team')
  .action((id: string) => {
    const db = getDatabase();
    const company = getCompany(id);
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${id}\n`));
      process.exit(1);
    }
    console.log('\n' + chalk.bold.blue('━━━ Entity: ') + chalk.bold(company.name) + chalk.bold.blue(' ━━━'));
    console.log();
    if (company.industry) console.log(chalk.gray('  Industry:    ') + company.industry);
    if (company.description) console.log(chalk.gray('  Description: ') + company.description);
    console.log(chalk.gray(`  ID: ${company.id}`));
    console.log();

    const team = listCompanyRelationships({ company_id: id }, db);
    if (team.length === 0) {
      console.log(chalk.gray('  No team members assigned.\n'));
      return;
    }
    console.log(chalk.yellow(`  Team (${team.length}):\n`));
    const rows = team.map((r: { contact_id: string; relationship_type: string; is_primary: boolean; status: string }) => {
      let name = r.contact_id;
      try {
        const c = getContact(r.contact_id);
        name = c.display_name;
      } catch {
        // contact not found
      }
      return {
        Contact: name,
        Role: r.relationship_type,
        Primary: r.is_primary ? 'yes' : '',
        Status: r.status,
      };
    });
    renderTable(['Contact', 'Role', 'Primary', 'Status'], rows);
    console.log();
  });

entities
  .command('add-contact <entity-id> <contact-id>')
  .description('Link a contact to an entity with a role')
  .option('--role <role>', 'Role (tax_preparer|bank_manager|attorney|registered_agent|accountant|payroll_provider|insurance_broker|advisor|other)', 'other')
  .option('--primary', 'Mark as primary contact for this role')
  .action((entityId: string, contactId: string, opts: { role?: string; primary?: boolean }) => {
    const db = getDatabase();
    const contact = getContact(contactId);
    const company = getCompany(entityId);
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${entityId}\n`));
      process.exit(1);
    }
    const rel = createCompanyRelationship({
      contact_id: contactId,
      company_id: entityId,
      relationship_type: (opts.role || 'other') as CompanyRelationshipType,
      is_primary: opts.primary || false,
    }, db);
    console.log(chalk.green(`\n✓ Linked ${contact.display_name} to ${company.name} as ${rel.relationship_type}\n`));
  });

entities
  .command('team <id>')
  .description('Show full team matrix for an entity')
  .action((id: string) => {
    const db = getDatabase();
    const company = getCompany(id);
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${id}\n`));
      process.exit(1);
    }
    const team = listCompanyRelationships({ company_id: id }, db);
    if (team.length === 0) {
      console.log(chalk.yellow(`\nNo team members for ${company.name}.\n`));
      return;
    }
    console.log('\n' + chalk.bold(`Team: ${company.name}`) + '\n');
    const rows = team.map((r: { contact_id: string; relationship_type: string; is_primary: boolean; status: string }) => {
      let name = r.contact_id;
      try {
        const c = getContact(r.contact_id);
        name = c.display_name;
      } catch {
        // not found
      }
      return {
        Contact: name,
        Role: r.relationship_type,
        Primary: r.is_primary ? 'yes' : '',
        Status: r.status,
      };
    });
    renderTable(['Contact', 'Role', 'Primary', 'Status'], rows);
    console.log();
  });

// ─── contacts workload ────────────────────────────────────────────────────────

program
  .command('workload <id>')
  .description('Show workload summary for a contact')
  .action((id: string) => {
    const db = getDatabase();
    const contact = getContact(id);
    const companyRels = listCompanyRelationships({ contact_id: id }, db);
    const overdue = listOverdueTasks(db).filter((t: { contact_id: string }) => t.contact_id === id);
    const orgMemberships = listOrgMembersForContact(id, db);

    console.log(chalk.bold(`\n${contact.display_name}`));
    if (contact.job_title) console.log(chalk.gray(`  ${contact.job_title}`));
    console.log();

    if (companyRels.length) {
      console.log(chalk.cyan(`  Manages/linked to ${companyRels.length} company relationship(s):`));
      for (const r of companyRels.slice(0, 5)) {
        console.log(chalk.gray(`    • ${r.relationship_type}${r.notes ? ` — ${r.notes}` : ''}`));
      }
    }

    if (orgMemberships.length) {
      console.log(chalk.cyan(`  Org memberships: ${orgMemberships.length}`));
    }

    if (overdue.length) {
      console.log(chalk.red(`  ⚠ Overdue tasks: ${overdue.length}`));
    } else {
      console.log(chalk.green('  No overdue tasks'));
    }

    if (contact.last_contacted_at) {
      const days = Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000);
      const color = days > 30 ? chalk.red : days > 14 ? chalk.yellow : chalk.green;
      console.log(color(`  Last contact: ${days} day(s) ago`));
    } else {
      console.log(chalk.gray('  Never contacted'));
    }
    console.log();
  });

// ─── contacts vendor ──────────────────────────────────────────────────────────

const vendor = program.command('vendor').description('Track vendor communications and invoices');

vendor
  .command('log <company-id>')
  .description('Log a vendor communication')
  .option('--type <type>', 'Type: email|invoice_request|invoice_received|call|payment|dispute|other', 'email')
  .option('--subject <subject>', 'Subject')
  .option('--body <body>', 'Body/notes')
  .option('--amount <n>', 'Invoice amount')
  .option('--currency <c>', 'Currency', 'USD')
  .option('--ref <ref>', 'Invoice reference')
  .option('--follow-up <date>', 'Follow-up date (YYYY-MM-DD)')
  .option('--status <status>', 'Status: sent|awaiting_response|responded|no_response|resolved', 'sent')
  .option('--contact <id>', 'Contact ID (optional)')
  .option('--direction <dir>', 'Direction: inbound|outbound', 'outbound')
  .action((companyId: string, opts: {
    type?: string;
    subject?: string;
    body?: string;
    amount?: string;
    currency?: string;
    ref?: string;
    followUp?: string;
    status?: string;
    contact?: string;
    direction?: string;
  }) => {
    const db = getDatabase();
    const company = getCompany(companyId);
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${companyId}\n`));
      process.exit(1);
    }
    const comm = logVendorCommunication({
      company_id: companyId,
      contact_id: opts.contact,
      comm_date: new Date().toISOString().slice(0, 10),
      type: (opts.type || 'email') as Parameters<typeof logVendorCommunication>[0]['type'],
      direction: (opts.direction || 'outbound') as Parameters<typeof logVendorCommunication>[0]['direction'],
      subject: opts.subject,
      body: opts.body,
      status: (opts.status || 'sent') as Parameters<typeof logVendorCommunication>[0]['status'],
      invoice_amount: opts.amount ? parseFloat(opts.amount) : undefined,
      invoice_currency: opts.currency,
      invoice_ref: opts.ref,
      follow_up_date: opts.followUp,
    }, db);
    console.log(chalk.green(`\n✓ Logged ${comm.type} communication with ${company.name} (${comm.id})\n`));
  });

vendor
  .command('missing-invoices')
  .description('Show all invoice requests with no response')
  .action(() => {
    const db = getDatabase();
    const missing = listMissingInvoices(db);
    if (!missing.length) {
      console.log(chalk.green('\nNo missing invoices.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${missing.length} missing invoice(s):\n`));
    renderTable(
      ['Company', 'Date', 'Subject', 'Status'],
      missing.map((m: { company_id: string; comm_date: string; subject?: string | null; status: string }) => ({
        Company: m.company_id,
        Date: m.comm_date,
        Subject: m.subject || '',
        Status: m.status,
      }))
    );
    console.log();
  });

vendor
  .command('pending-followups')
  .description('Show vendor follow-ups due today or overdue')
  .action(() => {
    const db = getDatabase();
    const pending = listPendingFollowUps(db);
    if (!pending.length) {
      console.log(chalk.green('\nNo pending follow-ups.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${pending.length} pending follow-up(s):\n`));
    renderTable(
      ['Company', 'Type', 'Follow-up', 'Subject'],
      pending.map((p: { company_id: string; type: string; follow_up_date?: string | null; subject?: string | null }) => ({
        Company: p.company_id,
        Type: p.type,
        'Follow-up': p.follow_up_date || '',
        Subject: p.subject || '',
      }))
    );
    console.log();
  });

vendor
  .command('history <company-id>')
  .description('Show vendor communication history for a company')
  .action((id: string) => {
    const db = getDatabase();
    const company = getCompany(id);
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${id}\n`));
      process.exit(1);
    }
    const comms = listVendorCommunications(id, {}, db);
    if (!comms.length) {
      console.log(chalk.gray(`\nNo communications logged for ${company.name}.\n`));
      return;
    }
    console.log(chalk.bold(`\nCommunications: ${company.name} (${comms.length})\n`));
    renderTable(
      ['Date', 'Type', 'Direction', 'Subject', 'Status'],
      comms.map((c: { comm_date: string; type: string; direction: string; subject?: string | null; status: string }) => ({
        Date: c.comm_date,
        Type: c.type,
        Direction: c.direction,
        Subject: c.subject || '',
        Status: c.status,
      }))
    );
    console.log();
  });

// ─── contacts task ────────────────────────────────────────────────────────────

const taskCmd = program.command('task').description('Contact-assigned tasks with escalation');

taskCmd
  .command('create')
  .description('Create a contact task')
  .option('--contact <id>', 'Contact ID (required)')
  .option('--title <title>', 'Task title (required)')
  .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
  .option('--priority <p>', 'Priority: low|medium|high|critical', 'medium')
  .option('--entity <id>', 'Entity/company this task is for')
  .option('--escalate <rule>', 'Escalation rule: contactId:afterDays (repeatable)', collect, [] as string[])
  .action(async (opts: {
    contact?: string;
    title?: string;
    deadline?: string;
    priority?: string;
    entity?: string;
    escalate: string[];
  }) => {
    const db = getDatabase();
    let contactId = opts.contact;
    let title = opts.title;
    if (!contactId) {
      contactId = await prompt('Contact ID (required):');
      if (!contactId) { console.error(chalk.red('Contact ID is required.')); process.exit(1); }
    }
    if (!title) {
      title = await prompt('Task title (required):');
      if (!title) { console.error(chalk.red('Task title is required.')); process.exit(1); }
    }
    const escalationRules = opts.escalate.map((rule: string) => {
      const [contactIdPart, daysPart] = rule.split(':');
      return {
        escalate_to_contact_id: contactIdPart || '',
        after_days: parseInt(daysPart || '7', 10),
        method: 'email' as const,
      };
    });
    const contact = getContact(contactId);
    const task = createContactTask({
      title,
      contact_id: contactId,
      deadline: opts.deadline,
      priority: (opts.priority || 'medium') as ContactTask['priority'],
      entity_id: opts.entity,
      escalation_rules: escalationRules.length ? escalationRules : undefined,
    }, db);
    console.log(chalk.green(`\n✓ Task created for ${contact.display_name}: ${task.title} (${task.id})\n`));
  });

taskCmd
  .command('list [contact-id]')
  .description('List contact tasks')
  .option('--overdue', 'Show only overdue tasks')
  .option('--status <s>', 'Filter by status')
  .action((contactId: string | undefined, opts: { overdue?: boolean; status?: string }) => {
    const db = getDatabase();
    let tasks;
    if (opts.overdue) {
      tasks = listOverdueTasks(db);
      if (contactId) tasks = tasks.filter((t: { contact_id: string }) => t.contact_id === contactId);
    } else {
      tasks = listContactTasks({
        contact_id: contactId,
        status: opts.status as ContactTask['status'],
      }, db);
    }
    if (!tasks.length) {
      console.log(chalk.gray('\nNo tasks found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Title', 'Contact', 'Priority', 'Status', 'Deadline'],
      tasks.map((t: { title: string; contact_id: string; priority: string; status: string; deadline?: string | null }) => {
        let contactName = t.contact_id;
        try { contactName = getContact(t.contact_id).display_name; } catch { /* not found */ }
        return {
          Title: t.title,
          Contact: contactName,
          Priority: t.priority,
          Status: t.status,
          Deadline: t.deadline ? t.deadline.slice(0, 10) : '',
        };
      })
    );
    console.log(chalk.gray(`\n${tasks.length} task(s)\n`));
  });

taskCmd
  .command('done <id>')
  .description('Mark a contact task as completed')
  .action((id: string) => {
    const db = getDatabase();
    const updated = updateContactTask(id, { status: 'completed' }, db);
    console.log(chalk.green(`\n✓ Task completed: ${updated.title}\n`));
  });

// ─── contacts applications ────────────────────────────────────────────────────

const appsCmd = program.command('applications').description('Track grant/credit/program applications');

appsCmd
  .command('list')
  .description('List applications')
  .option('--status <s>', 'Filter by status')
  .option('--type <t>', 'Filter by type')
  .action((opts: { status?: string; type?: string }) => {
    const db = getDatabase();
    const apps = listApplications({
      status: opts.status as ApplicationStatus | undefined,
      type: opts.type as ApplicationType | undefined,
    }, db);
    if (!apps.length) {
      console.log(chalk.gray('\nNo applications found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Program', 'Type', 'Status', 'Value', 'Follow-up'],
      apps.map((a: { program_name: string; type: string; status: string; value_usd?: number | null; follow_up_date?: string | null }) => ({
        Program: a.program_name,
        Type: a.type,
        Status: a.status,
        Value: a.value_usd ? `$${a.value_usd.toLocaleString()}` : '',
        'Follow-up': a.follow_up_date ? a.follow_up_date.slice(0, 10) : '',
      }))
    );
    console.log(chalk.gray(`\n${apps.length} application(s)\n`));
  });

appsCmd
  .command('add')
  .description('Add a new application')
  .option('--name <name>', 'Program name (required)')
  .option('--type <type>', 'Type: ai_credits|grant|startup_program|other', 'other')
  .option('--value <usd>', 'Value in USD')
  .option('--status <status>', 'Status: draft|submitted|pending|approved|rejected|follow_up_needed|expired|cancelled', 'draft')
  .option('--follow-up <date>', 'Follow-up date (YYYY-MM-DD)')
  .option('--provider <id>', 'Provider company ID')
  .option('--contact <id>', 'Primary contact ID')
  .option('--method <method>', 'Application method: email|form|typeform|hubspot|manual|browser|feathery|other')
  .option('--url <url>', 'Form URL')
  .action(async (opts: {
    name?: string;
    type?: string;
    value?: string;
    status?: string;
    followUp?: string;
    provider?: string;
    contact?: string;
    method?: string;
    url?: string;
  }) => {
    const db = getDatabase();
    let name = opts.name;
    if (!name) {
      name = await prompt('Program name (required):');
      if (!name) { console.error(chalk.red('Program name is required.')); process.exit(1); }
    }
    const app = createApplication({
      program_name: name,
      type: (opts.type || 'other') as ApplicationType,
      value_usd: opts.value ? parseFloat(opts.value) : undefined,
      status: (opts.status || 'draft') as ApplicationStatus,
      follow_up_date: opts.followUp,
      provider_company_id: opts.provider,
      primary_contact_id: opts.contact,
      method: opts.method as "email" | "form" | "typeform" | "hubspot" | "manual" | "browser" | "feathery" | "other" | undefined,
      form_url: opts.url,
    }, db);
    console.log(chalk.green(`\n✓ Application created: ${app.program_name} (${app.id})\n`));
  });

appsCmd
  .command('followup')
  .description('Show applications with follow-up due')
  .action(() => {
    const db = getDatabase();
    const apps = getFollowUpDueApplications(db);
    if (!apps.length) {
      console.log(chalk.green('\nNo follow-ups due.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${apps.length} application(s) need follow-up:\n`));
    renderTable(
      ['Program', 'Type', 'Status', 'Follow-up'],
      apps.map((a: { program_name: string; type: string; status: string; follow_up_date?: string | null }) => ({
        Program: a.program_name,
        Type: a.type,
        Status: a.status,
        'Follow-up': a.follow_up_date ? a.follow_up_date.slice(0, 10) : '',
      }))
    );
    console.log();
  });

// ─── contacts seed ────────────────────────────────────────────────────────────

program
  .command('seed')
  .description('Seed demo contacts, companies, and relationships')
  .option('--demo', 'Seed demo data (professional services example)')
  .option('--clear', 'Clear existing demo data first')
  .action(async (opts: { demo?: boolean; clear?: boolean }) => {
    if (!opts.demo) {
      console.log('Use --demo flag to seed demo data');
      return;
    }
    const db = getDatabase();
    console.log(chalk.cyan('Seeding demo contacts...'));

    // Create vendor companies
    const kpmg = createCompany({ name: 'KPMG Romania', industry: 'Accounting', description: 'Romanian accounting, tax, and payroll firm' }, db);
    const escalon = createCompany({ name: 'Escalon Services', industry: 'Tax & Finance', description: 'US tax preparation for multi-entity businesses', domain: 'escalon.services' }, db);
    const revisionLegal = createCompany({ name: 'Revision Legal PLLC', industry: 'Legal', description: 'Trademark and IP law firm', domain: 'revisionlegal.com' }, db);
    createCompany({ name: 'RAW Financial', industry: 'Tax & Finance', description: 'US tax preparation for dissolution entities' }, db);
    const svb = createCompany({ name: 'Silicon Valley Bank', industry: 'Banking', domain: 'svb.com' }, db);

    // Create owned entities
    const hasnaInc = createCompany({ name: 'Hasna, Inc.', is_owned_entity: true, entity_type: 'operating', industry: 'AI/Software', description: 'Primary US operating entity (C-Corp, Delaware)' }, db);
    const beepMedia = createCompany({ name: 'Beep Media International LLC', is_owned_entity: true, entity_type: 'operating', industry: 'Media/Technology' }, db);
    createCompany({ name: 'Hasna Global SRL', is_owned_entity: true, entity_type: 'operating', industry: 'AI/Software', description: 'Romanian operating entity' }, db);

    // Create contacts
    const alina = createContact({ display_name: 'Alina Turlea', first_name: 'Alina', last_name: 'Turlea', job_title: 'Tax Consultant', emails: [{ address: 'alinaturlea@kpmg.com', type: 'work', is_primary: true }], source: 'manual' });
    const lucia = createContact({ display_name: 'Lucia Grecu', first_name: 'Lucia', last_name: 'Grecu', job_title: 'Compliance & Billing', emails: [{ address: 'lsipos@kpmg.com', type: 'work', is_primary: true }], source: 'manual' });
    const elizabeth = createContact({ display_name: 'Elizabeth Robles', first_name: 'Elizabeth', last_name: 'Robles', job_title: 'Tax Manager', emails: [{ address: 'elizabeth.robles@escalon.services', type: 'work', is_primary: true }], source: 'manual' });
    const drew = createContact({ display_name: 'Andrew Jurgensen', first_name: 'Andrew', last_name: 'Jurgensen', job_title: 'Partner', emails: [{ address: 'drew@revisionlegal.com', type: 'work', is_primary: true }], source: 'manual' });
    const donna = createContact({ display_name: 'Donna Yang', first_name: 'Donna', last_name: 'Yang', job_title: 'Relationship Manager', emails: [{ address: 'DYang@svb.com', type: 'work', is_primary: true }], source: 'manual' });

    // Link contacts to companies
    createCompanyRelationship({ contact_id: alina.id, company_id: kpmg.id, relationship_type: 'accountant', is_primary: true }, db);
    createCompanyRelationship({ contact_id: lucia.id, company_id: kpmg.id, relationship_type: 'accountant' }, db);
    createCompanyRelationship({ contact_id: elizabeth.id, company_id: escalon.id, relationship_type: 'tax_preparer', is_primary: true }, db);
    createCompanyRelationship({ contact_id: drew.id, company_id: revisionLegal.id, relationship_type: 'attorney', is_primary: true }, db);
    createCompanyRelationship({ contact_id: donna.id, company_id: svb.id, relationship_type: 'bank_manager', is_primary: true }, db);

    // Link KPMG to owned entities
    createCompanyRelationship({ contact_id: alina.id, company_id: hasnaInc.id, relationship_type: 'tax_preparer', is_primary: true }, db);
    createCompanyRelationship({ contact_id: alina.id, company_id: beepMedia.id, relationship_type: 'tax_preparer', is_primary: true }, db);

    // Use the contacts (avoid unused variable warnings)
    void [lucia, elizabeth, drew, donna];

    console.log(chalk.green(`✓ Seeded: 5 companies, 3 owned entities, 5 key contacts`));
    console.log(chalk.gray('  Try: contacts entities list'));
    console.log(chalk.gray('  Try: contacts workload ' + alina.id));
  });

// ─── Parse ────────────────────────────────────────────────────────────────────

program.parse(process.argv);
