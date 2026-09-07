/**
 * run / mcp / self-update — runtime commands
 */

import chalk from "chalk";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { createInterface } from "readline";
import type { Command } from "commander";
import { getSkill, findSimilarSkills } from "../../lib/registry.js";
import { runSkill } from "../../lib/skillinfo.js";
import {
  ARTICLE_GENERATION_SLUG,
  validateBlogArticleRunOptions,
} from "../../lib/blog-article.js";
import { loadConfig } from "../../lib/config.js";
import { saveApiUrl } from "../../lib/auth-store.js";
import { normalizeSkillsApiOrigin, resolveSkillsFleet, resolveSkillsApiOrigin, SkillsFleetCredentialError, SKILLS_API_URL_ENV } from "../../lib/fleet-credentials.js";
import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../../sdk/runs.js";
import {
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  getRunExportDir,
  listSkillRuns,
  skillRunEnv,
  updateSkillRun,
  writeRunLogs,
} from "../../lib/run-state.js";
import { handleMcp } from "./runtime-mcp.js";
import {
  DEFAULT_LIST_LIMIT,
  paginate,
  parsePageLimit,
  parsePageOffset,
  showingLabel,
} from "../../lib/compact-output.js";
import { resolveConfiguredRunRouting } from "../../lib/run-routing.js";
import { RemoteSkillsClient } from "../../lib/remote-client.js";
import { execute as executeRemote } from "./remote-account.js";
import { describeRemoteFiles, type RemoteInputFile } from "../../lib/remote-files.js";

