import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity, readPersistedIdentity, updateCachedAutoName, isSelfRename } from "../../lib/identity.js";
import { isAgentConflict, normalizeAgentName } from "../../lib/presence.js";
import { windowItems } from "../../lib/compact-output.js";
import { getCliWindow, printCompactFooter } from "../compact.js";
import { printJson, printJsonLine } from "../stdout.js";

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
      const agent = resolveIdentity();
      await getStore().heartbeat(agent);

      const agentsList = await getStore().listAgents({ online_only: opts.online });
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(agentsList, window);

      if (opts.json) {
        printJson(agentsList);
      } else {
        if (agentsList.length === 0) {
          console.log(chalk.dim("No agents found."));
        } else {
          for (const a of page.items) {
            const status = a.online ? chalk.green("online") : chalk.dim("offline");
            const lastSeen = chalk.dim(a.last_seen_at.slice(0, 19));
            const agentName = a.agent === agent ? chalk.cyan(`${a.agent} (you)`) : chalk.cyan(a.agent);
            console.log(`  ${agentName}  ${status}  ${chalk.dim(a.status)}  ${lastSeen}`);
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
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
        console.error(chalk.red("Agent name cannot be empty."));
        process.exit(1);
      }

      const removed = await getStore().removePresence(agentName);

      if (opts.json) {
        printJsonLine({ agent: agentName, removed });
      } else {
        if (removed) {
          console.log(chalk.green(`Agent "${agentName}" removed.`));
        } else {
          console.error(chalk.red(`Agent "${agentName}" not found.`));
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
        console.error(chalk.red("Both old and new names are required."));
        process.exit(1);
      }

      try {
        const ok = await getStore().renameAgent(old, renamed);
        if (!ok) {
          console.error(chalk.red(`Agent "${old}" not found.`));
          process.exit(1);
        }

        // Presence lives in the store, but this installation's identity lives in
        // the local agent-id file. Without this the rename succeeds remotely and
        // the very next process resolves the OLD name again — the identity looks
        // like it "reverts". Only follow the rename when we renamed OURSELVES,
        // and decide that from the file on disk, never from the in-process cache
        // (in a long-lived daemon that cache can be days stale).
        const persistedIdentity = readPersistedIdentity();
        const isSelf = isSelfRename(old, persistedIdentity);
        const identityAdopted = isSelf ? updateCachedAutoName(normalizeAgentName(renamed)) : false;
        const identityWriteFailed = isSelf && !identityAdopted;

        if (opts.json) {
          printJsonLine({
            old_name: old,
            new_name: renamed,
            renamed: true,
            identity_adopted: identityAdopted,
            identity_write_failed: identityWriteFailed,
          });
        } else {
          console.log(chalk.green(`Agent "${old}" renamed to "${renamed}".`));
          if (identityAdopted) {
            console.log(chalk.dim(`This installation's identity is now "${normalizeAgentName(renamed)}".`));
          } else if (identityWriteFailed) {
            // Report the file, not resolveIdentity(): the file is what survives
            // this process, and it still names the agent we just renamed away.
            console.error(chalk.red(`Renamed in presence, but could not update the local agent-id file (pinned read-only?). This installation still resolves as "${persistedIdentity}" — which no longer exists in presence.`));
          }
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
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
        console.error(chalk.red("Agent name is required."));
        process.exit(1);
      }

      const sessionId = opts.session || crypto.randomUUID();
      const result = await getStore().registerAgent(agentName, sessionId, opts.role, opts.project);

      if (isAgentConflict(result)) {
        if (opts.json) {
          printJsonLine(result);
        } else {
          console.error(chalk.red(`Conflict: agent "${agentName}" is already active (last seen: ${result.last_seen_at}).`));
          console.error(chalk.dim("Use --force or wait 30 minutes for the session to expire."));
        }
        process.exit(1);
      }

      const registeredName = result.agent.agent;

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
      const envOverride = process.env.CONVERSATIONS_AGENT_ID?.trim() || null;

      if (opts.json) {
        printJsonLine({
          ...result,
          identity_adopted: identityAdopted,
          identity_write_failed: identityWriteFailed,
          identity_env_override: envOverride,
        });
      } else {
        const action = result.took_over ? chalk.yellow("took over") : result.created ? chalk.green("registered") : chalk.cyan("updated");
        console.log(`  ${action}  ${chalk.bold(registeredName)}  session: ${chalk.dim(sessionId)}`);
        if (identityAdopted) {
          console.log(chalk.dim(`  identity   installation identity set to "${registeredName}"`));
          if (envOverride && normalizeAgentName(envOverride) !== normalizeAgentName(registeredName)) {
            console.log(chalk.yellow(`  warning    CONVERSATIONS_AGENT_ID="${envOverride}" overrides the file; this environment still resolves as "${envOverride}"`));
          }
        } else if (identityWriteFailed) {
          // Read the file rather than resolveIdentity(): nothing was adopted, so
          // the truth is whatever the unwritable file already says.
          const persistedIdentity = readPersistedIdentity();
          const stillResolves = persistedIdentity
            ? `This installation still resolves as "${persistedIdentity}".`
            : "This installation still has no machine identity.";
          console.error(chalk.red(`  identity   NOT changed — could not write ${chalk.bold("agent-id")} (pinned read-only?). ${stillResolves}`));
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
        console.log(`  ${chalk.green("♥")}  ${chalk.cyan(agent)}  ${chalk.dim(status)}`);
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
        console.error(chalk.red(`Project "${projectArg}" not found.`));
        process.exit(1);
      }
      await getStore().setPresenceProject(agent, project.id);

      if (opts.json) {
        printJsonLine({ agent, project_id: project.id, project_name: project.name, focused: true });
      } else {
        console.log(`  ${chalk.green("focused")}  ${chalk.cyan(agent)}  →  ${chalk.bold(project.name)}  ${chalk.dim(`(${project.id})`)}`);
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
        console.log(`  ${chalk.yellow("unfocused")}  ${chalk.cyan(agent)}`);
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
          console.log(`  ${chalk.cyan(agent)}  focused on  ${chalk.bold(name)}  ${chalk.dim(`(${projectId})`)}`);
        } else {
          console.log(`  ${chalk.cyan(agent)}  ${chalk.dim("no focus set")}`);
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
      const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
      const agent = resolveIdentity(opts.from);

      let source: string;
      if (opts.from) {
        source = "explicit (--from flag)";
      } else if (envValue) {
        source = "env var (CONVERSATIONS_AGENT_ID)";
      } else {
        const { join } = require("path");
        const { homedir } = require("os");
        const { getDataDir } = require("../../lib/db.js");
        const agentIdFile = join(getDataDir(), "agent-id");
        source = `auto-generated (${agentIdFile})`;
      }

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

      console.log(`  ${chalk.bold("Agent:")}  ${chalk.cyan(agent)}`);
      console.log(`  ${chalk.bold("Source:")} ${source}`);
      console.log(`  ${chalk.bold("Online:")} ${onlineStatus}`);
      closeDb();
    });
}
