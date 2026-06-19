import type { Command } from "commander";
import { getAvailableProviders, getDnsProvider, getRegistrarProvider } from "../../lib/registrar.js";

function isAwsAccessDenied(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("AccessDenied") || msg.includes("route53domains:ListDomains");
}

export function registerProviderCommand(program: Command): void {
  const provider = program.command("provider").description("Configure and test registrar/DNS providers");

  provider
    .command("list")
    .description("Show all providers and their configuration status")
    .option("-j, --json", "Output JSON")
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
        const capabilities = [type, p.inventory ? "inventory" : null].filter(Boolean).join(", ");
        console.log(`  ${p.name.padEnd(12)} [${capabilities}]  ${status}`);
        if (!p.configured) {
          console.log(`    Missing: ${p.envVars.join(", ")}`);
        }
      }
      console.log();
    });

  provider
    .command("test <name>")
    .description("Live-test a provider's credentials")
    .option("-j, --json", "Output JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const providerName = name.toLowerCase();
      const providers = getAvailableProviders();
      const info = providers.find((p) => p.name === providerName);

      if (!info) {
        const error = `Unknown provider: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ provider: providerName, ok: false, error }, null, 2));
        } else {
          console.error(error);
        }
        process.exit(1);
      }

      if (!info.configured) {
        const error = `${providerName} is not configured. Set: ${info.envVars.join(", ")}`;
        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                provider: providerName,
                ok: false,
                configured: false,
                required_env: info.envVars,
                error,
              },
              null,
              2
            )
          );
        } else {
          console.error(`✗ ${error}`);
        }
        process.exit(1);
      }

      if (!opts.json) {
        console.log(`Testing ${providerName}...`);
      }

      let registrarOk: boolean | null = null;
      let dnsOk: boolean | null = null;
      let marketplaceOk: boolean | null = null;
      const notes: string[] = [];

      try {
        if (info.type === "registrar" || info.type === "full") {
          if (providerName === "route53") {
            try {
              const { listRegisteredDomains } = await import("../../lib/route53.js");
              await listRegisteredDomains();
              registrarOk = true;
              if (!opts.json) console.log("✓ Registrar connection OK");
            } catch (error) {
              if (!isAwsAccessDenied(error)) throw error;
              registrarOk = false;
              notes.push("route53domains-listdomains-access-denied");
              if (!opts.json) console.log("• Route53 Domains registrar API is not available for these AWS credentials");
            }
          } else {
            const reg = getRegistrarProvider(providerName);
            await reg.listDomains();
            registrarOk = true;
            if (!opts.json) console.log("✓ Registrar connection OK");
          }
        }

        if (info.type === "dns" || info.type === "full") {
          if (providerName === "brandsight" && registrarOk) {
            dnsOk = null;
            notes.push("dns-not-probed-with-synthetic-invalid-domain");
            if (!opts.json) console.log("• DNS not probed with synthetic invalid domain");
          } else {
            const dns = getDnsProvider(providerName);
            await dns.getDnsRecords("__test_nonexistent_domain__.invalid");
            dnsOk = true;
            if (!opts.json) console.log("✓ DNS connection OK");
          }
        }

        if (info.type === "marketplace") {
          if (providerName !== "sedo") throw new Error("No marketplace tester for provider: " + providerName);
          const { listSedoPortfolio } = await import("../../lib/sedo.js");
          await listSedoPortfolio({ limit: 1 });
          marketplaceOk = true;
          if (!opts.json) console.log("✓ Marketplace connection OK");
        }

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                provider: providerName,
                ok: true,
                configured: true,
                type: info.type,
                registrar_ok: registrarOk,
                dns_ok: dnsOk,
                marketplace_ok: marketplaceOk,
                ...(notes.length > 0 ? { notes } : {}),
              },
              null,
              2
            )
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Empty result is still a valid connection
        if (msg.includes("not found") || msg.includes("No hosted zone") || msg.includes("NXDOMAIN")) {
          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  provider: providerName,
                  ok: true,
                  configured: true,
                  type: info.type,
                  registrar_ok: registrarOk,
                  dns_ok: true,
                  marketplace_ok: marketplaceOk,
                  note: "connection-ok-no-domains-yet",
                  ...(notes.length > 0 ? { notes } : {}),
                },
                null,
                2
              )
            );
          } else {
            console.log("✓ Connection OK (no domains yet)");
          }
          return;
        }

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                provider: providerName,
                ok: false,
                configured: true,
                type: info.type,
                registrar_ok: registrarOk,
                dns_ok: dnsOk,
                marketplace_ok: marketplaceOk,
                error: msg,
              },
              null,
              2
            )
          );
        } else {
          console.error(`✗ ${providerName} test failed: ${msg}`);
        }
        process.exit(1);
      }
    });
}
