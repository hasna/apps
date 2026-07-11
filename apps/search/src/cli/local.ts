import type { Command } from "commander";
import chalk from "chalk";
import { findLocal, type FindKind } from "../lib/local/find.js";
import { benchmarkLocalSearch } from "../lib/local/benchmark.js";
import { evaluateRouterHeuristic } from "../lib/router-eval.js";
import {
  addRoot,
  getRoot,
  indexRoot,
  indexAllRoots,
  listRoots,
  removeRoot,
  type IndexRoot,
  type IndexStats,
} from "../lib/local/indexer.js";
import {
  DEFAULT_COMPACT_LIMIT,
  clampLimit,
  truncateMiddle,
  truncateText,
} from "../lib/compact-output.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parsePositiveInt(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(chalk.red(`Invalid ${label}: ${value} (expected a positive number)`));
    process.exit(1);
  }
  return n;
}

function parseNonNegativeInt(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    console.error(chalk.red(`Invalid ${label}: ${value} (expected an integer >= 0)`));
    process.exit(1);
  }
  return n;
}

function parseOptionalLimit(value: string | undefined, label: string): number {
  if (value === undefined) return DEFAULT_COMPACT_LIMIT;
  return clampLimit(parsePositiveInt(value, label));
}

function parseOffset(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    console.error(chalk.red(`Invalid --offset: ${value} (expected an integer >= 0)`));
    process.exit(1);
  }
  return n;
}

