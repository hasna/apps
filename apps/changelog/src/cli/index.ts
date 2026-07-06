#!/usr/bin/env bun
import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ChangelogClient } from "../client.js";
import { generateChangelogMarkdown } from "../markdown.js";
import { publishChangelog } from "../publisher.js";
import { publishRelease } from "../release.js";
import { generateChangelogSite } from "../web.js";
import { readProjectInfo } from "../project.js";
import { LocalChangelogStore, resolveChangelogFilePath } from "../storage.js";
import type {
  ChangelogEntryInput,
  ChangelogEntryListFilter,
  ChangelogEntryUpdate,
  ChangelogKind,
  ChangelogLink,
  JsonObject,
} from "../types.js";
import { normalizeAppId, parseChangelogKind } from "../validation.js";
import { VERSION } from "../version.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseTags(values: string[] | undefined): string[] {
  return values?.flatMap((value) => value.split(",")).map((tag) => tag.trim()).filter(Boolean) ?? [];
}

function parseMetadata(value: string | undefined): JsonObject | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--metadata must be a JSON object");
  return parsed as JsonObject;
}

function parseLinks(values: string[] | undefined): ChangelogLink[] {
  return values?.map((value) => {
    const separator = value.indexOf("=");
    if (separator === -1) return { url: value };
    return {
      label: value.slice(0, separator),
      url: value.slice(separator + 1),
    };
  }) ?? [];
}

function maybeClient(options: { apiUrl?: string }): ChangelogClient | null {
  if (!options.apiUrl) return null;
  return new ChangelogClient({
    baseUrl: options.apiUrl,
    token: process.env["CHANGELOG_API_TOKEN"],
  });
}

function localStore(): LocalChangelogStore {
  return new LocalChangelogStore();
}

/**
 * Normalize a user-supplied `--app` value the same way entries are normalized
 * on write (`@hasna/todos` -> `open-todos`) so filters match stored appIds.
 * Values that cannot be normalized fall back to the raw string, keeping
 * exact-match behavior for legacy stored ids.
 */
function normalizeAppFilter(app: string | undefined): string | undefined {
  if (!app) return undefined;
  try {
    return normalizeAppId(app);
  } catch {
    return app;
  }
}

function commonFilter(options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string }): ChangelogEntryListFilter {
  return {
    appId: normalizeAppFilter(options.app),
    version: options.version,
    kind: options.kind ? parseChangelogKind(options.kind) : undefined,
    tag: options.tag,
    limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
  };
}

async function inferredAppId(app: string | undefined): Promise<string | undefined> {
  return app ? normalizeAppFilter(app) : (await readProjectInfo()).appId;
}

async function requiredAppId(app: string | undefined): Promise<string> {
  const resolved = await inferredAppId(app);
  if (!resolved) throw new Error("--app is required when package.json name cannot be inferred");
  return resolved;
}

async function inferredRepositoryUrl(): Promise<string | undefined> {
  return (await readProjectInfo()).repositoryUrl;
}

