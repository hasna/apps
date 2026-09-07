import type { Command } from "commander";
import { resolve } from "node:path";
import { setupPreviews, registerPreviewStation } from "./cloudflare.js";
import { runPreviewStation } from "./daemon.js";
import { doctorPreview, downPreviews, listPreviews, previewOAuth, previewStatus, upPreviews } from "./service.js";

export function registerPreviewCommands(program: Command): void {
  const preview = program.command("preview").description("Stable workers.dev previews for products, apps and workstations");
  const output = async (work: () => unknown) => {
    try {
      if (program.opts().db) process.env.SERVERS_DB_PATH = resolve(program.opts().db);
      console.log(JSON.stringify(await work(), null, 2));
    }
    catch (error) { console.error(error instanceof Error ? error.message : "Preview command failed"); process.exitCode = 1; }
  };
  const selection = (command: Command) => command.option("--environment <name>", "Declared development environment", "dev").option("--name <name>", "Concurrent preview name", "main");
  preview.command("setup").description("Provision shared Cloudflare router with required Access protection")
    .option("--provider <provider>", "Preview provider", "cloudflare")
    .option("--account-id <id>", "Cloudflare account ID (or CLOUDFLARE_ACCOUNT_ID)")
    .option("--subdomain <name>", "Existing account workers.dev subdomain")
    .option("--router-name <name>", "Shared router Worker name")
    .option("--access-team <url>", "https://TEAM.cloudflareaccess.com")
    .option("--access-email <email...>", "Email addresses permitted to access previews")
    .option("--dry-run", "Show setup plan without creating resources")
    .action((options) => output(() => {
      if (options.provider !== "cloudflare") throw new Error("This release supports --provider cloudflare");
      return setupPreviews({ ...options, accessTeamDomain: options.accessTeam, accessEmails: options.accessEmail });
    }));
  const station = preview.command("station").description("Manage this workstation's single preview tunnel and gateway");
  station.command("register").option("--name <name>", "Workstation name").option("--gateway-port <port>", "Loopback gateway port", Number).option("--dry-run", "Show station enrollment plan").action((options) => output(() => registerPreviewStation(options)));
  station.command("start").description("Run gateway and cloudflared in the foreground; up starts it automatically").action(() => output(() => runPreviewStation()));
  selection(preview.command("up").argument("[app]", "Explicit product/app"))
    .option("--product <product>", "Start all apps in this product manifest")
    .option("--manifest <path>", "servers.config.json or repository directory")
    .option("--port <port>", "Explicit local port for one app", Number)
    .option("--takeover", "Move the preview from its current workstation after readiness")
    .option("--dry-run", "Show app preview plan without changes")
    .action((app, options) => output(() => upPreviews({ ...options, app })));
  preview.command("list").option("--product <product>", "Filter by product").action((options) => output(() => listPreviews(options.product)));
  selection(preview.command("status").argument("<app>", "Explicit product/app")).action((app, options) => output(() => previewStatus({ ...options, app })));
  selection(preview.command("down").argument("[app]", "Explicit product/app"))
    .option("--product <product>", "Release this station's previews for a product")
    .option("--stop", "Also stop the managed local app process")
    .action((app, options) => output(() => downPreviews({ ...options, app })));
  selection(preview.command("doctor").argument("[app]", "Optional product/app")).action((app, options) => output(() => doctorPreview({ ...options, app })));
  selection(preview.command("oauth").argument("[app]", "Explicit product/app"))
    .option("--product <product>", "Print OAuth guidance for the product")
    .option("--manifest <path>", "servers.config.json or repository directory")
    .action((app, options) => output(() => previewOAuth({ ...options, app })));
}