function collectQuery(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function printPageHint(shown: number, total: number, offset: number, command: string, detailHint?: string): void {
  const hints: string[] = [];
  const nextOffset = offset + shown;
  if (nextOffset < total) hints.push(`more: ${command} --offset ${nextOffset}`);
  if (detailHint) hints.push(detailHint);
  if (hints.length > 0) console.log(chalk.dim(hints.join(" | ")));
}

function printStats(stats: IndexStats, rootLabel: string): void {
  console.log(
    chalk.green(`✓ ${rootLabel}`) +
      chalk.dim(
        ` ${stats.fileCount} files (+${stats.added} ~${stats.updated} -${stats.deleted}, ${stats.contentIndexed} content) in ${stats.durationMs}ms`,
      ),
  );
}

function rootStatus(status: IndexRoot["status"]): string {
  return status === "ready"
    ? chalk.green(status)
    : status === "error"
      ? chalk.red(status)
      : chalk.yellow(status);
}

export function registerLocalCommands(program: Command): void {
  program
    .command("find")
    .description("Find files locally by name, path, or content across indexed roots")
    .argument("<query...>", "What to look for")
    .option("-k, --kind <kind>", "Match kind: file, content, both", "both")
    .option("-r, --root <root>", "Limit to one index root (name, path, or id)")
    .option("-e, --ext <ext>", "Filter by file extension")
    .option("-d, --dir <dir>", "Filter by directory substring")
    .option("-l, --limit <n>", "Max results", "20")
    .option("-x, --regex", "Treat the query as a regular expression (grep-style)")
    .option("--case-sensitive", "Case-sensitive matching (regex mode)")
    .option("--sync-refresh", "Synchronously refresh stale roots before searching")
    .option("--no-refresh", "Do not schedule stale-index refresh before searching")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show full paths, snippets, and match lines")
    .action((queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      let response;
      try {
        response = findLocal(query, {
          kind: opts.kind as FindKind,
          root: opts.root,
          ext: opts.ext,
          dir: opts.dir,
          limit: parsePositiveInt(opts.limit, "--limit"),
          refresh: opts.refresh === false ? false : opts.syncRefresh ? true : undefined,
          regex: opts.regex,
          caseSensitive: opts.caseSensitive,
        });
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        printJson(response);
        return;
      }

      if (!response.indexed) {
        console.log(chalk.yellow("No index roots ready. Add one with: search index add <path>"));
        process.exitCode = 1;
        return;
      }

      if (response.results.length === 0) {
        console.log(chalk.yellow("No matches"));
        return;
      }

      console.log(chalk.bold(`Local matches (showing ${response.results.length} of ${response.total})`));
      console.log();
      for (const r of response.results) {
        const loc = r.line ? `:${r.line}` : "";
        const badge = chalk.bgCyan.black(` ${r.kind} `);
        const path = opts.verbose ? r.path : truncateMiddle(r.path, 120);
        console.log(`${badge} ${chalk.bold(path)}${chalk.dim(loc)}`);
        if (r.kind !== "file" && r.snippet) {
          console.log(`   ${opts.verbose ? r.snippet : truncateText(r.snippet, 160)}`);
        }
        const matches = opts.verbose ? (r.matches?.slice(1) ?? []) : [];
        for (const m of matches) {
          console.log(chalk.dim(`   :${m.line} ${m.text}`));
        }
      }
      if (!opts.verbose) console.log(chalk.dim("details: search find <query> --verbose or --json"));
    });

  const index = program.command("index").description("Manage the local file index");

  index
    .command("add <path>")
    .description("Register a directory and index it")
    .option("-n, --name <name>", "Friendly root name (default: directory basename)")
    .option("--no-content", "Index file paths only, skip content")
    .option("--exclude <patterns>", "Comma-separated extra exclude patterns (gitignore syntax)")
    .option("--max-file-size <bytes>", "Max file size for content indexing", "524288")
    .option("--json", "Output as JSON")
    .action((path: string, opts) => {
      try {
        const root = addRoot(path, {
          name: opts.name,
          contentIndexing: opts.content,
          exclude: opts.exclude ? opts.exclude.split(",").map((s: string) => s.trim()) : [],
          maxFileSize: parsePositiveInt(opts.maxFileSize, "--max-file-size"),
        });
        if (!opts.json) console.log(chalk.dim(`Indexing ${root.path} ...`));
        const stats = indexRoot(root.id);
        if (opts.json) {
          printJson({ root: getRoot(root.id), stats });
          return;
        }
        printStats(stats, root.name);
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exitCode = 1;
      }
    });

  index
    .command("update [path]")
    .description("Incrementally re-index one root, or all roots")
    .option("--force", "Re-read content for all files, not just changed ones")
    .option("--json", "Output as JSON")
    .action((path: string | undefined, opts) => {
      try {
        if (path) {
          const root = getRoot(path);
          if (!root) {
            console.error(chalk.red(`Index root not found: ${path}`));
            process.exitCode = 1;
            return;
          }
          const stats = indexRoot(root.id, { force: opts.force });
          if (opts.json) printJson(stats);
          else printStats(stats, root.name);
          return;
        }
        const all = indexAllRoots({ force: opts.force });
        if (opts.json) {
          printJson(all);
          return;
        }
        if (all.length === 0) {
          console.log(chalk.yellow("No index roots. Add one with: search index add <path>"));
          return;
        }
        const roots = listRoots();
        for (const stats of all) {
          printStats(stats, roots.find((r) => r.id === stats.rootId)?.name ?? stats.rootId);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exitCode = 1;
      }
    });

  index
    .command("list")
    .alias("ls")
    .description("List index roots")
    .option("-l, --limit <n>", "Max roots to show", "20")
    .option("--offset <n>", "Start offset for pagination", "0")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show full root paths and errors")
    .action((opts) => {
      const roots = listRoots();
      if (opts.json) {
        printJson(roots);
        return;
      }
      if (roots.length === 0) {
        console.log(chalk.yellow("No index roots. Add one with: search index add <path>"));
        return;
      }
      const limit = parseOptionalLimit(opts.limit, "--limit");
      const offset = parseOffset(opts.offset);
      const page = roots.slice(offset, offset + limit);
      console.log(chalk.bold(`Index Roots (showing ${page.length} of ${roots.length})`));
      console.log();
      for (const r of page) {
        const status = rootStatus(r.status);
        const path = opts.verbose ? r.path : truncateMiddle(r.path, 88);
        console.log(
          `${chalk.dim(r.id)}  ${chalk.yellow(truncateText(r.name, 20).padEnd(20))} ${status.padEnd(8)} ${String(r.fileCount).padStart(7)} files  ${chalk.dim(path)}`,
        );
        if (r.error) console.log(chalk.red(`    ${opts.verbose ? r.error : truncateText(r.error, 140)}`));
      }
      printPageHint(page.length, roots.length, offset, "search index list", "details: search index status --verbose");
    });

  index
    .command("status")
    .description("Show index status and staleness")
    .option("-l, --limit <n>", "Max roots to show", "20")
    .option("--offset <n>", "Start offset for pagination", "0")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show full root paths and errors")
    .action((opts) => {
      const roots = listRoots();
      const status = roots.map((r) => ({
        ...r,
        staleMinutes: r.lastIndexedAt
          ? Math.round((Date.now() - Date.parse(r.lastIndexedAt)) / 60_000)
          : null,
      }));
      if (opts.json) {
        printJson(status);
        return;
      }
      if (status.length === 0) {
        console.log(chalk.yellow("No index roots. Add one with: search index add <path>"));
        return;
      }
      const limit = parseOptionalLimit(opts.limit, "--limit");
      const offset = parseOffset(opts.offset);
      const page = status.slice(offset, offset + limit);
      console.log(chalk.bold(`Index Status (showing ${page.length} of ${status.length})`));
      console.log();
      for (const r of page) {
        const age = r.staleMinutes === null ? "never indexed" : `indexed ${r.staleMinutes}m ago`;
        const path = opts.verbose ? r.path : truncateMiddle(r.path, 88);
        console.log(
          `${chalk.yellow(truncateText(r.name, 20).padEnd(20))} ${r.status.padEnd(8)} ${String(r.fileCount).padStart(7)} files  ${age}  ${chalk.dim(`(${r.lastDurationMs ?? "?"}ms)`)}  ${chalk.dim(path)}`,
        );
        if (r.error) console.log(chalk.red(`    ${opts.verbose ? r.error : truncateText(r.error, 140)}`));
      }
      printPageHint(page.length, status.length, offset, "search index status", "details: search index status --verbose");
    });

  index
    .command("rm <idOrPath>")
    .alias("remove")
    .description("Remove a root and all its indexed data")
    .action((idOrPath: string) => {
      if (removeRoot(idOrPath)) {
        console.log(chalk.green("Index root removed"));
      } else {
        console.error(chalk.red(`Index root not found: ${idOrPath}`));
        process.exitCode = 1;
      }
    });

  const bench = program
    .command("bench")
    .alias("benchmark")
    .description("Benchmark local search performance");

  bench
    .command("local")
    .description("Run repeated local find queries and report warm-cache timings")
    .option("-q, --query <query>", "Benchmark query (repeatable)", collectQuery, [])
    .option("-k, --kind <kind>", "Match kind: file, content, both", "both")
    .option("-r, --root <root>", "Limit to one index root")
    .option("-e, --ext <ext>", "Filter by file extension")
    .option("-d, --dir <dir>", "Filter by directory substring")
    .option("-l, --limit <n>", "Max results", "20")
    .option("-i, --iterations <n>", "Measured iterations per query", "5")
    .option("-w, --warmups <n>", "Warmup iterations per query", "1")
    .option("--refresh", "Synchronously refresh stale roots before each measured query")
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const report = benchmarkLocalSearch(
          opts.query.length > 0 ? opts.query : ["config", "index", "router"],
          {
            kind: opts.kind as FindKind,
            root: opts.root,
            ext: opts.ext,
            dir: opts.dir,
            limit: parsePositiveInt(opts.limit, "--limit"),
            iterations: parsePositiveInt(opts.iterations, "--iterations"),
            warmups: parseNonNegativeInt(opts.warmups, "--warmups"),
            refresh: Boolean(opts.refresh),
          },
        );

        if (opts.json) {
          printJson(report);
          return;
        }

        console.log(chalk.bold(`Local Search Benchmark`) + chalk.dim(` (${report.files} files, ${report.roots} roots)`));
        for (const row of report.rows) {
          console.log(
            `${chalk.yellow(row.query.padEnd(28))} ${String(row.resultCount).padStart(3)} results  ` +
              `p50 ${String(row.p50Ms).padStart(7)}ms  p95 ${String(row.p95Ms).padStart(7)}ms  max ${String(row.maxMs).padStart(7)}ms`,
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exitCode = 1;
      }
    });

  bench
    .command("router")
    .description("Run built-in heuristic router regression scenarios")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const report = evaluateRouterHeuristic();
      if (opts.json) {
        printJson(report);
        return;
      }

      const status = report.failed === 0 ? chalk.green("PASS") : chalk.red("FAIL");
      console.log(chalk.bold("Router Eval ") + status + chalk.dim(` (${report.passed}/${report.total})`));
      for (const result of report.results) {
        const marker = result.passed ? chalk.green("✓") : chalk.red("✗");
        console.log(
          `${marker} ${result.case.name.padEnd(28)} -> ${result.route.selectedProviders.join(", ")} ` +
            chalk.dim(`(${result.route.strategy}, ${result.route.confidence})`),
        );
        for (const failure of result.failures) console.log(chalk.red(`    ${failure}`));
      }
      if (report.failed > 0) process.exitCode = 1;
    });
}
