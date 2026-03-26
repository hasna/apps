import type { Command } from "commander";
import {
  syncToLocalDb,
  renewDomain as namecheapRenew,
  checkAvailability as namecheapCheck,
} from "../../lib/namecheap.js";
import {
  syncToLocalDb as godaddySyncToLocalDb,
  renewDomain as godaddyRenewDomain,
} from "../../lib/godaddy.js";
import {
  getAvailableProviders,
  syncAll,
  autoDetectRegistrar,
} from "../../lib/registrar.js";
import {
  createDomain,
  updateDomain,
  getDomainByName,
} from "../../db/domains.js";

export function registerProviderCommands(program: Command): void {
  program
    .command("providers")
    .description("Show which registrar providers are configured")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const providers = getAvailableProviders();

      if (opts.json) {
        console.log(JSON.stringify(providers, null, 2));
      } else {
        console.log("Registrar Providers:");
        for (const p of providers) {
          const status = p.configured ? "CONFIGURED" : "not configured";
          console.log(`  ${p.name}: ${status}`);
          if (!p.configured) {
            console.log(`    Missing: ${p.envVars.join(", ")}`);
          }
        }
      }
    });

  program
    .command("sync")
    .description("Sync domains from a provider to local DB")
    .option("--provider <provider>", "Provider name (namecheap, godaddy)")
    .option("--all", "Sync from all configured providers")
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
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Synced ${result.totalSynced} domain(s) from ${result.providers.length} provider(s)`);
            for (const p of result.providers) {
              console.log(`  ${p.name}: ${p.result.synced} synced`);
            }
            if (result.totalErrors.length > 0) {
              console.log("Errors:");
              for (const e of result.totalErrors) {
                console.log(`  - ${e}`);
              }
            }
          }
        } catch (error: unknown) {
          console.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
        return;
      }

      const provider = (opts.provider || "").toLowerCase();
      if (!provider) {
        console.error("Specify --provider <name> or --all");
        process.exit(1);
      }

      if (provider === "namecheap") {
        try {
          const result = await syncToLocalDb({
            getDomainByName,
            createDomain,
            updateDomain,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Synced ${result.synced} domain(s) from Namecheap`);
            for (const d of result.domains) {
              console.log(`  ${d}`);
            }
            if (result.errors.length > 0) {
              console.log("Errors:");
              for (const e of result.errors) {
                console.log(`  - ${e}`);
              }
            }
          }
        } catch (error: unknown) {
          console.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      } else if (provider === "godaddy") {
        try {
          const result = await godaddySyncToLocalDb({
            getDomainByName,
            createDomain,
            updateDomain,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Synced ${result.synced} domain(s) from GoDaddy (created: ${result.created}, updated: ${result.updated})`);
            if (result.errors.length > 0) {
              console.log("Errors:");
              for (const e of result.errors) {
                console.log(`  - ${e}`);
              }
            }
          }
        } catch (error: unknown) {
          console.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      } else {
        console.error(`Unsupported provider: ${provider}. Supported: namecheap, godaddy`);
        process.exit(1);
      }
    });

  program
    .command("renew")
    .description("Renew a domain via provider (auto-detects registrar from DB if --provider not given)")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--provider <provider>", "Provider name (namecheap, godaddy)")
    .option("--years <n>", "Number of years to renew", "1")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      let provider = (opts.provider || "").toLowerCase();

      if (!provider) {
        const detected = autoDetectRegistrar(name, getDomainByName);
        if (!detected) {
          console.error(`Could not auto-detect registrar for '${name}'. Use --provider.`);
          process.exit(1);
        }
        provider = detected;
        console.log(`Auto-detected registrar: ${provider}`);
      }

      if (provider === "namecheap") {
        try {
          const result = await namecheapRenew(name, parseInt(opts.years));
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Renewed ${result.domain} successfully via Namecheap`);
            if (result.chargedAmount) console.log(`  Charged: $${result.chargedAmount}`);
            if (result.orderId) console.log(`  Order ID: ${result.orderId}`);
          }
        } catch (error: unknown) {
          console.error(`Renewal failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      } else if (provider === "godaddy") {
        try {
          const result = await godaddyRenewDomain(name);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Renewed ${name} successfully via GoDaddy`);
            if (result.orderId) console.log(`  Order ID: ${result.orderId}`);
            if (result.total) console.log(`  Total: $${(result.total / 100).toFixed(2)}`);
          }
        } catch (error: unknown) {
          console.error(`Renewal failed: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      } else {
        console.error(`Unsupported provider: ${provider}. Supported: namecheap, godaddy`);
        process.exit(1);
      }
    });

  program
    .command("check")
    .description("Check domain availability")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      try {
        const result = await namecheapCheck(name);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.available) {
            console.log(`${result.domain} is AVAILABLE`);
          } else {
            console.log(`${result.domain} is NOT available`);
          }
        }
      } catch (error: unknown) {
        console.error(`Availability check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
