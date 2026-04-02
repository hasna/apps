import type { Command } from "commander";
import { getAvailableProviders, getDnsProvider, getRegistrarProvider } from "../../lib/registrar.js";

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
    .option("-j, --json", "Output JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const providers = getAvailableProviders();
      const info = providers.find((p) => p.name === name);

      if (!info) {
        const error = `Unknown provider: ${name}`;
        if (opts.json) {
          console.log(JSON.stringify({ provider: name, ok: false, error }, null, 2));
        } else {
          console.error(error);
        }
        process.exit(1);
      }

      if (!info.configured) {
        const error = `${name} is not configured. Set: ${info.envVars.join(", ")}`;
        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                provider: name,
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
        console.log(`Testing ${name}...`);
      }

      let registrarOk: boolean | null = null;
      let dnsOk: boolean | null = null;

      try {
        if (info.type === "registrar" || info.type === "full") {
          const reg = getRegistrarProvider(name);
          await reg.listDomains();
          registrarOk = true;
          if (!opts.json) console.log("✓ Registrar connection OK");
        }

        if (info.type === "dns" || info.type === "full") {
          const dns = getDnsProvider(name);
          await dns.getDnsRecords("__test_nonexistent_domain__.invalid");
          dnsOk = true;
          if (!opts.json) console.log("✓ DNS connection OK");
        }

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                provider: name,
                ok: true,
                configured: true,
                type: info.type,
                registrar_ok: registrarOk,
                dns_ok: dnsOk,
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
                  provider: name,
                  ok: true,
                  configured: true,
                  type: info.type,
                  registrar_ok: registrarOk,
                  dns_ok: true,
                  note: "connection-ok-no-domains-yet",
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
                provider: name,
                ok: false,
                configured: true,
                type: info.type,
                registrar_ok: registrarOk,
                dns_ok: dnsOk,
                error: msg,
              },
              null,
              2
            )
          );
        } else {
          console.error(`✗ ${name} test failed: ${msg}`);
        }
        process.exit(1);
      }
    });
}
