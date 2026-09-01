import type { Command } from "commander";
import { constants, copyFileSync, existsSync, lstatSync, statSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import chalk from "chalk";
import { dataDir } from "@hasna/paths";

interface LegacyCandidate {
  path: string;
  exists: boolean;
  size: number | null;
  modified_at: string | null;
  wal_present: boolean;
  source: "xdg" | "legacy-hasna" | "ancient";
}

function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}

export function legacyDatabaseCandidates(env: NodeJS.ProcessEnv = process.env): LegacyCandidate[] {
  const base = home(env);
  const paths = [
    { source: "xdg" as const, path: join(dataDir({ app: "contacts", home: base, env }), "contacts.db") },
    { source: "legacy-hasna" as const, path: join(base, ".hasna", "contacts", "contacts.db") },
    { source: "ancient" as const, path: join(base, ".contacts", "contacts.db") },
  ];
  return paths.map(({ source, path }) => {
    const exists = existsSync(path) && lstatSync(path).isFile();
    const stat = exists ? statSync(path) : null;
    return {
      source,
      path,
      exists,
      size: stat?.size ?? null,
      modified_at: stat?.mtime.toISOString() ?? null,
      wal_present: existsSync(`${path}-wal`),
    };
  });
}

function resolveSource(requested?: string): string {
  if (requested) return resolve(requested);
  const matches = legacyDatabaseCandidates().filter((candidate) => candidate.exists);
  if (matches.length === 0) {
    throw new Error("No legacy contacts SQLite database was found. Run `contacts legacy inspect --json` to see the checked paths.");
  }
  if (matches.length > 1) {
    throw new Error(
      "Multiple legacy contacts databases exist. Refusing to guess which one is authoritative; pass --source with an exact path.",
    );
  }
  return matches[0]!.path;
}

function preserveLegacyDatabase(sourceArg: string | undefined, outputArg: string): { source: string; output: string; bytes: number } {
  const source = resolveSource(sourceArg);
  const output = resolve(outputArg);
  if (!existsSync(source) || !lstatSync(source).isFile()) {
    throw new Error(`Legacy database is not a regular file: ${source}`);
  }
  if (source === output) throw new Error("The preservation output must differ from the source database.");
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);
  if (!existsSync(dirname(output))) throw new Error(`Output directory does not exist: ${dirname(output)}`);
  const sidecars = ["-wal", "-journal", "-shm"].map((suffix) => `${source}${suffix}`).filter(existsSync);
  if (sidecars.length > 0) {
    throw new Error(
      `Legacy SQLite sidecar file${sidecars.length === 1 ? " is" : "s are"} present: ${sidecars.join(", ")}. ` +
        "Stop every legacy contacts process and checkpoint it with the old client before preserving; " +
        "this command refuses a potentially inconsistent copy.",
    );
  }
  copyFileSync(source, output, constants.COPYFILE_EXCL);
  chmodSync(output, 0o600);
  return { source, output, bytes: statSync(output).size };
}

export function registerLegacyCommands(program: Command): void {
  const legacy = program
    .command("legacy")
    .description("Inspect or preserve retired local contacts data; never uses it as the live store");

  legacy
    .command("inspect")
    .description("List legacy SQLite candidates without opening or modifying them")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const candidates = legacyDatabaseCandidates();
      if (opts.json) {
        console.log(JSON.stringify({ candidates, local_fallback: false }, null, 2));
        return;
      }
      for (const candidate of candidates) {
        const state = candidate.exists ? chalk.yellow("found") : chalk.gray("absent");
        console.log(`${state}  ${candidate.path}`);
      }
      console.log(chalk.gray("These files are never selected by the contacts client."));
    });

  legacy
    .command("preserve")
    .description("Create a non-destructive owner-only copy of one retired SQLite database")
    .option("--source <path>", "Exact legacy database path (required when more than one candidate exists)")
    .requiredOption("--output <path>", "New output path; existing files are never overwritten")
    .option("--json", "Output as JSON")
    .action((opts: { source?: string; output: string; json?: boolean }) => {
      const result = preserveLegacyDatabase(opts.source, opts.output);
      if (opts.json) {
        console.log(JSON.stringify({ ...result, local_fallback: false }, null, 2));
        return;
      }
      console.log(chalk.green(`Preserved ${basename(result.source)} at ${result.output} (${result.bytes} bytes).`));
      console.log(chalk.gray("The source was not changed or deleted. Use a legacy @hasna/contacts release to export portable JSON, then import it through the HTTPS client."));
    });
}
