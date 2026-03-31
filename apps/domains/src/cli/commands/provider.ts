import type { Command } from "commander";
import { getAvailableProviders, getDnsProvider, getRegistrarProvider } from "../../lib/registrar.js";

export function registerProviderCommand(program: Command): void {
  const provider = program.command("provider").description("Configure and test registrar/DNS providers");

  provider
    .command("list")
    .description("Show all providers and their configuration status")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const providers = getAvailableProviders();
      if (opts.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }
      console.log("\nRegistrar / DNS Providers:");
      for (const p of providers) {
        const status = p.configured ? "✓ configured" : "✗ not configured";
        const type = p.type === "full" ? "registrar + dns" : p.type;
        console.log(`  ${p.name.padEnd(12)} [${type}]  ${status}`);
        if (!p.configured) {
          console.log(`    Missing: ${p.envVars.join(", ")}`);
        }
      }
      console.log();
    });

  provider
    .command("test <name>")
    .description("Live-test a provider's credentials")
    .action(async (name: string) => {
      const providers = getAvailableProviders();
      const info = providers.find((p) => p.name === name);
      if (!info) {
        console.error(`Unknown provider: ${name}`);
        process.exit(1);
      }
      if (!info.configured) {
        console.error(`✗ ${name} is not configured. Set: ${info.envVars.join(", ")}`);
        process.exit(1);
      }
      console.log(`Testing ${name}...`);
      try {
        if (info.type === "registrar" || info.type === "full") {
          const reg = getRegistrarProvider(name);
          await reg.listDomains();
          console.log(`✓ Registrar connection OK`);
        }
        if (info.type === "dns" || info.type === "full") {
          const dns = getDnsProvider(name);
          await dns.getDnsRecords("__test_nonexistent_domain__.invalid");
          console.log(`✓ DNS connection OK`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Empty result is still a valid connection
        if (msg.includes("not found") || msg.includes("No hosted zone") || msg.includes("NXDOMAIN")) {
          console.log(`✓ Connection OK (no domains yet)`);
        } else {
          console.error(`✗ ${name} test failed: ${msg}`);
          process.exit(1);
        }
      }
    });
}
