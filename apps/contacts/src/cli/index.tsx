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
} from "../db/contacts.js";
import {
  createCompany,
  getCompany,
  listCompanies,
} from "../db/companies.js";
import {
  createTag,
  listTags,
} from "../db/tags.js";
import { importContacts } from "../lib/import.js";
import { exportContacts } from "../lib/export.js";
import type {
  CreateContactInput,
  ContactWithDetails,
} from "../types/index.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { extname } from "path";

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
  .version("0.1.0");

// ─── contacts add ─────────────────────────────────────────────────────────────

program
  .command("add")
  .description("Add a new contact interactively")
  .action(async () => {
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
  .description("Edit a contact interactively")
  .action(async (id: string) => {
    const contact = getContact(id);

    console.log(chalk.bold.blue(`\nEditing: ${contact.display_name}\n`));
    console.log(chalk.gray("Press Enter to keep the current value.\n"));

    const display_name = await prompt(`Display name [${contact.display_name}]:`);
    const first_name = await prompt(`First name [${contact.first_name}]:`);
    const last_name = await prompt(`Last name [${contact.last_name}]:`);
    const job_title = await prompt(`Job title [${contact.job_title ?? ""}]:`);
    const notes = await prompt(`Notes [${contact.notes ? contact.notes.slice(0, 30) + "..." : ""}]:`);

    const updates: Record<string, string> = {};
    if (display_name) updates.display_name = display_name;
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (job_title) updates.job_title = job_title;
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

// ─── Parse ────────────────────────────────────────────────────────────────────

program.parse(process.argv);
