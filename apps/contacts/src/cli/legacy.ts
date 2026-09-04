import type { Command } from "commander";
import { createHash } from "node:crypto";
import fs, { constants, closeSync, existsSync, fstatSync, lstatSync, readSync, realpathSync, statSync, writeSync, type BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import chalk from "chalk";
import { dataDir } from "../db/paths.js";

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

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function unchangedFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameFile(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Bind every ancestor, including stable platform links such as macOS /var. */
function parentIdentity(path: string): string {
  const identities: string[] = [];
  let parent = dirname(path);
  while (true) {
    const stat = lstatSync(parent, { bigint: true });
    identities.push(`${parent}:${stat.dev}:${stat.ino}:${stat.mode}:${realpathSync(parent)}`);
    const next = dirname(parent);
    if (next === parent) return JSON.stringify(identities);
    parent = next;
  }
}

export function preserveLegacyDatabase(sourceArg: string | undefined, outputArg: string): { source: string; output: string; bytes: number } {
  const source = resolveSource(sourceArg);
  const output = resolve(outputArg);
  const sourceParents = parentIdentity(source);
  const inspectedSource = lstatSync(source, { bigint: true });
  if (!inspectedSource.isFile()) {
    throw new Error(`Legacy database is not a regular file: ${source}`);
  }
  if (source === output) throw new Error("The preservation output must differ from the source database.");
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);
  if (!existsSync(dirname(output))) throw new Error(`Output directory does not exist: ${dirname(output)}`);
  const outputParents = parentIdentity(output);
  const sidecarPaths = ["-wal", "-journal", "-shm"].map((suffix) => `${source}${suffix}`);
  const sidecars = sidecarPaths.filter(existsSync);
  if (sidecars.length > 0) {
    throw new Error(
      `Legacy SQLite sidecar file${sidecars.length === 1 ? " is" : "s are"} present: ${sidecars.join(", ")}. ` +
        "Stop every legacy contacts process and checkpoint it with the old client before preserving; " +
        "this command refuses a potentially inconsistent copy.",
    );
  }
  let sourceFd: number | null = null;
  let outputFd: number | null = null;
  try {
    if (constants.O_NOFOLLOW === undefined) throw new Error("This platform cannot safely preserve a legacy database without O_NOFOLLOW.");
    sourceFd = fs.openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(sourceFd, { bigint: true });
    if (!unchangedFile(inspectedSource, before) || !unchangedFile(before, lstatSync(source, { bigint: true })) ||
      parentIdentity(source) !== sourceParents || parentIdentity(output) !== outputParents) {
      throw new Error("Legacy source or an ancestor changed between inspection and opening; preservation refused.");
    }
    // Create at its final private mode. There is no interval where another user
    // can read the copy, unlike create-then-chmod.
    outputFd = fs.openSync(output, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
    const createdOutput = fstatSync(outputFd, { bigint: true });
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const copiedHash = createHash("sha256");
    let bytes = 0;
    while (true) {
      const read = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      copiedHash.update(buffer.subarray(0, read));
      let offset = 0;
      while (offset < read) offset += writeSync(outputFd, buffer, offset, read - offset);
      bytes += read;
    }
    fs.fsyncSync(outputFd);
    // Identity alone cannot detect truncation or an equal-length rewrite through
    // another handle. Verify the actual bytes through our exclusive output fd,
    // and bind both its metadata and final pathname across that verification.
    const verificationStart = fstatSync(outputFd, { bigint: true });
    const verifiedHash = createHash("sha256");
    let verifiedBytes = 0;
    while (verifiedBytes < bytes) {
      const read = readSync(outputFd, buffer, 0, Math.min(buffer.length, bytes - verifiedBytes), verifiedBytes);
      if (read === 0) break;
      verifiedHash.update(buffer.subarray(0, read));
      verifiedBytes += read;
    }
    const extraBytes = readSync(outputFd, buffer, 0, 1, verifiedBytes);
    const verificationEnd = fstatSync(outputFd, { bigint: true });
    const verifiedOutput = sameFile(createdOutput, verificationStart) &&
      BigInt(bytes) === verificationStart.size && verifiedBytes === bytes && extraBytes === 0 &&
      copiedHash.digest("hex") === verifiedHash.digest("hex") &&
      unchangedFile(verificationStart, verificationEnd) &&
      unchangedFile(verificationEnd, lstatSync(output, { bigint: true }));
    const after = fstatSync(sourceFd, { bigint: true });
    const stable = unchangedFile(before, after) && unchangedFile(after, lstatSync(source, { bigint: true })) &&
      BigInt(bytes) === after.size && parentIdentity(source) === sourceParents && parentIdentity(output) === outputParents;
    if (!stable || !verifiedOutput || sidecarPaths.some(existsSync)) {
      throw new Error("Legacy database, output, or ancestor changed or a SQLite sidecar appeared during preservation.");
    }
    return { source, output, bytes };
  } catch (error) {
    // Never unlink by pathname: a concurrent rename may now put an unrelated
    // file there, even after an identity check. Retain any private partial copy
    // for explicit inspection instead of risking deletion of someone else's file.
    if (outputFd !== null) {
      throw new Error(`${error instanceof Error ? error.message : "Preservation failed."} Any created output is unverified and was left untouched for manual inspection.`);
    }
    throw error;
  } finally {
    if (outputFd !== null) closeSync(outputFd);
    if (sourceFd !== null) closeSync(sourceFd);
  }
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
