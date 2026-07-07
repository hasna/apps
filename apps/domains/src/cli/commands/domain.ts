import type { Command } from "commander";
import {
  DOMAIN_EMAIL_TYPES,
  DOMAIN_OFFER_STATUSES,
  DOMAIN_STATUSES,
  createDomain,
  getDomainDetails,
  getDomainByName,
  updateDomain,
  markDomainPremium,
  createDomainOffer,
  updateDomainLifecycleStatus,
  listDomainEmailLinks,
  linkDomainEmail,
  recordDomainPurchase,
  exportPortfolio, checkAllDomains, whoisLookup,
} from "../../db/domains.js";
import {
  createDomain as createDomainRouted,
  getDomainByIdentifier as getDomainByIdentifierRouted,
  listDomains as listDomainsRouted,
  updateDomain as updateDomainRouted,
  deleteDomain as deleteDomainRouted,
  searchDomains as searchDomainsRouted,
  getDomainStats as getDomainStatsRouted,
  listExpiring as listExpiringRouted,
  isCloudMode,
} from "../../db/cloud-store.js";
import { getAvailableProviders, getRegistrarProvider, getDnsProvider, getDomainInventoryProvider, providerHasInventory, autoDetectRegistrar } from "../../lib/registrar.js";
import { loadConfig, resolveContact, applyPurchaseProfile } from "../../lib/config.js";
import { registerDomain, checkAvailability, getRegistrationStatus, createHostedZone, updateNameservers } from "../../lib/route53.js";
import { createZone as cfCreateZone, ensureZone as cfEnsureZone } from "../../lib/cloudflare.js";
import { delegateDomainToCloudflare } from "../../lib/delegate.js";
import { getCapability } from "../../lib/capability.js";
import { compactHint, formatDate, pageItemsOrExit, parseLimit, parseOffset, truncateText } from "../../lib/compact-output.js";

const DOMAIN_STATUS_HELP = DOMAIN_STATUSES.join("/");
const DOMAIN_OFFER_STATUS_HELP = DOMAIN_OFFER_STATUSES.join("/");
const DOMAIN_EMAIL_TYPE_HELP = DOMAIN_EMAIL_TYPES.join("/");

