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
} from "../../db/domain-owners.js";
import { getDomainDetails, getDomainByName, whoisLookup } from "../../db/domains.js";
import { getDatabase } from "../../db/database.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

function requireDomain(identifier: string) {
  const details = getDomainDetails(identifier);
  if (!details) {
    console.error(`Domain '${identifier}' not found.`);
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
    .action((opts: {
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
        const results = listDomainsWithOwners();
        if (opts.json) { console.log(JSON.stringify({ owners: results, count: results.length }, null, 2)); return; }
        const page = pageItemsOrExit(results, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) { console.log("No premium domain owners found."); return; }
        for (const r of page.items) {
          const verified = r.verified ? " [verified]" : "";
          const org = r.owner_organization ? ` @ ${r.owner_organization}` : "";
          const email = opts.verbose && r.owner_email ? ` email:${r.owner_email}` : "";
          console.log(`  ${r.domain_name} (${r.domain_status}) — ${r.owner_name ?? r.owner_email ?? "unknown"}${org}${verified}${email}`);
        }
        console.log(`\n${compactHint(page, "domain(s) with owner info", "Use --verbose for email details or owner info <domain> for full details.", { paging: "limit" })}`);
        return;
      }

      const owners = listDomainOwners({
        search: opts.search,
        source: opts.source,
        verified: opts.verifiedOnly ? true : undefined,
      });

      if (opts.json) { console.log(JSON.stringify({ owners, count: owners.length }, null, 2)); return; }
      const page = pageItemsOrExit(owners, { limit: opts.limit, all: opts.all });
      if (page.items.length === 0) { console.log("No owners found."); return; }
      for (const o of page.items) {
        const verified = o.verified ? " [verified]" : "";
        const org = o.owner_organization ? ` @ ${o.owner_organization}` : "";
        console.log(`  ${truncateText(o.owner_name ?? o.owner_email ?? "unknown", 48)}${org} [${o.source}]${verified}`);
        if (opts.verbose && o.owner_email) console.log(`    email: ${o.owner_email}`);
        if (opts.verbose && o.owner_phone) console.log(`    phone: ${o.owner_phone}`);
      }
      console.log(`\n${compactHint(page, "owner(s)", "Use --verbose for contact fields or owner get <id> for details.", { paging: "limit" })}`);
    });

  // ── get ─────────────────────────────────────────────────────────────────

  owner
    .command("get <ownerId>")
    .description("Get owner details by ID")
    .option("-j, --json", "Output JSON")
    .action((ownerId: string, opts: { json?: boolean }) => {
      const o = getDomainOwner(ownerId);
      if (!o) { console.error(`Owner '${ownerId}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(o, null, 2)); return; }
      console.log(`\nOwner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
      if (o.owner_organization) console.log(`  Organization: ${o.owner_organization}`);
      if (o.owner_email) console.log(`  Email: ${o.owner_email}`);
      if (o.owner_phone) console.log(`  Phone: ${o.owner_phone}`);
      console.log(`  Source: ${o.source}`);
      console.log(`  Verified: ${o.verified ? "yes" : "no"}`);
      if (o.contact_id) console.log(`  Contacts ID: ${o.contact_id}`);
      if (o.notes) console.log(`  Notes: ${truncateText(o.notes, 160)}`);
      console.log();
    });

  // ── info ────────────────────────────────────────────────────────────────

  owner
    .command("info <identifier>")
    .description("Show owner info for a specific domain")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { json?: boolean }) => {
      const details = requireDomain(identifier);
      const o = getDomainOwnerByDomain(details.domain.id);
      if (!o) {
        if (opts.json) { console.log(JSON.stringify({ domain: details.domain.name, owner: null }, null, 2)); return; }
        console.log(`No owner info for ${details.domain.name}.`);
        return;
      }
      const result = { domain: details.domain.name, owner: o };
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(`\nDomain: ${details.domain.name} [${details.domain.status}]`);
      console.log(`  Owner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
      if (o.owner_organization) console.log(`  Organization: ${o.owner_organization}`);
      if (o.owner_email) console.log(`  Email: ${o.owner_email}`);
      if (o.owner_phone) console.log(`  Phone: ${o.owner_phone}`);
      console.log(`  Source: ${o.source}`);
      console.log(`  Verified: ${o.verified ? "yes" : "no"}`);
      if (o.contact_id) console.log(`  Contacts ID: ${o.contact_id}`);
      console.log();
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
    .action((identifier: string, opts: {
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
      const details = requireDomain(identifier);

      if (!opts.name && !opts.email && !opts.organization && !opts.contactId) {
        console.error("At least one of --name, --email, --organization, or --contact-id is required.");
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

      const o = createDomainOwner(input);
      if (opts.json) { console.log(JSON.stringify(o, null, 2)); return; }
      console.log(`Added owner for ${details.domain.name}: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
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
    .action((ownerId: string, opts: {
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
      const existing = getDomainOwner(ownerId);
      if (!existing) { console.error(`Owner '${ownerId}' not found.`); process.exit(1); }

      const update: { owner_name?: string; owner_email?: string; owner_phone?: string; owner_organization?: string; contact_id?: string; verified?: boolean; notes?: string } = {};
      if (opts.name !== undefined) update.owner_name = opts.name;
      if (opts.email !== undefined) update.owner_email = opts.email;
      if (opts.phone !== undefined) update.owner_phone = opts.phone;
      if (opts.organization !== undefined) update.owner_organization = opts.organization;
      if (opts.contactId !== undefined) update.contact_id = opts.contactId;
      if (opts.verified) update.verified = true;
      if (opts.unverify) update.verified = false;
      if (opts.notes !== undefined) update.notes = opts.notes;

      const o = updateDomainOwner(ownerId, update);
      if (!o) { console.error("Update failed."); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(o, null, 2)); return; }
      console.log(`Updated owner: ${o.owner_name ?? o.owner_email ?? "unknown"}`);
    });

  // ── delete ──────────────────────────────────────────────────────────────

  owner
    .command("delete <ownerId>")
    .description("Delete an owner record")
    .option("-f, --force", "Required confirmation")
    .action((ownerId: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        console.error(`Refusing to delete owner '${ownerId}' without --force.`);
        process.exit(1);
      }
      const deleted = deleteDomainOwner(ownerId);
      if (!deleted) { console.error(`Owner '${ownerId}' not found.`); process.exit(1); }
      console.log(`Deleted owner ${ownerId}`);
    });

  // ── extract ─────────────────────────────────────────────────────────────

  owner
    .command("extract <identifier>")
    .description("Extract owner info from WHOIS lookup")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { json?: boolean }) => {
      const details = requireDomain(identifier);
      const whois = whoisLookup(details.domain.name);

      if (!whois.raw) {
        console.error("WHOIS returned no data.");
        process.exit(1);
      }

      const o = extractOwnerFromWhois(details.domain.name, whois.raw);
      if (!o) {
        console.log("No owner information found in WHOIS data.");
        return;
      }
      if (opts.json) { console.log(JSON.stringify(o, null, 2)); return; }
      console.log(`Extracted owner for ${details.domain.name}:`);
      if (o.owner_name) console.log(`  Name: ${o.owner_name}`);
      if (o.owner_email) console.log(`  Email: ${o.owner_email}`);
      if (o.owner_phone) console.log(`  Phone: ${o.owner_phone}`);
      if (o.owner_organization) console.log(`  Organization: ${o.owner_organization}`);
      console.log();
    });

  // ── link ────────────────────────────────────────────────────────────────

  owner
    .command("link <identifier>")
    .description("Link domain owner to open-contacts contact")
    .option("--contact-id <id>", "Existing contact ID in open-contacts")
    .option("--auto", "Auto-create contact from owner info")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { contactId?: string; auto?: boolean; json?: boolean }) => {
      const details = requireDomain(identifier);
      const o = getDomainOwnerByDomain(details.domain.id);
      if (!o) {
        console.error(`No owner record for ${details.domain.name}. Add one first.`);
        process.exit(1);
      }

      if (opts.contactId) {
        const updated = updateDomainOwner(o.id, { contact_id: opts.contactId });
        if (!updated) { console.error("Link failed."); process.exit(1); }
        if (opts.json) { console.log(JSON.stringify(updated, null, 2)); return; }
        console.log(`Linked ${details.domain.name} to contact ${opts.contactId}`);
        return;
      }

      if (opts.auto) {
        try {
          // Dynamically import open-contacts
          const contacts = require("@hasna/contacts");
          const contactId = linkOwnerToContacts(details.domain.id, {
            createContact: (input) => contacts.createContact(input),
            getContactByEmail: (email) => contacts.getContactByEmail(email),
          });
          if (!contactId) {
            console.error("Could not create/find contact — owner has no email.");
            process.exit(1);
          }
          if (opts.json) { console.log(JSON.stringify({ domain: details.domain.name, contact_id: contactId }, null, 2)); return; }
          console.log(`Created/linked contact ${contactId} for ${details.domain.name}`);
        } catch (e) {
          console.error(`Failed to link to open-contacts: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }
        return;
      }

      console.error("Use --contact-id <id> or --auto to link.");
      process.exit(1);
    });

  // ── whois ───────────────────────────────────────────────────────────────

  owner
    .command("whois <identifier>")
    .description("WHOIS lookup and save owner info")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { json?: boolean }) => {
      const details = requireDomain(identifier);
      const whois = whoisLookup(details.domain.name);

      if (!whois.raw) {
        console.error("WHOIS returned no data.");
        process.exit(1);
      }

      const o = extractOwnerFromWhois(details.domain.name, whois.raw);
      if (!o) {
        if (opts.json) { console.log(JSON.stringify({ domain: details.domain.name, owner: null }, null, 2)); return; }
        console.log("No owner information found in WHOIS data.");
        return;
      }
      if (opts.json) { console.log(JSON.stringify(o, null, 2)); return; }
      console.log(`WHOIS owner for ${details.domain.name}:`);
      if (o.owner_name) console.log(`  Name: ${o.owner_name}`);
      if (o.owner_email) console.log(`  Email: ${o.owner_email}`);
      if (o.owner_phone) console.log(`  Phone: ${o.owner_phone}`);
      if (o.owner_organization) console.log(`  Organization: ${o.owner_organization}`);
      console.log(`  Source: ${o.source}`);
      console.log();
    });
}
