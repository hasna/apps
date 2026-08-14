import type { Command } from "commander";
import {
  createDomainOwner,
  getDomainOwner,
  getDomainOwnerByDomain,
  listDomainOwners,
  updateDomainOwner,
  deleteDomainOwner,
  extractOwnerFromWhois,
  listDomainsWithOwners,
  type DomainOwnerSource,
  type CreateDomainOwnerInput,
  linkOwnerToContacts,
} from "../../db/owners.js";
import { getDomainDetails, whoisLookup } from "../../db/domains.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
async function requireDomain(identifier: string) {
  const details = await getDomainDetails(identifier);
  if (!details) {
    printErrorLine(`Domain '${identifier}' not found.`);
    process.exit(1);
  }
  return details;
}

export function registerOwnerCommand(program: Command): void {
  const owner = program.command("owner").description("Premium domain owner tracking");

  // ── list ────────────────────────────────────────────────────────────────

  owner
    .command("list")
    .description("List all premium domain owners")
    .option("--search <query>", "Search by owner name, email, or organization")
    .option("--source <source>", "Filter by source (whois/manual/brandsight/import)")
    .option("--verified-only", "Only show verified owners")
    .option("--with-domains", "Include domain details")
    .option("--limit <n>", "Limit number of displayed owners/domains")
    .option("--all", "Show all matching owners/domains")
    .option("--verbose", "Show email and phone details")
    .option("-j, --json", "Output JSON")
    .action(async (opts: {
      search?: string;
      source?: DomainOwnerSource;
      verifiedOnly?: boolean;
      withDomains?: boolean;
      limit?: string;
      all?: boolean;
      verbose?: boolean;
      json?: boolean;
    }) => {
      if (opts.withDomains) {
        const results = await listDomainsWithOwners();
        if (opts.json) { printLine(JSON.stringify({ owners: results, count: results.length }, null, 2)); return; }
        const page = pageItemsOrExit(results, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) { printLine("No premium domain owners found."); return; }
        for (const r of page.items) {
          const verified = r.verified ? " [verified]" : "";
          const org = r.owner_organization ? ` @ ${r.owner_organization}` : "";
          const email = opts.verbose && r.owner_email ? ` email:${r.owner_email}` : "";
          printLine(`  ${r.domain_name} (${r.domain_status}) — ${r.owner_name ?? r.owner_email ?? "unknown"}${org}${verified}${email}`);
        }
        printLine(`\n${compactHint(page, "domain(s) with owner info", "Use --verbose for email details or owner info <domain> for full details.", { paging: "limit" })}`);
        return;
      }

      const owners = await listDomainOwners({
        search: opts.search,
        source: opts.source,
        verified: opts.verifiedOnly ? true : undefined,
      });

      if (opts.json) { printLine(JSON.stringify({ owners, count: owners.length }, null, 2)); return; }
      const page = pageItemsOrExit(owners, { limit: opts.limit, all: opts.all });
      if (page.items.length === 0) { printLine("No owners found."); return; }
      for (const o of page.items) {
        const verified = o.verified ? " [verified]" : "";
        const org = o.owner_organization ? ` @ ${o.owner_organization}` : "";
        printLine(`  ${truncateText(o.owner_name ?? o.owner_email ?? "unknown", 48)}${org} [${o.source}]${verified}`);
        if (opts.verbose && o.owner_email) printLine(`    email: ${o.owner_email}`);
        if (opts.verbose && o.owner_phone) printLine(`    phone: ${o.owner_phone}`);
      }
      printLine(`\n${compactHint(page, "owner(s)", "Use --verbose for contact fields or owner get <id> for details.", { paging: "limit" })}`);
    });

  // ── get ─────────────────────────────────────────────────────────────────

  owner
    .command("get <ownerId>")
    .description("Get owner details by ID")
    .option("-j, --json", "Output JSON")
    .action(async (ownerId: string, opts: { json?: boolean }) => {
      const o = await getDomainOwner(ownerId);
      if (!o) { printErrorLine(`Owner '${ownerId}' not found.`); process.exit(1); }
      if (opts.json) { printLine(JSON.stringify(o, null, 2)); return; }
      printLine(`\nOwner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
      if (o.owner_organization) printLine(`  Organization: ${o.owner_organization}`);
      if (o.owner_email) printLine(`  Email: ${o.owner_email}`);
      if (o.owner_phone) printLine(`  Phone: ${o.owner_phone}`);
      printLine(`  Source: ${o.source}`);
      printLine(`  Verified: ${o.verified ? "yes" : "no"}`);
      if (o.contact_id) printLine(`  Contacts ID: ${o.contact_id}`);
      if (o.notes) printLine(`  Notes: ${truncateText(o.notes, 160)}`);
      printLine();
    });

  // ── info ────────────────────────────────────────────────────────────────

  owner
    .command("info <identifier>")
    .description("Show owner info for a specific domain")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const details = await requireDomain(identifier);
      const o = await getDomainOwnerByDomain(details.domain.id);
      if (!o) {
        if (opts.json) { printLine(JSON.stringify({ domain: details.domain.name, owner: null }, null, 2)); return; }
        printLine(`No owner info for ${details.domain.name}.`);
        return;
      }
      const result = { domain: details.domain.name, owner: o };
      if (opts.json) { printLine(JSON.stringify(result, null, 2)); return; }
      printLine(`\nDomain: ${details.domain.name} [${details.domain.status}]`);
      printLine(`  Owner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
      if (o.owner_organization) printLine(`  Organization: ${o.owner_organization}`);
      if (o.owner_email) printLine(`  Email: ${o.owner_email}`);
      if (o.owner_phone) printLine(`  Phone: ${o.owner_phone}`);
      printLine(`  Source: ${o.source}`);
      printLine(`  Verified: ${o.verified ? "yes" : "no"}`);
      if (o.contact_id) printLine(`  Contacts ID: ${o.contact_id}`);
      printLine();
    });

  // ── add ─────────────────────────────────────────────────────────────────

  owner
    .command("add <identifier>")
    .description("Add owner info for a domain")
    .option("--name <name>", "Owner name")
    .option("--email <email>", "Owner email")
    .option("--phone <phone>", "Owner phone")
    .option("--organization <org>", "Owner organization")
    .option("--source <source>", "Source (whois/manual/brandsight/import)", "manual")
    .option("--contact-id <id>", "Link to existing open-contacts contact ID")
    .option("--verified", "Mark as verified")
    .option("--notes <text>", "Notes")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: {
      name?: string;
      email?: string;
      phone?: string;
      organization?: string;
      source?: DomainOwnerSource;
      contactId?: string;
      verified?: boolean;
      notes?: string;
      json?: boolean;
    }) => {
      const details = await requireDomain(identifier);

      if (!opts.name && !opts.email && !opts.organization && !opts.contactId) {
        printErrorLine("At least one of --name, --email, --organization, or --contact-id is required.");
        process.exit(1);
      }

      const input: CreateDomainOwnerInput = {
        domain_id: details.domain.id,
        owner_name: opts.name,
        owner_email: opts.email,
        owner_phone: opts.phone,
        owner_organization: opts.organization,
        source: opts.source ?? "manual",
        verified: opts.verified ?? false,
        notes: opts.notes,
        contact_id: opts.contactId,
      };

      const o = await createDomainOwner(input);
      if (opts.json) { printLine(JSON.stringify(o, null, 2)); return; }
      printLine(`Added owner for ${details.domain.name}: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
    });

  // ── update ──────────────────────────────────────────────────────────────

  owner
    .command("update <ownerId>")
    .description("Update owner info")
    .option("--name <name>", "Owner name")
    .option("--email <email>", "Owner email")
    .option("--phone <phone>", "Owner phone")
    .option("--organization <org>", "Owner organization")
    .option("--contact-id <id>", "Link to open-contacts contact ID")
    .option("--verified", "Mark as verified")
    .option("--unverify", "Unmark as verified")
    .option("--notes <text>", "Notes")
    .option("-j, --json", "Output JSON")
    .action(async (ownerId: string, opts: {
      name?: string;
      email?: string;
      phone?: string;
      organization?: string;
      contactId?: string;
      verified?: boolean;
      unverify?: boolean;
      notes?: string;
      json?: boolean;
    }) => {
      const existing = await getDomainOwner(ownerId);
      if (!existing) { printErrorLine(`Owner '${ownerId}' not found.`); process.exit(1); }

      const update: { owner_name?: string; owner_email?: string; owner_phone?: string; owner_organization?: string; contact_id?: string; verified?: boolean; notes?: string } = {};
      if (opts.name !== undefined) update.owner_name = opts.name;
      if (opts.email !== undefined) update.owner_email = opts.email;
      if (opts.phone !== undefined) update.owner_phone = opts.phone;
      if (opts.organization !== undefined) update.owner_organization = opts.organization;
      if (opts.contactId !== undefined) update.contact_id = opts.contactId;
      if (opts.verified) update.verified = true;
      if (opts.unverify) update.verified = false;
      if (opts.notes !== undefined) update.notes = opts.notes;

      const o = await updateDomainOwner(ownerId, update);
      if (!o) { printErrorLine("Update failed."); process.exit(1); }
      if (opts.json) { printLine(JSON.stringify(o, null, 2)); return; }
      printLine(`Updated owner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
    });

  // ── delete ──────────────────────────────────────────────────────────────

  owner
    .command("delete <ownerId>")
    .description("Delete an owner record")
    .option("-f, --force", "Required confirmation")
    .action(async (ownerId: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        printErrorLine(`Refusing to delete owner '${ownerId}' without --force.`);
        process.exit(1);
      }
      const deleted = await deleteDomainOwner(ownerId);
      if (!deleted) { printErrorLine(`Owner '${ownerId}' not found.`); process.exit(1); }
      printLine(`Deleted owner ${ownerId}`);
    });

  // ── extract ─────────────────────────────────────────────────────────────

  owner
    .command("extract <identifier>")
    .description("Extract owner info from WHOIS lookup")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const details = await requireDomain(identifier);
      const whois = await whoisLookup(details.domain.name);

      if (!whois.raw) {
        printErrorLine("WHOIS returned no data.");
        process.exit(1);
      }

      const o = await extractOwnerFromWhois(details.domain.name, whois.raw);
      if (!o) {
        printLine("No owner information found in WHOIS data.");
        return;
      }
      if (opts.json) { printLine(JSON.stringify(o, null, 2)); return; }
      printLine(`Extracted owner for ${details.domain.name}:`);
      if (o.owner_name) printLine(`  Name: ${o.owner_name}`);
      if (o.owner_email) printLine(`  Email: ${o.owner_email}`);
      if (o.owner_phone) printLine(`  Phone: ${o.owner_phone}`);
      if (o.owner_organization) printLine(`  Organization: ${o.owner_organization}`);
      printLine();
    });

  // ── link ────────────────────────────────────────────────────────────────

  owner
    .command("link <identifier>")
    .description("Link domain owner to open-contacts contact")
    .option("--contact-id <id>", "Existing contact ID in open-contacts")
    .option("--auto", "Auto-create contact from owner info")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { contactId?: string; auto?: boolean; json?: boolean }) => {
      const details = await requireDomain(identifier);
      const o = await getDomainOwnerByDomain(details.domain.id);
      if (!o) {
        printErrorLine(`No owner record for ${details.domain.name}. Add one first.`);
        process.exit(1);
      }

      if (opts.contactId) {
        const updated = await updateDomainOwner(o.id, { contact_id: opts.contactId });
        if (!updated) { printErrorLine("Link failed."); process.exit(1); }
        if (opts.json) { printLine(JSON.stringify(updated, null, 2)); return; }
        printLine(`Linked ${details.domain.name} to contact ${opts.contactId}`);
        return;
      }

      if (opts.auto) {
        try {
          const contactsPackage = "@hasna/contacts";
          const contacts = await import(contactsPackage);
          const contactId = await linkOwnerToContacts(details.domain.id, {
            createContact: (input) => contacts.createContact(input),
            getContactByEmail: (email) => contacts.getContactByEmail(email),
          });
          if (!contactId) {
            printErrorLine("Could not create/find contact — owner has no email.");
            process.exit(1);
          }
          if (opts.json) { printLine(JSON.stringify({ domain: details.domain.name, contact_id: contactId }, null, 2)); return; }
          printLine(`Created/linked contact ${contactId} for ${details.domain.name}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (
            (typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "MODULE_NOT_FOUND") ||
            message.includes("@hasna/contacts")
          ) {
            printErrorLine("@hasna/contacts is not installed. Install it alongside @hasna/domains, or pass --contact-id to link an existing contact ID.");
          } else {
            printErrorLine(`Failed to link to open-contacts: ${message}`);
          }
          process.exit(1);
        }
        return;
      }

      printErrorLine("Use --contact-id <id> or --auto to link.");
      process.exit(1);
    });

  // ── whois ───────────────────────────────────────────────────────────────

  owner
    .command("whois <identifier>")
    .description("WHOIS lookup and save owner info")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const details = await requireDomain(identifier);
      const whois = await whoisLookup(details.domain.name);

      if (!whois.raw) {
        printErrorLine("WHOIS returned no data.");
        process.exit(1);
      }

      const o = await extractOwnerFromWhois(details.domain.name, whois.raw);
      if (!o) {
        if (opts.json) { printLine(JSON.stringify({ domain: details.domain.name, owner: null }, null, 2)); return; }
        printLine("No owner information found in WHOIS data.");
        return;
      }
      if (opts.json) { printLine(JSON.stringify(o, null, 2)); return; }
      printLine(`WHOIS owner for ${details.domain.name}:`);
      if (o.owner_name) printLine(`  Name: ${o.owner_name}`);
      if (o.owner_email) printLine(`  Email: ${o.owner_email}`);
      if (o.owner_phone) printLine(`  Phone: ${o.owner_phone}`);
      if (o.owner_organization) printLine(`  Organization: ${o.owner_organization}`);
      printLine(`  Source: ${o.source}`);
      printLine();
    });
}
