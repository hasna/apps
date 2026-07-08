#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveStore, type Store } from "../client-store.js";
import type { TotalStats } from "../store-interface.js";
import { getConfigPath, getDataDir, getDatabasePath, loadConfig, saveConfig, updateConfig } from "../config.js";
import { serveShortlinks } from "../server.js";
import { createCloudflarePlan, writeWorkerFiles, upsertCloudflareDnsRecord } from "../cloudflare.js";
import { runDomains } from "../domains-cli.js";
import { createLocalSetupPlan, registerMachinesDns } from "../local.js";
import type { Link, LinkStats } from "../types.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

function useJson(localOpts?: { json?: boolean }): boolean {
  return Boolean(localOpts?.json || program.opts().json);
}

function print(data: unknown, localOpts?: { json?: boolean }, human?: () => void): void {
  if (useJson(localOpts)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (human) human();
}

function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (useJson()) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(chalk.red(message));
  }
  process.exit(1);
}

/**
 * Run `fn` with the resolved client {@link Store}. The store is the cloud
 * ApiStore when the client flip is on (HASNA_SHORTLINKS_API_URL + _API_KEY /
 * _STORAGE_MODE), otherwise the on-box LocalStore. There is no DSN/postgres
 * client path: a client never touches the raw RDS.
 */
async function withRuntimeStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const store = resolveStore(process.env, { dbPath: program.opts().db });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

function formatLink(link: Link): string {
  return `${chalk.green(link.short_url || `${link.hostname}/${link.slug}`)} ${chalk.dim("->")} ${link.destination_url}`;
}

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf-8" });
  return result.status === 0;
}

program
  .name("shortlinks")
  .description("Shortlink manager with custom domains, click tracking, and Cloudflare helpers — local SQLite or self-hosted cloud /v1 API storage")
  .version(getPackageVersion())
  .option("--db <path>", "SQLite database path (local mode only)")
  .option("-j, --json", "Output JSON for agents and scripts");

program
  .command("init")
  .description("Initialize local shortlinks storage")
  .option("--domain <hostname>", "Add a default shortlink domain")
  .option("--public-base-url <url>", "Public URL base for generated links")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const result = await withRuntimeStore(async (store) => {
        const config = loadConfig();
        if (opts.publicBaseUrl) config.publicBaseUrl = opts.publicBaseUrl;
        if (opts.domain) {
          const domain = await store.addDomain({
            hostname: opts.domain,
            provider: "manual",
            defaultDomain: true,
          });
          config.defaultDomain = domain.hostname;
          config.publicBaseUrl = opts.publicBaseUrl || `https://${domain.hostname}`;
        }
        if (store.kind === "local") saveConfig(config);
        return {
          data_dir: getDataDir(),
          config_path: getConfigPath(),
          db_path: getDatabasePath(program.opts().db),
          store: store.kind,
          config,
          stats: await store.totalStats(),
        };
      });
      print(result, opts, () => {
        console.log(chalk.green("shortlinks initialized"));
        console.log(`  Data: ${result.data_dir}`);
        console.log(`  DB: ${result.db_path}`);
        if (result.config.defaultDomain) console.log(`  Default domain: ${result.config.defaultDomain}`);
      });
    } catch (error) {
      handleError(error);
    }
  });

const configCmd = program.command("config").description("View and update local config");

configCmd
  .command("show")
  .description("Show local config")
  .option("-j, --json", "Output JSON")
  .action((opts) => {
    const data = { path: getConfigPath(), config: loadConfig() };
    print(data, opts, () => console.log(JSON.stringify(data, null, 2)));
  });

configCmd
  .command("set <key> <value>")
  .description("Set config value: default-domain, public-base-url, cloudflare-account-id, cloudflare-worker-name, cloudflare-origin")
  .option("-j, --json", "Output JSON")
  .action((key, value, opts) => {
    try {
      let config = loadConfig();
      switch (key) {
        case "default-domain":
          config = updateConfig({ defaultDomain: value, publicBaseUrl: config.publicBaseUrl || `https://${value}` });
          break;
        case "public-base-url":
          config = updateConfig({ publicBaseUrl: value });
          break;
        case "cloudflare-account-id":
          config = updateConfig({ cloudflare: { accountId: value } });
          break;
        case "cloudflare-worker-name":
          config = updateConfig({ cloudflare: { workerName: value } });
          break;
        case "cloudflare-origin":
          config = updateConfig({ cloudflare: { origin: value } });
          break;
        default:
          throw new Error(`Unknown config key: ${key}`);
      }
      print({ path: getConfigPath(), config }, opts, () => console.log(chalk.green(`Set ${key}.`)));
    } catch (error) {
      handleError(error);
    }
  });

