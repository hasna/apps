#!/usr/bin/env bun
import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ChangelogClient } from "../client.js";
import { generateChangelogMarkdown } from "../markdown.js";
import { publishChangelog } from "../publisher.js";
import { LocalChangelogStore, resolveChangelogFilePath } from "../storage.js";
import type {
  ChangelogEntryInput,
  ChangelogEntryListFilter,
  ChangelogEntryUpdate,
  ChangelogKind,
  ChangelogLink,
  JsonObject,
} from "../types.js";
import { parseChangelogKind } from "../validation.js";
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

function commonFilter(options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string }): ChangelogEntryListFilter {
  return {
    appId: options.app,
    version: options.version,
    kind: options.kind ? parseChangelogKind(options.kind) : undefined,
    tag: options.tag,
    limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
  };
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
    .requiredOption("--app <appId>", "Application id or slug")
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
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (title: string, options: Record<string, string | string[] | undefined>) => {
      const input: ChangelogEntryInput = {
        appId: String(options.app),
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
      printJson(client ? await client.add(input) : await localStore().createEntry(input, { source: "cli" }));
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
      const filter = commonFilter(options);
      const markdown = client
        ? await client.generate({ ...filter, title: options.title })
        : generateChangelogMarkdown(await localStore().listEntries({ ...filter, limit: filter.limit ?? 500 }), {
          ...filter,
          title: options.title,
        });
      process.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    });

  program
    .command("publish")
    .description("Preview or write a generated CHANGELOG.md")
    .option("--app <appId>", "Filter by app id")
    .option("--version <version>", "Filter by version")
    .option("--kind <kind>", "Filter by kind/category")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit entries", "500")
    .option("--title <title>", "Markdown title")
    .option("--target <path>", "Target changelog file", "CHANGELOG.md")
    .option("--dry-run", "Preview without writing", true)
    .option("--write", "Write the target file")
    .option("--json", "Print JSON result instead of Markdown preview")
    .option("--api-url <url>", "Remote Open Changelog API URL")
    .action(async (options: { app?: string; version?: string; kind?: string; tag?: string; limit?: string; title?: string; target: string; dryRun?: boolean; write?: boolean; json?: boolean; apiUrl?: string }) => {
      const client = maybeClient(options);
      const filter = commonFilter(options);
      const result = client
        ? await client.publish({ ...filter, title: options.title, targetPath: options.target, write: options.write === true })
        : await publishChangelog({
          ...filter,
          title: options.title,
          targetPath: options.target,
          write: options.write === true,
        });
      if (options.json || result.mode === "write") {
        printJson(result);
      } else {
        process.stdout.write(result.markdown.endsWith("\n") ? result.markdown : `${result.markdown}\n`);
      }
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
