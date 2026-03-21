#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { createWriteStream } from "fs";
import { getCrawl, listCrawls, getCrawlStats } from "../db/crawls.js";
import { getPage, listPages, searchPages, getPageVersions } from "../db/pages.js";
import { getConfig, setConfig, resetConfig, getConfigPath } from "../lib/config.js";
import { fetchSitemap, type SitemapEntry } from "../lib/sitemap.js";
import { diffTexts } from "../lib/diff.js";
import type { ExportFormat } from "../types/index.js";

// These modules exist at runtime but are not yet written; typed as any to avoid type errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startCrawl, batchCrawl, recrawl } = await import("../lib/crawler.js").catch(() => ({
  startCrawl: null as any,
  batchCrawl: null as any,
  recrawl: null as any,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { checkAiProviders } = await import("../lib/ai.js").catch(() => ({
  checkAiProviders: null as any,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { exportCrawl } = await import("../lib/export.js").catch(() => ({
  exportCrawl: null as any,
}));

const program = new Command();

program
  .name("crawl")
  .description("AI-powered web crawler — crawl, extract, search")
  .version("0.1.0");

// ─── crawl <url> ─────────────────────────────────────────────────────────────

program
  .command("crawl <url>")
  .description("Crawl a URL (single page or recursive)")
  .option("-d, --depth <n>", "crawl depth", "1")
  .option("-m, --max-pages <n>", "max pages to crawl", "100")
  .option("--render", "use Playwright JS rendering")
  .option("--screenshot", "capture screenshots")
  .option("--delay <ms>", "delay between requests (ms)", "1000")
  .option("--extract <schema>", "AI extraction schema (JSON string)")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: {
    depth: string;
    maxPages: string;
    render?: boolean;
    screenshot?: boolean;
    delay: string;
    extract?: string;
    json?: boolean;
  }) => {
    try {
      const depth = parseInt(opts.depth, 10);
      const maxPages = parseInt(opts.maxPages, 10);
      const delay = parseInt(opts.delay, 10);

      if (!opts.json) {
        process.stderr.write(
          chalk.cyan(`Crawling ${url}`) +
          (depth > 1 ? chalk.gray(` (depth=${depth})`) : "") +
          "\n"
        );
      }

      const crawlResult = await startCrawl({
        url,
        depth,
        maxPages,
        options: {
          render: opts.render,
          screenshot: opts.screenshot,
          delay,
        },
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify(crawlResult, null, 2) + "\n");
        return;
      }

      const crawl = getCrawl(crawlResult.id);
      if (!crawl) {
        process.stderr.write(chalk.red("Crawl failed: could not retrieve result\n"));
        process.exit(1);
      }

      process.stderr.write(chalk.green("✓ Crawl complete") + "\n");
      process.stderr.write(`  ${chalk.bold("ID:")}     ${chalk.cyan(crawl.id)}\n`);
      process.stderr.write(`  ${chalk.bold("Status:")} ${formatStatus(crawl.status)}\n`);
      process.stderr.write(`  ${chalk.bold("Pages:")}  ${chalk.white(String(crawl.pagesCrawled))}\n`);

      const pages = listPages(crawl.id, { limit: 5 });
      if (pages.length > 0) {
        process.stderr.write("\n" + chalk.bold("Pages crawled:") + "\n");
        for (const page of pages) {
          const statusColor = page.statusCode === 200 ? chalk.green : chalk.yellow;
          process.stderr.write(
            `  ${statusColor(String(page.statusCode ?? "?"))}  ` +
            `${chalk.cyan(page.url.slice(0, 80))}` +
            (page.title ? chalk.gray(` — ${page.title.slice(0, 50)}`) : "") +
            "\n"
          );
        }
        if (crawl.pagesCrawled > 5) {
          process.stderr.write(chalk.gray(`  ... and ${crawl.pagesCrawled - 5} more\n`));
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── list ─────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List all crawl jobs")
  .option("--status <status>", "filter by status (pending|running|completed|failed)")
  .option("--json", "output as JSON")
  .action((opts: { status?: string; json?: boolean }) => {
    try {
      const crawls = listCrawls({ status: opts.status, limit: 50 });

      if (opts.json) {
        process.stdout.write(JSON.stringify(crawls, null, 2) + "\n");
        return;
      }

      if (crawls.length === 0) {
        process.stderr.write(chalk.gray("No crawl jobs found.\n"));
        return;
      }

      process.stderr.write(chalk.bold(`${crawls.length} crawl job(s):\n\n`));
      for (const crawl of crawls) {
        process.stderr.write(
          `  ${chalk.cyan(crawl.id.slice(0, 8))}  ` +
          `${formatStatus(crawl.status).padEnd(18)}  ` +
          `${chalk.white(String(crawl.pagesCrawled).padStart(4))} pages  ` +
          `${chalk.blue(crawl.url.slice(0, 60))}\n`
        );
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── status <crawl-id> ────────────────────────────────────────────────────────

program
  .command("status <crawl-id>")
  .description("Show crawl job details and stats")
  .option("--json", "output as JSON")
  .action((crawlId: string, opts: { json?: boolean }) => {
    try {
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
        process.exit(1);
      }

      const stats = getCrawlStats(crawlId);

      if (opts.json) {
        process.stdout.write(JSON.stringify({ crawl, stats }, null, 2) + "\n");
        return;
      }

      process.stderr.write(chalk.bold("Crawl Details\n") + chalk.gray("─".repeat(50)) + "\n");
      process.stderr.write(`  ${chalk.bold("ID:")}          ${chalk.cyan(crawl.id)}\n`);
      process.stderr.write(`  ${chalk.bold("URL:")}         ${chalk.blue(crawl.url)}\n`);
      process.stderr.write(`  ${chalk.bold("Status:")}      ${formatStatus(crawl.status)}\n`);
      process.stderr.write(`  ${chalk.bold("Pages:")}       ${crawl.pagesCrawled} / ${crawl.maxPages}\n`);
      process.stderr.write(`  ${chalk.bold("Depth:")}       ${crawl.depth}\n`);
      process.stderr.write(`  ${chalk.bold("Created:")}     ${crawl.createdAt}\n`);
      if (crawl.completedAt) {
        process.stderr.write(`  ${chalk.bold("Completed:")}   ${crawl.completedAt}\n`);
      }
      if (crawl.errorMessage) {
        process.stderr.write(`  ${chalk.bold("Error:")}       ${chalk.red(crawl.errorMessage)}\n`);
      }

      process.stderr.write("\n" + chalk.bold("Stats\n") + chalk.gray("─".repeat(50)) + "\n");
      process.stderr.write(`  ${chalk.bold("Total pages:")}    ${stats.total}\n`);
      process.stderr.write(`  ${chalk.bold("Avg word count:")} ${Math.round(stats.avgWordCount)}\n`);
      if (Object.keys(stats.statusCodes).length > 0) {
        process.stderr.write(`  ${chalk.bold("Status codes:")}\n`);
        for (const [code, count] of Object.entries(stats.statusCodes)) {
          const color = code.startsWith("2") ? chalk.green : code.startsWith("4") ? chalk.yellow : chalk.red;
          process.stderr.write(`    ${color(code)}: ${count}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── pages <crawl-id> ────────────────────────────────────────────────────────

program
  .command("pages <crawl-id>")
  .description("List pages in a crawl")
  .option("--limit <n>", "max pages to show", "20")
  .option("--json", "output as JSON")
  .action((crawlId: string, opts: { limit: string; json?: boolean }) => {
    try {
      const pages = listPages(crawlId, { limit: parseInt(opts.limit, 10) });

      if (opts.json) {
        process.stdout.write(JSON.stringify(pages, null, 2) + "\n");
        return;
      }

      if (pages.length === 0) {
        process.stderr.write(chalk.gray("No pages found for this crawl.\n"));
        return;
      }

      process.stderr.write(chalk.bold(`${pages.length} page(s):\n\n`));
      for (const page of pages) {
        const statusColor =
          (page.statusCode ?? 0) >= 200 && (page.statusCode ?? 0) < 300
            ? chalk.green
            : chalk.yellow;
        process.stderr.write(
          `  ${chalk.cyan(page.id.slice(0, 8))}  ` +
          `${statusColor(String(page.statusCode ?? "?").padEnd(3))}  ` +
          `${String(page.wordCount ?? 0).padStart(6)} words  ` +
          `${chalk.blue(page.url.slice(0, 60))}\n`
        );
        if (page.title) {
          process.stderr.write(`          ${chalk.gray(page.title.slice(0, 70))}\n`);
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── get <page-id> ────────────────────────────────────────────────────────────

program
  .command("get <page-id>")
  .description("Show page content")
  .option("--format <fmt>", "output format: md | text", "md")
  .option("--json", "output as JSON")
  .action((pageId: string, opts: { format: string; json?: boolean }) => {
    try {
      const page = getPage(pageId);
      if (!page) {
        process.stderr.write(chalk.red(`Page not found: ${pageId}\n`));
        process.exit(1);
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(page, null, 2) + "\n");
        return;
      }

      process.stderr.write(chalk.bold(page.title ?? "(no title)") + "\n");
      process.stderr.write(chalk.blue(page.url) + "\n");
      process.stderr.write(
        chalk.gray(`${page.wordCount ?? 0} words  ·  status ${page.statusCode ?? "?"}`) + "\n"
      );
      process.stderr.write(chalk.gray("─".repeat(60)) + "\n\n");

      const content =
        opts.format === "text"
          ? page.textContent
          : page.markdownContent ?? page.textContent;

      if (content) {
        process.stdout.write(content + "\n");
      } else {
        process.stderr.write(chalk.gray("(no content)\n"));
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── search <query> ───────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Full-text search across crawled pages")
  .option("--domain <domain>", "filter by domain")
  .option("--crawl-id <id>", "filter by crawl ID")
  .option("--limit <n>", "max results", "10")
  .option("--json", "output as JSON")
  .action(
    (
      query: string,
      opts: { domain?: string; crawlId?: string; limit: string; json?: boolean }
    ) => {
      try {
        const results = searchPages(query, {
          domain: opts.domain,
          crawlId: opts.crawlId,
          limit: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(results, null, 2) + "\n");
          return;
        }

        if (results.length === 0) {
          process.stderr.write(chalk.gray(`No results for "${query}"\n`));
          return;
        }

        process.stderr.write(chalk.bold(`${results.length} result(s) for "${query}":\n\n`));
        for (const result of results) {
          process.stderr.write(
            `  ${chalk.cyan(result.page.id.slice(0, 8))}  ` +
            `${chalk.blue(result.page.url.slice(0, 70))}\n`
          );
          if (result.page.title) {
            process.stderr.write(`  ${chalk.bold(result.page.title)}\n`);
          }
          process.stderr.write(`  ${chalk.gray(result.snippet)}\n\n`);
        }
      } catch (err) {
        process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
        process.exit(1);
      }
    }
  );

// ─── export <crawl-id> ────────────────────────────────────────────────────────

program
  .command("export <crawl-id>")
  .description("Export a crawl to file")
  .option("--format <fmt>", "output format: json | md | csv", "json")
  .option("--output <path>", "output file path (default: stdout)")
  .option("--json", "output as JSON to stdout")
  .action(
    async (
      crawlId: string,
      opts: { format: string; output?: string; json?: boolean }
    ) => {
      try {
        const crawl = getCrawl(crawlId);
        if (!crawl) {
          process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
          process.exit(1);
        }

        if (!opts.json) {
          process.stderr.write(
            chalk.cyan(`Exporting crawl ${crawlId} as ${opts.format}...\n`)
          );
        }

        const format = opts.format as ExportFormat;
        const content: unknown = await exportCrawl(crawlId, format);
        const out =
          typeof content === "string" ? content : JSON.stringify(content, null, 2);

        if (opts.output) {
          const stream = createWriteStream(opts.output, "utf-8");
          stream.write(out);
          stream.end();
          process.stderr.write(chalk.green(`✓ Exported to ${opts.output}\n`));
        } else {
          process.stdout.write(out + "\n");
        }
      } catch (err) {
        process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
        process.exit(1);
      }
    }
  );

// ─── sitemap <url> ────────────────────────────────────────────────────────────

program
  .command("sitemap <url>")
  .description("Discover URLs from sitemap.xml")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: { json?: boolean }) => {
    try {
      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Fetching sitemap from ${url}...\n`));
      }

      const entries: SitemapEntry[] = await fetchSitemap(url);

      if (opts.json) {
        process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
        return;
      }

      process.stderr.write(chalk.green(`✓ Found ${entries.length} URL(s):\n\n`));
      for (const entry of entries) {
        process.stdout.write(entry.url + "\n");
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── recrawl <crawl-id> ───────────────────────────────────────────────────────

program
  .command("recrawl <crawl-id>")
  .description("Re-crawl all pages in a crawl job and detect changes")
  .option("--json", "output as JSON")
  .action(async (crawlId: string, opts: { json?: boolean }) => {
    try {
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
        process.exit(1);
      }

      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Re-crawling ${crawl.url}...\n`));
      }

      // recrawl returns an opaque result from the crawler module (runtime only)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (recrawl as any)(crawlId)) as { pagesCrawled: number; changesDetected: number };

      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      process.stderr.write(chalk.green("✓ Recrawl complete\n"));
      process.stderr.write(`  ${chalk.bold("Pages re-crawled:")} ${result.pagesCrawled}\n`);
      process.stderr.write(
        `  ${chalk.bold("Changes detected:")} ${chalk.yellow(String(result.changesDetected))}\n`
      );
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── batch <url1> <url2> ... ─────────────────────────────────────────────────

program
  .command("batch <urls...>")
  .description("Crawl multiple URLs")
  .option("--render", "use Playwright JS rendering")
  .option("--screenshot", "capture screenshots")
  .option("--delay <ms>", "delay between requests (ms)", "1000")
  .option("--json", "output as JSON")
  .action(
    async (
      urls: string[],
      opts: { render?: boolean; screenshot?: boolean; delay: string; json?: boolean }
    ) => {
      try {
        if (!opts.json) {
          process.stderr.write(chalk.cyan(`Crawling ${urls.length} URL(s)...\n`));
        }

        const results: Array<{
          url: string;
          status: string;
          pagesCrawled: number;
          error?: string;
        }> = await batchCrawl(urls, {
          render: opts.render,
          screenshot: opts.screenshot,
          delay: parseInt(opts.delay, 10),
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(results, null, 2) + "\n");
          return;
        }

        process.stderr.write(chalk.green(`✓ Batch crawl complete\n\n`));
        for (const result of results) {
          const statusIcon =
            result.status === "completed" ? chalk.green("✓") : chalk.red("✗");
          process.stderr.write(
            `  ${statusIcon}  ${chalk.blue(result.url.slice(0, 70))}` +
            (result.error
              ? chalk.red(` — ${result.error}`)
              : chalk.gray(` — ${result.pagesCrawled} pages`)) +
            "\n"
          );
        }
      } catch (err) {
        process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
        process.exit(1);
      }
    }
  );

// ─── diff <page-id> ───────────────────────────────────────────────────────────

program
  .command("diff <page-id>")
  .description("Show content diff for a page compared to its previous version")
  .option("--json", "output as JSON")
  .action(async (pageId: string, opts: { json?: boolean }) => {
    try {
      const page = getPage(pageId);
      if (!page) {
        process.stderr.write(chalk.red(`Page not found: ${pageId}\n`));
        process.exit(1);
      }

      const versions = getPageVersions(pageId);
      const previous = versions[0];
      if (!previous) {
        process.stderr.write(
          chalk.gray("No previous version found — crawl this page again to compare.\n")
        );
        return;
      }

      const oldText = previous.textContent ?? "";
      const newText = page.textContent ?? "";

      const summary = diffTexts(oldText, newText);

      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            pageId,
            url: page.url,
            previousVersion: previous.crawledAt,
            currentVersion: page.crawledAt,
            summary,
          }, null, 2) + "\n"
        );
        return;
      }

      process.stderr.write(chalk.bold(page.title ?? page.url) + "\n");
      process.stderr.write(chalk.gray("─".repeat(60)) + "\n");
      process.stderr.write(
        chalk.gray(`Previous: ${previous.crawledAt}  →  Current: ${page.crawledAt}`) + "\n\n"
      );
      process.stderr.write(chalk.bold("Changes: ") + summary + "\n");
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── config [view|set|reset] [key] [value] ───────────────────────────────────

program
  .command("config [action] [key] [value]")
  .description("Manage configuration (view|set|reset)")
  .action((action = "view", key?: string, value?: string) => {
    try {
      if (!action || action === "view") {
        const config = getConfig();
        process.stderr.write(
          chalk.bold("Configuration\n") + chalk.gray("─".repeat(50)) + "\n"
        );
        process.stderr.write(chalk.gray(`  Path: ${getConfigPath()}\n\n`));
        for (const [k, v] of Object.entries(config)) {
          process.stderr.write(
            `  ${chalk.cyan(k.padEnd(28))} ${chalk.white(JSON.stringify(v))}\n`
          );
        }
        return;
      }

      if (action === "set") {
        if (!key || value === undefined) {
          process.stderr.write(chalk.red("Usage: crawl config set <key> <value>\n"));
          process.exit(1);
        }
        const updates = { [key]: parseConfigValue(value) } as Parameters<typeof setConfig>[0];
        const updated = setConfig(updates);
        const displayVal = updated[key as keyof typeof updated];
        process.stderr.write(
          chalk.green(`✓ Set ${key} = ${JSON.stringify(displayVal)}\n`)
        );
        return;
      }

      if (action === "reset") {
        const config = resetConfig();
        process.stderr.write(chalk.green("✓ Config reset to defaults\n"));
        for (const [k, v] of Object.entries(config)) {
          process.stderr.write(
            `  ${chalk.cyan(k.padEnd(28))} ${chalk.white(JSON.stringify(v))}\n`
          );
        }
        return;
      }

      process.stderr.write(chalk.red(`Unknown config action: ${action}\n`));
      process.stderr.write(
        chalk.gray("Usage: crawl config [view|set|reset] [key] [value]\n")
      );
      process.exit(1);
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── providers ────────────────────────────────────────────────────────────────

program
  .command("providers")
  .description("Show AI provider status")
  .option("--json", "output as JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      const providers = (await checkAiProviders()) as Record<
        string,
        { available: boolean; model?: string; error?: string }
      >;

      if (opts.json) {
        process.stdout.write(JSON.stringify(providers, null, 2) + "\n");
        return;
      }

      process.stderr.write(
        chalk.bold("AI Providers\n") + chalk.gray("─".repeat(40)) + "\n"
      );
      for (const [name, info] of Object.entries(providers)) {
        const icon = info.available ? chalk.green("✓") : chalk.red("✗");
        const status = info.available
          ? chalk.green("available") +
            (info.model ? chalk.gray(` (${info.model})`) : "")
          : chalk.red("unavailable") +
            (info.error ? chalk.gray(` — ${info.error}`) : "");
        process.stderr.write(
          `  ${icon}  ${chalk.cyan(name.padEnd(15))}  ${status}\n`
        );
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── serve [--port 19700] ────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the REST API server")
  .option("-p, --port <port>", "port to listen on", "19700")
  .action(async (opts: { port: string }) => {
    try {
      const port = parseInt(opts.port, 10);
      process.stderr.write(chalk.cyan(`Starting server on port ${port}...\n`));
      // Dynamically import the server to avoid pulling it into the CLI bundle
      // @ts-ignore — server/index.ts is a separate entry point built independently
      const mod = await import("../server/index.js") as { startServer: (port: number) => Promise<void> };
      await mod.startServer(port);
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── mcp [--claude|--codex|--gemini|--all] ───────────────────────────────────

program
  .command("mcp")
  .description("Install the MCP server into AI agent configs")
  .option("--claude", "install into Claude Code (user scope)")
  .option("--codex", "install into Codex")
  .option("--gemini", "install into Gemini")
  .option("--all", "install into all supported agents")
  .action(
    (opts: { claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }) => {
      const installClaude = opts.claude || opts.all;
      const installCodex = opts.codex || opts.all;
      const installGemini = opts.gemini || opts.all;

      if (!installClaude && !installCodex && !installGemini) {
        process.stderr.write(
          chalk.yellow("Specify a target: --claude, --codex, --gemini, or --all\n")
        );
        process.exit(1);
      }

      if (installClaude) {
        try {
          process.stderr.write(chalk.cyan("Installing into Claude Code...\n"));
          execSync("claude mcp add --transport stdio --scope user crawl -- crawl-mcp", {
            stdio: "inherit",
          });
          process.stderr.write(
            chalk.green("✓ Installed into Claude Code (user scope)\n")
          );
          process.stderr.write(
            chalk.gray("  Restart Claude Code for changes to take effect.\n")
          );
        } catch (err) {
          process.stderr.write(
            chalk.red(
              `Failed to install into Claude Code: ${(err as Error).message}\n`
            )
          );
        }
      }

      if (installCodex) {
        process.stderr.write(
          chalk.yellow("Codex install: append to ~/.codex/config.toml:\n")
        );
        process.stderr.write(
          chalk.gray(
            "\n[mcp_servers.crawl]\ncommand = \"crawl-mcp\"\nargs = []\n\n"
          )
        );
      }

      if (installGemini) {
        process.stderr.write(
          chalk.yellow(
            "Gemini install: add to ~/.gemini/settings.json under mcpServers:\n"
          )
        );
        process.stderr.write(
          chalk.gray(
            '\n"crawl": {\n  "command": "crawl-mcp",\n  "args": []\n}\n\n'
          )
        );
      }
    }
  );

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatStatus(status: string): string {
  switch (status) {
    case "completed": return chalk.green("completed");
    case "running":   return chalk.cyan("running");
    case "pending":   return chalk.yellow("pending");
    case "failed":    return chalk.red("failed");
    case "cancelled": return chalk.gray("cancelled");
    default:          return chalk.gray(status);
  }
}

function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(chalk.red(`Fatal: ${(err as Error).message}\n`));
  process.exit(1);
});
