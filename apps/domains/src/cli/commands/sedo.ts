import type { Command } from "commander";
import { compactHint, pageItemsOrExit } from "../../lib/compact-output.js";

function parseSedoLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error("--limit must be a non-negative integer");
    process.exit(1);
  }
  return parsed;
}

export function registerSedoCommand(program: Command): void {
  const sedo = program
    .command("sedo")
    .description("Sedo domain marketplace integration");

  sedo
    .command("search")
    .description("Search for domains for sale on Sedo")
    .argument("<keyword>", "Search term (e.g. 'health', 'ai', 'cloud')")
    .option("--tld <tld>", "Filter by TLD (e.g. 'com')")
    .option("--limit <n>", "Max results")
    .option("--min-price <n>", "Minimum price")
    .option("--max-price <n>", "Maximum price")
    .option("--json", "Output as JSON", false)
    .action(async (keyword, opts) => {
      const { searchSedoDomains } = await import("../../lib/sedo.js");
      const limit = parseSedoLimit(opts.limit, opts.json ? 50 : 20);

      const result = await searchSedoDomains(keyword, {
        tld: opts.tld,
        limit,
        minPrice: opts.minPrice ? parseInt(opts.minPrice) : undefined,
        maxPrice: opts.maxPrice ? parseInt(opts.maxPrice) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.domains.length === 0) {
          console.log(`No domains found for "${keyword}".`);
          return;
        }
        console.log(`Sedo marketplace — "${keyword}" (${result.total} total):`);
        for (const d of result.domains) {
          const price = d.price
            ? ` — ${d.price.toLocaleString()} ${d.currency || ""}`.trimEnd()
            : " — make offer";
          const premium = d.isPremium ? " [PREMIUM]" : "";
          console.log(`  ${d.domain}${price}${premium}`);
        }
        console.log(`\nShowing ${result.domains.length}/${result.total} marketplace result(s). Use --limit <n> for more or --json for full fields.`);
      }
    });

  sedo
    .command("status")
    .description("Check domain status on Sedo")
    .argument("<domains...>", "Domain names to check")
    .option("--json", "Output as JSON", false)
    .action(async (domains, opts) => {
      const { checkSedoStatus } = await import("../../lib/sedo.js");

      const results = await checkSedoStatus(domains);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          const listed = r.listed ? "listed" : "not listed";
          const sale = r.forSale ? ` for sale (${r.price || "?"} ${r.currency || ""})` : "";
          console.log(`  ${r.domain}: ${listed}${sale}`);
        }
      }
    });

  sedo
    .command("portfolio")
    .description("List your Sedo portfolio domains")
    .option("--limit <n>", "Max results")
    .option("--all", "Show all loaded portfolio domains")
    .option("--json", "Output as JSON", false)
    .action(async (opts: { limit?: string; all?: boolean; json?: boolean }) => {
      const { listSedoPortfolio } = await import("../../lib/sedo.js");
      const limit = parseSedoLimit(opts.limit, opts.json || opts.all ? 100 : 20);

      const domains = await listSedoPortfolio({ limit });

      if (opts.json) {
        console.log(JSON.stringify(domains, null, 2));
      } else {
        if (domains.length === 0) {
          console.log("No domains in your Sedo portfolio.");
          return;
        }
        const page = pageItemsOrExit(domains, { limit: opts.limit, all: opts.all });
        console.log(`Sedo Portfolio:`);
        for (const d of page.items) {
          const sale = d.forSale ? `[for sale ${d.price || "?"} ${d.currency || ""}]` : "";
          console.log(`  ${d.domain} ${sale}`);
        }
        console.log(`\n${compactHint(page, "domain(s)", "Use --limit <n> for more or --json for full marketplace fields.", { paging: "limit" })}`);
      }
    });

  sedo
    .command("add")
    .description("Add a domain to Sedo marketplace")
    .argument("<domain>", "Domain name to list")
    .option("--price <n>", "Asking price")
    .option("--currency <currency>", "Currency (USD, EUR, GBP)", "USD")
    .option("--for-sale", "Mark domain for sale", true)
    .option("--parking", "Enable parking", false)
    .option("--buy-now-price <n>", "Buy-it-now price")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      const { addDomainToSedo } = await import("../../lib/sedo.js");

      const result = await addDomainToSedo({
        domain,
        price: opts.price ? parseInt(opts.price) : undefined,
        currency: opts.currency,
        forSale: opts.forSale,
        parkingEnabled: opts.parking,
        buyNowPrice: opts.buyNowPrice ? parseInt(opts.buyNowPrice) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Added ${domain} to Sedo marketplace`);
      }
    });

  sedo
    .command("edit")
    .description("Update an existing domain on Sedo")
    .argument("<domain>", "Domain name to update")
    .option("--price <n>", "New asking price")
    .option("--currency <currency>", "Currency")
    .option("--buy-now-price <n>", "New buy-it-now price")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      const { editDomainOnSedo } = await import("../../lib/sedo.js");

      const result = await editDomainOnSedo({
        domain,
        price: opts.price ? parseInt(opts.price) : undefined,
        currency: opts.currency,
        buyNowPrice: opts.buyNowPrice ? parseInt(opts.buyNowPrice) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Updated ${domain} on Sedo`);
      }
    });

  sedo
    .command("remove")
    .description("Remove a domain from Sedo marketplace")
    .argument("<domain>", "Domain name to remove")
    .action(async (domain) => {
      const { removeDomainFromSedo } = await import("../../lib/sedo.js");
      const removed = await removeDomainFromSedo(domain);
      if (removed) {
        console.log(`Removed ${domain} from Sedo marketplace`);
      } else {
        console.error(`Failed to remove ${domain} from Sedo`);
        process.exit(1);
      }
    });

  sedo
    .command("blacklist")
    .description("Check if domains are blacklisted at Sedo")
    .argument("<domains...>", "Domain names to check")
    .option("--json", "Output as JSON", false)
    .action(async (domains, opts) => {
      const { checkSedoBlacklist } = await import("../../lib/sedo.js");
      const results = await checkSedoBlacklist(domains);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          console.log(`  ${r.domain}: ${r.blacklisted ? "BLACKLISTED" : "clean"}`);
        }
      }
    });

  sedo
    .command("buy")
    .description("Record a Sedo domain purchase in the local DB")
    .argument("<domain>", "Domain name purchased")
    .requiredOption("--price <n>", "Purchase price")
    .option("--order-id <id>", "Sedo order or transaction ID")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      const { recordSedoPurchase } = await import("../../lib/sedo.js");

      const price = parseInt(opts.price);
      const created = recordSedoPurchase(domain, price, opts.orderId);

      if (opts.json) {
        console.log(JSON.stringify(created, null, 2));
      } else {
        console.log(`Recorded Sedo purchase: ${domain} for $${price}`);
      }
    });
}