export function registerRuntime(parent: Command) {
  // Run
  parent
    .command("run")
    .argument("<skill>", "Skill name")
    .argument("[args...]", "Arguments to pass to the skill")
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .option("--json", "Output result as JSON", false)
    .option("--remote", "Run on the configured server, using its catalog and quote", false)
    .option("--yes", "Approve the server's quoted credit cost for this run", false)
    .option("--idempotency-key <key>", "Reuse this key when retrying the same remote submission")
    .option("--file <path>", "Attach a local input file to a remote run (repeatable)", (value: string, prior: string[]) => [...prior, value], [] as string[])
    .option("--wait", "Poll remote runs until a terminal status", false)
    .option("--poll-interval-ms <ms>", "Remote polling interval in milliseconds", "1000")
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for a remote run", "300000")
    .description("Run a skill directly")
    .action(async (name: string, args: string[], options: RunCommandOptions) => handleRun(name, args, options));

  const runs = parent
    .command("runs")
    .description("Inspect local skill run records");

  runs
    .command("list")
    .option("--remote", "List runs on the configured server", false)
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Maximum number of runs", "20")
    .option("--cursor <n>", "Local human-output offset; remote accepts only 0", "0")
    .description("List recent skill runs")
    .action((options: { json: boolean; limit: string; cursor?: string; remote?: boolean }) => options.remote
      ? handleRemoteRunsList(options) : handleRunsList(options));

  runs.command("logs").argument("<run-id>").option("--json", "Output as JSON", false)
    .action((id: string, options: { json: boolean }) => executeRemote(options, client => client.getRunLogs(id)));
  runs.command("cancel").argument("<run-id>").option("--json", "Output as JSON", false)
    .action((id: string, options: { json: boolean }) => executeRemote(options, client => client.cancelRun(id)));
  runs.command("resume").argument("<run-id>").option("--json", "Output as JSON", false)
    .action((id: string, options: { json: boolean }) => executeRemote(options, client => client.resumeRun(id)));
  runs.command("artifacts").argument("<run-id>").option("--json", "Output as JSON", false)
    .action((id: string, options: { json: boolean }) => executeRemote(options, client => client.getRunArtifacts(id)));

  runs
    .command("show")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Show a skill run record")
    .action((runId: string, options: { json: boolean }) => handleRunsShow(runId, options));

  runs
    .command("status")
    .argument("<run-id>", "Remote run id, or local run id linked to a remote run")
    .option("--json", "Output as JSON", false)
    .description("Fetch remote run status")
    .action((runId: string, options: { json: boolean }) => handleRunsStatus(runId, options));

  const exportsCommand = parent
    .command("exports")
    .description("Inspect or open skill run exports");

  exportsCommand
    .command("open")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Open the export directory for a run")
    .action((runId: string, options: { json: boolean }) => handleExportsOpen(runId, options));

  exportsCommand
    .command("download")
    .argument("<run-id>", "Remote run id")
    .option("--json", "Output as JSON", false)
    .description("Download remote run artifacts into .skills/exports")
    .action((runId: string, options: { json: boolean }) => handleExportsDownload(runId, options));

  // MCP
  parent
    .command("mcp")
    .option("--register <agent>", "Register MCP server with agent")
    .option("--json", "Output registration result as JSON", false)
    // Reject stray positionals ourselves: commander's default is version-
    // dependent (v13+ allows excess arguments silently), and a phantom verb
    // like `skills mcp connect` must fail loudly, not exit rc=0 with zero
    // bytes (BUG e3997558).
    .allowExcessArguments(true)
    .description("Start MCP server (stdio) or register with an agent")
    .action(async (options: { register?: string; json: boolean }, command: Command) => {
      const stray = command.args[0];
      if (stray !== undefined) {
        console.error(
          chalk.red(
            `error: unknown argument '${stray}'. 'skills mcp' takes no positional arguments. ` +
              `Valid forms: 'skills mcp' (start the MCP stdio server), ` +
              `'skills mcp --register <agent>', 'skills mcp --register all'`,
          ),
        );
        process.exit(1);
      }
      await handleMcp(options);
    });

  const setup = parent
    .command("setup")
    .description("Point this CLI at a Skills API server, or register agent integrations")
    .option("--api-url <url>", "Skills API origin to send remote work to")
    .option("--global", "Accepted for compatibility; the API origin is always per-user", false)
    .option("--json", "Output setup result as JSON", false)
    .action(async (options: SetupCommandOptions) => handleSetup(options));

  setup
    .command("agents")
    .option("--json", "Output registration result as JSON", false)
    .description("Register the Skills MCP server with all supported agents")
    .action(async (options: { json: boolean }) => handleMcp({ register: "all", json: options.json }));

  // Self-update
  parent
    .command("self-update")
    .description("Update @hasna/skills to the latest version")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { json: boolean }) => {
      if (process.env.SKILLS_TEST_MODE === "1") {
        if (options.json) console.log(JSON.stringify({ updated: false, error: "Self-update disabled in test mode" }));
        else console.error(chalk.yellow("Self-update disabled in test mode"));
        process.exitCode = 1;
        return;
      }
      const name = "@hasna/skills";
      if (!options.json) console.log(chalk.bold(`\nUpdating ${name}...\n`));
      const proc = Bun.spawn(["bun", "add", "-g", `${name}@latest`], {
        stdout: options.json ? "pipe" : "inherit",
        stderr: options.json ? "pipe" : "inherit",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        options.json ? new Response(proc.stdout).text() : Promise.resolve(""),
        options.json ? new Response(proc.stderr).text() : Promise.resolve(""),
        proc.exited,
      ]);
      if (exitCode === 0) {
        const vProc = Bun.spawn(["skills", "--version"], { stdout: "pipe" });
        const version = (await new Response(vProc.stdout).text()).trim();
        if (options.json) console.log(JSON.stringify({ updated: true, version, stdout, stderr }));
        else {
          console.log(chalk.green("\n\u2713 Updated to latest version"));
          console.log(chalk.dim(`  Version: ${version}`));
        }
      } else {
        if (options.json) console.log(JSON.stringify({ updated: false, exitCode, stdout, stderr }));
        else console.error(chalk.red("\n\u2717 Update failed"));
        process.exitCode = 1;
      }
    });
}

interface SetupCommandOptions {
  apiUrl?: string;
  /** Accepted and ignored: the fleet authority is per-user, never per-project. */
  global: boolean;
  json: boolean;
}

/**
 * Setup answers exactly one question: which Skills API server, if any, this CLI
 * should send remote work to.
 *
 * There is no mode to pick. Running skills on this machine is not a mode, it is
 * what happens when no credential resolves, so setup never has to be run to get
 * there and this command never writes a URL the operator did not supply.
 *
 * WHERE IT WRITES, and why that changed: `~/.hasna/skills/config/credentials`,
 * the shared fleet ladder's disk tier (owner ruling 2026-09-04, hasna/apps#1720)
 * — the same file `skills auth login` writes the key into, and the same file
 * every other Hasna CLI reads for its own app. It used to be this app's
 * `config.json`, project-scoped, which no other tool could see and which the
 * shared resolver does not read; `--global` is therefore accepted and ignored,
 * because a service address that differs per working directory is not a thing
 * the fleet ladder can express.
 *
 * Note the two separate facts in the output. `saved` is what this invocation
 * wrote, and only this invocation; `apiUrl` is the authority in effect
 * afterwards, which may come from the environment or the Keychain and outrank
 * what was just written. Reporting only the second would have this command claim
 * a write it never performed; reporting only the first would hide an override.
 */
