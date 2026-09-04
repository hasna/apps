import { Command } from "commander";
import { getConfig, setConfig, parseExpiryStrict, CONFIG_PATH } from "../../core/config";
import { resolveStore } from "../../core/store";

export function configCommand(): Command {
  const cmd = new Command("config").description("Manage non-authoritative client preferences");
  cmd.command("show").action(() => {
    process.stdout.write(JSON.stringify({ path: CONFIG_PATH, defaults: getConfig().defaults }, null, 2) + "\n");
  });
  cmd.command("set").option("--expiry <duration>").option("--link-type <type>").action((options) => {
    if (options.expiry) parseExpiryStrict(options.expiry);
    if (options.linkType && !["presigned", "server"].includes(options.linkType)) throw new Error("Invalid link type");
    setConfig({ defaults: { ...(options.expiry ? { expiry: options.expiry } : {}), ...(options.linkType ? { linkType: options.linkType } : {}) } });
  });
  cmd.command("test").action(async () => {
    const store = resolveStore();
    await store.list({ limit: 1 });
    process.stdout.write("Authenticated HTTPS service reachable\n");
  });
  return cmd;
}
