#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { createWriteStream } from "fs";
import { getCrawl, listCrawls, getCrawlStats, deleteCrawl, getGlobalStats } from "../db/crawls.js";
import { getPage, listPages, searchPages, getPageVersions } from "../db/pages.js";
import { getConfig, setConfig, resetConfig, getConfigPath } from "../lib/config.js";
import { fetchSitemap, type SitemapEntry } from "../lib/sitemap.js";
import { diffTexts } from "../lib/diff.js";
import type { ExportFormat } from "../types/index.js";
import { createWebhook, getWebhook, listWebhooks, deleteWebhook, listDeliveries, createDelivery } from "../db/webhooks.js";
import { deliverWebhook } from "../lib/webhooks.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../db/api-keys.js";
import { getUsageSummary } from "../db/usage.js";

// These modules exist at runtime but are not yet written; typed as any to avoid type errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startCrawl, batchCrawl, recrawl, resumeCrawl, mapSite } = await import("../lib/crawler.js").catch(() => ({
  startCrawl: null as any,
  batchCrawl: null as any,
  recrawl: null as any,
  resumeCrawl: null as any,
  mapSite: null as any,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { crawlInSandbox, checkE2B } = await import("../lib/sandbox.js").catch(() => ({
  crawlInSandbox: null as any,
  checkE2B: null as any,
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
  .option("--include <pattern>", "only follow URLs matching this pattern (repeatable)")
  .option("--exclude <pattern>", "skip URLs matching this pattern (repeatable)")
  .option("--ignore-query-params", "treat URLs differing only in query string as the same")
  .option("--allow-subdomains", "also crawl subdomains of the root domain")
  .option("--allow-external", "follow links to external domains")
  .option("--no-main-content", "disable main-content stripping (include navs, headers, footers)")
  .option("--max-age <ms>", "return cached page if crawled within this window (ms)")
  .option("--proxy <url>", "HTTP/HTTPS proxy URL")
  .option("--skip-tls", "disable TLS certificate verification")
  .option("--actions <json>", "pre-scrape browser actions JSON array")
  .option("--prompt <text>", "run AI prompt against first page after crawl")
  .option("--sandbox", "run crawl inside an isolated e2b cloud sandbox")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: {
    depth: string;
    maxPages: string;
    render?: boolean;
    screenshot?: boolean;
    delay: string;
    extract?: string;
    include?: string | string[];
    exclude?: string | string[];
    ignoreQueryParams?: boolean;
    allowSubdomains?: boolean;
    allowExternal?: boolean;
    mainContent?: boolean;
    maxAge?: string;
    proxy?: string;
    skipTls?: boolean;
    actions?: string;
    prompt?: string;
    sandbox?: boolean;
    json?: boolean;
  }) => {
    try {
      const depth = parseInt(opts.depth, 10);
      const maxPages = parseInt(opts.maxPages, 10);
      const delay = parseInt(opts.delay, 10);

      // ─── Sandbox mode ────────────────────────────────────────────────────
      if (opts.sandbox) {
        const e2bStatus = checkE2B();
        if (!e2bStatus.available) {
          process.stderr.write(chalk.red(`Cannot use sandbox: ${e2bStatus.reason}\n`));
          process.exit(1);
        }
        if (!opts.json) process.stderr.write(chalk.cyan(`Crawling ${url} `) + chalk.yellow(`[sandbox]\n`));
        const result = await crawlInSandbox(
          { url, depth, maxPages },
          {
            onOutput: opts.json ? undefined : (line: string) => process.stderr.write(chalk.gray(line + "\n")),
          }
        );
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stderr.write(chalk.green(`✓ Sandbox crawl complete\n`));
          process.stderr.write(`  ${chalk.bold("ID:")}       ${chalk.cyan(result.crawl.id)}\n`);
          process.stderr.write(`  ${chalk.bold("Pages:")}    ${result.pages.length}\n`);
          process.stderr.write(`  ${chalk.bold("Sandbox:")}  ${result.sandboxId}\n`);
          process.stderr.write(`  ${chalk.bold("Duration:")} ${(result.durationMs / 1000).toFixed(1)}s\n`);
        }
        return;
      }

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
          include: opts.include ? [opts.include].flat() : undefined,
          exclude: opts.exclude ? [opts.exclude].flat() : undefined,
          ignoreQueryParameters: opts.ignoreQueryParams,
          allowSubdomains: opts.allowSubdomains,
          allowExternalLinks: opts.allowExternal,
          onlyMainContent: opts.mainContent !== false ? true : false,
          maxAge: opts.maxAge ? parseInt(opts.maxAge, 10) : undefined,
          proxy: opts.proxy,
          skipTlsVerification: opts.skipTls,
          actions: opts.actions ? JSON.parse(opts.actions) : undefined,
          onProgress: opts.json ? undefined : ({ url: pageUrl, pageNumber }: { url: string; pageNumber: number }) => {
            process.stderr.write(chalk.gray(`  [${pageNumber}] ${pageUrl.slice(0, 90)}\n`));
          },
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

      // If --prompt is provided, run AI extraction on the first page
      if (opts.prompt) {
        const firstPages = listPages(crawl.id, { limit: 1 });
        if (firstPages[0]?.textContent) {
          const { extractWithPrompt } = await import("../lib/ai.js");
          const answer = await extractWithPrompt(firstPages[0].textContent, opts.prompt);
          process.stdout.write(answer + "\n");
        }
      }

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
  .option("--domain <domain>", "filter by domain")
  .option("--json", "output as JSON")
  .action((opts: { status?: string; domain?: string; json?: boolean }) => {
    try {
      const crawls = listCrawls({ status: opts.status, domain: opts.domain, limit: 50 });

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

// ─── stats ────────────────────────────────────────────────────────────────────

program
  .command("stats")
  .description("Show database stats and overview")
  .option("--json", "output as JSON")
  .action((opts: { json?: boolean }) => {
    try {
      const s = getGlobalStats();
      const usage = getUsageSummary();
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ...s, usage }, null, 2) + "\n");
        return;
      }
      process.stderr.write(chalk.bold("open-crawl stats\n") + chalk.gray("─".repeat(50)) + "\n");
      process.stderr.write(`  ${chalk.cyan("Total crawls:".padEnd(25))} ${chalk.white(String(s.totalCrawls))}\n`);
      process.stderr.write(`  ${chalk.cyan("Total pages:".padEnd(25))} ${chalk.white(String(s.totalPages))}\n`);
      process.stderr.write(`  ${chalk.cyan("Total words:".padEnd(25))} ${chalk.white(s.totalWords.toLocaleString())}\n`);
      process.stderr.write(`  ${chalk.cyan("Avg pages/crawl:".padEnd(25))} ${chalk.white(s.avgPagesPerCrawl.toFixed(1))}\n`);
      process.stderr.write(`  ${chalk.cyan("DB size:".padEnd(25))} ${chalk.white(formatBytes(s.dbSizeBytes))}\n`);
      if (s.topDomains.length > 0) {
        process.stderr.write("\n" + chalk.bold("Top domains:\n"));
        for (const d of s.topDomains) {
          process.stderr.write(`  ${chalk.blue((d.domain ?? "unknown").padEnd(40))} ${chalk.gray(String(d.pages) + " crawls")}\n`);
        }
      }
      process.stderr.write("\n" + chalk.bold("Credits used:\n"));
      process.stderr.write(`  ${chalk.cyan("Total credits:".padEnd(25))} ${chalk.white(String(usage.totalCredits))}\n`);
      if (Object.keys(usage.byType).length > 0) {
        for (const [type, info] of Object.entries(usage.byType)) {
          process.stderr.write(`  ${chalk.cyan(type.padEnd(25))} ${chalk.white(String(info.credits))} credits (${info.count} events)\n`);
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── clean ────────────────────────────────────────────────────────────────────

program
  .command("clean")
  .description("Remove failed/old crawls and reclaim disk space")
  .option("--failed", "remove all failed crawls")
  .option("--older-than <days>", "remove crawls older than N days")
  .option("--vacuum", "run SQLite VACUUM to reclaim space")
  .option("--json", "output as JSON")
  .action(async (opts: { failed?: boolean; olderThan?: string; vacuum?: boolean; json?: boolean }) => {
    try {
      const { getDb } = await import("../db/database.js");
      const db = getDb();
      let removed = 0;
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (opts.failed) {
        conditions.push("status = 'failed'");
      }
      if (opts.olderThan) {
        const cutoff = new Date(Date.now() - parseInt(opts.olderThan, 10) * 86400000).toISOString();
        conditions.push("created_at < ?");
        params.push(cutoff);
      }
      if (conditions.length > 0) {
        const stmt = db.prepare(`DELETE FROM crawls WHERE ${conditions.join(" AND ")}`);
        const result = stmt.run(...(params as Parameters<typeof stmt.run>));
        removed = result.changes;
      }
      if (opts.vacuum) {
        db.exec("VACUUM");
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify({ removed, vacuumed: opts.vacuum ?? false }) + "\n");
      } else {
        if (removed > 0) process.stderr.write(chalk.green(`✓ Removed ${removed} crawl(s)\n`));
        if (opts.vacuum) process.stderr.write(chalk.green("✓ Database vacuumed\n"));
        if (removed === 0 && !opts.vacuum) process.stderr.write(chalk.gray("Nothing to clean. Use --failed, --older-than <days>, or --vacuum.\n"));
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

// ─── links <crawl-id> ─────────────────────────────────────────────────────────

program
  .command("links <crawl-id>")
  .description("Show broken links (4xx/5xx) found during a crawl")
  .option("--json", "output as JSON")
  .action((crawlId: string, opts: { json?: boolean }) => {
    try {
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
        process.exit(1);
      }
      const pages = listPages(crawlId, { limit: 10000 });
      const broken = pages.filter(p => (p.statusCode ?? 0) >= 400);
      if (opts.json) {
        process.stdout.write(JSON.stringify(broken, null, 2) + "\n");
        return;
      }
      if (broken.length === 0) {
        process.stderr.write(chalk.green("✓ No broken links found\n"));
        return;
      }
      process.stderr.write(chalk.bold(`${broken.length} broken link(s):\n\n`));
      for (const page of broken) {
        const code = page.statusCode ?? 0;
        const color = code >= 500 ? chalk.red : chalk.yellow;
        process.stderr.write(`  ${color(String(code))}  ${chalk.blue(page.url.slice(0, 80))}\n`);
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

      if (process.stdout.isTTY) {
        process.stderr.write(chalk.bold(page.title ?? "(no title)") + "\n");
        process.stderr.write(chalk.blue(page.url) + "\n");
        process.stderr.write(chalk.gray(`${page.wordCount ?? 0} words  ·  status ${page.statusCode ?? "?"}\n`));
        process.stderr.write(chalk.gray("─".repeat(60)) + "\n\n");
      }

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

// ─── map <url> ────────────────────────────────────────────────────────────────

program
  .command("map <url>")
  .description("Discover all URLs on a site without crawling content")
  .option("--limit <n>", "max URLs to return", "1000")
  .option("--search <pattern>", "filter URLs containing this string")
  .option("--allow-subdomains", "include subdomains")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: {
    limit: string;
    search?: string;
    allowSubdomains?: boolean;
    json?: boolean;
  }) => {
    try {
      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Mapping ${url}...\n`));
      }

      const urls = await mapSite(url, {
        limit: parseInt(opts.limit, 10),
        search: opts.search,
        allowSubdomains: opts.allowSubdomains,
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify(urls, null, 2) + "\n");
        return;
      }

      for (const u of urls) {
        process.stdout.write(u + "\n");
      }
      process.stderr.write(chalk.gray(`\n${urls.length} URL(s) found\n`));
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

// ─── resume <crawl-id> ────────────────────────────────────────────────────────

program
  .command("resume <crawl-id>")
  .description("Resume an interrupted crawl, skipping already-crawled pages")
  .option("--json", "output as JSON")
  .action(async (crawlId: string, opts: { json?: boolean }) => {
    try {
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
        process.exit(1);
      }
      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Resuming crawl ${crawlId.slice(0, 8)} (${crawl.pagesCrawled} pages already done)...\n`));
      }
      const result = await resumeCrawl(crawlId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stderr.write(chalk.green(`✓ Resume complete — ${result.pagesCrawled} total pages\n`));
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── delete <crawl-id> ────────────────────────────────────────────────────────

program
  .command("delete <crawl-id>")
  .description("Delete a crawl and all its pages")
  .option("--force", "skip confirmation")
  .option("--json", "output as JSON")
  .action(async (crawlId: string, opts: { force?: boolean; json?: boolean }) => {
    try {
      const crawl = getCrawl(crawlId);
      if (!crawl) {
        process.stderr.write(chalk.red(`Crawl not found: ${crawlId}\n`));
        process.exit(1);
      }
      const stats = getCrawlStats(crawlId);
      if (!opts.force && !opts.json) {
        process.stderr.write(
          chalk.yellow(`Delete crawl ${crawlId.slice(0, 8)} (${stats.total} pages)?`) +
          chalk.gray(" Pass --force to confirm.\n")
        );
        process.exit(0);
      }
      deleteCrawl(crawlId);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ deleted: crawlId, pages: stats.total }) + "\n");
      } else {
        process.stderr.write(chalk.green(`✓ Deleted crawl ${crawlId.slice(0, 8)} and ${stats.total} pages\n`));
      }
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

// ─── open <page-id> ───────────────────────────────────────────────────────────

program
  .command("open <page-id>")
  .description("Open the original URL of a page in your browser")
  .action((pageId: string) => {
    try {
      const page = getPage(pageId);
      if (!page) {
        process.stderr.write(chalk.red(`Page not found: ${pageId}\n`));
        process.exit(1);
      }
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execSync(`${cmd} "${page.url}"`);
      process.stderr.write(chalk.green(`✓ Opened ${page.url}\n`));
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

// ─── webhook ─────────────────────────────────────────────────────────────────

const webhookCmd = program.command("webhook").description("Manage webhooks");

webhookCmd
  .command("add <url>")
  .description("Register a webhook endpoint")
  .option("--events <events>", "comma-separated events (default: crawl.completed)", "crawl.completed")
  .option("--secret <secret>", "HMAC signing secret")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: { events: string; secret?: string; json?: boolean }) => {
    try {
      const events = opts.events.split(",").map(e => e.trim()) as Parameters<typeof createWebhook>[0]["events"];
      const webhook = createWebhook({ url, events, secret: opts.secret });
      if (opts.json) {
        process.stdout.write(JSON.stringify(webhook, null, 2) + "\n");
        return;
      }
      process.stderr.write(
        chalk.green(`✓ Webhook created: ${chalk.cyan(webhook.id.slice(0, 8))} → ${chalk.blue(url)} [events: ${events?.join(", ")}]\n`)
      );
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

webhookCmd
  .command("list")
  .description("List all registered webhooks")
  .option("--json", "output as JSON")
  .action((opts: { json?: boolean }) => {
    try {
      const webhooks = listWebhooks();
      if (opts.json) {
        process.stdout.write(JSON.stringify(webhooks, null, 2) + "\n");
        return;
      }
      if (webhooks.length === 0) {
        process.stderr.write(chalk.gray("No webhooks registered.\n"));
        return;
      }
      process.stderr.write(chalk.bold(`${webhooks.length} webhook(s):\n\n`));
      process.stderr.write(
        chalk.gray(
          `  ${"ID".padEnd(8)}  ${"URL".padEnd(50)}  ${"Events".padEnd(30)}  ${"Active".padEnd(6)}  ${"Failures".padEnd(8)}  Last triggered\n`
        )
      );
      process.stderr.write(chalk.gray("  " + "─".repeat(120) + "\n"));
      for (const w of webhooks) {
        const activeStr = w.active ? chalk.green("yes") : chalk.red("no");
        const failStr = w.failureCount > 0 ? chalk.yellow(String(w.failureCount)) : chalk.gray("0");
        const lastStr = w.lastTriggeredAt ? chalk.gray(w.lastTriggeredAt.slice(0, 19)) : chalk.gray("never");
        process.stderr.write(
          `  ${chalk.cyan(w.id.slice(0, 8))}  ` +
          `${chalk.blue(w.url.slice(0, 50).padEnd(50))}  ` +
          `${w.events.join(",").slice(0, 30).padEnd(30)}  ` +
          `${activeStr.padEnd(6)}  ` +
          `${failStr.padEnd(8)}  ` +
          `${lastStr}\n`
        );
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

webhookCmd
  .command("delete <webhook-id>")
  .description("Remove a webhook")
  .action((id: string) => {
    try {
      const deleted = deleteWebhook(id);
      if (!deleted) {
        process.stderr.write(chalk.red(`Webhook not found: ${id}\n`));
        process.exit(1);
      }
      process.stderr.write(chalk.green(`✓ Deleted webhook ${chalk.cyan(id.slice(0, 8))}\n`));
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

webhookCmd
  .command("test <webhook-id>")
  .description("Send a test event to a webhook endpoint")
  .option("--json", "output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    try {
      const webhook = getWebhook(id);
      if (!webhook) {
        process.stderr.write(chalk.red(`Webhook not found: ${id}\n`));
        process.exit(1);
      }
      const payload = JSON.stringify({
        crawlId: "test",
        url: "https://example.com",
        pagesCrawled: 1,
        status: "completed",
        event: "crawl.completed",
        timestamp: new Date().toISOString(),
      });
      const delivery = createDelivery({ webhookId: id, event: "crawl.completed", payload });
      const success = await deliverWebhook(delivery.id);
      const { getDelivery } = await import("../db/webhooks.js");
      const updated = getDelivery(delivery.id);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ success, httpStatus: updated?.httpStatus, responseBody: updated?.responseBody }) + "\n");
        return;
      }
      if (success) {
        process.stderr.write(chalk.green(`✓ Test delivery succeeded`) + chalk.gray(` (HTTP ${updated?.httpStatus})\n`));
      } else {
        process.stderr.write(chalk.red(`✗ Test delivery failed`) + chalk.gray(` (HTTP ${updated?.httpStatus ?? "none"})\n`));
        if (updated?.responseBody) {
          process.stderr.write(chalk.gray(`  Response: ${updated.responseBody.slice(0, 200)}\n`));
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

webhookCmd
  .command("deliveries <webhook-id>")
  .description("Show delivery history for a webhook")
  .option("--limit <n>", "max deliveries to show", "20")
  .option("--json", "output as JSON")
  .action((id: string, opts: { limit: string; json?: boolean }) => {
    try {
      const webhook = getWebhook(id);
      if (!webhook) {
        process.stderr.write(chalk.red(`Webhook not found: ${id}\n`));
        process.exit(1);
      }
      const deliveries = listDeliveries(id, parseInt(opts.limit, 10));
      if (opts.json) {
        process.stdout.write(JSON.stringify(deliveries, null, 2) + "\n");
        return;
      }
      if (deliveries.length === 0) {
        process.stderr.write(chalk.gray("No deliveries found.\n"));
        return;
      }
      process.stderr.write(chalk.bold(`${deliveries.length} delivery/deliveries for webhook ${chalk.cyan(id.slice(0, 8))}:\n\n`));
      for (const d of deliveries) {
        const statusFn =
          d.status === "delivered" ? chalk.green :
          d.status === "failed"    ? chalk.red    :
                                     chalk.yellow;
        const statusStr = statusFn(d.status.padEnd(10));
        const httpStr = d.httpStatus ? chalk.gray(`HTTP ${d.httpStatus}`) : chalk.gray("no response");
        process.stderr.write(
          `  ${statusStr}  attempts=${d.attemptCount}  ${httpStr}  ${chalk.gray(d.createdAt.slice(0, 19))}\n`
        );
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── api-key ──────────────────────────────────────────────────────────────────

const apiKeyCmd = program.command("api-key").description("Manage API keys");

apiKeyCmd
  .command("create")
  .description("Create a new API key")
  .option("--name <name>", "descriptive name for the key")
  .option("--expires <duration>", "expiry duration (e.g. 30d, 7d, 1y)")
  .option("--json", "output as JSON")
  .action((opts: { name?: string; expires?: string; json?: boolean }) => {
    try {
      let expiresAt: string | undefined;
      if (opts.expires) {
        const match = opts.expires.match(/^(\d+)(d|y)$/);
        if (!match) {
          process.stderr.write(chalk.red(`Invalid expires format: ${opts.expires}. Use e.g. 30d, 7d, 1y\n`));
          process.exit(1);
        }
        const amount = parseInt(match[1] as string, 10);
        const unit = match[2] as string;
        const ms = unit === "y" ? amount * 365 * 86400000 : amount * 86400000;
        expiresAt = new Date(Date.now() + ms).toISOString();
      }

      const { apiKey, rawKey } = createApiKey({ name: opts.name, expiresAt });

      if (opts.json) {
        process.stdout.write(JSON.stringify({ key: rawKey, id: apiKey.id, prefix: apiKey.keyPrefix }) + "\n");
        return;
      }

      process.stderr.write(chalk.green("✓ API key created\n"));
      process.stderr.write(chalk.yellow("⚠  Save this key — it won't be shown again\n\n"));
      process.stderr.write(`  ${chalk.bold("Key:")}    ${chalk.cyan(rawKey)}\n`);
      process.stderr.write(`  ${chalk.bold("ID:")}     ${chalk.gray(apiKey.id)}\n`);
      process.stderr.write(`  ${chalk.bold("Prefix:")} ${chalk.gray(apiKey.keyPrefix)}\n`);
      if (apiKey.name) process.stderr.write(`  ${chalk.bold("Name:")}   ${chalk.white(apiKey.name)}\n`);
      if (apiKey.expiresAt) process.stderr.write(`  ${chalk.bold("Expires:")} ${chalk.white(apiKey.expiresAt)}\n`);
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

apiKeyCmd
  .command("list")
  .description("List all API keys")
  .option("--json", "output as JSON")
  .action((opts: { json?: boolean }) => {
    try {
      const keys = listApiKeys();
      if (opts.json) {
        // Never return key hash
        process.stdout.write(JSON.stringify(keys.map(({ keyHash: _kh, ...rest }) => rest), null, 2) + "\n");
        return;
      }
      if (keys.length === 0) {
        process.stderr.write(chalk.gray("No API keys found.\n"));
        return;
      }
      process.stderr.write(chalk.bold(`${keys.length} API key(s):\n\n`));
      for (const key of keys) {
        const status = key.active ? chalk.green("active") : chalk.red("revoked");
        const expired = key.expiresAt && new Date(key.expiresAt) < new Date();
        process.stderr.write(
          `  ${chalk.cyan(key.id.slice(0, 8))}  ` +
          `${chalk.gray(key.keyPrefix + "...")}  ` +
          `${status}${expired ? chalk.yellow(" (expired)") : ""}` +
          (key.name ? chalk.gray(`  — ${key.name}`) : "") +
          "\n"
        );
        if (key.lastUsedAt) {
          process.stderr.write(chalk.gray(`           Last used: ${key.lastUsedAt}\n`));
        }
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

apiKeyCmd
  .command("revoke <id>")
  .description("Revoke an API key")
  .option("--json", "output as JSON")
  .action((id: string, opts: { json?: boolean }) => {
    try {
      const revoked = revokeApiKey(id);
      if (!revoked) {
        process.stderr.write(chalk.red(`API key not found: ${id}\n`));
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify({ revoked: true, id }) + "\n");
        return;
      }
      process.stderr.write(chalk.green(`✓ Revoked API key ${id.slice(0, 8)}\n`));
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── brand <url> ─────────────────────────────────────────────────────────────

program
  .command("brand <url>")
  .description("Extract branding (logo, colors, fonts) from a webpage")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: { json?: boolean }) => {
    try {
      const { fetchPage } = await import("../lib/fetcher.js");
      const { extractBranding } = await import("../lib/branding.js");
      const result = await fetchPage(url);
      const branding = extractBranding(result.html, url);
      if (opts.json) { process.stdout.write(JSON.stringify(branding, null, 2) + "\n"); return; }
      process.stderr.write(chalk.bold("Branding\n") + chalk.gray("─".repeat(40)) + "\n");
      if (branding.favicon) process.stderr.write(`  ${chalk.cyan("Favicon:")}    ${branding.favicon}\n`);
      if (branding.logo)    process.stderr.write(`  ${chalk.cyan("Logo:")}       ${branding.logo}\n`);
      if (branding.themeColor) process.stderr.write(`  ${chalk.cyan("Color:")}      ${branding.themeColor}\n`);
      if (branding.fonts.length) process.stderr.write(`  ${chalk.cyan("Fonts:")}      ${branding.fonts.join(", ")}\n`);
      if (branding.colors.length) process.stderr.write(`  ${chalk.cyan("CSS colors:")} ${branding.colors.slice(0, 5).join(" ")}\n`);
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── search-web <query> ───────────────────────────────────────────────────────

program
  .command("search-web <query>")
  .description("Search the web using Exa and optionally scrape results")
  .option("--limit <n>", "number of results", "10")
  .option("--scrape", "also crawl each result URL")
  .option("--json", "output as JSON")
  .action(async (query: string, opts: { limit: string; scrape?: boolean; json?: boolean }) => {
    try {
      const { searchWeb } = await import("../lib/search-web.js");
      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Searching: ${query}\n`));
      }
      const results = await searchWeb(query, {
        limit: parseInt(opts.limit, 10),
        scrape: opts.scrape,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return;
      }
      if (results.length === 0) {
        process.stderr.write(chalk.gray("No results found.\n"));
        return;
      }
      process.stderr.write(chalk.bold(`${results.length} result(s):\n\n`));
      for (const r of results) {
        process.stderr.write(`  ${chalk.blue(r.url)}\n`);
        process.stderr.write(`  ${chalk.bold(r.title)}\n`);
        if (r.snippet) process.stderr.write(`  ${chalk.gray(r.snippet.slice(0, 120))}\n`);
        process.stderr.write("\n");
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── sandbox <url> ───────────────────────────────────────────────────────────

program
  .command("sandbox <url>")
  .description("Crawl a URL inside an isolated e2b cloud sandbox")
  .option("-d, --depth <n>", "crawl depth", "1")
  .option("-m, --max-pages <n>", "max pages", "50")
  .option("--timeout <ms>", "sandbox timeout in ms", "300000")
  .option("--json", "output as JSON")
  .action(async (url: string, opts: { depth: string; maxPages: string; timeout: string; json?: boolean }) => {
    try {
      const e2bStatus = checkE2B();
      if (!e2bStatus.available) {
        process.stderr.write(chalk.red(`Cannot use sandbox: ${e2bStatus.reason}\n`));
        process.stderr.write(chalk.gray("Set E2B_API_KEY to use cloud sandboxes. Get a key at https://e2b.dev\n"));
        process.exit(1);
      }

      if (!opts.json) {
        process.stderr.write(chalk.cyan(`Crawling ${url} `) + chalk.yellow(`[e2b sandbox]\n`));
        process.stderr.write(chalk.gray("  Spinning up isolated cloud environment...\n"));
      }

      const result = await crawlInSandbox(
        {
          url,
          depth: parseInt(opts.depth, 10),
          maxPages: parseInt(opts.maxPages, 10),
        },
        {
          timeoutMs: parseInt(opts.timeout, 10),
          onOutput: opts.json ? undefined : (line: string) => process.stderr.write(chalk.gray(`  ${line}\n`)),
        }
      );

      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      process.stderr.write(chalk.green("\n✓ Sandbox crawl complete\n"));
      process.stderr.write(`  ${chalk.bold("Crawl ID:")}  ${chalk.cyan(result.crawl.id)}\n`);
      process.stderr.write(`  ${chalk.bold("Pages:")}     ${chalk.white(String(result.pages.length))}\n`);
      process.stderr.write(`  ${chalk.bold("Sandbox:")}   ${chalk.gray(result.sandboxId)}\n`);
      process.stderr.write(`  ${chalk.bold("Duration:")}  ${chalk.gray((result.durationMs / 1000).toFixed(1) + "s")}\n`);
      process.stderr.write("\n" + chalk.bold("Pages crawled:\n"));
      for (const page of result.pages.slice(0, 5)) {
        process.stderr.write(
          `  ${chalk.green(String(page.statusCode ?? "?"))}  ${chalk.blue(page.url.slice(0, 70))}\n`
        );
      }
      if (result.pages.length > 5) {
        process.stderr.write(chalk.gray(`  ... and ${result.pages.length - 5} more\n`));
      }
    } catch (err) {
      process.stderr.write(chalk.red(`Error: ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── feedback ─────────────────────────────────────────────────────────────────

program
  .command("feedback <message>")
  .description("Send feedback about this service")
  .option("-e, --email <email>", "Contact email")
  .option("-c, --category <cat>", "Category: bug, feature, general", "general")
  .action(async (message: string, opts: { email?: string; category?: string }) => {
    const { getDb } = await import("../db/database.js");
    const db = getDb();
    db.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [message, opts.email || null, opts.category || "general", program.version()]
    );
    console.log(chalk.green("✓") + " Feedback saved. Thank you!");
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

// Default command: if first real arg looks like a URL, treat as `crawl crawl <url>`
const args = process.argv.slice(2);
const firstArg = args[0];
if (firstArg && (firstArg.startsWith("http://") || firstArg.startsWith("https://"))) {
  process.argv.splice(2, 0, "crawl");
}

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(chalk.red(`Fatal: ${(err as Error).message}\n`));
  process.exit(1);
});
