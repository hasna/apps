import type { Command } from "commander";
import { getAvailableProviders, getRegistrarProvider, getDnsProvider } from "../../lib/registrar.js";
import { loadConfig } from "../../lib/config.js";
import { countDomains } from "../../db/domains.js";
import { execSync } from "node:child_process";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run diagnostics — check credentials, DB, and provider connectivity")
    .action(async () => {
      let passed = 0;
      let failed = 0;

      function ok(msg: string) { console.log(`  ✓ ${msg}`); passed++; }
      function fail(msg: string, fix?: string) {
        console.log(`  ✗ ${msg}`);
        if (fix) console.log(`    → ${fix}`);
        failed++;
      }

      console.log("\n── Database ─────────────────────────────────");
      try {
        const count = countDomains();
        ok(`Local DB accessible (${count} domain${count !== 1 ? "s" : ""})`);
      } catch (e) {
        fail("Local DB not accessible", `Check ~/.hasna/domains/domains.db`);
      }

      console.log("\n── Config ───────────────────────────────────");
      const cfg = loadConfig();
      if (cfg.default_registrar) ok(`default-registrar: ${cfg.default_registrar}`);
      else fail("No default registrar set", "domains config set default-registrar route53");
      if (cfg.default_dns) ok(`default-dns: ${cfg.default_dns}`);
      else fail("No default DNS provider set", "domains config set default-dns cloudflare");

      const contactFields = ["first_name","last_name","email","phone","address_line_1","city","state","country_code","zip_code"] as const;
      const missingContact = contactFields.filter((f) => !cfg.contact?.[f]);
      if (missingContact.length === 0) ok("Registrant contact info complete");
      else fail(`Missing contact fields: ${missingContact.join(", ")}`, "domains config set contact.<field> <value>");

      console.log("\n── Providers ────────────────────────────────");
      const providers = getAvailableProviders().filter((p) => p.name !== "brandsight");
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

      console.log("\n── Tools ────────────────────────────────────");
      try { execSync("whois --version 2>/dev/null || whois example.com 2>/dev/null", { timeout: 3000 }); ok("whois binary found"); }
      catch { fail("whois not installed", "apt install whois  /  brew install whois"); }

      console.log(`\n${"─".repeat(45)}`);
      console.log(`  ${passed} passed  /  ${failed} failed\n`);
      if (failed > 0) process.exit(1);
    });
}