async function handleSetup(options: SetupCommandOptions) {
  // An absent flag means "tell me where I stand". A present but empty flag is
  // an unset variable in a script (`--api-url "$SKILLS_URL"`), which must fail
  // loudly rather than report success while pointing nowhere.
  if (options.apiUrl !== undefined && !options.apiUrl.trim()) {
    const error = "Invalid value '' for --api-url. Expected an http(s) URL";
    if (options.json) console.log(JSON.stringify({ saved: null, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  let requested = options.apiUrl?.trim();
  if (!requested && !options.json && process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await promptLine("Skills API URL (blank to leave unchanged): ");
    if (answer === null) { process.exitCode = 130; return; }
    requested = answer.trim();
  }

  let saved: string | null = null;
  let credentialsFile: string | null = null;
  if (requested) {
    try {
      const normalized = normalizeSkillsApiOrigin(requireHttpUrl(requested));
      credentialsFile = saveApiUrl(normalized);
      saved = normalized;
    } catch (err) {
      const error = (err as Error).message;
      if (options.json) console.log(JSON.stringify({ saved: null, requested, error }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }
  }

  // Read the ladder back rather than echoing what was written: an env override
  // or a Keychain item outranks the file, and an operator who cannot see that
  // debugs the wrong thing.
  let configured: string | null = null;
  let source: string | null = null;
  let authenticated = false;
  let error: string | null = null;
  try {
    const fleet = resolveSkillsFleet();
    if (fleet.mode === "hosted") authenticated = true;
  } catch (err) {
    // Setup configures an instance before login. Missing authentication is
    // expected here; malformed configuration and a mismatched saved key still fail.
    if (!(err instanceof SkillsFleetCredentialError && err.code === "MISSING_API_CREDENTIAL")) {
      error = (err as Error).message;
      configured = saved;
    }
  }
  if (!error) {
    // The authority in effect, read back independently of the mode decision:
    // the local opt-in and a missing credential can both make the fleet
    // resolution above refuse, while the address this command manages (env,
    // Keychain, the file it just wrote) is still configured and must be shown.
    const authority = resolveSkillsApiOrigin();
    configured = authority?.origin ?? null;
    source = authority?.source ?? null;
  }

  const next = error
    ? ["skills auth login"]
    : configured
      ? ["skills auth login", "skills list --remote"]
      : ["skills list", "skills run <skill>"];
  const payload = {
    apiUrl: configured,
    source,
    saved,
    credentialsFile,
    authenticated,
    ...(error ? { error } : {}),
    config: loadConfig(),
    next,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    if (error) process.exitCode = 1;
    return;
  }

  if (error) {
    if (saved) console.log(chalk.green(`Skills API set to ${saved}`));
    console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  if (saved) {
    console.log(chalk.green(`Skills API set to ${saved}`));
    if (credentialsFile) console.log(chalk.dim(`  Saved in: ${credentialsFile}`));
    console.log(chalk.dim("  Next: skills auth login"));
  } else if (configured) {
    console.log(chalk.green(`Skills API already configured: ${configured}`));
    console.log(chalk.dim(`  Source: ${source}`));
    console.log(chalk.dim("  Change it with: skills setup --api-url <url>"));
    console.log(chalk.dim(`  Clear it with:  skills config unset apiUrl (or unset ${SKILLS_API_URL_ENV})`));
  } else {
    console.log(chalk.green("No Skills API configured; skills run on this machine."));
    console.log(chalk.dim("  Point at a server with: skills setup --api-url <url>"));
    console.log(chalk.dim("  Next: skills list"));
  }
}

/** Reject anything that is not an http(s) URL before it reaches the credentials file. */
function requireHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid value '${value}' for --api-url. Expected an http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid value '${value}' for --api-url. Expected an http(s) URL`);
  }
  return value.replace(/\/+$/, "");
}

function promptLine(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(answer);
    };
    rl.once("SIGINT", () => finish(null));
    rl.once("close", () => finish(null));
    rl.question(chalk.bold(question), (answer) => {
      finish(answer.trim());
    });
  });
}

interface RunCommandOptions {
  json: boolean;
  remote?: boolean;
  yes?: boolean;
  idempotencyKey?: string;
  file?: string[];
  wait?: boolean;
  pollIntervalMs?: string;
  pollTimeoutMs?: string;
}

async function handleRun(name: string, args: string[], options: RunCommandOptions) {
  // An explicit remote selection uses the server catalog. A private or newly
  // published skill need not exist in this package's local instruction corpus.
  const skill = options.remote ? { name, serverOwned: true } : getSkill(name);
  if (!skill) {
    const similar = findSimilarSkills(name);
    if (options.json) {
      console.log(JSON.stringify({ skill: name, args, exitCode: 1, error: `Skill '${name}' not found`, similar }));
    } else {
      console.error(`Skill '${name}' not found`);
      if (similar.length) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
    }
    process.exitCode = 1; return;
  }

  const prompt = extractPrompt(args);
  if (!options.remote && skill.name === ARTICLE_GENERATION_SLUG) {
    const validation = validateBlogArticleRunOptions({}, args, { requireTopic: true });
    if (!validation.ok) {
      writeBlogArticleValidationError(validation.errors, options.json);
      return;
    }
  }
  const routing = await resolveConfiguredRunRouting(skill);
  if (routing.route !== "remote" && options.file?.length) {
    const error = "File uploads require an explicitly remote run";
    if (options.json) console.log(JSON.stringify({ error })); else console.error(error);
    process.exitCode = 1;
    return;
  }
  let client: RemoteSkillsClient | undefined;
  let approvedCredits = 0;
  let inputFiles: RemoteInputFile[] = [];
  if (routing.route === "remote") {
    try {
      // Validate polling settings before creating a remote run or a credit hold.
      parsePollingOptions(options);
      inputFiles = (options.file ?? []).map(path => {
        const info = lstatSync(path);
        if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Input must be a regular file no larger than 20 MiB");
        return { name: basename(path), bytes: new Uint8Array(readFileSync(path)) };
      });
      describeRemoteFiles(inputFiles);
      client = new RemoteSkillsClient(routing.apiKey, routing.apiOrigin);
      const quote = await client.quoteRun(skill.name, {}, args);
      approvedCredits = quote.pricing.costCents;
      if (approvedCredits > 0 && !options.yes) {
        if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) {
          throw new Error(`CREDIT_APPROVAL_REQUIRED: This run costs ${approvedCredits} credits. Review skills quote, then rerun with --yes before the skill name.`);
        }
        const answer = await promptLine(`Approve ${approvedCredits} credits for ${quote.skill}? (y/N) `);
        if (answer === null) { process.exitCode = 130; return; }
        if (!/^(y|yes)$/i.test(answer)) { process.exitCode = 1; return; }
      }
      skill.name = quote.skill;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remote quote failed";
      if (options.json) console.log(JSON.stringify({ skill: name, exitCode: 1, remote: true, error: message }));
      else console.error(message);
      process.exitCode = 1;
      return;
    }
  }
  const runContext = createSkillRun({
    skill: skill.name,
    args,
    prompt,
    remote: routing.route === "remote",
    ...(routing.route === "remote" ? { remoteApiOrigin: routing.apiOrigin } : {}),
  });

  if (routing.route === "error") {
    const error = routing.error;
    writeRunLogs(runContext, "", error + "\n");
    const run = completeSkillRun(runContext, { status: "failed", error });
    if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error, run }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  if (routing.route === "remote") {
      try {
        const run = await client!.submitQuotedRunWithFiles(skill.name, {}, args, inputFiles, {
          maxCredits: approvedCredits,
          idempotencyKey: options.idempotencyKey ?? runContext.record.id,
        });
        if (run.error) {
          writeRunLogs(runContext, "", String(run.error) + "\n");
          const localRun = completeSkillRun(runContext, { status: "failed", error: String(run.error) });
          if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error: run.error, remoteRun: run, run: localRun }, null, 2));
          else console.error(chalk.red(run.error));
          process.exitCode = 1;
          return;
        }
        const remoteRunId = typeof run.id === "string" ? run.id : undefined;
        const nextActions = remoteRunNextActions(remoteRunId);
        const polling = parsePollingOptions(options);
        const polled: PollRemoteRunResult = options.wait && remoteRunId && !isTerminalRemoteStatus(run.status)
          ? await pollRemoteRun(client!, remoteRunId, polling)
          : { run, attempts: 0, waited: false };
        const remoteRun = polled.run ?? run;
        const status = normalizeRemoteStatus(remoteRun.status);
        const timedOutError = polled.timedOut && remoteRunId
          ? `Remote run '${remoteRunId}' did not reach a terminal status within ${polling.timeoutMs}ms`
          : undefined;
        const exitCode = timedOutError ? 124 : remoteExitCode(remoteRun, status);
        const error = timedOutError ?? remoteRunError(remoteRun);
        const localRun = await persistRemoteRun({
          client: client!,
          context: runContext,
          remoteRun,
          remoteRunId,
          fallbackError: error,
        });
        if (options.json) {
          console.log(JSON.stringify({
            contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
            skill: skill.name,
            args,
            exitCode,
            remote: true,
            remoteRun,
            run: localRun,
            nextActions,
            ...(options.wait ? { polling: { waited: polled.waited, attempts: polled.attempts, timeoutMs: polling.timeoutMs, timedOut: Boolean(polled.timedOut) } } : {}),
            ...(error ? { error } : {}),
          }, null, 2));
        }
        else {
          if (status === "failed") console.log(chalk.red(`Remote run failed for ${skill.name}`));
          else if (status === "completed") console.log(chalk.green(`Completed remote run for ${skill.name}`));
          else console.log(chalk.green(`Submitted remote run for ${skill.name}`));
          console.log(chalk.dim(`  Local run: ${localRun.id}`));
          console.log(chalk.dim(`  Run: ${remoteRun.id ?? "unknown"}`));
          console.log(chalk.dim(`  Status: ${remoteRun.status ?? "queued"}`));
          console.log(chalk.dim(`  Metadata: ${localRun.paths.runDir}/run.json`));
          if (options.wait) console.log(chalk.dim(`  Poll attempts: ${polled.attempts}`));
          if (error) console.log(chalk.red(`  Error: ${error}`));
          if (nextActions) {
            console.log(chalk.dim(`  Next: ${nextActions.poll}`));
            console.log(chalk.dim(`  When complete: ${nextActions.download}`));
          }
        }
        process.exitCode = exitCode;
        return;
      } catch (err) {
        const error = `Hosted skill ${skill.name} requires API access: ${(err as Error).message}`;
        writeRunLogs(runContext, "", error + "\n");
        const run = completeSkillRun(runContext, { status: "failed", error });
        if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error, run }, null, 2));
        else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }
  }

  const result = await runSkill(name, args, {
    stdio: "pipe",
    env: skillRunEnv(runContext),
  });
  writeRunLogs(runContext, result.stdout ?? "", result.stderr ?? result.error ?? "");
  const completed = completeSkillRun(runContext, {
    status: result.exitCode === 0 ? "completed" : "failed",
    error: result.error,
  });
  if (options.json) console.log(JSON.stringify({ skill: skill.name, args, ...result, run: completed }, null, 2));
  else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error);
    console.log(chalk.dim(`Run metadata: ${completed.paths.runDir}/run.json`));
    console.log(chalk.dim(`Exports: ${completed.paths.exportDir}`));
  }
  process.exitCode = result.exitCode;
}

function writeBlogArticleValidationError(errors: string[], json: boolean) {
  const payload = {
    error: "invalid blog article options",
    code: "INVALID_BLOG_ARTICLE_OPTIONS",
    details: errors,
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.error(chalk.red(payload.error));
    for (const error of errors) console.error(chalk.dim(`  ${error}`));
  }
  process.exitCode = 1;
}

function handleRemoteRunsList(options: { json: boolean; limit: string; cursor?: string }) {
  // The remote contract accepts a limit, not a continuation cursor. Validate
  // before resolving credentials or sending a request that would repeat page one.
  if (!/^0+$/.test(options.cursor ?? "0")) {
    const error = "Remote runs do not support cursor pagination. Omit --cursor or use --cursor 0; use --limit 1–100 to choose the number of recent runs.";
    if (options.json) console.log(JSON.stringify({ error, code: "REMOTE_CURSOR_UNSUPPORTED" }));
    else console.error(error);
    process.exitCode = 1;
    return;
  }
  return executeRemote(options, client => client.listRuns(Number(options.limit)));
}

function handleRunsList(options: { json: boolean; limit: string; cursor?: string }) {
  if (options.json) {
    const jsonLimit = Number.parseInt(options.limit, 10);
    const runs = listSkillRuns(process.cwd(), Number.isFinite(jsonLimit) ? jsonLimit : 20);
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  const limit = parsePageLimit(options.limit, DEFAULT_LIST_LIMIT, { allowAll: true });
  const offset = parsePageOffset(options.cursor);
  const fetchLimit = Number.isFinite(limit) ? limit + offset + 1 : Number.POSITIVE_INFINITY;
  const runs = listSkillRuns(process.cwd(), Number.isFinite(fetchLimit) ? fetchLimit : 10_000);
  if (!runs.length) {
    console.log(chalk.dim("No skill runs found"));
    return;
  }
  const hasMoreThanFetched = Number.isFinite(limit) && runs.length > offset + limit;
  const page = paginate(hasMoreThanFetched ? runs.slice(0, offset + limit) : runs, { limit, offset });
  console.log(chalk.bold(`\nRecent skill runs (${showingLabel(hasMoreThanFetched ? offset + limit + 1 : runs.length, page.items.length, page.offset)}):\n`));
  for (const run of page.items) {
    console.log(`  ${chalk.cyan(run.id)}  ${run.skill}  ${statusColor(run.status)}  ${chalk.dim(run.startedAt)}  artifacts:${run.artifacts.length}`);
  }
  if (hasMoreThanFetched) console.log(chalk.dim(`\nNext: skills runs list --cursor ${offset + page.items.length} --limit ${page.limit}`));
  console.log(chalk.dim("Details: skills runs show <run-id> or use --json for full run records."));
}

function handleRunsShow(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(run, null, 2));
  else {
    console.log(chalk.bold(`\n${run.id}\n`));
    console.log(`${chalk.dim("Skill:")} ${run.skill}`);
    console.log(`${chalk.dim("Status:")} ${statusColor(run.status)}`);
    console.log(`${chalk.dim("Started:")} ${run.startedAt}`);
    if (run.completedAt) console.log(`${chalk.dim("Completed:")} ${run.completedAt}`);
    if (run.remoteRunId) console.log(`${chalk.dim("Remote run:")} ${run.remoteRunId}`);
    if (run.error) console.log(`${chalk.dim("Error:")} ${chalk.red(run.error)}`);
    console.log(`${chalk.dim("Run dir:")} ${run.paths.runDir}`);
    console.log(`${chalk.dim("Exports:")} ${run.paths.exportDir}`);
  }
}

async function handleRunsStatus(runId: string, options: { json: boolean }) {
  const { skillsCredentialOrReason } = await import("../../lib/fleet-credentials.js");
  const { apiKey, apiOrigin, reason } = await skillsCredentialOrReason();
  if (!apiKey) {
    const error = reason ?? "Remote run status requires API access. Run: skills auth login";
    if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  const localRun = findSkillRun(runId);
  const remoteRunId = localRun?.remoteRunId || runId;
  if (localRun && !localRun.remoteRunId) {
    const error = `Run '${runId}' is local and has no remote run id`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  try {
    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    if (localRun?.remoteApiOrigin && localRun.remoteApiOrigin !== apiOrigin) throw new Error("This run belongs to another Skills instance; select its credential profile");
    const client = new RemoteSkillsClient(apiKey, apiOrigin!);
    const run = await client.getRun(remoteRunId);
    if (!run) {
      const error = `Remote run '${remoteRunId}' not found`;
      if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }

    const nextActions = remoteRunNextActions(remoteRunId);
    const payload = {
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      runId: remoteRunId,
      ...(localRun ? { localRunId: localRun.id } : {}),
      run,
      nextActions,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(chalk.bold(`\n${remoteRunId}\n`));
    if (localRun) console.log(`${chalk.dim("Local run:")} ${localRun.id}`);
    if (typeof run.skill === "string") console.log(`${chalk.dim("Skill:")} ${run.skill}`);
    console.log(`${chalk.dim("Status:")} ${statusColor(String(run.status || "queued"))}`);
    if (run.createdAt) console.log(`${chalk.dim("Created:")} ${run.createdAt}`);
    if (run.startedAt) console.log(`${chalk.dim("Started:")} ${run.startedAt}`);
    if (run.completedAt) console.log(`${chalk.dim("Completed:")} ${run.completedAt}`);
    if (run.errorMessage) console.log(`${chalk.dim("Error:")} ${chalk.red(run.errorMessage)}`);
    if (nextActions) {
      console.log(`${chalk.dim("Next:")} ${nextActions.poll}`);
      const label = run.status === "completed" ? "Download" : "When complete";
      console.log(`${chalk.dim(`${label}:`)} ${nextActions.download}`);
    }
  } catch (err) {
    const error = (err as Error).message;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
  }
}

async function handleExportsOpen(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  const exportDir = run.paths.exportDir;
  if (options.json) {
    console.log(JSON.stringify({ runId, exportDir }, null, 2));
    return;
  }
  console.log(exportDir);
  try {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", exportDir] : [exportDir];
    Bun.spawn([opener, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

async function handleExportsDownload(runId: string, options: { json: boolean }) {
  const { skillsCredentialOrReason } = await import("../../lib/fleet-credentials.js");
  const { apiKey, apiOrigin, reason } = await skillsCredentialOrReason();
  if (!apiKey) {
    const error = reason ?? "Remote artifact downloads require API access. Run: skills auth login";
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  try {
    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    const client = new RemoteSkillsClient(apiKey, apiOrigin!);
    const remoteRun = await client.getRun(runId);
    if (!remoteRun) {
      const error = `Remote run '${runId}' not found`;
      if (options.json) console.log(JSON.stringify({ error }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }

    const artifacts = await client.getRunArtifacts(runId);
    const canonicalSkill = typeof remoteRun.skill === "string" ? remoteRun.skill : "remote";
    const requestedSkill = typeof remoteRun.requestedSlug === "string" && remoteRun.requestedSlug.trim()
      ? remoteRun.requestedSlug
      : canonicalSkill;
    const exportDir = getRunExportDir(runId, requestedSkill);
    mkdirSync(exportDir, { recursive: true });
    const downloaded: Array<{ id: string; path: string; byteSize: number }> = [];

    for (const artifact of artifacts) {
      const artifactId = String(artifact.id || "");
      if (!artifactId) continue;
      const verified = await client.getVerifiedRunArtifact(runId, artifactId);
      const relativePath = safeArtifactRelativePath(
        typeof artifact.relativePath === "string" ? artifact.relativePath : artifact.fileName,
        String(artifact.fileName || artifactId),
      );
      const outputPath = join(exportDir, relativePath);
      ensureSafeExportParent(exportDir, relativePath);
      writeFileSync(outputPath, verified.bytes, { flag: "wx", mode: 0o600 });
      downloaded.push({ id: artifactId, path: outputPath, byteSize: verified.byteSize });
    }

    const payload = {
      runId,
      skill: requestedSkill,
      ...(requestedSkill !== canonicalSkill ? { canonicalSkill } : {}),
      exportDir,
      downloaded,
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(chalk.green(`Downloaded ${downloaded.length} artifact${downloaded.length === 1 ? "" : "s"}`));
      console.log(chalk.dim(`  Exports: ${exportDir}`));
    }
  } catch (err) {
    const error = (err as Error).message;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
  }
}

function safeArtifactRelativePath(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  const parts = raw.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || parts.length === 0 || parts.some((part) => part === ".." || /[\x00-\x1f\x7f]/.test(part))) throw new Error("Unsafe artifact path");
  return parts.join("/");
}

function ensureSafeExportParent(root: string, relativePath: string): void {
  const parts = relativePath.split("/").slice(0, -1);
  let parent = root;
  for (const part of ["", ...parts]) {
    if (part) parent = join(parent, part);
    try { if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) throw new Error("Unsafe artifact directory"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(parent, { mode: 0o700 });
    }
  }
}

interface RemoteRunApiClient {
  getRun(runId: string): Promise<any | null>;
  getRunLogs(runId: string): Promise<any[]>;
}

interface PollingOptions {
  intervalMs: number;
  timeoutMs: number;
}

interface PollRemoteRunResult {
  run: any;
  attempts: number;
  waited: boolean;
  timedOut?: boolean;
}

function parsePollingOptions(options: RunCommandOptions): PollingOptions {
  return {
    intervalMs: parsePositiveInt(options.pollIntervalMs, 1000),
    timeoutMs: parsePositiveInt(options.pollTimeoutMs, 300_000),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function pollRemoteRun(
  client: RemoteRunApiClient,
  runId: string,
  options: PollingOptions,
): Promise<PollRemoteRunResult> {
  const deadline = Date.now() + options.timeoutMs;
  let attempts = 0;
  let current: any = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    current = await client.getRun(runId);
    if (!current) throw new Error(`Remote run '${runId}' not found`);
    if (isTerminalRemoteStatus(current.status)) return { run: current, attempts, waited: true };
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.intervalMs, remaining)));
  }

  return {
    run: current ?? { id: runId, status: "queued" },
    attempts,
    waited: true,
    timedOut: true,
  };
}

async function persistRemoteRun(params: {
  client: RemoteRunApiClient;
  context: ReturnType<typeof createSkillRun>;
  remoteRun: any;
  remoteRunId?: string;
  fallbackError?: string;
}) {
  const status = normalizeRemoteStatus(params.remoteRun.status);
  await writeRemoteRunLogs(params.client, params.context, params.remoteRun, params.remoteRunId, params.fallbackError);
  if (isTerminalNormalizedStatus(status)) {
    return completeSkillRun(params.context, {
      status,
      remoteRunId: params.remoteRunId,
      ...(status === "failed" ? { error: params.fallbackError ?? "Remote run failed" } : {}),
    });
  }

  return updateSkillRun(params.context, {
    status,
    remoteRunId: params.remoteRunId,
  });
}

async function writeRemoteRunLogs(
  client: RemoteRunApiClient,
  context: ReturnType<typeof createSkillRun>,
  remoteRun: any,
  remoteRunId?: string,
  fallbackError?: string,
): Promise<void> {
  const logs = remoteRunId ? await fetchRemoteRunLogs(client, remoteRunId) : [];
  const { stdout, stderr } = splitRemoteLogs(remoteRun, logs, fallbackError);
  writeRunLogs(context, stdout, stderr);
}

async function fetchRemoteRunLogs(client: RemoteRunApiClient, runId: string): Promise<any[]> {
  try {
    return await client.getRunLogs(runId);
  } catch {
    return [];
  }
}

function splitRemoteLogs(remoteRun: any, logs: any[], fallbackError?: string): { stdout: string; stderr: string } {
  let stdout = typeof remoteRun.stdout === "string" ? remoteRun.stdout : "";
  let stderr = typeof remoteRun.stderr === "string" ? remoteRun.stderr : "";

  if (logs.length > 0) {
    const out: string[] = [];
    const err: string[] = [];
    for (const entry of logs) {
      const line = formatRemoteLogLine(entry);
      const level = typeof entry?.level === "string" ? entry.level.toLowerCase() : "info";
      if (level === "error" || level === "warn") err.push(line);
      else out.push(line);
    }
    stdout = appendLines(stdout, out);
    stderr = appendLines(stderr, err);
  }

  if (!stdout && typeof remoteRun.outputPreview === "string" && normalizeRemoteStatus(remoteRun.status) === "completed") {
    stdout = `${remoteRun.outputPreview}\n`;
  }
  if (!stderr && fallbackError) stderr = `${fallbackError}\n`;

  return { stdout, stderr };
}

function formatRemoteLogLine(entry: any): string {
  const message = typeof entry?.message === "string" ? entry.message : JSON.stringify(entry);
  const level = typeof entry?.level === "string" ? entry.level : "info";
  const sequence = Number.isFinite(Number(entry?.sequence)) ? `${entry.sequence} ` : "";
  return `[${level}] ${sequence}${message}`;
}

function appendLines(existing: string, lines: string[]): string {
  const rendered = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  return existing ? `${existing}${existing.endsWith("\n") || !rendered ? "" : "\n"}${rendered}` : rendered;
}

function remoteRunNextActions(runId: string | undefined): { poll: string; download: string } | undefined {
  if (!runId) return undefined;
  return {
    poll: `skills runs status ${runId}`,
    download: `skills exports download ${runId}`,
  };
}

function extractPrompt(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--prompt" || arg === "-p") && args[i + 1]) return args[i + 1];
    if (arg.startsWith("--prompt=")) return arg.slice("--prompt=".length);
  }
  return undefined;
}

function normalizeRemoteStatus(status: unknown): "queued" | "running" | "completed" | "failed" {
  switch (String(status ?? "queued").toLowerCase()) {
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
    case "errored":
    case "cancelled":
    case "canceled":
    case "timed_out":
    case "timeout":
      return "failed";
    default:
      return "queued";
  }
}

function isTerminalRemoteStatus(status: unknown): boolean {
  return isTerminalNormalizedStatus(normalizeRemoteStatus(status));
}

function isTerminalNormalizedStatus(status: "queued" | "running" | "completed" | "failed"): boolean {
  return status === "completed" || status === "failed";
}

function remoteRunError(run: any): string | undefined {
  for (const key of ["error", "errorMessage", "message"]) {
    if (typeof run?.[key] === "string" && run[key].trim()) return run[key];
  }
  return normalizeRemoteStatus(run?.status) === "failed" ? "Remote run failed" : undefined;
}

function remoteExitCode(run: any, status: "queued" | "running" | "completed" | "failed"): number {
  const rawExitCode = Number(run?.exitCode);
  const hasExitCode = Number.isInteger(rawExitCode) && rawExitCode >= 0 && rawExitCode <= 255;
  if (hasExitCode) return rawExitCode;
  return status === "failed" ? 1 : 0;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return chalk.green(status);
    case "failed": return chalk.red(status);
    case "running": return chalk.yellow(status);
    default: return chalk.dim(status);
  }
}
