import type { Command } from "commander";
import { loadConfig, saveConfig, setConfigKey } from "../../lib/config.js";

const VALID_KEYS = [
  "default-registrar",
  "default-dns",
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
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }
      console.log("\nConfiguration (~/.hasna/domains/config.json):");
      console.log(`  default-registrar: ${cfg.default_registrar ?? "(not set)"}`);
      console.log(`  default-dns:       ${cfg.default_dns ?? "(not set)"}`);
      if (cfg.contact && Object.keys(cfg.contact).length > 0) {
        console.log("\n  contact:");
        for (const [k, v] of Object.entries(cfg.contact)) {
          if (v) console.log(`    ${k}: ${v}`);
        }
      } else {
        console.log("  contact:           (not set)");
      }
      console.log();
    });

  config
    .command("set <key> <value>")
    .description(`Set a config value. Keys: ${VALID_KEYS.join(", ")}`)
    .action((key: string, value: string) => {
      // Normalize key (accept both formats: contact.first-name or contact.first_name)
      const normalized = key.replace(/-/g, "_");
      try {
        setConfigKey(normalized, value);
        console.log(`✓ Set ${key} = ${value}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
      console.log(`✓ Unset ${key}`);
    });
}
