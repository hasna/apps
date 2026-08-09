import type { Command } from "commander";
import { loadConfig, saveConfig, setConfigKey } from "../../lib/config.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
const VALID_KEYS = [
  "default-registrar",
  "default-dns",
  "purchase-aws-profile",
  "contact.first-name",
  "contact.last-name",
  "contact.email",
  "contact.phone",
  "contact.address",
  "contact.city",
  "contact.state",
  "contact.country",
  "contact.zip",
  "contact.org",
];

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("View and set configuration");

  config
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const cfg = loadConfig();
      if (opts.json) {
        printLine(JSON.stringify(cfg, null, 2));
        return;
      }
      printLine("\nConfiguration:");
      printLine(`  default-registrar:    ${cfg.default_registrar ?? "(not set)"}`);
      printLine(`  default-dns:          ${cfg.default_dns ?? "(not set)"}`);
      printLine(`  purchase-aws-profile: ${cfg.purchase_aws_profile ?? "(not set)"}`);
      if (cfg.contact && Object.keys(cfg.contact).length > 0) {
        printLine("\n  contact:");
        for (const [k, v] of Object.entries(cfg.contact)) {
          if (v) printLine(`    ${k}: ${v}`);
        }
      } else {
        printLine("  contact:           (not set)");
      }
      printLine();
    });

  config
    .command("set <key> <value>")
    .description(`Set a config value. Keys: ${VALID_KEYS.join(", ")}`)
    .action((key: string, value: string) => {
      // Normalize key (accept both formats: contact.first-name or contact.first_name)
      const normalized = key.replace(/-/g, "_");
      try {
        setConfigKey(normalized, value);
        printLine(`✓ Set ${key} = ${value}`);
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  config
    .command("unset <key>")
    .description("Remove a config value")
    .action((key: string) => {
      const normalized = key.replace(/-/g, "_");
      const cfg = loadConfig();
      const parts = normalized.split(".");
      if (parts.length === 1) {
        delete (cfg as Record<string, unknown>)[parts[0]!];
      } else if (parts.length === 2 && parts[0] === "contact" && cfg.contact) {
        delete (cfg.contact as Record<string, unknown>)[parts[1]!];
      }
      saveConfig(cfg);
      printLine(`✓ Unset ${key}`);
    });
}
