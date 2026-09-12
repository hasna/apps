#!/usr/bin/env bun
import { Command, Help } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { resolveIdentity, IdentityError } from "../lib/identity.js";
import { ConversationsStoreConfigError, getStore } from "../lib/store/index.js";
import { App } from "./components/App.js";
import { registerMessagingCommands } from "./commands/messaging.js";
import { registerAttachmentCommands } from "./commands/attachments.js";
import { registerChannelCommands } from "./commands/channels.js";
import { registerProjectCommands } from "./commands/projects.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerReceiptCommands } from "./commands/receipts.js";
import { registerLockCommands } from "./commands/locks.js";
import { registerTmuxCommands } from "./commands/tmux.js";
import { registerAdminCommands } from "./commands/admin.js";
import { registerProjectRegistrationCommands } from "./commands/project-registration.js";
import { registerThreadCommands } from "./commands/threads.js";
import pkg from "../../package.json";
import { printErrorLine, printJsonLine, printLine } from "../lib/stdout.js";

const program = new Command();

// Commander's default subcommandTerm() renders each row of the parent
// `--help` command listing from the .argument() declaration order and
// deliberately ignores a command's explicit .usage() override (help.js:
// "Legacy. Ignores custom usage string"). That left `send` listed as
// `send [options] <message> [channel]` in `conversations --help` while
// `conversations send --help` — corrected by PR #1068 — says
// `<channel> <message>`, so the contradiction the original bug named
// persisted one surface up (todos afda2dcf). When a command declares an
// explicit .usage(), render its parent row from that string so the two
// surfaces agree; every other row keeps the legacy rendering unchanged.
const legacySubcommandTerm = Help.prototype.subcommandTerm;

program.configureHelp({
  subcommandTerm(cmd: Command): string {
    const explicitUsage = (cmd as { _usage?: string })._usage;
    if (explicitUsage) {
      return `${cmd.name()} ${explicitUsage}`;
    }
    return legacySubcommandTerm(cmd);
  },
});

program
  .name("conversations")
  .description("Real-time CLI messaging for AI agents")
  .version(pkg.version);

// ---- command groups ----
registerMessagingCommands(program);
registerAttachmentCommands(program);
registerChannelCommands(program);
registerProjectCommands(program);
registerAgentCommands(program);
registerAnalyticsCommands(program);
registerReceiptCommands(program);
registerLockCommands(program);
registerTmuxCommands(program);
registerAdminCommands(program);
registerProjectRegistrationCommands(program);
registerThreadCommands(program);

// ---- mcp ----
program
  .command("mcp")
  .description("Start MCP server")
  .action(async () => {
    const { startMcpServer } = await import("../mcp/index.js");
    await startMcpServer();
  });

// ---- events-drain: Conversations→Events source outbox worker ----
// One command, one semantics on whichever store the resolver selected: the
// on-box SQLite outbox spools into the on-box events durable spool inbox, and
// the hosted API runs the server's own outbox worker over its Postgres store.
// Routing through getStore() means a hosted station can never silently open
// (or create) ~/.hasna/conversations/messages.db — the fail-closed property
// hasna/apps#1720 demanded, kept by delegation instead of by a gate.
program
  .command("events-drain")
  .description("Drain the Conversations→Events source outbox into the Events durable spool inbox")
  .option("--limit <n>", "Maximum pending rows to transport per run", parseInt)
  // Declared so the refusal above can honour the JSON error contract: without
  // the option Commander rejected `--json` as unknown before the action ran,
  // and the fail-closed refusal was reachable on the human path only
  // (hasna/apps#1720 validation, round 2).
  .option("-j, --json", "Output the drain report as JSON")
  .action(async (opts) => {
    // Generalized from the old local worker's guard: an unparseable `--limit`
    // (commander's parseInt yields NaN, e.g. `--limit abc`) must not reach the
    // stores — the hosted route tolerates it via positiveInteger() but the
    // on-box worker would pass `LIMIT NaN` to SQLite. One spelling for both.
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : undefined;
    const result = await getStore().drainEventOutbox({ limit });
    if (opts.json) {
      printJsonLine({ scanned: result.scanned, transported: result.transported, skipped: result.skipped, spooled: result.spooled });
      return;
    }
    printLine(`events-drain: scanned ${result.scanned}, transported ${result.transported}, skipped ${result.skipped}, spooled ${result.spooled}`);
  });

// ---- default: TUI ----
// The interactive TUI is Store-backed exactly like every other surface: it
// reads and writes through the store the resolver selected (hosted API or the
// on-box SQLite store), so it works in either transport. It still needs a
// real terminal — that is a TTY requirement, not a transport gate.
program
  .action(() => {
    if (!process.stdin.isTTY) {
      printErrorLine(chalk.red("Interactive mode requires a TTY terminal."));
      printErrorLine(chalk.dim("Use subcommands (send, read, sessions, etc.) for non-interactive use."));
      process.exit(1);
    }
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });

