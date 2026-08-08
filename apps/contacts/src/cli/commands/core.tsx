import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../../store/index.js";
import { getDbPath, getDataDir } from "../../db/paths.js";
import { importContacts } from "../../lib/import.js";
import { exportContacts } from "../../lib/export.js";
import { readConfig } from "../../lib/config.js";
import type { CreateContactInput, Group } from "../../types/index.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync, mkdirSync, readdirSync, chmodSync } from "fs";
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
    const store = getStore();

    // Non-interactive path: if --first/--last or --display provided, skip prompts
    if (opts.first || opts.last || opts.display) {
      const firstName = opts.first ?? "";
      const lastName = opts.last ?? "";
      const displayName = opts.display ?? (`${firstName} ${lastName}`.trim() || "Unnamed Contact");

      // Resolve tag names to ids up-front so contact creation is a single
      // Store call (works identically in local + self_hosted; no post-hoc
      // inline SQL and no per-command mode branching).
      let tagIds: string[] | undefined;
      if (opts.tag.length > 0) {
        const allTags = (await store.listTags()) as Array<{ id: string; name: string }>;
        tagIds = [];
        for (const tagName of opts.tag) {
          const tag = allTags.find((t) => t.name === tagName);
          if (tag) tagIds.push(tag.id);
          else console.log(chalk.yellow(`  ! Tag not found: ${tagName} (skipped)`));
        }
      }

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
        tag_ids: tagIds && tagIds.length > 0 ? tagIds : undefined,
      };

      const contact = await store.createContact(input);
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

    const contact = await store.createContact(input);
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
    const store = getStore();
    const result = await store.listContacts({
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
      Tags: c.tags?.map((t: { name: string }) => `#${t.name}`).join(" ") ?? "",
    }));

    renderTable(["Name", "Company", "Email", "Phone", "Tags"], rows);
    console.log(chalk.gray(`\n${result.total} contact(s) total, showing ${result.contacts.length}\n`));
  });

// ─── contacts show ─────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show full contact details")
  .action(async (id: string) => {
    const store = getStore();
    const contact = await store.getContact(id);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${id}\n`));
      process.exit(1);
    }
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
    const store = getStore();
    const contact = await store.getContact(id);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${id}\n`));
      process.exit(1);
    }

    // Non-interactive path: flags provided
    const hasFlags = opts.first || opts.last || opts.display || opts.email ||
      opts.phone || opts.title || opts.note || opts.website;

    if (hasFlags) {
      const updates: Record<string, unknown> = {};
      if (opts.first !== undefined) updates.first_name = opts.first;
      if (opts.last !== undefined) updates.last_name = opts.last;
      if (opts.display !== undefined) updates.display_name = opts.display;
      if (opts.title !== undefined) updates.job_title = opts.title;
      if (opts.note !== undefined) updates.notes = opts.note;
      if (opts.website !== undefined) updates.website = opts.website;
      // New email/phone travel with the update through the same Store path
      // (emails_add / phones_add), so there is no separate inline-SQL write.
      if (opts.email) updates.emails_add = [{ address: opts.email, type: "work" }];
      if (opts.phone) updates.phones_add = [{ number: opts.phone, type: "mobile" }];

      const updated = await store.updateContact(id, updates);
      console.log(chalk.green(`\n✓ Contact updated: ${updated.display_name}\n`));
      formatContact(updated);
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

    const updated = await store.updateContact(id, updates);
    console.log(chalk.green(`\n✓ Contact updated: ${updated.display_name}\n`));
  });

// ─── contacts delete ──────────────────────────────────────────────────────────

