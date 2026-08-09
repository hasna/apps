import type { Command } from "commander";
import { getAvailableProviders, getDnsProvider, getRegistrarProvider } from "../../lib/registrar.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
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
        printLine(JSON.stringify(providers, null, 2));
        return;
      }
      printLine("\nRegistrar / DNS Providers:");
      for (const p of providers) {
        const status = p.configured ? "✓ configured" : "✗ not configured";
        const type = p.type === "full" ? "registrar + dns" : p.type;
        const capabilities = [type, p.inventory ? "inventory" : null].filter(Boolean).join(", ");
        printLine(`  ${p.name.padEnd(12)} [${capabilities}]  ${status}`);
        if (!p.configured) {
          printLine(`    Missing: ${p.envVars.join(", ")}`);
        }
      }
      printLine();
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
          printLine(JSON.stringify({ provider: providerName, ok: false, error }, null, 2));
        } else {
          printErrorLine(error);
        }
        process.exit(1);
      }

      if (!info.configured) {
        const error = `${providerName} is not configured. Set: ${info.envVars.join(", ")}`;
        if (opts.json) {
          printLine(
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
          printErrorLine(`✗ ${error}`);
        }
        process.exit(1);
      }

      if (!opts.json) {
        printLine(`Testing ${providerName}...`);
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
              if (!opts.json) printLine("✓ Registrar connection OK");
            } catch (error) {
              if (!isAwsAccessDenied(error)) throw error;
              registrarOk = false;
              notes.push("route53domains-listdomains-access-denied");
              if (!opts.json) printLine("• Route53 Domains registrar API is not available for these AWS credentials");
            }
          } else {
            const reg = getRegistrarProvider(providerName);
            await reg.listDomains();
            registrarOk = true;
            if (!opts.json) printLine("✓ Registrar connection OK");
          }
        }

        if (info.type === "dns" || info.type === "full") {
          if (providerName === "brandsight" && registrarOk) {
            dnsOk = null;
            notes.push("dns-not-probed-with-synthetic-invalid-domain");
            if (!opts.json) printLine("• DNS not probed with synthetic invalid domain");
          } else {
            const dns = getDnsProvider(providerName);
            await dns.getDnsRecords("__test_nonexistent_domain__.invalid");
            dnsOk = true;
            if (!opts.json) printLine("✓ DNS connection OK");
          }
        }

        if (info.type === "marketplace") {
          if (providerName !== "sedo") throw new Error("No marketplace tester for provider: " + providerName);
          const { listSedoPortfolio } = await import("../../lib/sedo.js");
          await listSedoPortfolio({ limit: 1 });
          marketplaceOk = true;
          if (!opts.json) printLine("✓ Marketplace connection OK");
        }

        if (opts.json) {
          printLine(
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
            printLine(
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
            printLine("✓ Connection OK (no domains yet)");
          }
          return;
        }

        if (opts.json) {
          printLine(
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
          printErrorLine(`✗ ${providerName} test failed: ${msg}`);
        }
        process.exit(1);
      }
    });
}