// ---- top-level error handling ----
// Commander actions are async; `program.parse()` returns before they settle, so a
// rejected action would otherwise surface as an unhandled rejection with a raw
// (minified) stack trace. Route every failure through one clean formatter instead.
type HttpFailure = {
  name: "HasnaHttpError";
  status: number;
  method: string;
  path: string;
  body: unknown;
};

function isHttpFailure(err: unknown): err is HttpFailure {
  if (!err || typeof err !== "object") return false;
  const candidate = err as Partial<HttpFailure>;
  return candidate.name === "HasnaHttpError"
    && typeof candidate.status === "number"
    && typeof candidate.method === "string"
    && typeof candidate.path === "string";
}

/**
 * Whether the invocation asked for machine-readable output.
 *
 * Recorded from commander's PARSED options, not by scanning argv. Scanning
 * argv gets this wrong for a message whose body happens to be `--json`
 * (`conversations send someone -- --json`), which would then be answered with a
 * JSON error object by a caller that never asked for one.
 *
 * It is captured globally because identity resolution now fails at ~55
 * independent call sites that previously had no failure path, and the repo's
 * contract (src/cli/json-error-contract.e2e.test.ts) is that every error branch
 * emits parseable JSON on stdout under --json so consumers that JSON.parse the
 * output do not crash on an empty string.
 */
let jsonOutputRequested = false;

program.hook("preAction", (_thisCommand, actionCommand) => {
  const opts = actionCommand.opts() as { json?: boolean; contract?: boolean };
  jsonOutputRequested = Boolean(opts.json || opts.contract);
});

function wantsJsonOutput(): boolean {
  return jsonOutputRequested;
}

function reportCliError(err: unknown): never {
  if (err instanceof IdentityError) {
    if (wantsJsonOutput()) {
      printJsonLine({ error: err.message, code: err.code, agent: null });
    } else {
      printErrorLine(chalk.red(err.message));
    }
    process.exit(1);
  }
  // A store CONFIGURATION refusal (fail closed: API env missing or half-set,
  // no explicit local store path) is an operator error, not a data error.
  // Under --json it must honour the repo's JSON-error contract (parseable JSON
  // on stdout) exactly like every other error branch.
  if (err instanceof ConversationsStoreConfigError) {
    if (wantsJsonOutput()) {
      printJsonLine({ error: err.message, code: err.code });
    } else {
      printErrorLine(chalk.red(err.message));
    }
    process.exit(1);
  }
  if (isHttpFailure(err)) {
    const body = err.body && typeof err.body === "object"
      ? err.body as { error?: string; message?: string; reason?: string; hint?: string }
      : undefined;
    const detail = body?.error || body?.message || (typeof err.body === "string" ? err.body : undefined);
    printErrorLine(chalk.red(`Request failed: ${err.method} ${err.path} -> ${err.status}`));
    if (detail) printErrorLine(chalk.dim(detail));
    if (body?.reason && body.reason !== detail) printErrorLine(chalk.dim(body.reason));
    if (body?.hint) printErrorLine(chalk.dim(`Hint: ${body.hint}`));
    if (err.status === 404) {
      printErrorLine(
        chalk.dim("The cloud API did not recognize this route. Ensure the server is up to date."),
      );
    }
    process.exit(1);
  }
  printErrorLine(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

process.on("unhandledRejection", reportCliError);

/**
 * Reject an unregistered command before Commander can route it to the root
 * action.
 *
 * The root action is the no-argument interactive TUI. Commander otherwise
 * treats a positional token such as `heartbeat` as an excess argument to that
 * action, and its help option is processed before the action runs. The result
 * is either an unrelated TUI error or successful top-level help for a command
 * that does not exist. Derive the accepted names from the registered command
 * tree so new commands and aliases do not need a parallel allowlist.
 */
function rejectUnknownTopLevelCommand(command: Command, argv: string[]): void {
  const candidate = argv[0];
  if (!candidate || candidate.startsWith("-") || candidate === "help") return;

  const registered = command.commands.some((subcommand) =>
    subcommand.name() === candidate || subcommand.aliases().includes(candidate)
  );
  if (!registered) {
    command.error(`error: unknown command '${candidate}'`, {
      code: "commander.unknownCommand",
      exitCode: 1,
    });
  }
}

rejectUnknownTopLevelCommand(program, process.argv.slice(2));
program.parseAsync().catch(reportCliError);
