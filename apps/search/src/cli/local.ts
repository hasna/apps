import type { Command } from "commander";
import chalk from "chalk";
import { findLocal, type FindKind } from "../lib/local/find.js";
import {
  addRoot,
  getRoot,
  indexRoot,
  indexAllRoots,
  listRoots,
  removeRoot,
  type IndexStats,
} from "../lib/local/indexer.js";

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

function printStats(stats: IndexStats, rootLabel: string): void {
  console.log(
    chalk.green(`✓ ${rootLabel}`) +
      chalk.dim(
        ` ${stats.fileCount} files (+${stats.added} ~${stats.updated} -${stats.deleted}, ${stats.contentIndexed} content) in ${stats.durationMs}ms`,
      ),
  );
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
    .option("--no-refresh", "Skip stale-index refresh before searching")
    .option("--json", "Output as JSON")
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
          refresh: opts.refresh,
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

      for (const r of response.results) {
        const loc = r.line ? `:${r.line}` : "";
        const badge = chalk.bgCyan.black(` ${r.kind} `);
        console.log(`${badge} ${chalk.bold(r.path)}${chalk.dim(loc)}`);
        if (r.kind !== "file" && r.snippet) console.log(`   ${r.snippet}`);
        for (const m of r.matches?.slice(1) ?? []) {
          console.log(chalk.dim(`   :${m.line} ${m.text}`));
        }
      }
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
        console.log(chalk.dim(`Indexing ${root.path} ...`));
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
    .option("--json", "Output as JSON")
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
      for (const r of roots) {
        const status =
          r.status === "ready"
            ? chalk.green(r.status)
            : r.status === "error"
              ? chalk.red(r.status)
              : chalk.yellow(r.status);
        console.log(
          `${chalk.dim(r.id.substring(0, 8))}  ${chalk.yellow(r.name.padEnd(20))} ${status.padEnd(8)} ${String(r.fileCount).padStart(7)} files  ${chalk.dim(r.path)}`,
        );
        if (r.error) console.log(chalk.red(`    ${r.error}`));
      }
    });

  index
    .command("status")
    .description("Show index status and staleness")
    .option("--json", "Output as JSON")
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
      for (const r of status) {
        const age = r.staleMinutes === null ? "never indexed" : `indexed ${r.staleMinutes}m ago`;
        console.log(
          `${chalk.yellow(r.name.padEnd(20))} ${r.status.padEnd(8)} ${String(r.fileCount).padStart(7)} files  ${age}  ${chalk.dim(`(${r.lastDurationMs ?? "?"}ms)`)}`,
        );
      }
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
}
