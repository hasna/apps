import type { Command } from "commander";
import { env } from "../../lib/env.js";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { closeDb } from "../../lib/db.js";
import {
  resolveIdentity,
  readPersistedIdentity,
  readSessionIdentity,
  updateCachedAutoName,
  isSelfRename,
  describeIdentitySource,
  IdentityError,
  bindSessionIdentity,
  getDeclaredSessionId,
} from "../../lib/identity.js";
import { emitCliError } from "../cli-error.js";
import { isAgentConflict, normalizeAgentName } from "../../lib/presence.js";
import { windowItems } from "../../lib/compact-output.js";
import { getCliWindow, printCompactFooter, printJsonDisclosure, windowJsonList } from "../compact.js";
import { printErrorLine, printJson, printJsonLine, printLine } from "../../lib/stdout.js";

type PresenceView = {
  online: boolean;
  last_seen_at: string;
} | null;

export type WhoamiPayload = {
  agent: string;
  source: string;
  online: boolean;
  last_seen_at: string | null;
  last_seen_ago_seconds: number | null;
};

export function buildWhoamiPayload(
  agent: string,
  source: string,
  presence: PresenceView,
  nowMs = Date.now(),
): WhoamiPayload {
  if (!presence) {
    return {
      agent,
      source,
      online: false,
      last_seen_at: null,
      last_seen_ago_seconds: null,
    };
  }

  const lastSeenMs = new Date(`${presence.last_seen_at}Z`).getTime();
  const deltaSeconds = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000))
    : null;

  return {
    agent,
    source,
    online: presence.online,
    last_seen_at: presence.last_seen_at,
    last_seen_ago_seconds: deltaSeconds,
  };
}

