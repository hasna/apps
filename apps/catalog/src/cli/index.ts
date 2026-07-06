#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { AppLifecycleSchema, ReleaseChannelSchema, type App } from "../contracts.js";
import { defaultOpensourceRoot } from "../paths.js";
import { loadProjectsJoin, seedCatalog } from "../seed.js";
import { startCatalogServer } from "../server/index.js";
import { generateSite } from "../site.js";
import { CatalogStore } from "../store.js";
import { VERSION } from "../version.js";

function openStore(options: { db?: string }): CatalogStore {
  return new CatalogStore({ dbPath: options.db });
}

function printApps(apps: App[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(apps, null, 2));
    return;
  }
  if (apps.length === 0) {
    console.log("No apps found.");
    return;
  }
  for (const app of apps) {
    const version = typeof app.metadata?.["version"] === "string" ? ` v${app.metadata["version"]}` : "";
    console.log(`${app.appId.padEnd(24)} ${app.npmName.padEnd(28)}${version.padEnd(12)} ${app.lifecycle}`);
  }
}

const program = new Command();
program
  .name("catalog")
  .description("Read-model app catalog for Hasna distribution (hasna.app.v1)")
  .version(VERSION);

program
  .command("seed")
  .description("Scan an opensource checkout directory and seed the catalog read model")
  .option("--root <dir>", "opensource checkout directory", defaultOpensourceRoot())
  .option("--db <path>", "catalog SQLite database path")
  .option("--fixture <path>", "also write the seeded apps as a JSONL fixture")
  .option("--no-projects-join", "skip joining against the open-projects registry")
  .option("--json", "print the full seed report as JSON", false)
  .action((options: { root: string; db?: string; fixture?: string; projectsJoin: boolean; json: boolean }) => {
    const store = openStore(options);
    const report = seedCatalog({
      root: resolve(options.root),
      store,
      fixturePath: options.fixture ? resolve(options.fixture) : undefined,
      projectsJoin: options.projectsJoin ? loadProjectsJoin() : [],
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`Scanned ${report.scanned} folders under ${report.root}`);
    console.log(`Seeded ${report.seeded.length} apps (${report.joinedProjects} joined to open-projects records)`);
    console.log(`Skipped ${report.skipped.length}:`);
    for (const skip of report.skipped) {
      console.log(`  - ${skip.folder}: ${skip.reason}`);
    }
  });

program
  .command("import")
  .description("Import hasna.app.v1 documents from a JSONL fixture into the read model")
  .argument("<file>", "JSONL fixture path")
  .option("--db <path>", "catalog SQLite database path")
  .action((file: string, options: { db?: string }) => {
    const store = openStore(options);
    const count = store.importJsonl(readFileSync(resolve(file), "utf8"));
    console.log(`Imported ${count} apps.`);
  });

program
  .command("list")
  .description("List apps in the catalog")
  .option("--db <path>", "catalog SQLite database path")
  .option("--lifecycle <lifecycle>", "filter by lifecycle (active|stub|deprecated|archived)")
  .option("--channel <channel>", "filter by release channel (stable|beta|canary|internal)")
  .option("--limit <n>", "max apps to return")
  .option("--json", "print JSON", false)
  .action((options: { db?: string; lifecycle?: string; channel?: string; limit?: string; json: boolean }) => {
    const lifecycle = AppLifecycleSchema.safeParse(options.lifecycle);
    const channel = ReleaseChannelSchema.safeParse(options.channel);
    if (options.lifecycle && !lifecycle.success) {
      program.error(`invalid --lifecycle: ${options.lifecycle}`);
    }
    if (options.channel && !channel.success) {
      program.error(`invalid --channel: ${options.channel}`);
    }
    const store = openStore(options);
    const apps = store.listApps({
      lifecycle: lifecycle.success ? lifecycle.data : undefined,
      channel: channel.success ? channel.data : undefined,
      limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
    });
    printApps(apps, options.json);
  });

program
  .command("get")
  .description("Get one app by its appId slug")
  .argument("<appId>", "app id slug, e.g. open-todos")
  .option("--db <path>", "catalog SQLite database path")
  .action((appId: string, options: { db?: string }) => {
    const store = openStore(options);
    const app = store.getApp(appId);
    if (!app) {
      program.error(`app not found: ${appId}`);
    }
    console.log(JSON.stringify(app, null, 2));
  });

program
  .command("search")
  .description("Search apps by id, npm name, summary, or tags")
  .argument("<query>", "search query")
  .option("--db <path>", "catalog SQLite database path")
  .option("--limit <n>", "max apps to return")
  .option("--json", "print JSON", false)
  .action((query: string, options: { db?: string; limit?: string; json: boolean }) => {
    const store = openStore(options);
    const apps = store.searchApps(query, {
      limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
    });
    printApps(apps, options.json);
  });

program
  .command("site")
  .description("Generate the public static catalog site (index + per-app pages)")
  .option("--db <path>", "catalog SQLite database path")
  .option("--out <dir>", "output directory", "dist-site")
  .option("--name <name>", "site name", "Hasna App Catalog")
  .action((options: { db?: string; out: string; name: string }) => {
    const store = openStore(options);
    const apps = store.listApps({ limit: 1000 });
    const result = generateSite({ apps, outDir: resolve(options.out), siteName: options.name });
    console.log(`Generated ${result.pages.length} pages for ${result.appCount} apps into ${result.outDir}`);
  });

program
  .command("serve")
  .description("Serve the read-only catalog HTTP API")
  .option("--db <path>", "catalog SQLite database path")
  .option("--host <host>", "host to bind")
  .option("--port <port>", "port to bind")
  .action((options: { db?: string; host?: string; port?: string }) => {
    const server = startCatalogServer({
      store: openStore(options),
      host: options.host,
      port: options.port ? Number.parseInt(options.port, 10) : undefined,
    });
    console.log(`Open Catalog API listening on http://${server.hostname}:${server.port}`);
  });

if (import.meta.main) {
  program.parse();
}

export { program };