function updateFromOptions(options: Record<string, string | string[] | undefined>): ChangelogEntryUpdate {
  return {
    appId: options.app as string | undefined,
    version: options.version as string | undefined,
    kind: options.kind as ChangelogKind | undefined,
    title: options.title as string | undefined,
    message: options.message as string | undefined,
    details: options.details as string | undefined,
    date: options.date as string | undefined,
    author: options.author as string | undefined,
    tags: options.tag ? parseTags(options.tag as string[]) : undefined,
    links: options.link ? parseLinks(options.link as string[]) : undefined,
    commits: options.commit ? parseTags(options.commit as string[]) : undefined,
    tasks: options.task ? parseTags(options.task as string[]) : undefined,
    metadata: parseMetadata(options.metadata as string | undefined),
  };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("changelog")
    .description("Collect, generate, and publish Open Changelog entries")
    .version(VERSION, "-V, --cli-version", "output the CLI version number");

  program
    .command("init")
    .description("Create the local Open Changelog data directory")
    .action(() => {
      const filePath = resolveChangelogFilePath();
      mkdirSync(dirname(filePath), { recursive: true });
      printJson({ dataFile: filePath });
    });

  program
    .command("add")
    .description("Add a changelog entry locally or through an API")
    .argument("<title>", "Entry title")
    .option("--app <appId>", "Application id or slug; inferred from package.json when omitted")
    .option("--version <version>", "Application version", "Unreleased")
    .option("--kind <kind>", "Entry kind: added, changed, deprecated, removed, fixed, security, or other", "changed")
    .option("--message <message>", "Short message")
    .option("--details <details>", "Detailed body text")
    .option("--date <date>", "Entry date as YYYY-MM-DD")
    .option("--author <author>", "Author or source actor")
    .option("--tag <tag...>", "Tag; can be repeated or comma-separated")
    .option("--link <link...>", "Link as URL or label=URL; can be repeated")
    .option("--commit <commit...>", "Commit sha/ref; can be repeated")
    .option("--task <task...>", "Task id/ref; can be repeated")
    .option("--metadata <json>", "JSON object metadata")
    .option("--allow-duplicate", "Allow an entry with the same app/version/kind/title/tasks/commits")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (title: string, options: Record<string, string | string[] | boolean | undefined>) => {
      const input: ChangelogEntryInput = {
        appId: await requiredAppId(options.app as string | undefined),
        version: options.version as string | undefined,
        kind: options.kind as ChangelogKind | undefined,
        title,
        message: options.message as string | undefined,
        details: options.details as string | undefined,
        date: options.date as string | undefined,
        author: options.author as string | undefined,
        tags: parseTags(options.tag as string[] | undefined),
        links: parseLinks(options.link as string[] | undefined),
        commits: parseTags(options.commit as string[] | undefined),
        tasks: parseTags(options.task as string[] | undefined),
        metadata: parseMetadata(options.metadata as string | undefined),
      };
      const client = maybeClient({ apiUrl: options.apiUrl as string | undefined });
      const allowDuplicate = options.allowDuplicate === true;
      printJson(client ? await client.add(input, { allowDuplicate }) : await localStore().createEntry(input, {
        source: "cli",
        allowDuplicate,
      }));
    });

  program
    .command("list")
    .description("List changelog entries")
    .option("--app <appId>", "Filter by app id")
    .option("--version <version>", "Filter by version")
    .option("--kind <kind>", "Filter by kind/category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit results", "50")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string; apiUrl?: string }) => {
      const filter = commonFilter(options);
      const client = maybeClient(options);
      printJson(client ? await client.list(filter) : await localStore().listEntries(filter));
    });

  program
    .command("show")
    .description("Show one changelog entry")
    .argument("<id>", "Changelog entry id")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (id: string, options: { apiUrl?: string }) => {
      const client = maybeClient(options);
      const item = client ? await client.get(id) : await localStore().getEntry(id);
      if (!item) {
        console.error(`Changelog entry not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("update")
    .description("Update one changelog entry")
    .argument("<id>", "Changelog entry id")
    .option("--app <appId>", "Application id or slug")
    .option("--version <version>", "Application version")
    .option("--kind <kind>", "Entry kind/category")
    .option("--title <title>", "Entry title")
    .option("--message <message>", "Short message")
    .option("--details <details>", "Detailed body text")
    .option("--date <date>", "Entry date as YYYY-MM-DD")
    .option("--author <author>", "Author or source actor")
    .option("--tag <tag...>", "Replace tags; can be repeated or comma-separated")
    .option("--link <link...>", "Replace links as URL or label=URL; can be repeated")
    .option("--commit <commit...>", "Replace commit refs; can be repeated")
    .option("--task <task...>", "Replace task refs; can be repeated")
    .option("--metadata <json>", "Replace JSON object metadata")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (id: string, options: Record<string, string | string[] | undefined>) => {
      const client = maybeClient({ apiUrl: options.apiUrl as string | undefined });
      const update = updateFromOptions(options);
      const item = client ? await client.update(id, update) : await localStore().updateEntry(id, update);
      if (!item) {
        console.error(`Changelog entry not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("generate")
    .description("Generate Keep a Changelog style Markdown")
    .option("--app <appId>", "Filter by app id")
    .option("--version <version>", "Filter by version")
    .option("--kind <kind>", "Filter by kind/category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit entries", "500")
    .option("--title <title>", "Markdown title")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string; title?: string; apiUrl?: string }) => {
      const client = maybeClient(options);
      const filter = commonFilter({ ...options, app: await inferredAppId(options.app) });
      const repositoryUrl = await inferredRepositoryUrl();
      const markdown = client
        ? await client.generate({ ...filter, title: options.title, repositoryUrl })
        : generateChangelogMarkdown(await localStore().listEntries({ ...filter, limit: filter.limit ?? 500 }), {
          ...filter,
          title: options.title,
          repositoryUrl,
        });
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });

  program
    .command("release")
    .description("Promote Unreleased entries for an app to a version")
    .requiredOption("--version <version>", "Release version")
    .option("--app <appId>", "Application id or slug; inferred from package.json when omitted")
    .option("--from-version <version>", "Source version bucket", "Unreleased")
    .option("--date <date>", "Release date as YYYY-MM-DD")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version: string; fromVersion?: string; date?: string; apiUrl?: string }) => {
      const input = {
        appId: await requiredAppId(options.app),
        version: options.version,
        fromVersion: options.fromVersion,
        date: options.date,
      };
      const client = maybeClient(options);
      printJson(client ? await client.release(input) : await localStore().releaseEntries(input));
    });

  program
    .command("publish")
    .description("Preview or write a generated CHANGELOG.md; with --release, promote appId+version and return a changelogRef")
    .option("--app <appId>", "Filter by app id")
    .option("--version <version>", "Filter by version")
    .option("--kind <kind>", "Filter by kind/category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit entries", "500")
    .option("--title <title>", "Markdown title")
    .option("--target <path>", "Target changelog file", "CHANGELOG.md")
    .option("--dry-run", "Preview without writing (the default unless --write is passed; not supported with --release)")
    .option("--write", "Write the target file")
    .option("--release", "Release-publish for open-releases: promote pending entries to --version, write the changelog, and print a changelogRef")
    .option("--from-version <version>", "Source bucket promoted by --release", "Unreleased")
    .option("--date <date>", "Release date as YYYY-MM-DD used by --release")
    .option("--base-url <url>", "Published changelog site base URL used for the changelogRef uri")
    .option("--diff", "Print a line diff during dry-run or include it in JSON")
    .option("--no-backup", "Do not write a backup before overwriting an existing file")
    .option("--json", "Print JSON result instead of Markdown preview")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string; title?: string; target: string; dryRun?: boolean; write?: boolean; release?: boolean; fromVersion?: string; date?: string; baseUrl?: string; diff?: boolean; backup?: boolean; json?: boolean; apiUrl?: string }) => {
      if (options.release) {
        if (!options.version) throw new Error("--release requires --version");
        if (options.dryRun) {
          throw new Error("--dry-run is not supported with --release: release-publish promotes entries in the store and writes the changelog. Preview pending entries with `changelog generate` first.");
        }
        const result = await publishRelease({
          appId: await requiredAppId(options.app),
          version: options.version,
          fromVersion: options.fromVersion,
          date: options.date,
          targetPath: options.target,
          title: options.title,
          repositoryUrl: await inferredRepositoryUrl(),
          baseUrl: options.baseUrl,
          write: options.write !== false,
        });
        printJson(result);
        return;
      }
      const client = maybeClient(options);
      const filter = commonFilter({ ...options, app: await inferredAppId(options.app) });
      const repositoryUrl = await inferredRepositoryUrl();
      const result = client
        ? await client.publish({
          ...filter,
          title: options.title,
          repositoryUrl,
          targetPath: options.target,
          write: options.write === true,
          diff: options.diff === true,
          backup: options.backup !== false,
        })
        : await publishChangelog({
          ...filter,
          title: options.title,
          repositoryUrl,
          targetPath: options.target,
          write: options.write === true,
          diff: options.diff === true,
          backup: options.backup !== false,
        });
      if (options.json || result.mode === "write") {
        printJson(result);
      } else if (options.diff) {
        process.stdout.write(result.diff || "No changes.\n");
      } else {
        process.stdout.write(result.markdown.endsWith("\n") ? result.markdown : `${result.markdown}\n`);
      }
    });

  program
    .command("web")
    .description("Generate a static web changelog site with per-app pages plus RSS and JSON feeds")
    .requiredOption("--out <dir>", "Output directory")
    .option("--app <appId>", "Restrict the site to one app")
    .option("--base-url <url>", "Public base URL for absolute feed links; when omitted, RSS/JSON feed link fields are dropped to keep feeds valid")
    .option("--title <title>", "Site title", "Changelogs")
    .option("--limit <n>", "Limit entries per app", "500")
    .action(async (options: { out: string; app?: string; baseUrl?: string; title?: string; limit?: string }) => {
      const result = await generateChangelogSite({
        outDir: options.out,
        appId: normalizeAppFilter(options.app),
        baseUrl: options.baseUrl,
        title: options.title,
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
      });
      printJson(result);
    });

  program
    .command("stats")
    .description("Show changelog stats")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { apiUrl?: string }) => {
      const client = maybeClient(options);
      printJson(client ? await client.stats() : await localStore().stats());
    });

  program
    .command("export")
    .description("Export changelog entries")
    .option("--app <appId>", "Filter by app id")
    .option("--version <version>", "Filter by version")
    .option("--kind <kind>", "Filter by kind/category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit results", "500")
    .option("--format <format>", "json or jsonl", "jsonl")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string; format: string; apiUrl?: string }) => {
      const filter = commonFilter(options);
      const client = maybeClient(options);
      if (options.format === "json") {
        printJson(client ? await client.list(filter) : await localStore().listEntries(filter));
        return;
      }
      process.stdout.write(client ? await client.exportJsonl(filter) : await localStore().exportJsonl(filter));
    });

  await program.parseAsync(argv);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/cli/index.ts") ||
  process.argv[1]?.endsWith("/cli/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