function parseOptionalNumber(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative number`);
  }
  return parsed;
}

async function createDnsZoneForProvider(domain: string, provider: string): Promise<{ zoneId: string; nameservers: string[] }> {
  if (provider === "cloudflare") {
    const zone = await cfEnsureZone(domain);
    return { zoneId: zone.id, nameservers: zone.nameservers ?? [] };
  }
  if (provider === "route53") {
    const zone = await createHostedZone(domain, "Managed by domains CLI");
    return { zoneId: zone.id, nameservers: zone.name_servers ?? [] };
  }
  throw new Error(`DNS provider '${provider}' is not supported by domain purchase delegation yet`);
}

function requireDomain(identifier: string) {
  const details = getDomainDetails(identifier);
  if (!details) {
    console.error(`Domain '${identifier}' not found.`);
    process.exit(1);
  }
  return details;
}

export function registerDomainCommand(program: Command): void {
  const domain = program.command("domain").description("Domain portfolio management");

  // ── list ────────────────────────────────────────────────────────────────

  domain
    .command("list")
    .description("List all domains in the portfolio")
    .option("--status <status>", `Filter by status (${DOMAIN_STATUS_HELP})`)
    .option("--registrar <name>", "Filter by registrar")
    .option("--premium", "Only show premium domains")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--offset <n>", "Skip first N domains", "0")
    .option("--all", "Show all matching domains")
    .option("--verbose", "Show registrar, expiry, and notes columns")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { status?: string; registrar?: string; premium?: boolean; limit?: string; offset?: string; all?: boolean; verbose?: boolean; json?: boolean }) => {
      let limit: number | undefined;
      let offset: number;
      try {
        limit = opts.limit === undefined ? undefined : parseLimit(opts.limit);
        offset = parseOffset(opts.offset);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      const filters = {
        status: opts.status as (typeof DOMAIN_STATUSES)[number] | undefined,
        registrar: opts.registrar,
        is_premium: opts.premium ? true : undefined,
      };
      const jsonPaging = !opts.all && (opts.limit !== undefined || offset > 0) ? { limit, offset } : {};
      const domains = opts.json
        ? await listDomainsRouted({ ...filters, ...jsonPaging })
        : await listDomainsRouted(filters);

      if (opts.json) {
        console.log(JSON.stringify({ domains, count: domains.length, limit: limit ?? null, offset }, null, 2));
        return;
      }
      const page = pageItemsOrExit(domains, { limit, offset, all: opts.all });
      if (page.items.length === 0) { console.log("No domains found."); return; }
      for (const d of page.items) {
        const exp = d.expires_at ? ` exp:${formatDate(d.expires_at)}` : "";
        const premium = d.is_premium ? " premium" : "";
        if (opts.verbose) {
          const registrar = d.registrar ? ` reg:${truncateText(d.registrar, 24)}` : "";
          const notes = d.notes ? ` notes:${truncateText(d.notes, 60)}` : "";
          console.log(`  ${d.name} [${d.status}]${registrar}${exp}${premium}${notes}`);
        } else {
          console.log(`  ${d.name} [${d.status}]${exp}${premium}`);
        }
      }
      console.log(`\n${compactHint(page, "domain(s)", "Use --verbose for registrar/notes or domain get <id|name> for details.")}`);
    });
  // ── get ─────────────────────────────────────────────────────────────────

  domain
    .command("get <identifier>")
    .description("Get a domain by ID or name")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const details = isCloudMode()
        ? await (async () => {
            const d = await getDomainByIdentifierRouted(identifier);
            return d ? { domain: d, offers: [] as never[], emails: [] as never[] } : null;
          })()
        : getDomainDetails(identifier);
      if (!details) { console.error(`Domain '${identifier}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(details, null, 2)); return; }
      const d = details.domain;
      console.log(`\n${d.name} [${d.status}]`);
      if (d.registrar) console.log(`  Registrar:      ${d.registrar}`);
      if (d.expires_at) console.log(`  Expires:        ${formatDate(d.expires_at)}`);
      if (d.purchase_date) console.log(`  Purchased:      ${formatDate(d.purchase_date)}`);
      if (d.purchase_price !== null) console.log(`  Purchase price: ${d.purchase_price}`);
      console.log(`  Auto-renew:     ${d.auto_renew ? "yes" : "no"}`);
      if (d.is_premium) {
        console.log(`  Premium:        yes`);
        if (d.premium_price !== null) console.log(`  Premium ask:    ${d.premium_price}`);
      }
      if (d.standard_price !== null) console.log(`  Standard price: ${d.standard_price}`);
      if (d.notes) console.log(`  Notes:          ${truncateText(d.notes, 160)}`);
      if (details.offers.length > 0) {
        console.log("\nOffers:");
        const offerPage = pageItemsOrExit(details.offers, { fallbackLimit: 5 });
        for (const offer of offerPage.items) {
          const parts = [
            offer.created_at.split(" ")[0],
            offer.status,
            offer.our_offer !== null ? `our=${offer.our_offer}` : null,
            offer.their_ask !== null ? `their=${offer.their_ask}` : null,
            offer.notes,
          ].filter(Boolean);
          console.log(`  - ${parts.join(" | ")}`);
        }
        if (offerPage.hasMore) console.log(`  ${compactHint(offerPage, "offer(s)", "Use --json for the full offer history.", { paging: "none" })}`);
      }
      if (details.emails.length > 0) {
        console.log("\nEmails:");
        const emailPage = pageItemsOrExit(details.emails, { fallbackLimit: 5 });
        for (const email of emailPage.items) {
          const threadPart = email.thread_id ? ` thread=${email.thread_id}` : "";
          console.log(`  - ${email.type}: ${email.email_id}${threadPart}`);
        }
        if (emailPage.hasMore) console.log(`  ${compactHint(emailPage, "email link(s)", "Use --json for the full email list.", { paging: "none" })}`);
      }
      console.log();
    });

  // ── add ─────────────────────────────────────────────────────────────────

  domain
    .command("add")
    .description("Add a domain to the portfolio")
    .requiredOption("--name <name>", "Domain name")
    .option("--registrar <name>", "Registrar name")
    .option("--status <s>", `Status (${DOMAIN_STATUS_HELP})`, "active")
    .option("--expires <date>", "Expiry date (YYYY-MM-DD)")
    .option("--premium", "Mark the domain as premium")
    .option("--premium-price <price>", "Premium asking price")
    .option("--standard-price <price>", "Standard registration price")
    .option("--purchase-price <price>", "Acquisition price paid")
    .option("--purchase-date <date>", "Purchase date (ISO or YYYY-MM-DD)")
    .option("--notes <text>", "Notes")
    .option("-j, --json", "Output JSON")
    .action(async (opts: {
      name: string;
      registrar?: string;
      status: string;
      expires?: string;
      premium?: boolean;
      premiumPrice?: string;
      standardPrice?: string;
      purchasePrice?: string;
      purchaseDate?: string;
      notes?: string;
      json?: boolean;
    }) => {
      const premiumPrice = parseOptionalNumber(opts.premiumPrice, "--premium-price");
      const standardPrice = parseOptionalNumber(opts.standardPrice, "--standard-price");
      const purchasePrice = parseOptionalNumber(opts.purchasePrice, "--purchase-price");
      const d = await createDomainRouted({
        name: opts.name, registrar: opts.registrar,
        status: opts.status as (typeof DOMAIN_STATUSES)[number],
        expires_at: opts.expires,
        is_premium: opts.premium || premiumPrice !== undefined,
        premium_price: premiumPrice,
        standard_price: standardPrice,
        purchase_price: purchasePrice,
        purchase_date: opts.purchaseDate,
        notes: opts.notes,
      });
      if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log(`Created domain: ${d.name} (${d.id})`);
    });

  // ── update ──────────────────────────────────────────────────────────────

  domain
    .command("update <id>")
    .description("Update a domain")
    .option("--registrar <name>", "Registrar")
    .option("--status <s>", `Status (${DOMAIN_STATUS_HELP})`)
    .option("--expires <date>", "Expiry date")
    .option("--premium <bool>", "Premium flag (true/false)")
    .option("--premium-price <price>", "Premium asking price")
    .option("--standard-price <price>", "Standard registration price")
    .option("--purchase-price <price>", "Purchase price paid")
    .option("--purchase-date <date>", "Purchase date")
    .option("--notes <text>", "Notes")
    .option("-j, --json", "Output JSON")
    .action(async (id: string, opts: {
      registrar?: string;
      status?: string;
      expires?: string;
      premium?: string;
      premiumPrice?: string;
      standardPrice?: string;
      purchasePrice?: string;
      purchaseDate?: string;
      notes?: string;
      json?: boolean;
    }) => {
      const premiumPrice = parseOptionalNumber(opts.premiumPrice, "--premium-price");
      const standardPrice = parseOptionalNumber(opts.standardPrice, "--standard-price");
      const purchasePrice = parseOptionalNumber(opts.purchasePrice, "--purchase-price");
      const d = await updateDomainRouted(id, {
        registrar: opts.registrar,
        status: opts.status as (typeof DOMAIN_STATUSES)[number] | undefined,
        expires_at: opts.expires,
        is_premium: opts.premium !== undefined ? opts.premium === "true" : undefined,
        premium_price: premiumPrice,
        standard_price: standardPrice,
        purchase_price: purchasePrice,
        purchase_date: opts.purchaseDate,
        notes: opts.notes,
      });
      if (!d) { console.error(`Domain '${id}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log(`Updated: ${d.name}`);
    });

  // ── delete ──────────────────────────────────────────────────────────────

  domain
    .command("delete <id>")
    .description("Delete a domain from the portfolio")
    .option("-f, --force", "Required confirmation for destructive delete")
    .option("-j, --json", "Output JSON")
    .action(async (id: string, opts: { force?: boolean; json?: boolean }) => {
      if (!opts.force) {
        const message = `Refusing to delete domain '${id}' without --force.`;
        if (opts.json) {
          console.log(JSON.stringify({ deleted: false, id, error: message }, null, 2));
        } else {
          console.error(message);
          console.error("Re-run with --force to confirm deletion.");
        }
        process.exit(1);
      }

      const deleted = await deleteDomainRouted(id);
      if (!deleted) {
        const message = `Domain '${id}' not found.`;
        if (opts.json) {
          console.log(JSON.stringify({ deleted: false, id, error: message }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ deleted: true, id }, null, 2));
        return;
      }

      console.log(`Deleted domain ${id}`);
    });

  // ── search ──────────────────────────────────────────────────────────────

  domain
    .command("search <query>")
    .description("Search domains by name, registrar, or notes")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--offset <n>", "Skip first N domains", "0")
    .option("--all", "Show all matching domains")
    .option("--verbose", "Show registrar and truncated notes")
    .option("-j, --json", "Output JSON")
    .action(async (query: string, opts: { limit?: string; offset?: string; all?: boolean; verbose?: boolean; json?: boolean }) => {
      const results = await searchDomainsRouted(query);
      if (opts.json) { console.log(JSON.stringify({ results, count: results.length }, null, 2)); return; }
      let page;
      try {
        page = pageItemsOrExit(results, { limit: opts.limit, offset: opts.offset, all: opts.all });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      for (const d of page.items) {
        const notes = opts.verbose && d.notes ? ` — ${truncateText(d.notes, 80)}` : "";
        console.log(`  ${d.name} [${d.status}]${notes}`);
      }
      if (results.length === 0) console.log("No results.");
      else console.log(`\n${compactHint(page, "result(s)", "Use --verbose for notes or domain get <id|name> for details.")}`);
    });

  // ── expiring ────────────────────────────────────────────────────────────

  domain
    .command("expiring")
    .description("List domains expiring soon")
    .option("--days <n>", "Days threshold", "30")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all matching domains")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { days: string; limit?: string; all?: boolean; json?: boolean }) => {
      const domains = await listExpiringRouted(parseInt(opts.days));
      if (opts.json) { console.log(JSON.stringify(domains, null, 2)); return; }
      const page = pageItemsOrExit(domains, { limit: opts.limit, all: opts.all });
      if (page.items.length === 0) { console.log(`No domains expiring within ${opts.days} days.`); return; }
      console.log(`\nExpiring within ${opts.days} days:`);
      for (const d of page.items) console.log(`  ${d.name.padEnd(40)} expires ${formatDate(d.expires_at)}`);
      console.log(`\n${compactHint(page, "domain(s)", "Use --all to display every expiring domain.", { paging: "limit" })}`);
    });

  // ── stats ───────────────────────────────────────────────────────────────

  domain
    .command("stats")
    .description("Show portfolio statistics")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const stats = await getDomainStatsRouted();
      if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
      console.log("Domain Portfolio Stats:");
      for (const [k, v] of Object.entries(stats)) {
        console.log(`  ${k.replace(/_/g, " ")}: ${v}`);
      }
    });

  // ── whois ───────────────────────────────────────────────────────────────

  domain
    .command("whois <name>")
    .description("Run WHOIS lookup and update local DB record")
    .option("-j, --json", "Output JSON")
    .action((name: string, opts: { json?: boolean }) => {
      try {
        const result = whoisLookup(name);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(`\nWHOIS for ${result.domain} [${result.source}]:`);
        console.log(`  Registrar: ${result.registrar ?? "unknown"}`);
        console.log(`  Expires:   ${result.expires_at ?? "unknown"}`);
        if (result.nameservers.length) { console.log(`  NS: ${result.nameservers.join(", ")}`); }
        const r = result.registrant;
        if (r?.name || r?.email || r?.organization) {
          console.log(`  Registrant:`);
          if (r.name) console.log(`    Name: ${r.name}`);
          if (r.email) console.log(`    Email: ${r.email}`);
          if (r.phone) console.log(`    Phone: ${r.phone}`);
          if (r.organization) console.log(`    Org: ${r.organization}`);
        }
        console.log();
      } catch (error: unknown) {
        console.error(`WHOIS lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // ── export ──────────────────────────────────────────────────────────────

  domain
    .command("export")
    .description("Export all domains as CSV or JSON")
    .option("--format <fmt>", "Format: csv or json", "json")
    .action((opts: { format: string }) => {
      const output = exportPortfolio(opts.format as "csv" | "json");
      console.log(output);
    });

  // ── check ───────────────────────────────────────────────────────────────

  domain
    .command("check <domains...>")
    .description("Check domain availability via configured registrar")
    .option("--provider <name>", "Registrar provider to use")
    .option("-j, --json", "Output JSON")
    .action(async (domains: string[], opts: { provider?: string; json?: boolean }) => {
      const cfg = loadConfig();
      const providerName = opts.provider ?? cfg.default_registrar ?? "route53";
      const results = await Promise.allSettled(
        domains.map(async (d) => {
          const provider = getRegistrarProvider(providerName);
          return provider.checkAvailability(d);
        })
      );

      let anyError = false;
      const output: Array<{
        domain: string;
        available?: boolean;
        is_premium?: boolean;
        premium_price?: number;
        standard_price?: number;
        currency?: string;
        error?: string;
      }> = [];

      for (let i = 0; i < domains.length; i++) {
        const r = results[i]!;
        if (r.status === "rejected") {
          const reason = (r as PromiseRejectedResult).reason;
          const error = reason instanceof Error ? reason.message : String(reason);
          output.push({ domain: domains[i]!, error });
          if (!opts.json) {
            console.error(`✗ ${domains[i]}: ${error}`);
          }
          anyError = true;
        } else {
          const result = (r as PromiseFulfilledResult<{ domain: string; available: boolean }>).value;
          output.push({ domain: result.domain, available: result.available });
          if (!opts.json) {
            console.log(`${result.available ? "✓" : "✗"} ${result.domain} is ${result.available ? "available" : "not available"}`);
          }
        }
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              provider: providerName,
              count: output.length,
              ok: !anyError,
              results: output,
            },
            null,
            2
          )
        );
      } else {
        for (const result of output) {
          if (result.available !== undefined && "is_premium" in result && result.is_premium) {
            console.log(`  Premium ask: ${result.premium_price ?? "unknown"}`);
          }
          if ("standard_price" in result && result.standard_price !== undefined) {
            const currency = "currency" in result && result.currency ? ` ${result.currency}` : "";
            console.log(`  Standard price: ${result.standard_price}${currency}`);
          }
        }
      }

      for (const result of output) {
        if (result.error) continue;
        const existing = getDomainByName(result.domain);
        if (!existing) continue;
        updateDomain(existing.id, {
          is_premium: "is_premium" in result ? Boolean(result.is_premium) : existing.is_premium,
          premium_price: "premium_price" in result ? result.premium_price ?? existing.premium_price : existing.premium_price,
          standard_price: "standard_price" in result ? result.standard_price ?? existing.standard_price : existing.standard_price,
          status: result.available ? existing.status : ("is_premium" in result && result.is_premium ? "premium_only" : "not_available"),
        });
      }

      if (anyError) process.exit(1);
    });
  // ── sync ────────────────────────────────────────────────────────────────

  domain
    .command("sync")
    .description("Sync domains from a provider to the local DB")
    .option("--provider <name>", "Provider name (default: all configured)")
    .action(async (opts: { provider?: string }) => {
      const providers = opts.provider
        ? [opts.provider]
        : getAvailableProviders().filter((p) => p.configured && providerHasInventory(p.name)).map((p) => p.name);

      for (const name of providers) {
        try {
          const provider = getDomainInventoryProvider(name);
          const result = await provider.syncToLocalDb({ getDomainByName, createDomain, updateDomain });
          console.log(`✓ [${name}] Synced ${result.synced} (${result.created} new, ${result.updated} updated)`);
          if (result.errors.length > 0) console.log(`  Errors: ${result.errors.join(", ")}`);
        } catch (e) {
          console.error(`✗ [${name}] ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });

  // ── renew ───────────────────────────────────────────────────────────────

  domain
    .command("premium <identifier>")
    .description("Mark a tracked domain as premium-priced")
    .requiredOption("--ask <price>", "Premium asking price")
    .option("--standard <price>", "Standard registration price")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { ask: string; standard?: string; json?: boolean }) => {
      const premiumPrice = parseOptionalNumber(opts.ask, "--ask");
      const standardPrice = parseOptionalNumber(opts.standard, "--standard");
      const updated = markDomainPremium(identifier, premiumPrice!, standardPrice);
      if (!updated) { console.error(`Domain '${identifier}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(updated, null, 2)); return; }
      console.log(`Marked ${updated.name} as premium at ${premiumPrice}`);
    });

  domain
    .command("offer <identifier>")
    .description("Record a negotiation step for a domain")
    .option("--our <price>", "Our offer")
    .option("--their <price>", "Their asking price")
    .option("--status <status>", `Offer status (${DOMAIN_OFFER_STATUS_HELP})`, "pending")
    .option("--notes <text>", "Negotiation notes")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { our?: string; their?: string; status: string; notes?: string; json?: boolean }) => {
      const details = requireDomain(identifier);
      const offer = createDomainOffer({
        domain_id: details.domain.id,
        our_offer: parseOptionalNumber(opts.our, "--our"),
        their_ask: parseOptionalNumber(opts.their, "--their"),
        status: opts.status as (typeof DOMAIN_OFFER_STATUSES)[number],
        notes: opts.notes,
      });
      if (details.domain.status === "discovered" || details.domain.status === "researching" || details.domain.status === "offered") {
        updateDomainLifecycleStatus(details.domain.id, opts.their || opts.our ? "negotiating" : "offered");
      }
      if (opts.json) { console.log(JSON.stringify(offer, null, 2)); return; }
      console.log(`Logged offer for ${details.domain.name}: ${offer.status}`);
    });

  domain
    .command("status <identifier> <status>")
    .description("Update the lifecycle status of a domain")
    .option("--notes <text>", "Optional note to store with the status change")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, status: string, opts: { notes?: string; json?: boolean }) => {
      const updated = updateDomainLifecycleStatus(identifier, status as (typeof DOMAIN_STATUSES)[number], opts.notes);
      if (!updated) { console.error(`Domain '${identifier}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(updated, null, 2)); return; }
      console.log(`Updated ${updated.name} to ${updated.status}`);
    });

  domain
    .command("emails <identifier>")
    .description("Show email threads linked to a domain")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { json?: boolean }) => {
      const details = requireDomain(identifier);
      const emails = listDomainEmailLinks(details.domain.id);
      if (opts.json) {
        console.log(JSON.stringify({ domain: details.domain.name, emails, count: emails.length }, null, 2));
        return;
      }
      if (emails.length === 0) {
        console.log(`No linked emails for ${details.domain.name}.`);
        return;
      }
      for (const email of emails) {
        const threadPart = email.thread_id ? ` (${email.thread_id})` : "";
        console.log(`  ${email.type}: ${email.email_id}${threadPart}`);
      }
    });

  domain
    .command("link-email <identifier> <emailId>")
    .description("Link an email or email thread to a domain")
    .requiredOption("--type <type>", `Link type (${DOMAIN_EMAIL_TYPE_HELP})`)
    .option("--thread-id <threadId>", "Email thread ID")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, emailId: string, opts: { type: string; threadId?: string; json?: boolean }) => {
      const details = requireDomain(identifier);
      const link = linkDomainEmail({
        domain_id: details.domain.id,
        email_id: emailId,
        thread_id: opts.threadId,
        type: opts.type as (typeof DOMAIN_EMAIL_TYPES)[number],
      });
      if (opts.json) { console.log(JSON.stringify(link, null, 2)); return; }
      console.log(`Linked ${emailId} to ${details.domain.name}`);
    });

  domain
    .command("renew <name>")
    .description("Renew a domain via its registrar provider")
    .option("--provider <name>", "Override provider")
    .option("--years <n>", "Number of years to renew", "1")
    .action(async (name: string, opts: { provider?: string; years: string }) => {
      const providerName = opts.provider ?? autoDetectRegistrar(name, getDomainByName) ?? loadConfig().default_registrar;
      if (!providerName) { console.error("Could not detect provider. Use --provider."); process.exit(1); }
      const provider = getRegistrarProvider(providerName);
      const result = await provider.renewDomain(name, parseInt(opts.years, 10));
      if (result.success) {
        console.log(`✓ Renewed: ${name}`);
        if (result.orderId) console.log(`  Order: ${result.orderId}`);
      } else {
        console.error(`✗ Renewal failed or not supported for ${providerName}`);
        process.exit(1);
      }
    });

  // ── buy ─────────────────────────────────────────────────────────────────

  domain
    .command("buy <name>")
    .description("Purchase or record a domain via registrar provider (contact defaults from: domains config set contact.*)")
    .option("--provider <name>", "Registrar provider (default: config default-registrar or route53)")
    .option("--registrar <name>", "Registrar/seller for recorded purchases (alias of --provider)")
    .option("--email <email>", "Registrant email")
    .option("--first-name <n>", "First name")
    .option("--last-name <n>", "Last name")
    .option("--phone <p>", "Phone")
    .option("--address <a>", "Street address")
    .option("--city <c>", "City")
    .option("--state <s>", "State/province")
    .option("--country <c>", "Country code")
    .option("--zip <z>", "ZIP code")
    .option("--org <o>", "Organization")
    .option("--price <amount>", "Record a completed purchase instead of registering via Route 53")
    .option("--expires <date>", "Expiry date for recorded purchases")
    .option("--auto-renew <bool>", "Auto-renew for recorded purchases (true/false)")
    .option("--years <n>", "Years", "1")
    .option("--wait", "Poll until registration completes")
    .option("--dns <provider>", "DNS provider to delegate to after purchase (default: config default-dns or cloudflare)")
    .option("--no-delegate", "Skip nameserver delegation after purchase")
    .option("--allow-gated", "Allow gated/contract-only registrar purchase path when the provider API supports it")
    .action(async (name: string, opts: {
      provider?: string; registrar?: string; email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; price?: string; expires?: string; autoRenew?: string;
      years: string; wait?: boolean; dns?: string; delegate?: boolean; allowGated?: boolean;
    }) => {
      const recordedPrice = parseOptionalNumber(opts.price, "--price");
      if (recordedPrice !== undefined) {
        const registrarName = opts.registrar ?? opts.provider ?? "manual";
        const existing = getDomainByName(name);
        const domainRecord = existing ?? createDomain({ name, status: "discovered" });
        const purchased = recordDomainPurchase(domainRecord.id, {
          price: recordedPrice,
          registrar: registrarName,
          expires_at: opts.expires,
          auto_renew: opts.autoRenew ? opts.autoRenew === "true" : domainRecord.auto_renew,
        });
        if (!purchased) { console.error(`Domain '${name}' not found.`); process.exit(1); }
        if (opts.wait) {
          updateDomainLifecycleStatus(purchased.id, "active");
        }
        console.log(`Recorded purchase for ${purchased.name} at ${recordedPrice}`);
        return;
      }

      const cfg = loadConfig();
      const providerName = opts.registrar ?? opts.provider ?? cfg.default_registrar ?? "route53";
      const dnsProvider = opts.dns ?? cfg.default_dns ?? "cloudflare";

      // Use the configured purchase AWS profile unless explicit AWS
      // creds/profile are already set in the environment.
      const purchaseProfile = providerName === "route53" ? applyPurchaseProfile() : undefined;
      if (purchaseProfile) console.log(`Using purchase AWS profile: ${purchaseProfile}`);

      if (providerName !== "route53") {
        try {
          const capability = getCapability(providerName);
          if (!capability.canBuy) {
            console.error(`Direct domain purchase is not supported for ${providerName}. ${capability.notes} Use route53 or record a marketplace/manual purchase with --price.`);
            process.exit(1);
          }
          if (capability.gated && !opts.allowGated) {
            console.error(`Registrar '${providerName}' is gated/enterprise-only. Pass --allow-gated only when this account is contract-approved. ${capability.notes}`);
            process.exit(1);
          }

          const provider = getRegistrarProvider(providerName);
          if (!provider.registerDomain) {
            console.error(`Direct domain purchase is not supported for ${providerName}. Use route53 or record a marketplace/manual purchase with --price.`);
            process.exit(1);
          }

          const avail = await provider.checkAvailability(name);
          if (!avail.available) { console.error(`✗ ${name} is not available`); process.exit(1); }
          console.log(`✓ Available via ${providerName}`);

          let contact;
          try { contact = resolveContact(opts); } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }

          console.log(`Registering ${name} via ${providerName}...`);
          const reg = await provider.registerDomain(name, contact, {
            years: parseInt(opts.years, 10),
            premiumPrice: avail.premium_price,
            autoRenew: opts.autoRenew ? opts.autoRenew === "true" : true,
          });
          if (!reg.success) { console.error(`✗ Registration failed via ${providerName}`); process.exit(1); }

          const existing = getDomainByName(name);
          const dbInput = {
            registrar: providerName,
            status: "active" as const,
            auto_renew: opts.autoRenew ? opts.autoRenew === "true" : true,
            purchase_price: reg.chargedAmount ? Number(reg.chargedAmount) : avail.standard_price,
            purchase_date: new Date().toISOString(),
            standard_price: avail.standard_price,
            is_premium: avail.is_premium,
            premium_price: avail.premium_price,
          };
          if (existing) updateDomain(existing.id, dbInput);
          else createDomain({ name, ...dbInput });
          console.log(`✓ Registered and added to portfolio`);
          if (reg.orderId) console.log(`  Order: ${reg.orderId}`);

          if (opts.delegate !== false) {
            if (!provider.updateNameservers) {
              console.log(`  DNS: ${providerName} registration succeeded, but nameserver updates are not implemented for this provider.`);
            } else {
              const zone = await createDnsZoneForProvider(name, dnsProvider);
              const nsUpdate = await provider.updateNameservers(name, zone.nameservers);
              const existing2 = getDomainByName(name);
              if (existing2) updateDomain(existing2.id, { nameservers: zone.nameservers });
              console.log(`✓ ${dnsProvider} zone ${zone.zoneId}; nameservers updated${nsUpdate.operationId ? ` (op ${nsUpdate.operationId})` : ""}`);
            }
          }
          return;
        } catch (e) {
          console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }
      }

      try {
        const avail = await checkAvailability(name);
        if (!avail.available) { console.error(`✗ ${name} is not available`); process.exit(1); }
        const price = avail.price ? ` (USD ${avail.price}/yr)` : "";
        console.log(`✓ Available${price}`);

        let contact;
        try { contact = resolveContact(opts); } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }

        console.log(`Registering ${name}...`);
        const reg = await registerDomain(name, contact, parseInt(opts.years));
        console.log(`✓ Submitted (operation: ${reg.operationId})`);

        if (opts.wait) {
          let status = "IN_PROGRESS";
          while (status === "IN_PROGRESS" || status === "SUBMITTED") {
            await new Promise((r) => setTimeout(r, 10_000));
            const s = await getRegistrationStatus(reg.operationId);
            status = s.status;
            process.stdout.write(`  Status: ${status}\r`);
          }
          console.log();
          if (status !== "SUCCESSFUL") { console.error(`✗ Registration ${status}`); process.exit(1); }
          console.log(`✓ Registration complete`);
        }

        const existing = getDomainByName(name);
        if (existing) {
          updateDomain(existing.id, {
            registrar: "AWS Route 53",
            status: "active",
            auto_renew: true,
            purchase_price: avail.price ? Number(avail.price) : existing.purchase_price,
            purchase_date: new Date().toISOString(),
            standard_price: avail.price ? Number(avail.price) : existing.standard_price,
          });
        } else {
          createDomain({
            name,
            registrar: "AWS Route 53",
            status: "active",
            auto_renew: true,
            purchase_price: avail.price ? Number(avail.price) : undefined,
            purchase_date: new Date().toISOString(),
            standard_price: avail.price ? Number(avail.price) : undefined,
          });
        }
        console.log(`✓ Added to portfolio`);

        // Nameserver updates require registration to have completed, so only
        // delegate in this flow when --wait is set.
        if (opts.delegate !== false) {
          if (!opts.wait) {
            console.log(`  DNS: run 'domains domain buy ${name} --wait' or delegate later — registration must finish before NS can change.`);
          } else {
            try {
              console.log(`Delegating DNS to ${dnsProvider}...`);
              const del = dnsProvider === "cloudflare"
                ? await delegateDomainToCloudflare(name, {
                    createCloudflareZone: async (d) => {
                      const z = await cfEnsureZone(d);
                      return { id: z.id, nameservers: z.nameservers };
                    },
                    updateNameservers: (d, ns) => updateNameservers(d, ns),
                  })
                : await (async () => {
                    const zone = await createDnsZoneForProvider(name, dnsProvider);
                    const nsUpdate = await updateNameservers(name, zone.nameservers);
                    return { zoneId: zone.zoneId, nameservers: zone.nameservers, operationId: nsUpdate.operationId };
                  })();
              const existing2 = getDomainByName(name);
              if (existing2) updateDomain(existing2.id, { nameservers: del.nameservers });
              console.log(`✓ ${dnsProvider} zone ${del.zoneId}; nameservers → ${del.nameservers.join(", ")} (op ${del.operationId})`);
            } catch (e) {
              console.error(`⚠ DNS delegation failed (domain is registered): ${e instanceof Error ? e.message : String(e)}`);
              console.error(`  Retry: create the DNS zone and point Route53 NS at it.`);
            }
          }
        }
        if (!opts.wait) console.log(`  Check: domains r53 status ${reg.operationId}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ── setup ────────────────────────────────────────────────────────────────
  // Full flow: buy → create DNS zone → update nameservers → sync to DB

  domain
    .command("setup <name>")
    .description("Full setup: buy domain + create DNS zone + point nameservers (contact defaults from config)")
    .option("--registrar <n>", "Registrar provider (default: config default-registrar or route53)")
    .option("--dns <n>", "DNS provider (default: config default-dns or cloudflare)")
    .option("--email <e>", "Registrant email")
    .option("--first-name <n>", "First name")
    .option("--last-name <n>", "Last name")
    .option("--phone <p>", "Phone")
    .option("--address <a>", "Street address")
    .option("--city <c>", "City")
    .option("--state <s>", "State/province")
    .option("--country <c>", "Country code")
    .option("--zip <z>", "ZIP code")
    .option("--org <o>", "Organization")
    .option("--years <n>", "Years", "1")
    .option("--wait", "Poll until registration completes before creating DNS zone")
    .action(async (name: string, opts: {
      registrar?: string; dns?: string; email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; years: string; wait?: boolean;
    }) => {
      const cfg = loadConfig();
      const registrarName = opts.registrar ?? cfg.default_registrar ?? "route53";
      const dnsName = opts.dns ?? cfg.default_dns ?? "cloudflare";

      console.log(`\nSetting up ${name}`);
      console.log(`  Registrar: ${registrarName}  |  DNS: ${dnsName}\n`);

      try {
        // 1. Check availability
        process.stdout.write(opts.wait ? "[1/5] Checking availability... " : "[1/4] Checking availability... ");
        const avail = await checkAvailability(name);
        if (!avail.available) { console.log("not available"); console.error(`✗ ${name} is not available`); process.exit(1); }
        const price = avail.price ? `(USD ${avail.price}/yr)` : "";
        console.log(`available ${price}`);

        // 2. Buy domain
        if (registrarName !== "route53") {
          console.error("Direct domain purchase currently only supported via route53.");
          process.exit(1);
        }
        let contact;
        try { contact = resolveContact(opts); } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }

        process.stdout.write(opts.wait ? "[2/5] Registering domain... " : "[2/4] Registering domain... ");
        const reg = await registerDomain(name, contact, parseInt(opts.years));
        console.log(`submitted (${reg.operationId})`);

        if (opts.wait) {
          let status = "IN_PROGRESS";
          while (status === "IN_PROGRESS" || status === "SUBMITTED") {
            await new Promise((r) => setTimeout(r, 10_000));
            const s = await getRegistrationStatus(reg.operationId);
            status = s.status;
            process.stdout.write(`  Waiting: ${status}...\r`);
          }
          console.log();
          if (status !== "SUCCESSFUL") { console.error(`✗ Registration ${status}`); process.exit(1); }
          console.log("  Registration confirmed");
        }

        // 3. Create DNS zone
        process.stdout.write(opts.wait ? "[3/5] Creating DNS zone... " : "[3/4] Creating DNS zone... ");
        let nameservers: string[] = [];
        if (dnsName === "cloudflare") {
          const zone = await cfEnsureZone(name);
          nameservers = zone.nameservers ?? [];
          console.log("ready (" + zone.id + ")");
        } else {
          const zone = await createHostedZone(name, "Managed by domains CLI");
          nameservers = zone.name_servers ?? [];
          console.log(`created (${zone.id})`);
        }

        if (nameservers.length > 0) {
          if (opts.wait) {
            process.stdout.write("[4/5] Updating registrar nameservers... ");
            if (registrarName !== "route53") {
              console.log("skipped");
              console.error("Only Route53 nameserver delegation is currently implemented for setup.");
              process.exit(1);
            }
            const nsUpdate = await updateNameservers(name, nameservers);
            console.log("submitted (" + nsUpdate.operationId + ")");
          } else {
            console.log("  Nameserver delegation skipped until registration completes; re-run with --wait or use domains r53 domain-info/status first.");
          }
        }

        // 5. Sync to local DB
        process.stdout.write(opts.wait ? "[5/5] Adding to portfolio... " : "[4/4] Adding to portfolio... ");
        const existing = getDomainByName(name);
        const dbInput = { registrar: `AWS Route 53`, status: "active" as const, auto_renew: true, nameservers };
        if (existing) updateDomain(existing.id, dbInput);
        else createDomain({ name, ...dbInput });
        console.log("done");

        console.log(`\n✓ Setup complete for ${name}`);
        if (!opts.wait) {
          console.log(`  ⚠ Registration pending — check: domains r53 status ${reg.operationId}`);
          console.log(`  ⚠ If registration fails, clean up: domains zone delete <zoneId> --force`);
        }
        if (nameservers.length > 0) {
          console.log(`\n  Point your registrar to these name servers:`);
          for (const ns of nameservers) console.log(`    ${ns}`);
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
