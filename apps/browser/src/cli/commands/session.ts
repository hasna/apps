// ─── Session commands: create, list, close, save-state, list-states ──────────

import type { Command } from "commander";
import chalk from "chalk";
import { createSession, closeSession, getSession, listSessions, getSessionPage } from "../../lib/session.js";
import type { BrowserEngine, Session } from "../../types/index.js";
import { formatDate, limited, parseLimit, printHint, printListFooter, shortId, truncate } from "../output.js";
import { addKernelOptions, kernelSessionOptionsFromCli, type KernelCliOptions } from "./kernel.js";

function printSessionSummary(session: Session, opts: { verbose?: boolean } = {}): void {
  const label = session.name ? `${session.name} ` : "";
  const url = session.start_url ? ` ${truncate(session.start_url, opts.verbose ? 100 : 56)}` : "";
  const remote = session.remote_session_id ? ` remote=${shortId(session.remote_session_id)}` : "";
  const created = opts.verbose ? ` created=${formatDate(session.created_at)}` : "";
  console.log(`${shortId(session.id)} ${label}[${session.status}] ${session.engine}${remote}${created}${url}`);
}

export function register(program: Command) {

const sessionCmd = program.command("session").description("Manage browser sessions");

addKernelOptions(sessionCmd
  .command("create")
  .description("Create a new browser session")
  .option("--engine <engine>", "Browser engine", "auto")
  .option("--url <url>", "Start URL")
  .option("--headed", "Run in headed (visible) mode")
  .option("--json", "Output full session as JSON")
  .option("--verbose", "Show the full session object"))
  .action(async (opts: KernelCliOptions & { engine: string; url?: string; headed?: boolean; json?: boolean; verbose?: boolean }) => {
    const { session } = await createSession({
      engine: opts.engine as BrowserEngine,
      startUrl: opts.url,
      headless: !opts.headed,
      ...kernelSessionOptionsFromCli(opts),
    });
    if (opts.json) {
      console.log(JSON.stringify(session, null, 2));
      return;
    }
    console.log(chalk.green(`✓ Session created: ${session.id}`));
    printSessionSummary(session, { verbose: opts.verbose });
    if (opts.verbose) console.log(JSON.stringify(session, null, 2));
    else printHint(`Use browser session show ${session.id} or --json for the full record.`);
  });

sessionCmd
  .command("list")
  .description("List all sessions")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .option("--verbose", "Show extra compact columns")
  .action((opts: { status?: string; json?: boolean; limit?: string; verbose?: boolean }) => {
    const sessions = listSessions(opts.status ? { status: opts.status as "active" | "closed" | "error" } : undefined);
    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else if (sessions.length === 0) {
      console.log(chalk.gray("No sessions found"));
    } else {
      const { visible } = limited(sessions, parseLimit(opts.limit));
      visible.forEach((s) => printSessionSummary(s, { verbose: opts.verbose }));
      printListFooter(sessions.length, visible.length, "Use --limit N, --verbose, --json, or browser session show <id> for details.");
    }
  });

sessionCmd
  .command("show <id>")
  .description("Show full details for one session")
  .option("--json", "Output as JSON")
  .action((id: string, opts: { json?: boolean }) => {
    const session = getSession(id);
    if (opts.json) {
      console.log(JSON.stringify(session, null, 2));
      return;
    }
    printSessionSummary(session, { verbose: true });
    console.log(chalk.gray(`  id: ${session.id}`));
    if (session.start_url) console.log(chalk.gray(`  url: ${session.start_url}`));
    if (session.project_id) console.log(chalk.gray(`  project: ${session.project_id}`));
    if (session.agent_id) console.log(chalk.gray(`  agent: ${session.agent_id}`));
    if (session.remote_session_id) console.log(chalk.gray(`  remote: ${session.remote_session_id}`));
    if (session.browser_live_view_url) console.log(chalk.gray(`  live view: ${session.browser_live_view_url}`));
  });

sessionCmd
  .command("close <id>")
  .description("Close a session")
  .action(async (id: string) => {
    await closeSession(id);
    console.log(chalk.green(`✓ Session closed: ${id}`));
  });

sessionCmd
  .command("save-state <name>")
  .description("Save current session auth state for reuse")
  .requiredOption("--session <id>", "Session ID")
  .action(async (name: string, opts: { session: string }) => {
    const page = getSessionPage(opts.session);
    const { saveStateFromPage } = await import("../../lib/storage-state.js");
    const path = await saveStateFromPage(page, name);
    console.log(chalk.green(`✓ State saved: ${name}`));
    console.log(chalk.gray(`  Path: ${path}`));
  });

sessionCmd
  .command("list-states")
  .description("List saved auth states")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Max rows to print in compact output", String(20))
  .action(async (opts: { json?: boolean; limit?: string }) => {
    const { listStates } = await import("../../lib/storage-state.js");
    const states = listStates();
    if (opts.json) {
      console.log(JSON.stringify(states, null, 2));
      return;
    }
    if (states.length === 0) { console.log(chalk.gray("No saved states")); return; }
    const { visible } = limited(states, parseLimit(opts.limit));
    visible.forEach(s => console.log(`${truncate(s.name, 48)} ${chalk.gray(formatDate(s.modified))}`));
    printListFooter(states.length, visible.length, "Use --limit N or --json for state paths.");
  });

} // end register
