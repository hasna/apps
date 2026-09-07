import type { Command } from "commander";
import { getAvailableProviders, getRegistrarProvider, getDnsProvider } from "../../lib/registrar.js";
import { loadConfig } from "../../lib/config.js";
import { countDomains } from "../../db/domains.js";
import { execSync } from "node:child_process";

import { printLine } from "../../lib/stdout.js";
export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run diagnostics — check credentials, DB, and provider connectivity")
    .option("--json", "Output structured JSON")
    .action(async (opts: { json?: boolean }) => {
      let passed = 0;
      let failed = 0;
      const checks: { section: string; status: "pass" | "fail"; message: string; fix?: string }[] = [];
      let currentSection = "general";

      function section(name: string): void {
        currentSection = name;
        if (!opts.json) {
          printLine(`\n── ${name} ─────────────────────────────────`);
        }
      }

      function ok(msg: string) {
        checks.push({ section: currentSection, status: "pass", message: msg });
        if (!opts.json) printLine(`  ✓ ${msg}`);
        passed++;
      }

      function fail(msg: string, fix?: string) {
        checks.push({ section: currentSection, status: "fail", message: msg, fix });
        if (!opts.json) {
          printLine(`  ✗ ${msg}`);
          if (fix) printLine(`    → ${fix}`);
        }
        failed++;
      }

      // Named FIRST, before anything reads data: the store that gets resolved
      // decides what every other check below is talking about. Until this
      // existed, a command could read or write the production portfolio with
      // no surface anywhere saying so — which is how 230 rows reached it on
      // 2026-08-07 while the operator believed a local path was in effect.
      // Reports the transport, the variable NAMES that drove it, and the
      // credential tier; never a credential value, and never a URL.
      section("Store");
      try {
        const { getStoreResolution } = await import("../../db/store.js");
        const resolution = getStoreResolution(process.env);
        if (resolution.transport === "local") {
          ok(`Resolved store: local sqlite${resolution.localPathVar ? ` (opted in via ${resolution.localPathVar})` : ""}`);
        } else {
          ok(`Resolved store: http — reads and writes go to the REMOTE portfolio`);
          if (resolution.apiUrlSource) ok(`API URL from ${resolution.apiUrlSource}`);
          if (resolution.apiKeySource) ok(`API key from ${resolution.apiKeySource} (tier: ${resolution.apiKeyTier})`);
        }
      } catch (error) {
        fail(
          `Store not resolvable: ${error instanceof Error ? error.message.split(". ")[0] : String(error)}`,
          "Set a hosted credential (HASNA_DOMAINS_API_KEY, or the Keychain item / credential file), or opt into the local store with a local path variable",
        );
      }

      section("Database");
      try {
        const count = await countDomains();
        ok(`Local DB accessible (${count} domain${count !== 1 ? "s" : ""})`);
      } catch {
        fail("Local DB not accessible", "Check DOMAINS_DB_PATH, DOMAINS_DIR, or the default local data directory");
      }

      section("Config");
      const cfg = loadConfig();
      if (cfg.default_registrar) ok(`default-registrar: ${cfg.default_registrar}`);
      else fail("No default registrar set", "domains config set default-registrar route53");
      if (cfg.default_dns) ok(`default-dns: ${cfg.default_dns}`);
      else fail("No default DNS provider set", "domains config set default-dns cloudflare");

      const contactFields = ["first_name", "last_name", "email", "phone", "address_line_1", "city", "state", "country_code", "zip_code"] as const;
      const missingContact = contactFields.filter((f) => !cfg.contact?.[f]);
      if (missingContact.length === 0) ok("Registrant contact info complete");
      else fail(`Missing contact fields: ${missingContact.join(", ")}`, "domains config set contact.<field> <value>");

      section("Provisioning Credentials");
      const { checkProvisioningCredentials } = await import("../../lib/creds-check.js");
      for (const c of checkProvisioningCredentials()) {
        if (c.configured) ok(`${c.provider}: ${c.mode} — ${c.detail}`);
        else fail(`${c.provider}: not configured (${c.detail})`);
      }

      section("Providers");
      const providers = getAvailableProviders().filter((p) => p.type !== "marketplace");
      for (const p of providers) {
        if (!p.configured) {
          fail(`${p.name}: not configured`, `Set: ${p.envVars.join(", ")}`);
          continue;
        }
        try {
          if (p.type === "registrar" || p.type === "full") {
            const reg = getRegistrarProvider(p.name);
            await reg.listDomains();
          } else {
            const dns = getDnsProvider(p.name);
            await dns.getDnsRecords("__test__.invalid");
          }
          ok(`${p.name}: connected`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("not found") || msg.includes("No hosted zone") || msg.includes("No Cloudflare zone")) {
            ok(`${p.name}: connected (no domains yet)`);
          } else {
            fail(`${p.name}: ${msg}`);
          }
        }
      }

      section("Tools");
      try {
        execSync("whois --version 2>/dev/null || whois example.com 2>/dev/null", { timeout: 3000 });
        ok("whois binary found");
      } catch {
        fail("whois not installed", "apt install whois  /  brew install whois");
      }

      if (opts.json) {
        printLine(
          JSON.stringify(
            {
              passed,
              failed,
              healthy: failed === 0,
              checks,
            },
            null,
            2
          )
        );
      } else {
        printLine(`\n${"─".repeat(45)}`);
        printLine(`  ${passed} passed  /  ${failed} failed\n`);
      }

      if (failed > 0) process.exit(1);
    });
}