const domainCmd = program.command("domain").alias("domains").description("Manage custom shortlink domains");

domainCmd
  .command("add <hostname>")
  .description("Add or update a custom domain")
  .option("--provider <provider>", "Provider label", "manual")
  .option("--default", "Make this the default domain")
  .option("--cloudflare-zone-id <id>", "Cloudflare zone ID")
  .option("--cloudflare-account-id <id>", "Cloudflare account ID")
  .option("--cloudflare-worker-name <name>", "Cloudflare Worker name")
  .option("--origin <url>", "Origin redirect server URL")
  .option("--notes <text>", "Notes")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.addDomain({
        hostname,
        provider: opts.provider,
        defaultDomain: opts.default,
        cloudflareZoneId: opts.cloudflareZoneId,
        cloudflareAccountId: opts.cloudflareAccountId,
        cloudflareWorkerName: opts.cloudflareWorkerName,
        originUrl: opts.origin,
        notes: opts.notes,
      }));
      print(domain, opts, () => {
        console.log(chalk.green(`Domain ready: ${domain.hostname}`));
        if (domain.default_domain) console.log(chalk.dim("Default domain updated."));
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("list")
  .description("List configured domains")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const domains = await withRuntimeStore((store) => store.listDomains());
      print(domains, opts, () => {
        if (domains.length === 0) {
          console.log(chalk.dim("No domains configured."));
          return;
        }
        for (const domain of domains) {
          const marker = domain.default_domain ? chalk.green("*") : " ";
          console.log(`${marker} ${domain.hostname} ${chalk.dim(domain.provider)}`);
        }
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("get <hostname>")
  .description("Show a configured domain")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.getDomain(hostname));
      if (!domain) throw new Error("Domain not found.");
      print(domain, opts, () => console.log(JSON.stringify(domain, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("remove <hostname>")
  .alias("delete")
  .alias("rm")
  .description("Delete a domain and all of its links and clicks")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.deleteDomain(hostname));
      print({ deleted: true, hostname: domain.hostname }, opts, () => {
        console.log(chalk.green(`Domain removed: ${domain.hostname}`));
        console.log(chalk.dim("Its links and clicks were deleted."));
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("setup <hostname>")
  .description("Add a domain locally and optionally prepare Cloudflare DNS")
  .option("--default", "Make this the default domain")
  .option("--origin <url>", "Origin redirect server URL")
  .option("--cloudflare", "Upsert Cloudflare CNAME record")
  .option("--target <hostname>", "CNAME target for Cloudflare DNS")
  .option("--zone-id <id>", "Cloudflare zone ID")
  .option("--dry-run", "Show the Cloudflare plan without changing DNS")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const result = await withRuntimeStore(async (store) => {
        const domain = await store.addDomain({
          hostname,
          provider: opts.cloudflare ? "cloudflare" : "manual",
          defaultDomain: opts.default,
          originUrl: opts.origin,
        });
        const cloudflare = opts.cloudflare
          ? await upsertCloudflareDnsRecord({
              hostname,
              target: opts.target || hostname,
              zoneId: opts.zoneId,
              dryRun: opts.dryRun,
            })
          : null;
        return { domain, cloudflare };
      });
      print(result, opts, () => {
        console.log(chalk.green(`Domain ready: ${result.domain.hostname}`));
        if (result.cloudflare) console.log(JSON.stringify(result.cloudflare, null, 2));
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("check <hostname>")
  .description("Check domain availability through @hasna/domains")
  .option("--dry-run", "Print the command without running it")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    const result = runDomains("check", hostname, { dryRun: opts.dryRun });
    print(result, opts, () => {
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
      if (result.status !== 0) process.exit(result.status || 1);
    });
  });

domainCmd
  .command("buy <hostname>")
  .description("Buy a domain through @hasna/domains / Route 53")
  .option("--dry-run", "Print the command without running it")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    const result = runDomains("buy", hostname, { dryRun: opts.dryRun });
    print(result, opts, () => {
      if (result.stdout.trim()) console.log(result.stdout.trim());
      if (result.stderr.trim()) console.error(result.stderr.trim());
      if (result.status !== 0) process.exit(result.status || 1);
    });
  });

const linkCmd = program.command("link").alias("links").description("Manage shortlinks");

async function createLinkAction(url: string, opts: any): Promise<void> {
  try {
    const link = await withRuntimeStore((store) => store.createLink({
      destinationUrl: url,
      domain: opts.domain,
      slug: opts.slug,
      title: opts.title,
      expiresAt: opts.expires,
      slugLength: opts.length ? Number(opts.length) : undefined,
    }));
    print(link, opts, () => console.log(formatLink(link)));
  } catch (error) {
    handleError(error);
  }
}

linkCmd
  .command("create <url>")
  .description("Create a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--slug <slug>", "Custom slug")
  .option("--title <title>", "Human title")
  .option("--expires <date>", "Expiration date")
  .option("--length <n>", "Generated slug length", "7")
  .option("-j, --json", "Output JSON")
  .action(createLinkAction);

program
  .command("create <url>")
  .description("Create a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--slug <slug>", "Custom slug")
  .option("--title <title>", "Human title")
  .option("--expires <date>", "Expiration date")
  .option("--length <n>", "Generated slug length", "7")
  .option("-j, --json", "Output JSON")
  .action(createLinkAction);

linkCmd
  .command("list")
  .description("List shortlinks")
  .option("--domain <hostname>", "Filter by domain")
  .option("--active", "Only active links")
  .option("--limit <n>", "Maximum rows", "100")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const links = await withRuntimeStore((store) => store.listLinks({
        domain: opts.domain,
        activeOnly: opts.active,
        limit: Number(opts.limit),
      }));
      print(links, opts, () => {
        if (links.length === 0) {
          console.log(chalk.dim("No links yet."));
          return;
        }
        for (const link of links) console.log(formatLink(link));
      });
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("get <slug>")
  .description("Show a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.getLink(opts.domain, slug) : store.getLink(slug));
      if (!link) throw new Error("Link not found.");
      print(link, opts, () => console.log(JSON.stringify(link, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("disable <slug>")
  .description("Disable a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.setLinkActive(opts.domain, slug, false) : store.setLinkActive(slug, false));
      print(link, opts, () => console.log(chalk.green(`Disabled ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("enable <slug>")
  .description("Enable a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.setLinkActive(opts.domain, slug, true) : store.setLinkActive(slug, true));
      print(link, opts, () => console.log(chalk.green(`Enabled ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("delete <slug>")
  .description("Delete a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.deleteLink(opts.domain, slug) : store.deleteLink(slug));
      print(link, opts, () => console.log(chalk.green(`Deleted ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("resolve <slug>")
  .description("Resolve a slug to its destination without recording a click")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.getLink(opts.domain, slug) : store.getLink(slug));
      if (!link) throw new Error("Link not found.");
      print(link, opts, () => console.log(link.destination_url));
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("stats [slug]")
  .description("Show overall stats or stats for a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const result = await withRuntimeStore<LinkStats | TotalStats>((store) => {
        if (slug) return opts.domain ? store.getStats(opts.domain, slug) : store.getStats(slug);
        return store.totalStats();
      });
      print(result, opts, () => console.log(JSON.stringify(result, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("serve")
  .description("Run the on-box redirect server that records clicks (routes through the resolved Store)")
  .option("--host <host>", "Bind host", "127.0.0.1")
  .option("--port <port>", "Port", "8787")
  .option("--default-host <hostname>", "Fallback host if the request has no Host header")
  .action(async (opts) => {
    try {
      // The redirect server reads/records through the same Store seam as every
      // other command: LocalStore on-box, or the cloud ApiStore when the flip is
      // on. There is no DSN path here — a client never opens the raw RDS.
      const store = resolveStore(process.env, { dbPath: program.opts().db });
      const server = serveShortlinks({
        store,
        host: opts.host,
        port: Number(opts.port),
        defaultHost: opts.defaultHost,
      });
      console.log(chalk.green(`shortlinks redirect server listening on http://${server.hostname}:${server.port} (${store.kind})`));
    } catch (error) {
      handleError(error);
    }
  });

const cfCmd = program.command("cloudflare").description("Cloudflare DNS and Worker helpers");

cfCmd
  .command("plan <hostname>")
  .description("Print the Cloudflare setup plan")
  .requiredOption("--target <hostname>", "CNAME target")
  .option("--origin <url>", "Origin redirect server URL", process.env.SHORTLINKS_ORIGIN || "https://shortlinks.example.com")
  .option("--worker <name>", "Worker name", "shortlinks")
  .option("--no-proxied", "Create unproxied DNS record")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    try {
      const plan = createCloudflarePlan({
        hostname,
        target: opts.target,
        origin: opts.origin,
        workerName: opts.worker,
        proxied: opts.proxied,
      });
      print(plan, opts, () => console.log(JSON.stringify(plan, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

cfCmd
  .command("worker")
  .description("Write Cloudflare Worker files")
  .option("--out-dir <dir>", "Output directory", "cloudflare")
  .option("--worker <name>", "Worker name", "shortlinks")
  .option("--origin <url>", "Origin redirect server URL", process.env.SHORTLINKS_ORIGIN || "https://shortlinks.example.com")
  .option("-j, --json", "Output JSON")
  .action((opts) => {
    try {
      const result = writeWorkerFiles({ outDir: opts.outDir, workerName: opts.worker, origin: opts.origin });
      print(result, opts, () => {
        console.log(chalk.green(`Wrote ${result.workerPath}`));
        console.log(chalk.green(`Wrote ${result.wranglerPath}`));
      });
    } catch (error) {
      handleError(error);
    }
  });

cfCmd
  .command("dns <hostname>")
  .description("Create or update the Cloudflare CNAME record")
  .requiredOption("--target <hostname>", "CNAME target")
  .option("--zone-id <id>", "Cloudflare zone ID")
  .option("--dry-run", "Show plan without changing DNS")
  .option("--no-proxied", "Create unproxied DNS record")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const result = await upsertCloudflareDnsRecord({
        hostname,
        target: opts.target,
        zoneId: opts.zoneId,
        dryRun: opts.dryRun,
        proxied: opts.proxied,
      });
      print(result, opts, () => console.log(JSON.stringify(result, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

const localCmd = program.command("local").description("Local domain setup helpers");

localCmd
  .command("plan <domain>")
  .description("Render hosts and reverse-proxy setup for a local shortlink domain")
  .option("--port <port>", "Local redirect server port", "8787")
  .option("--target-host <host>", "Local target host", "127.0.0.1")
  .option("-j, --json", "Output JSON")
  .action((domain, opts) => {
    try {
      const plan = createLocalSetupPlan({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      print(plan, opts, () => console.log(JSON.stringify(plan, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });

localCmd
  .command("setup <domain>")
  .description("Record local domain mapping with machines and print remaining sudo-only setup")
  .option("--port <port>", "Local redirect server port", "8787")
  .option("--target-host <host>", "Local target host", "127.0.0.1")
  .option("--skip-machines", "Do not call machines dns add")
  .option("-j, --json", "Output JSON")
  .action((domain, opts) => {
    try {
      const plan = createLocalSetupPlan({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      const machines = opts.skipMachines ? null : registerMachinesDns({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      const result = { plan, machines };
      print(result, opts, () => {
        if (machines && machines.status !== 0) {
          console.error(chalk.yellow(machines.stderr.trim() || "machines dns add failed"));
        }
        console.log(JSON.stringify(result, null, 2));
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("doctor")
  .description("Check local shortlinks tooling and integration readiness")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const dbPath = getDatabasePath(program.opts().db);
      const data = await withRuntimeStore(async (store) => ({
        service: "shortlinks",
        ok: true,
        // Which transport the client flip resolved to: "local" or "cloud-http".
        store: store.kind,
        data_dir: getDataDir(),
        config_path: getConfigPath(),
        db_path: dbPath,
        db_exists: existsSync(dbPath),
        stats: await store.totalStats(),
        commands: {
          domains: commandExists("domains"),
          wrangler: commandExists("wrangler"),
          secrets: commandExists("secrets"),
        },
        environment: {
          // API mode is bearer-key only — never a DB DSN on the client.
          api_url_present: Boolean(process.env.HASNA_SHORTLINKS_API_URL),
          api_key_present: Boolean(process.env.HASNA_SHORTLINKS_API_KEY),
          storage_mode: process.env.HASNA_SHORTLINKS_STORAGE_MODE || process.env.HASNA_SHORTLINKS_MODE || null,
          cloudflare_api_token_present: Boolean(process.env.CLOUDFLARE_API_TOKEN),
          cloudflare_api_key_present: Boolean(process.env.CLOUDFLARE_API_KEY),
          cloudflare_email_present: Boolean(process.env.CLOUDFLARE_EMAIL),
          shortlinks_origin_present: Boolean(process.env.SHORTLINKS_ORIGIN),
        },
      }));
      print(data, opts, () => console.log(JSON.stringify(data, null, 2)));
    } catch (error) {
      handleError(error);
    }
  });
registerEventsCommands(program, { source: "shortlinks" });

program.parseAsync(process.argv).catch(handleError);