program
  .command("delete <id>")
  .description("Delete a contact")
  .option("-f, --force", "Skip confirmation")
  .action(async (id: string, opts: { force?: boolean }) => {
    const store = getStore();
    const contact = await store.getContact(id);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${id}\n`));
      process.exit(1);
    }

    if (!opts.force) {
      const ok = await confirm(`Delete ${chalk.bold(contact.display_name)}?`);
      if (!ok) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    await store.deleteContact(id);
    console.log(chalk.green(`\n✓ Contact deleted: ${contact.display_name}\n`));
  });

// ─── contacts search ──────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search contacts")
  .action(async (query: string) => {
    const store = getStore();
    const contacts = await store.searchContacts(query);

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
      Tags: c.tags?.map((t: { name: string }) => `#${t.name}`).join(" ") ?? "",
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
  .action(async (opts: { limit: string; offset: string; orderBy: string; orderDir: string; json?: boolean }) => {
    const store = getStore();
    const result = await store.listCompanies({
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
    const store = getStore();
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

    const company = await store.createCompany({
      name,
      domain: domain || undefined,
      industry: industry || undefined,
      size: size || undefined,
      description: description || undefined,
      notes: opts.notes || undefined,
    }) as { name: string; id: string };

    console.log(chalk.green(`\n✓ Company created: ${company.name} (${company.id})\n`));
  });

companiesCmd
  .command("show <id>")
  .description("Show company details")
  .action(async (id: string) => {
    const store = getStore();
    const company = await store.getCompany(id) as {
      name: string; id: string; domain?: string; industry?: string; size?: string;
      description?: string; founded_year?: number; employee_count: number;
    } | null;
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
  .action(async () => {
    const store = getStore();
    const tags = (await store.listTags()) as Array<{ name: string; color?: string; description?: string }>;
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
    const store = getStore();
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

    const tag = await store.createTag({
      name,
      color: color || undefined,
      description: description || undefined,
    }) as { name: string; id: string };

    console.log(chalk.green(`\n✓ Tag created: #${tag.name} (${tag.id})\n`));
  });

// ─── contacts import ──────────────────────────────────────────────────────────

program
  .command("import <file>")
  .description("Import contacts from CSV, vCard (.vcf), or JSON file")
  .action(async (file: string) => {
    const store = getStore();
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
        await store.createContact(input);
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
    const store = getStore();
    const format = opts.format as "csv" | "vcf" | "json";
    if (!["csv", "vcf", "json"].includes(format)) {
      console.error(chalk.red(`\nInvalid format: ${format}. Use csv, vcf, or json\n`));
      process.exit(1);
    }

    const { contacts } = await store.listContacts({ limit: 100000 });
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
  .action(async (opts: { limit: string; json?: boolean }) => {
    const store = getStore();
    const limit = parseInt(opts.limit, 10);
    const contacts = await store.listRecentContacts(limit);

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
  .action(async () => {
    const store = getStore();

    const emailDupes = await store.findEmailDuplicates();
    const nameDupes = await store.findNameDuplicates();

    let total = 0;

    if (emailDupes.length > 0) {
      console.log(chalk.bold.yellow("\nDuplicate Emails:\n"));
      for (const group of emailDupes) {
        console.log(`  ${chalk.cyan(group.email)}`);
        for (const cid of group.contact_ids) {
          try {
            const c = await store.getContact(cid);
            console.log(`    ${chalk.gray(cid)}  ${c?.display_name ?? "(not found)"}`);
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
          const a = await store.getContact(pair.contact_ids[0]);
          const b = await store.getContact(pair.contact_ids[1]);
          console.log(`  ${chalk.magenta(a?.display_name ?? "?")}  ↔  ${chalk.magenta(b?.display_name ?? "?")}  ${chalk.gray(`(distance: ${pair.similarity})`)}`);
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
  .action(async (id: string, opts: { note?: string; date?: string }) => {
    const store = getStore();
    const contact = await store.getContact(id);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${id}\n`));
      process.exit(1);
    }
    const date = opts.date ?? new Date().toISOString().slice(0, 10);

    const updates: Record<string, string> = {
      last_contacted_at: date,
    };

    if (opts.note) {
      const existing = contact.notes ?? "";
      const separator = existing ? "\n" : "";
      updates.notes = `${existing}${separator}[${date}] ${opts.note}`;
    }

    const updated = await store.updateContact(id, updates);
    console.log(chalk.green(`\n✓ Logged contact with ${updated.display_name} on ${date}\n`));
    if (opts.note) {
      console.log(chalk.gray(`  Note: ${opts.note}\n`));
    }
  });

// ─── contacts groups ──────────────────────────────────────────────────────────

const groupsCmd = program
  .command("groups")
  .description("Manage contact groups")
  .action(async () => {
    const store = getStore();
    const groups = (await store.listGroups()) as Group[];
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
    const store = getStore();
    let name = opts.name;
    if (!name) {
      name = await prompt("Group name (required):");
      if (!name) {
        console.error(chalk.red("Group name is required."));
        process.exit(1);
      }
    }
    const group = (await store.createGroup({ name, description: opts.description })) as { name: string; id: string };
    console.log(chalk.green(`\n✓ Group created: ${group.name} (${group.id})\n`));
  });

groupsCmd
  .command("show <id>")
  .description("Show group details with members")
  .action(async (id: string) => {
    const store = getStore();
    const group = (await store.getGroup(id)) as { name: string; id: string; description?: string } | null;
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${id}\n`));
      process.exit(1);
    }
    console.log("\n" + chalk.bold.blue("━━━ Group: ") + chalk.bold(group.name) + chalk.bold.blue(" ━━━"));
    if (group.description) console.log(chalk.gray("  Description: ") + group.description);
    console.log(chalk.gray(`  ID: ${group.id}`));
    console.log();

    const memberIds = await store.listContactsInGroup(id);
    if (memberIds.length === 0) {
      console.log(chalk.gray("  No members.\n"));
      return;
    }

    console.log(chalk.yellow(`  Members (${memberIds.length}):\n`));
    for (const cid of memberIds) {
      try {
        const c = await store.getContact(cid);
        console.log(`    ${chalk.bold(c?.display_name ?? "(not found)")}  ${chalk.gray(cid)}`);
      } catch {
        console.log(`    ${chalk.gray(cid)}  (not found)`);
      }
    }
    console.log();
  });

groupsCmd
  .command("add-member <group-id> <contact-id>")
  .description("Add a contact to a group")
  .action(async (groupId: string, contactId: string) => {
    const store = getStore();
    const group = (await store.getGroup(groupId)) as { name: string } | null;
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${groupId}\n`));
      process.exit(1);
    }
    const contact = await store.getContact(contactId);
    await store.addContactToGroup(contactId, groupId);
    console.log(chalk.green(`\n✓ Added ${contact?.display_name ?? contactId} to group ${group.name}\n`));
  });

groupsCmd
  .command("remove-member <group-id> <contact-id>")
  .description("Remove a contact from a group")
  .action(async (groupId: string, contactId: string) => {
    const store = getStore();
    const group = (await store.getGroup(groupId)) as { name: string } | null;
    if (!group) {
      console.error(chalk.red(`\nGroup not found: ${groupId}\n`));
      process.exit(1);
    }
    const contact = await store.getContact(contactId);
    await store.removeContactFromGroup(contactId, groupId);
    console.log(chalk.green(`\n✓ Removed ${contact?.display_name ?? contactId} from group ${group.name}\n`));
  });

// ─── contacts projects ────────────────────────────────────────────────────────

const projectsCmd = program
  .command("projects")
  .description("Manage contact project links");

projectsCmd
  .command("attach <contact-id> <project-id>")
  .description("Attach a contact to a project idempotently")
  .action(async (contactId: string, projectId: string) => {
    const store = getStore();
    await store.linkContactToProject(contactId, projectId);
    console.log(chalk.green(`\n✓ Attached ${contactId} to project ${projectId}\n`));
  });

projectsCmd
  .command("list <contact-id>")
  .description("List project ids attached to a contact")
  .option("-j, --json", "Output JSON")
  .action(async (contactId: string, opts: { json?: boolean }) => {
    const store = getStore();
    const projectIds = await store.getContactProjectIds(contactId);
    if (opts.json) {
      console.log(JSON.stringify({ contact_id: contactId, project_ids: projectIds }, null, 2));
      return;
    }
    if (projectIds.length === 0) {
      console.log(chalk.gray(`\nNo project links found for ${contactId}.\n`));
      return;
    }
    console.log();
    for (const projectId of projectIds) console.log(`  ${projectId}`);
    console.log(chalk.gray(`\n${projectIds.length} project link(s) for ${contactId}\n`));
  });

projectsCmd
  .command("detach <contact-id> <project-id>")
  .description("Detach a contact from a project")
  .action(async (contactId: string, projectId: string) => {
    const store = getStore();
    await store.unlinkContactFromProject(contactId, projectId);
    console.log(chalk.green(`\n✓ Detached ${contactId} from project ${projectId}\n`));
  });

// ─── contacts init ────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Show setup info, stats, and configuration")
  .action(async () => {
    const store = getStore();
    const dbPath = getDbPath();
    const config = readConfig();

    console.log(chalk.bold.blue("\n━━━ Open Contacts Setup ━━━\n"));
    console.log(chalk.gray("  DB path:    ") + (config.db_path ?? dbPath));
    console.log();

    try {
      const s = await store.stats();
      console.log(chalk.bold("  Stats:"));
      console.log(`    ${chalk.cyan(String(s.contacts))} contacts`);
      console.log(`    ${chalk.cyan(String(s.companies))} companies`);
      console.log(`    ${chalk.cyan(String(s.tags))} tags`);
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
  .description("Backup the contacts database (local mode only)")
  .option("--output <path>", "Output path")
  .option("--list", "List existing backups")
  .action(async (opts: { output?: string; list?: boolean }) => {
    const store = getStore();
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

    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    chmodSync(backupDir, 0o700);
    // Checkpoint + release the SQLite handle through the Store (local transport
    // only; in self_hosted mode this throws — the cloud DB is backed up server-side).
    await store.flushForBackup();

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = opts.output || join(backupDir, `contacts-${ts}.db`);
    copyFileSync(src, dest);
    chmodSync(dest, 0o600);
    const size = statSync(dest).size;
    console.log(chalk.green(`\n✓ Backed up to ${dest} (${(size / 1024).toFixed(1)} KB)\n`));
  });

} // end registerCoreCommands
