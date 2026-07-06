#!/usr/bin/env bun
import { Command, Option } from "commander";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageVersion } from "../version.js";
import { getHuggingFaceAuthStatus, redactAuthStatus, saveHuggingFaceSecretRef } from "../auth.js";
import { getDbPath, getModelsHome } from "../paths.js";
import { formatProviderRef, parseEntityKind, parseProviderRef } from "../ref.js";
import {
  createDownloadPlan,
  downloadPlannedFiles,
  getHuggingFaceInfo,
  listHuggingFaceFiles,
  searchHuggingFace,
} from "../huggingface.js";
import { MODEL_CAPABILITY_FIXTURES } from "../capabilities.js";
import { ModelsStore } from "../storage.js";
import type { CatalogEntry, DownloadPlan, EntityKind, InstalledArtifact, ModelCapability, RemoteFileEntry, SearchInput } from "../types.js";

const program = new Command();
type CheckStatus = "ok" | "warn" | "fail";

program
  .name("models")
  .description("Discover, index, download, and manage local open models and datasets")
  .version(getPackageVersion())
  .option("-j, --json", "output JSON");

function isJson(opts?: { json?: boolean }): boolean {
  return Boolean(opts?.json || program.opts().json);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printResult(data: unknown, text: string, opts?: { json?: boolean }): void {
  if (isJson(opts)) printJson(data);
  else console.log(text);
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function planBlockedReason(plan: DownloadPlan): string | null {
  if (plan.files.length === 0) return "matched zero files";
  if (plan.exceedsMaxBytes) return `exceeds max bytes (${humanBytes(plan.totalBytes)} > ${humanBytes(plan.maxBytes)})`;
  if (plan.maxBytes != null && plan.unknownSizeFiles.length > 0) return `has unknown-size files under a byte cap: ${plan.unknownSizeFiles.join(", ")}`;
  return null;
}

function parsePositiveInt(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`Expected a positive integer, got ${value}`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, got ${value}`);
  return parsed;
}

function parseBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/i);
  if (!match) throw new Error(`Invalid byte value: ${value}`);
  const amount = Number.parseFloat(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const factor = unit === "tb" ? 1024 ** 4 : unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.floor(amount * factor);
}

function humanBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function renderEntry(entry: CatalogEntry): string {
  const parts = [
    chalk.cyan(entry.repoId),
    entry.task ? chalk.gray(entry.task) : null,
    entry.license ? chalk.gray(`license:${entry.license}`) : null,
    entry.downloads != null ? chalk.gray(`downloads:${entry.downloads}`) : null,
  ].filter(Boolean);
  return parts.join("  ");
}

function summarizeEntry(entry: CatalogEntry): Record<string, unknown> {
  return {
    provider: entry.provider,
    entityKind: entry.entityKind,
    repoId: entry.repoId,
    revision: entry.revision,
    task: entry.task,
    libraryName: entry.libraryName,
    license: entry.license,
    gated: entry.gated,
    private: entry.private,
    downloads: entry.downloads,
    likes: entry.likes,
    lastModified: entry.lastModified,
    canonicalUrl: entry.canonicalUrl,
  };
}

function renderFiles(files: RemoteFileEntry[]): string {
  if (files.length === 0) return "files: none";
  return files
    .map((file) => `${file.path.padEnd(36)} ${humanBytes(file.size).padStart(10)} ${file.format ?? ""}`.trimEnd())
    .join("\n");
}

function renderPlan(plan: DownloadPlan): string {
  return [
    `ref: ${formatProviderRef(plan.ref)}`,
    `destination: ${plan.destinationRoot}`,
    `files: ${plan.files.length}`,
    `bytes: ${humanBytes(plan.totalBytes)}`,
    plan.unknownSizeFiles.length > 0 ? `unknown-size files: ${plan.unknownSizeFiles.length}` : null,
    plan.exceedsMaxBytes ? chalk.red(`exceeds max bytes: ${humanBytes(plan.maxBytes)}`) : null,
  ].filter(Boolean).join("\n");
}

function renderCapability(capability: ModelCapability): string {
  return [
    capability.provider.padEnd(18),
    capability.modelId.padEnd(36),
    `ctx:${capability.contextWindowTokens}`,
    `tools:${capability.toolUse}`,
    `json:${capability.jsonMode}`,
    `health:${capability.providerHealth.status}`,
    `version:${capability.capabilityVersion}`,
  ].join("  ");
}

function commandError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (program.opts().json) {
    printJson({ ok: false, error: message });
  } else {
    console.error(chalk.red(message));
  }
  process.exit(1);
}

function searchOptions(command: Command): Command {
  return command
    .option("--kind <kind>", "entity kind: model, dataset, or space", "model")
    .option("--task <task>", "task or pipeline tag filter")
    .option("--license <license>", "license tag filter")
    .option("--tag <tag>", "additional Hub tag filter", collect, [])
    .option("--limit <n>", "result limit", parsePositiveInt, 20)
    .addOption(new Option("--sort <field>", "sort field").choices(["downloads", "likes", "lastModified", "createdAt", "trendingScore"]).default("downloads"))
    .addOption(new Option("--direction <direction>", "sort direction").choices(["asc", "desc"]).default("desc"));
}

async function runSearch(query: string | undefined, opts: Record<string, unknown>, defaultKind: EntityKind): Promise<CatalogEntry[]> {
  const kind = parseEntityKind(String((opts.kind as EntityKind | undefined) ?? defaultKind));
  const input: SearchInput = {
    query,
    entityKind: kind,
    task: opts.task as string | undefined,
    license: opts.license as string | undefined,
    tags: opts.tag as string[] | undefined,
    limit: opts.limit as number | undefined,
    sort: opts.sort as SearchInput["sort"],
    direction: opts.direction as SearchInput["direction"],
  };
  return searchHuggingFace(input);
}

const providers = program.command("providers").description("Manage provider auth and status");

providers
  .command("list")
  .description("List supported providers")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    const data = [
      {
        id: "huggingface",
        entities: ["model", "dataset", "space"],
        capabilities: ["search", "info", "files", "selected-file-download", "best-index"],
      },
    ];
    printResult(data, data.map((provider) => `${provider.id}: ${provider.entities.join(", ")}`).join("\n"), opts);
  });

providers
  .command("status")
  .description("Show provider credential status without printing token values")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    const status = [redactAuthStatus(getHuggingFaceAuthStatus())];
    printResult(status, status.map((item) => `${item.provider}: ${item.available ? chalk.green(item.source) : chalk.yellow("no token")}${item.secretKey ? ` (${item.secretKey})` : ""}`).join("\n"), opts);
  });

providers
  .command("auth")
  .argument("[provider]", "provider id", "huggingface")
  .description("Configure provider auth by saving a local secret reference")
  .option("--secret-key <key>", "secret key to read through the secrets CLI")
  .option("-j, --json", "output JSON")
  .action((provider, opts) => {
    if (provider !== "huggingface" && provider !== "hf") throw new Error(`Unsupported provider: ${provider}`);
    const status = opts.secretKey ? saveHuggingFaceSecretRef(opts.secretKey) : redactAuthStatus(getHuggingFaceAuthStatus());
    printResult(status, `${status.provider}: ${status.available ? chalk.green(status.source) : chalk.yellow("not configured")}${status.secretKey ? ` (${status.secretKey})` : ""}`, opts);
  });

searchOptions(program.command("search")
  .argument("[query]", "search query")
  .description("Search the remote Hugging Face catalog"))
  .option("--index", "store returned entries in local SQLite")
  .option("-j, --json", "output JSON")
  .action(async (query, opts) => {
    try {
      const entries = await runSearch(query, opts, "model");
      if (opts.index) new ModelsStore().upsertCatalog(entries);
      printResult(entries, entries.map(renderEntry).join("\n") || "no results", opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("info")
  .argument("<ref>", "provider ref, for example hf:sshleifer/tiny-gpt2")
  .option("--kind <kind>", "entity kind", "model")
  .option("--index", "store entry in local SQLite")
  .option("-j, --json", "output JSON")
  .description("Inspect a model or dataset")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, opts.kind);
      const info = await getHuggingFaceInfo(ref);
      if (opts.index) new ModelsStore().upsertCatalog([info]);
      printResult(info, renderEntry(info), opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("files")
  .argument("<ref>", "provider ref")
  .option("--kind <kind>", "entity kind", "model")
  .option("--index", "store files in local SQLite")
  .option("-j, --json", "output JSON")
  .description("List remote files for a model or dataset")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, opts.kind);
      const files = await listHuggingFaceFiles(ref);
      if (opts.index) new ModelsStore().upsertFiles(files);
      printResult(files, renderFiles(files), opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("plan")
  .argument("<ref>", "provider ref")
  .option("--kind <kind>", "entity kind", "model")
  .option("--include <pattern>", "include file path/glob; repeatable", collect, [])
  .option("--exclude <pattern>", "exclude file path/glob; repeatable", collect, [])
  .option("--max-bytes <bytes>", "maximum total known bytes", parseBytes, parseBytes("2gb"))
  .option("-j, --json", "output JSON")
  .description("Create a local download plan")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, opts.kind);
      const plan = await createDownloadPlan({ ref, include: opts.include, exclude: opts.exclude, maxBytes: opts.maxBytes });
      const blockedReason = planBlockedReason(plan);
      printResult({ ok: blockedReason == null, status: blockedReason ? "blocked" : "ready", blockedReason, plan }, renderPlan(plan), opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("install")
  .argument("<ref>", "provider ref")
  .option("--kind <kind>", "entity kind", "model")
  .option("--include <pattern>", "include file path/glob; repeatable", collect, [])
  .option("--exclude <pattern>", "exclude file path/glob; repeatable", collect, [])
  .option("--max-bytes <bytes>", "maximum total known bytes", parseBytes, parseBytes("2gb"))
  .option("--dry-run", "preview without downloading")
  .option("-j, --json", "output JSON")
  .description("Install selected model or dataset files into the local store")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, opts.kind);
      const plan = await createDownloadPlan({ ref, include: opts.include, exclude: opts.exclude, maxBytes: opts.maxBytes });
      const blockedReason = planBlockedReason(plan);
      if (opts.dryRun) {
        printResult({ ok: blockedReason == null, dryRun: true, status: blockedReason ? "blocked" : "ready", blockedReason, plan }, renderPlan(plan), opts);
        return;
      }
      if (blockedReason) throw new Error(`Download plan is blocked: ${blockedReason}`);
      const downloaded = await downloadPlannedFiles(plan);
      const now = new Date().toISOString();
      const artifact: InstalledArtifact = {
        id: randomUUID(),
        provider: ref.provider,
        entityKind: ref.entityKind,
        repoId: ref.repoId,
        revision: ref.revision,
        installPath: plan.destinationRoot,
        bytes: downloaded.reduce((sum, file) => sum + file.bytes, 0),
        files: downloaded.map((file) => file.path),
        status: "installed",
        createdAt: now,
        updatedAt: now,
      };
      new ModelsStore().recordInstall(artifact, { plan, downloaded });
      printResult({ ok: true, install: artifact, downloaded }, `installed ${artifact.repoId} (${downloaded.length} files, ${humanBytes(artifact.bytes)})\n${artifact.installPath}`, opts);
    } catch (error) {
      commandError(error);
    }
  });

const index = program.command("index").description("Index provider catalogs into local SQLite");

index
  .command("hf")
  .description("Index Hugging Face entries")
  .argument("[query]", "optional search query")
  .option("--kind <kind>", "entity kind", "model")
  .option("--task <task>", "task or pipeline tag filter")
  .option("--license <license>", "license tag filter")
  .option("--tag <tag>", "additional Hub tag filter", collect, [])
  .option("--limit <n>", "result limit", parsePositiveInt, 100)
  .addOption(new Option("--sort <field>", "sort field").choices(["downloads", "likes", "lastModified", "createdAt", "trendingScore"]).default("downloads"))
  .addOption(new Option("--direction <direction>", "sort direction").choices(["asc", "desc"]).default("desc"))
  .option("--with-files", "also index remote file lists for returned entries")
  .option("--include-results", "include all indexed entries in JSON output")
  .option("-j, --json", "output JSON")
  .action(async (query, opts) => {
    try {
      const entries = await runSearch(query, opts, opts.kind);
      const store = new ModelsStore();
      const catalogCount = store.upsertCatalog(entries);
      let fileCount = 0;
      if (opts.withFiles) {
        for (const entry of entries) {
          const files = await listHuggingFaceFiles({
            provider: entry.provider,
            entityKind: entry.entityKind,
            repoId: entry.repoId,
            revision: "main",
          });
          fileCount += store.upsertFiles(files);
        }
      }
      const result = {
        ok: true,
        catalogCount,
        fileCount,
        stats: store.catalogStats(),
        preview: entries.slice(0, 20).map(summarizeEntry),
        entries: opts.includeResults ? entries : undefined,
      };
      printResult(result, `indexed ${catalogCount} catalog entries${fileCount ? ` and ${fileCount} files` : ""}`, opts);
    } catch (error) {
      commandError(error);
    }
  });

index
  .command("best")
  .description("Index top Hugging Face models by downloads")
  .option("--limit <n>", "result limit", parsePositiveInt, 250)
  .option("--task <task>", "task or pipeline tag filter")
  .option("--with-files", "also index remote file lists")
  .option("-j, --json", "output JSON")
  .action(async (opts) => {
    try {
      const entries = await searchHuggingFace({
        entityKind: "model",
        task: opts.task,
        limit: opts.limit,
        sort: "downloads",
        direction: "desc",
      });
      const store = new ModelsStore();
      const catalogCount = store.upsertCatalog(entries);
      let fileCount = 0;
      if (opts.withFiles) {
        for (const entry of entries) {
          const files = await listHuggingFaceFiles({
            provider: entry.provider,
            entityKind: entry.entityKind,
            repoId: entry.repoId,
            revision: "main",
          });
          fileCount += store.upsertFiles(files);
        }
      }
      const result = { ok: true, catalogCount, fileCount, stats: store.catalogStats(), top: entries.slice(0, 20).map(summarizeEntry) };
      printResult(result, `indexed ${catalogCount} top models by downloads`, opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("list")
  .description("List locally installed models and datasets")
  .option("--catalog", "show top indexed catalog entries instead of installs")
  .option("--limit <n>", "catalog limit", parsePositiveInt, 20)
  .option("-j, --json", "output JSON")
  .action((opts) => {
    try {
      const store = new ModelsStore();
      if (opts.catalog) {
        const entries = store.topCatalog(opts.limit);
        printResult(entries, entries.map(renderEntry).join("\n") || "catalog is empty", opts);
        return;
      }
      const installs = store.listInstalls();
      printResult(installs, installs.map((item) => `${item.id}  ${item.repoId}  ${humanBytes(item.bytes)}  ${item.installPath}`).join("\n") || "no installs", opts);
    } catch (error) {
      commandError(error);
    }
  });

const capabilities = program.command("capabilities").description("Model/provider capability metadata for routing consumers");

capabilities
  .command("seed-fixtures")
  .description("Load golden capability fixtures for tests and consumer contract development")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    try {
      const store = new ModelsStore();
      const count = store.upsertCapabilities(MODEL_CAPABILITY_FIXTURES);
      const result = { ok: true, count, stats: store.catalogStats(), capabilities: MODEL_CAPABILITY_FIXTURES };
      printResult(result, `seeded ${count} capability fixtures`, opts);
    } catch (error) {
      commandError(error);
    }
  });

capabilities
  .command("list")
  .description("List stored model capabilities")
  .option("--provider <provider>", "filter by provider")
  .option("--health <status>", "filter by provider health")
  .option("--limit <n>", "result limit", parsePositiveInt, 50)
  .option("-j, --json", "output JSON")
  .action((opts) => {
    try {
      const items = new ModelsStore().listCapabilities({ provider: opts.provider, health: opts.health, limit: opts.limit });
      printResult(items, items.map(renderCapability).join("\n") || "no capabilities", opts);
    } catch (error) {
      commandError(error);
    }
  });

capabilities
  .command("get")
  .argument("<model-or-alias>", "model id, provider:model id, or alias")
  .description("Resolve a stored capability by model id or alias")
  .option("-j, --json", "output JSON")
  .action((input, opts) => {
    try {
      const capability = new ModelsStore().findCapability(input);
      if (!capability) throw new Error(`Capability not found: ${input}`);
      printResult(capability, renderCapability(capability), opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("where")
  .argument("<id-or-repo>", "install id or repo id")
  .description("Show local install path")
  .option("-j, --json", "output JSON")
  .action((input, opts) => {
    try {
      const install = new ModelsStore().findInstall(input);
      if (!install) throw new Error(`Install not found: ${input}`);
      printResult(install, install.installPath, opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("remove")
  .argument("<id-or-repo>", "install id or repo id")
  .description("Remove install metadata, and optionally local files")
  .option("--apply", "apply the removal; default is dry-run")
  .option("--files", "also remove local files when --apply is set")
  .option("-j, --json", "output JSON")
  .action((input, opts) => {
    try {
      const store = new ModelsStore();
      const install = store.findInstall(input);
      if (!install) throw new Error(`Install not found: ${input}`);
      const result = {
        ok: true,
        dryRun: !opts.apply,
        removeFiles: Boolean(opts.files),
        install,
      };
      if (!opts.apply) {
        printResult(result, `would remove metadata for ${install.id}${opts.files ? ` and files at ${install.installPath}` : ""}`, opts);
        return;
      }
      if (opts.files && existsSync(install.installPath)) {
        rmSync(install.installPath, { recursive: true, force: true });
      }
      store.deleteInstall(install.id);
      printResult(result, `removed ${install.id}${opts.files ? " and local files" : ""}`, opts);
    } catch (error) {
      commandError(error);
    }
  });

const datasets = program.command("datasets").description("Dataset catalog and install commands");

searchOptions(datasets.command("search")
  .argument("[query]", "search query")
  .description("Search Hugging Face datasets"))
  .option("--index", "store returned entries")
  .option("-j, --json", "output JSON")
  .action(async (query, opts) => {
    try {
      opts.kind = "dataset";
      const entries = await runSearch(query, opts, "dataset");
      if (opts.index) new ModelsStore().upsertCatalog(entries);
      printResult(entries, entries.map(renderEntry).join("\n") || "no results", opts);
    } catch (error) {
      commandError(error);
    }
  });

datasets
  .command("info")
  .argument("<ref>", "dataset ref, for example hf:dataset:cornell-movie-review-data/rotten_tomatoes")
  .option("--index", "store entry")
  .option("-j, --json", "output JSON")
  .description("Inspect a dataset")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, "dataset");
      const info = await getHuggingFaceInfo(ref);
      if (opts.index) new ModelsStore().upsertCatalog([info]);
      printResult(info, renderEntry(info), opts);
    } catch (error) {
      commandError(error);
    }
  });

datasets
  .command("files")
  .argument("<ref>", "dataset ref")
  .option("--index", "store files")
  .option("-j, --json", "output JSON")
  .description("List dataset files")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, "dataset");
      const files = await listHuggingFaceFiles(ref);
      if (opts.index) new ModelsStore().upsertFiles(files);
      printResult(files, renderFiles(files), opts);
    } catch (error) {
      commandError(error);
    }
  });

datasets
  .command("install")
  .argument("<ref>", "dataset ref")
  .option("--include <pattern>", "include file path/glob; repeatable", collect, [])
  .option("--exclude <pattern>", "exclude file path/glob; repeatable", collect, [])
  .option("--max-bytes <bytes>", "maximum total known bytes", parseBytes, parseBytes("2gb"))
  .option("--dry-run", "preview without downloading")
  .option("-j, --json", "output JSON")
  .description("Install selected dataset files into the local store")
  .action(async (refInput, opts) => {
    try {
      const ref = parseProviderRef(refInput, "dataset");
      const plan = await createDownloadPlan({ ref, include: opts.include, exclude: opts.exclude, maxBytes: opts.maxBytes });
      const blockedReason = planBlockedReason(plan);
      if (opts.dryRun) {
        printResult({ ok: blockedReason == null, dryRun: true, status: blockedReason ? "blocked" : "ready", blockedReason, plan }, renderPlan(plan), opts);
        return;
      }
      if (blockedReason) throw new Error(`Download plan is blocked: ${blockedReason}`);
      const downloaded = await downloadPlannedFiles(plan);
      const now = new Date().toISOString();
      const artifact: InstalledArtifact = {
        id: randomUUID(),
        provider: ref.provider,
        entityKind: ref.entityKind,
        repoId: ref.repoId,
        revision: ref.revision,
        installPath: plan.destinationRoot,
        bytes: downloaded.reduce((sum, file) => sum + file.bytes, 0),
        files: downloaded.map((file) => file.path),
        status: "installed",
        createdAt: now,
        updatedAt: now,
      };
      new ModelsStore().recordInstall(artifact, { plan, downloaded });
      printResult({ ok: true, install: artifact, downloaded }, `installed dataset ${artifact.repoId} (${downloaded.length} files, ${humanBytes(artifact.bytes)})`, opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("doctor")
  .description("Check local store, auth, and basic runtime prerequisites")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    try {
      const store = new ModelsStore();
      const dataDir = getModelsHome();
      const dbPath = getDbPath();
      const auth = redactAuthStatus(getHuggingFaceAuthStatus());
      const checks: Array<{ id: string; status: CheckStatus; detail: string }> = [
        { id: "data-dir", status: "ok", detail: dataDir },
        { id: "sqlite", status: existsSync(dbPath) ? "ok" : "warn", detail: dbPath },
        { id: "huggingface-auth", status: auth.available ? "ok" : "warn", detail: auth.available ? `token available via ${auth.source}` : "anonymous Hub access only" },
        { id: "catalog", status: "ok", detail: JSON.stringify(store.catalogStats()) },
      ];
      const report = {
        ok: checks.every((check) => check.status !== "fail"),
        dataDir,
        dbPath,
        providers: [auth],
        checks,
      };
      printResult(report, checks.map((check) => `${check.id.padEnd(18)} ${check.status} ${check.detail}`).join("\n"), opts);
    } catch (error) {
      commandError(error);
    }
  });

program
  .command("manual")
  .description("Print the local command manual")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    const commands = [
      "models providers status --json",
      "models search \"tiny gpt2\" --limit 5 --json",
      "models info hf:sshleifer/tiny-gpt2 --json",
      "models files hf:sshleifer/tiny-gpt2 --json",
      "models install hf:sshleifer/tiny-gpt2 --include config.json --include tokenizer_config.json --max-bytes 5mb --json",
      "models index best --limit 100 --json",
      "models datasets search rotten_tomatoes --limit 5 --json",
    ];
    const manual = { name: "models", version: getPackageVersion(), commands };
    printResult(manual, commands.join("\n"), opts);
  });

program
  .command("goals")
  .description("Print the implementation goal chain")
  .option("-j, --json", "output JSON")
  .action((opts) => {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    const path = join(cliDir, "..", "..", "docs", "GOALS.md");
    const text = existsSync(path) ? readFileSync(path, "utf8") : "Goal chain not found.";
    if (isJson(opts)) {
      printJson({ path, bytes: existsSync(path) ? statSync(path).size : 0, text });
    } else {
      console.log(text);
    }
  });

program.parseAsync().catch(commandError);
