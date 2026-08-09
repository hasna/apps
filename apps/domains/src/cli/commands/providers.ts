import type { Command } from "commander";
import {
  getAvailableProviders,
  syncAll,
  autoDetectRegistrar,
  getRegistrarProvider,
  getDomainInventoryProvider,
  getProviderInfo,
  providerHasRegistrar,
  providerHasInventory,
} from "../../lib/registrar.js";
import { loadConfig } from "../../lib/config.js";
import { printLine, printErrorLine } from "../../lib/stdout.js";
import {
  createDomain,
  updateDomain,
  getDomainByName,
} from "../../db/domains.js";

function registrarProviderNames(): string {
  return getAvailableProviders()
    .filter((p) => providerHasRegistrar(p.name))
    .map((p) => p.name)
    .join(", ");
}

function inventoryProviderNames(): string {
  return getAvailableProviders()
    .filter((p) => providerHasInventory(p.name))
    .map((p) => p.name)
    .join(", ");
}

function requireInventoryProvider(name: string): void {
  const info = getProviderInfo(name);
  if (!info) {
    throw new Error(`Unknown provider: ${name}. Supported domain inventory providers: ${inventoryProviderNames()}`);
  }
  if (!providerHasInventory(name)) {
    throw new Error(`${name} is a ${info.type} provider without domain inventory sync. Supported domain inventory providers: ${inventoryProviderNames()}`);
  }
}

function requireRegistrarProvider(name: string): void {
  const info = getProviderInfo(name);
  if (!info) {
    throw new Error(`Unknown provider: ${name}. Supported registrars: ${registrarProviderNames()}`);
  }
  if (!providerHasRegistrar(name)) {
    throw new Error(`${name} is a ${info.type} provider, not a registrar. Supported registrars: ${registrarProviderNames()}`);
  }
}

export function registerProviderCommands(program: Command): void {
  program
    .command("providers")
    .description("Show which providers are configured")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const providers = getAvailableProviders();

      if (opts.json) {
        printLine(JSON.stringify(providers, null, 2));
      } else {
        printLine("Providers:");
        for (const p of providers) {
          const status = p.configured ? "CONFIGURED" : "not configured";
          const capabilities = [p.type, p.inventory ? "inventory" : null].filter(Boolean).join(", ");
          printLine(`  ${p.name} [${capabilities}]: ${status}`);
          if (!p.configured) {
            printLine(`    Accepted env: ${p.envVars.join(", ")}`);
          }
        }
      }
    });

  program
    .command("sync")
    .description("Sync domains from a domain inventory provider to local DB")
    .option("--provider <provider>", "Provider name")
    .option("--all", "Sync from all configured domain inventory providers")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      if (opts.all) {
        try {
          const result = await syncAll({
            getDomainByName,
            createDomain,
            updateDomain,
          });

          if (opts.json) {
            printLine(JSON.stringify(result, null, 2));
          } else {
            printLine(`Synced ${result.totalSynced} domain(s) from ${result.providers.length} provider(s)`);
            for (const p of result.providers) {
              printLine(`  ${p.name}: ${p.result.synced} synced (${p.result.created} new, ${p.result.updated} updated)`);
            }
            if (result.totalErrors.length > 0) {
              printLine("Errors:");
              for (const e of result.totalErrors) {
                printLine(`  - ${e}`);
              }
            }
          }
        } catch (error: unknown) {
          printErrorLine(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
        return;
      }

      const provider = (opts.provider || "").toLowerCase();
      if (!provider) {
        printErrorLine("Specify --provider <name> or --all");
        process.exit(1);
      }

      try {
        requireInventoryProvider(provider);
        const result = await getDomainInventoryProvider(provider).syncToLocalDb({
          getDomainByName,
          createDomain,
          updateDomain,
        });

        if (opts.json) {
          printLine(JSON.stringify({ provider, ...result }, null, 2));
        } else {
          printLine(`Synced ${result.synced} domain(s) from ${provider} (${result.created} new, ${result.updated} updated)`);
          if (result.errors.length > 0) {
            printLine("Errors:");
            for (const e of result.errors) printLine(`  - ${e}`);
          }
        }
      } catch (error: unknown) {
        printErrorLine(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("renew")
    .description("Renew a domain via provider (auto-detects registrar from DB if --provider not given)")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--provider <provider>", "Provider name")
    .option("--years <n>", "Number of years to renew", "1")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      let provider = (opts.provider || "").toLowerCase();

      if (!provider) {
        const detected = autoDetectRegistrar(name, getDomainByName);
        if (!detected) {
          printErrorLine(`Could not auto-detect registrar for '${name}'. Use --provider.`);
          process.exit(1);
        }
        provider = detected;
        if (!opts.json) printLine(`Auto-detected registrar: ${provider}`);
      }

      try {
        requireRegistrarProvider(provider);
        const result = await getRegistrarProvider(provider).renewDomain(name, parseInt(opts.years, 10));
        if (!result.success) {
          throw new Error(`Renewal failed or is not supported for ${provider}`);
        }

        if (opts.json) {
          printLine(JSON.stringify({ provider, ...result }, null, 2));
        } else {
          printLine(`Renewed ${result.domain} successfully via ${provider}`);
          if (result.chargedAmount) printLine(`  Charged: $${result.chargedAmount}`);
          if (result.orderId) printLine(`  Order ID: ${result.orderId}`);
        }
      } catch (error: unknown) {
        printErrorLine(`Renewal failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("check")
    .description("Check domain availability via a registrar provider")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--provider <name>", "Registrar provider — defaults to config default-registrar, else route53")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts: { provider?: string; json?: boolean }) => {
      try {
        const providerName = (opts.provider ?? loadConfig().default_registrar ?? "route53").toLowerCase();
        requireRegistrarProvider(providerName);
        const result = await getRegistrarProvider(providerName).checkAvailability(name);

        if (opts.json) {
          printLine(JSON.stringify({ provider: providerName, ...result }, null, 2));
        } else {
          printLine(`${result.domain} is ${result.available ? "AVAILABLE" : "NOT available"} (via ${providerName})`);
          if (result.is_premium) printLine(`  Premium ask: ${result.premium_price ?? "unknown"}`);
          if (result.standard_price !== undefined) {
            const currency = result.currency ? ` ${result.currency}` : "";
            printLine(`  Standard price: ${result.standard_price}${currency}`);
          }
        }
      } catch (error: unknown) {
        printErrorLine(`Availability check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