export function registerAgentCommands(program: Command): void {
  // ---- agents ----
  const agents = program
    .command("agents")
    .description("Manage agents");

  agents
    .command("list")
    .description("List all agents with their presence status")
    .option("--online", "Only show online agents")
    .option("--limit <n>", "Max agents to show", parseInt)
    .option("--cursor <n>", "Skip first N agents for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      // Roster discovery must NOT require an identity. This is the command a
      // fresh seat runs to see which names are taken BEFORE claiming one, and
      // the command an operator runs to work out who is who — requiring a name
      // to ask which names exist is a deadlock, and `agents list` has no --from
      // to escape it. The identity is incidental here: it drives a courtesy
      // heartbeat and the "(you)" marker, and listAgents() takes no identity at
      // all, so both simply drop out when nothing is declared.
      let agent: string | null = null;
      try {
        agent = resolveIdentity();
      } catch (err) {
        if (!(err instanceof IdentityError)) throw err;
      }
      if (agent) await getStore().heartbeat(agent);

      const agentsList = await getStore().listAgents({ online_only: opts.online });
      const sort = getStore().describeListOrder("agents");
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(agentsList, window);

      if (opts.json) {
        const listing = windowJsonList(agentsList, opts);
        printJson(listing.rows);
        printJsonDisclosure({
          shown: listing.rows.length,
          total: listing.page.total,
          hasMore: listing.bounded && listing.page.hasMore,
          nextCursor: listing.page.nextCursor,
          sort,
        });
      } else {
        if (agentsList.length === 0) {
          printLine(chalk.dim("No agents found."));
        } else {
          for (const a of page.items) {
            const status = a.online ? chalk.green("online") : chalk.dim("offline");
            const lastSeen = chalk.dim(a.last_seen_at.slice(0, 19));
            const agentName = a.agent === agent ? chalk.cyan(`${a.agent} (you)`) : chalk.cyan(a.agent);
            printLine(`  ${agentName}  ${status}  ${chalk.dim(a.status)}  ${lastSeen}`);
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort,
            detailHint: "Use --online to filter active agents.",
          });
        }
      }
      closeDb();
    });

  agents
    .command("remove")
    .description("Remove an agent from the presence list")
    .argument("<name>", "Agent name to remove")
    .option("-j, --json", "Output as JSON")
    .action(async (name, opts) => {
      const agentName = typeof name === "string" ? name.trim() : "";
      if (!agentName) {
        printErrorLine(chalk.red("Agent name cannot be empty."));
        process.exit(1);
      }

      const removed = await getStore().removePresence(agentName);

      if (opts.json) {
        printJsonLine({ agent: agentName, removed });
      } else {
        if (removed) {
          printLine(chalk.green(`Agent "${agentName}" removed.`));
        } else {
          printErrorLine(chalk.red(`Agent "${agentName}" not found.`));
          process.exit(1);
        }
      }
      closeDb();
    });

  agents
    .command("rename")
    .description("Rename an agent in the presence list")
    .argument("<old-name>", "Current agent name")
    .argument("<new-name>", "New agent name")
    .option("-j, --json", "Output as JSON")
    .action(async (oldName, newName, opts) => {
      const old = typeof oldName === "string" ? oldName.trim() : "";
      const renamed = typeof newName === "string" ? newName.trim() : "";

      if (!old || !renamed) {
        printErrorLine(chalk.red("Both old and new names are required."));
        process.exit(1);
      }

      try {
        const ok = await getStore().renameAgent(old, renamed);
        if (!ok) {
          printErrorLine(chalk.red(`Agent "${old}" not found.`));
          process.exit(1);
        }

        // Presence lives in the store, while durable identity can live in either
        // the session record or the installation-wide agent-id file. Migrate each
        // record only when it names the agent that was actually renamed. Without
        // this, the next process resolves the OLD name and heartbeat recreates
        // presence for an agent the rename just removed.
        const normalizedRenamed = normalizeAgentName(renamed);
        const persistedIdentity = readPersistedIdentity();
        const machineIsSelf = isSelfRename(old, persistedIdentity);
        const identityAdopted = machineIsSelf ? updateCachedAutoName(normalizedRenamed) : false;
        const identityWriteFailed = machineIsSelf && !identityAdopted;

        const declaredSessionId = getDeclaredSessionId();
        const persistedSessionIdentity = readSessionIdentity(declaredSessionId);
        const sessionIsSelf = isSelfRename(old, persistedSessionIdentity);
        const sessionIdentityAdopted = sessionIsSelf && declaredSessionId
          ? bindSessionIdentity(normalizedRenamed, declaredSessionId)
          : false;
        const sessionIdentityWriteFailed = sessionIsSelf && !sessionIdentityAdopted;

        if (opts.json) {
          printJsonLine({
            old_name: old,
            new_name: renamed,
            renamed: true,
            identity_adopted: identityAdopted,
            identity_write_failed: identityWriteFailed,
            session_identity_adopted: sessionIdentityAdopted,
            session_identity_write_failed: sessionIdentityWriteFailed,
          });
        } else {
          printLine(chalk.green(`Agent "${old}" renamed to "${renamed}".`));
          if (identityAdopted) {
            printLine(chalk.dim(`This installation's identity is now "${normalizedRenamed}".`));
          } else if (identityWriteFailed) {
            // Report the file, not resolveIdentity(): the file is what survives
            // this process, and it still names the agent we just renamed away.
            printErrorLine(chalk.red(`Renamed in presence, but could not update the local agent-id file (pinned read-only?). This installation still resolves as "${persistedIdentity}" — which no longer exists in presence.`));
          }
          if (sessionIdentityAdopted) {
            printLine(chalk.dim(`This session's identity is now "${normalizedRenamed}".`));
          } else if (sessionIdentityWriteFailed) {
            printErrorLine(chalk.red(`Renamed in presence, but could not update this session's identity binding. CONVERSATIONS_SESSION_ID still resolves as "${persistedSessionIdentity}" — which no longer exists in presence.`));
          }
        }
      } catch (e: any) {
        printErrorLine(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  agents
    .command("register")
    .description("Register an agent with conflict detection (30 min active window)")
    .argument("<name>", "Agent name to register")
    .option("--session <id>", "Session ID (default: random UUID)")
    .option("--role <role>", "Agent role (default: agent)")
    .option("--project <id>", "Project ID to lock agent to")
    .option("--force", "Force takeover even if another session is active")
    .option("--identity", "Also adopt this name as this installation's identity (writes the machine-wide agent-id file)")
    .option("-j, --json", "Output as JSON")
    .action(async (name, opts) => {
      const agentName = (typeof name === "string" ? name : "").trim();
      if (!agentName) {
        printErrorLine(chalk.red("Agent name is required."));
        process.exit(1);
      }

      const explicitSessionId = typeof opts.session === "string" ? opts.session.trim() : "";
      const environmentSessionId = getDeclaredSessionId();
      const sessionId = explicitSessionId || environmentSessionId || crypto.randomUUID();
      const result = await getStore().registerAgent(agentName, sessionId, opts.role, opts.project, opts.force);

      if (isAgentConflict(result)) {
        if (opts.json) {
          printJsonLine(result);
        } else {
          printErrorLine(chalk.red(`Conflict: agent "${agentName}" is already active (last seen: ${result.last_seen_at}).`));
          printErrorLine(chalk.dim("Use --force or wait 30 minutes for the session to expire."));
        }
        process.exit(1);
      }

      const registeredName = result.agent.agent;

      // Presence registration and identity resolution are separate surfaces.
      // Persist the successful registration under this session id so the next
      // CLI process carrying the same CONVERSATIONS_SESSION_ID resolves to the
      // same agent. Each session gets its own hashed file; registering session B
      // cannot rewrite session A or the installation-wide fallback.
      const sessionIdentityBound = bindSessionIdentity(registeredName, sessionId);
      const sessionIdentityWriteFailed = !sessionIdentityBound;
      const sessionIdentitySource = explicitSessionId
        ? "explicit (--session)"
        : environmentSessionId
          ? "env var (CONVERSATIONS_SESSION_ID)"
          : "generated by agents register";

      // Adopting is OPT-IN. The agent-id file is machine-wide: every session on
      // this host that passes neither --from nor CONVERSATIONS_AGENT_ID resolves
      // through it. Registering on a shared box must not silently repoint the
      // whole machine — that is last-writer-wins between concurrent agents.
      // Pass --identity to deliberately claim the machine identity.
      let identityAdopted = false;
      let identityWriteFailed = false;
      if (opts.identity) {
        identityAdopted = updateCachedAutoName(registeredName);
        identityWriteFailed = !identityAdopted;
      }

      // The env var outranks the file, so adopting does not necessarily change
      // what this environment resolves to. Say what is actually true.
      const envOverride = env.agentId()?.trim() || null;

      if (opts.json) {
        printJsonLine({
          ...result,
          identity_adopted: identityAdopted,
          identity_write_failed: identityWriteFailed,
          identity_env_override: envOverride,
          session_identity_bound: sessionIdentityBound,
          session_identity_write_failed: sessionIdentityWriteFailed,
          session_identity_source: sessionIdentitySource,
        });
      } else {
        const action = result.took_over ? chalk.yellow("took over") : result.created ? chalk.green("registered") : chalk.cyan("updated");
        printLine(`  ${action}  ${chalk.bold(registeredName)}  session: ${chalk.dim(sessionId)}`);
        if (sessionIdentityBound) {
          printLine(chalk.dim(`  identity   session identity bound via ${sessionIdentitySource}`));
          if (!environmentSessionId) {
            printLine(chalk.dim(`  reuse      set CONVERSATIONS_SESSION_ID=${sessionId} for later CLI invocations in this session`));
          } else if (explicitSessionId && explicitSessionId !== environmentSessionId) {
            printLine(chalk.yellow(`  warning    --session bound "${explicitSessionId}", but this environment resolves CONVERSATIONS_SESSION_ID="${environmentSessionId}"`));
          }
        } else {
          printErrorLine(chalk.red("  identity   session binding was NOT persisted; later CLI invocations cannot inherit this registration"));
        }
        if (identityAdopted) {
          printLine(chalk.dim(`  identity   installation identity set to "${registeredName}"`));
        } else if (identityWriteFailed) {
          // Read the file rather than resolveIdentity(): nothing was adopted, so
          // the truth is whatever the unwritable file already says.
          const persistedIdentity = readPersistedIdentity();
          const stillResolves = persistedIdentity
            ? `This installation still resolves as "${persistedIdentity}".`
            : "This installation still has no machine identity.";
          printErrorLine(chalk.red(`  identity   NOT changed — could not write ${chalk.bold("agent-id")} (pinned read-only?). ${stillResolves}`));
        }
        if (envOverride && normalizeAgentName(envOverride) !== normalizeAgentName(registeredName)) {
          printLine(chalk.yellow(`  warning    CONVERSATIONS_AGENT_ID="${envOverride}" has higher precedence; this environment still resolves as "${envOverride}"`));
        }
      }
      closeDb();
    });

  agents
    .command("heartbeat")
    .description("Send a presence heartbeat to mark yourself as active")
    .option("--from <agent>", "Agent identity (default: CONVERSATIONS_AGENT_ID or auto)")
    .option("--status <status>", "Status: online, busy, idle (default: online)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      const status = opts.status || "online";
      await getStore().heartbeat(agent, status);

      if (opts.json) {
        printJsonLine({ agent, status, heartbeat: true });
      } else {
        printLine(`  ${chalk.green("♥")}  ${chalk.cyan(agent)}  ${chalk.dim(status)}`);
      }
      closeDb();
    });

  agents
    .command("reap-stale")
    .description("Flag registrations created once and never seen again (report-only unless --apply)")
    .option("--older-than <days>", "Minimum age in days for a single-touch registration to be flagged (default: 7)", parseInt)
    .option("--apply", "Delete the flagged registrations (default: report only)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const olderThanDays = opts.olderThan;
      const olderThanSeconds = typeof olderThanDays === "number" && Number.isFinite(olderThanDays) && olderThanDays > 0
        ? Math.round(olderThanDays * 86400)
        : undefined;
      const applied = opts.apply === true;
      const result = await getStore().reapStaleSingleTouch({ olderThanSeconds, apply: applied });

      if (opts.json) {
        printJsonLine({ ...result, applied });
      } else if (result.candidates === 0) {
        printLine(chalk.dim("No single-touch registrations older than the retention window."));
      } else {
        printLine(`  ${result.candidates} single-touch registration(s) older than the retention window:`);
        for (const name of result.agents) {
          printLine(`    ${chalk.cyan(name)}`);
        }
        if (result.reaped > 0) {
          printLine(chalk.green(`  ${result.reaped} removed.`));
          printLine(chalk.dim(`  ${result.archived} preserved in ${result.archiveTable} for rollback.`));
        } else {
          printLine(chalk.dim("  Report only — pass --apply to remove."));
        }
      }
      closeDb();
    });

  // ---- focus ----
  const focus = program
    .command("focus")
    .description("Manage agent project focus");

  focus
    .command("set")
    .description("Set your project focus — scopes read operations to this project")
    .argument("<project>", "Project ID or name")
    .option("--from <agent>", "Agent identity")
    .option("-j, --json", "Output as JSON")
    .action(async (projectArg, opts) => {
      const agent = resolveIdentity(opts.from);
      const project = await getStore().getProject(projectArg) || await getStore().getProjectByName(projectArg);
      if (!project) {
        printErrorLine(chalk.red(`Project "${projectArg}" not found.`));
        process.exit(1);
      }
      await getStore().setPresenceProject(agent, project.id);

      if (opts.json) {
        printJsonLine({ agent, project_id: project.id, project_name: project.name, focused: true });
      } else {
        printLine(`  ${chalk.green("focused")}  ${chalk.cyan(agent)}  →  ${chalk.bold(project.name)}  ${chalk.dim(`(${project.id})`)}`);
      }
      closeDb();
    });

  focus
    .command("clear")
    .description("Clear your project focus")
    .option("--from <agent>", "Agent identity")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      await getStore().setPresenceProject(agent, null);

      if (opts.json) {
        printJsonLine({ agent, project_id: null, focused: false });
      } else {
        printLine(`  ${chalk.yellow("unfocused")}  ${chalk.cyan(agent)}`);
      }
      closeDb();
    });

  focus
    .command("get")
    .description("Show current project focus")
    .option("--from <agent>", "Agent identity")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      const presence = await getStore().getPresence(agent);
      const projectId = presence?.project_id ?? null;
      const project = projectId ? (await getStore().getProject(projectId) || null) : null;

      if (opts.json) {
        printJsonLine({ agent, project_id: projectId, project_name: project?.name ?? null });
      } else {
        if (projectId) {
          const name = project?.name ?? chalk.dim("(unknown)");
          printLine(`  ${chalk.cyan(agent)}  focused on  ${chalk.bold(name)}  ${chalk.dim(`(${projectId})`)}`);
        } else {
          printLine(`  ${chalk.cyan(agent)}  ${chalk.dim("no focus set")}`);
        }
      }
      closeDb();
    });

  // ---- whoami ----
  program
    .command("whoami")
    .description("Show current agent identity and online status")
    .option("--from <agent>", "Explicit agent identity")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      // whoami is the command an operator reaches for *because* attribution
      // looks wrong, so an unresolved identity is the answer here, not a crash:
      // report it as the diagnosis, still non-zero so scripts notice.
      let agent: string;
      try {
        agent = resolveIdentity(opts.from);
      } catch (err) {
        if (err instanceof IdentityError) {
          emitCliError(err.message, opts, { code: err.code, agent: null });
        }
        throw err;
      }
      const source = describeIdentitySource(opts.from);

      const presence = await getStore().getPresence(agent);
      const payload = buildWhoamiPayload(agent, source, presence);
      if (opts.json) {
        printJson(payload);
        closeDb();
        return;
      }

      let onlineStatus: string;
      if (presence && presence.online) {
        const agoSec = payload.last_seen_ago_seconds ?? 0;
        const agoStr = agoSec < 60 ? `${agoSec}s ago` : `${Math.floor(agoSec / 60)}m ago`;
        onlineStatus = chalk.green(`yes`) + chalk.dim(` (last seen ${agoStr})`);
      } else if (presence) {
        onlineStatus = chalk.red("no") + chalk.dim(` (last seen ${presence.last_seen_at})`);
      } else {
        onlineStatus = chalk.red("no") + chalk.dim(" (no presence record)");
      }

      printLine(`  ${chalk.bold("Agent:")}  ${chalk.cyan(agent)}`);
      printLine(`  ${chalk.bold("Source:")} ${source}`);
      printLine(`  ${chalk.bold("Online:")} ${onlineStatus}`);
      closeDb();
    });
}
