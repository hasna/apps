import type { Command } from "commander";
import chalk from "chalk";
import {
  createContact,
  getContact,
  updateContact,
  deleteContact,
  listContacts,
  searchContacts,
  listRecentContacts,
} from "../../db/contacts.js";
import {
  createCompany,
  getCompany,
  listCompanies,
} from "../../db/companies.js";
import {
  createTag,
  listTags,
} from "../../db/tags.js";
import {
  createGroup,
  getGroup,
  listGroups,
  addContactToGroup,
  removeContactFromGroup,
  listContactsInGroup,
} from "../../db/groups.js";
import { getDatabase, getDbPath } from "../../db/database.js";
import { importContacts } from "../../lib/import.js";
import { exportContacts } from "../../lib/export.js";
import { findEmailDuplicates, findNameDuplicates } from "../../lib/dedup.js";
import { readConfig } from "../../lib/config.js";
import type {
  CreateContactInput,
  Group,
} from "../../types/index.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync, mkdirSync, readdirSync } from "fs";
import { extname, join } from "path";
import { renderTable, formatContact, promptUser as prompt, confirmUser as confirm } from "../utils.js";

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

export function registerCoreCommands(program: Command): void {

// ─── contacts add ─────────────────────────────────────────────────────────────

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
  .option("--include-restricted", "Include restricted-sensitivity contacts")
  .option("-l, --limit <n>", "Max results", "50")
  .option("-o, --offset <n>", "Skip first N results", "0")
  .option("--order-by <field>", "Sort field: display_name|created_at|updated_at|last_contacted_at|follow_up_at", "display_name")
  .option("--order-dir <dir>", "Sort direction: asc|desc", "asc")
  .option("-j, --json", "Output JSON")
  .action(async (opts: { tag?: string; company?: string; includeRestricted?: boolean; limit: string; offset: string; orderBy: string; orderDir: string; json?: boolean }) => {
    const result = listContacts({
      tag_id: opts.tag,
      company_id: opts.company,
      include_restricted: opts.includeRestricted,
      limit: parseInt(opts.limit, 10),
      offset: parseInt(opts.offset, 10),
      order_by: opts.orderBy as "display_name" | "created_at" | "updated_at" | "last_contacted_at" | "follow_up_at",
      order_dir: opts.orderDir === "desc" ? "desc" : "asc",
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

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
        const { uuid } = await import("../../db/database.js");
        db.run(`INSERT INTO emails (id, contact_id, company_id, address, type, is_primary) VALUES (?, ?, NULL, ?, 'work', 0)`, [uuid(), id, opts.email]);
      }
      if (opts.phone) {
        const db = getDatabase();
        const { uuid } = await import("../../db/database.js");
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
  .option("-l, --limit <n>", "Max results", "50")
  .option("-o, --offset <n>", "Skip first N results", "0")
  .option("--order-by <field>", "Sort field: name|created_at|updated_at", "name")
  .option("--order-dir <dir>", "Sort direction: asc|desc", "asc")
  .option("-j, --json", "Output JSON")
  .action((opts: { limit: string; offset: string; orderBy: string; orderDir: string; json?: boolean }) => {
    const result = listCompanies({
      limit: parseInt(opts.limit, 10),
      offset: parseInt(opts.offset, 10),
      order_by: opts.orderBy as "name" | "created_at" | "updated_at",
      order_dir: opts.orderDir === "desc" ? "desc" : "asc",
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
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
  .option("--name <name>", "Company name")
  .option("--domain <domain>", "Domain (e.g. acme.com)")
  .option("--industry <industry>", "Industry")
  .option("--size <size>", "Size (e.g. 1-10, 11-50)")
  .option("--description <desc>", "Description")
  .option("--notes <notes>", "Notes")
  .action(async (opts: { name?: string; domain?: string; industry?: string; size?: string; description?: string; notes?: string }) => {
    let name = opts.name;
    let domain = opts.domain;
    let industry = opts.industry;
    let size = opts.size;
    let description = opts.description;

    if (!name) {
      console.log(chalk.bold.blue("\nAdd New Company\n"));
      name = await prompt("Company name (required):");
      if (!name) {
        console.error(chalk.red("Company name is required."));
        process.exit(1);
      }
      domain = domain ?? await prompt("Domain (e.g. acme.com):");
      industry = industry ?? await prompt("Industry:");
      size = size ?? await prompt("Size (e.g. 1-10, 11-50):");
      description = description ?? await prompt("Description:");
    }

    const company = createCompany({
      name,
      domain: domain || undefined,
      industry: industry || undefined,
      size: size || undefined,
      description: description || undefined,
      notes: opts.notes || undefined,
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
  .option("--name <name>", "Tag name")
  .option("--color <hex>", "Color hex (e.g. #FF5733)")
  .option("--description <desc>", "Description")
  .action(async (opts: { name?: string; color?: string; description?: string }) => {
    let name = opts.name;
    let color = opts.color;
    let description = opts.description;

    if (!name) {
      console.log(chalk.bold.blue("\nAdd New Tag\n"));
      name = await prompt("Tag name (required):");
      if (!name) {
        console.error(chalk.red("Tag name is required."));
        process.exit(1);
      }
      color = color ?? await prompt("Color (hex, e.g. #FF5733 — optional):");
      description = description ?? await prompt("Description (optional):");
    }

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
    const { startServer } = await import("../../server/serve.js");
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
  .option("-l, --limit <n>", "Number to show", "10")
  .option("-j, --json", "Output JSON")
  .action((opts: { limit: string; json?: boolean }) => {
    const limit = parseInt(opts.limit, 10);
    const contacts = listRecentContacts(limit);

    if (opts.json) {
      console.log(JSON.stringify({ contacts, total: contacts.length }, null, 2));
      return;
    }

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
    const { getDataDir } = require("../../db/database.js") as typeof import("../../db/database.js");
    const backupDir = join(getDataDir(), "backups");

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

} // end registerCoreCommands
