import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { windowItems } from "../../lib/compact-output.js";
import { getCliWindow, printCompactFooter } from "../compact.js";
import { printErrorLine, printJson, printJsonLine, printLine } from "../../lib/stdout.js";

const DEFAULT_RESOURCE_TYPE = "resource";

function resolveKey(key: unknown): string {
  const resourceId = typeof key === "string" ? key.trim() : "";
  if (!resourceId) {
    printErrorLine(chalk.red("Lock key cannot be empty."));
    process.exit(1);
  }
  return resourceId;
}

function resolveType(type: unknown): string {
  const resourceType = typeof type === "string" && type.trim() ? type.trim() : DEFAULT_RESOURCE_TYPE;
  return resourceType;
}

function resolveTtlMs(ttl: unknown): number | undefined {
  if (ttl === undefined) return undefined;
  const seconds = Number(ttl);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    printErrorLine(chalk.red("--ttl must be a positive number of seconds."));
    process.exit(1);
  }
  return Math.round(seconds * 1000);
}

export function registerLockCommands(program: Command): void {
  const locks = program
    .command("locks")
    .description("Coordinate shared resources with advisory/exclusive locks (same lock store as the MCP lock tools)");

  locks
    .command("acquire")
    .description("Acquire (or refresh) a lock on a key. Exit code: 0 acquired, 2 held by another agent.")
    .argument("<key>", "Lock key (stored as the lock's resource_id)")
    .option("--ttl <seconds>", "Lock time-to-live in seconds (default 300)")
    .option("--from <agent>", "Agent acquiring the lock")
    .option("--type <resource-type>", `Lock resource type (default: ${DEFAULT_RESOURCE_TYPE})`)
    .option("--exclusive", "Acquire an exclusive lock instead of advisory")
    .option("--no-dm", "Do not DM the holding agent on conflict")
    .option("-j, --json", "Output as JSON")
    .action(async (key, opts) => {
      const resourceId = resolveKey(key);
      const resourceType = resolveType(opts.type);
      const expiryMs = resolveTtlMs(opts.ttl);
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        printErrorLine(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      const lockType = opts.exclusive ? "exclusive" : "advisory";

      const result = await getStore().acquireLock(resourceType, resourceId, agent, lockType, expiryMs);

      if (!result.acquired && result.held_by && opts.dm !== false) {
        try {
          await await getStore().sendMessage({
            from: agent,
            to: result.held_by,
            content: `Lock conflict: I (@${agent}) tried to acquire ${lockType} lock on \`${resourceType}/${resourceId}\` but you hold it. If you no longer need it, release it with \`conversations locks release ${resourceId}${resourceType !== DEFAULT_RESOURCE_TYPE ? ` --type ${resourceType}` : ""}\`.`,
            priority: "high",
          });
        } catch {
          // DM failure must not break the lock response
        }
      }

      if (opts.json) {
        printJson(result);
      } else if (result.acquired && result.lock) {
        printLine(chalk.green(`Lock acquired: ${resourceType}/${resourceId}`) + chalk.dim(` by ${agent} (${lockType}, expires ${result.lock.expires_at})`));
      } else {
        printLine(chalk.yellow(`Lock held by ${result.held_by}: ${resourceType}/${resourceId}`));
      }

      closeDb();
      if (!result.acquired) process.exit(2);
    });

  locks
    .command("release")
    .description("Release a lock you hold on a key (idempotent — exits 0 whether or not a lock was released)")
    .argument("<key>", "Lock key (the lock's resource_id)")
    .option("--from <agent>", "Agent releasing the lock")
    .option("--type <resource-type>", `Lock resource type (default: ${DEFAULT_RESOURCE_TYPE})`)
    .option("-j, --json", "Output as JSON")
    .action(async (key, opts) => {
      const resourceId = resolveKey(key);
      const resourceType = resolveType(opts.type);
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        printErrorLine(chalk.red("Agent identity is required."));
        process.exit(1);
      }

      const released = await getStore().releaseLock(resourceType, resourceId, agent);

      if (opts.json) {
        printJsonLine({ released });
      } else if (released) {
        printLine(chalk.green(`Lock released: ${resourceType}/${resourceId}`));
      } else {
        printLine(chalk.dim(`No lock on ${resourceType}/${resourceId} was held by ${agent}.`));
      }
      closeDb();
    });

  locks
    .command("check")
    .description("Check whether a key is locked and by whom. Exit code: 0 free, 2 locked.")
    .argument("<key>", "Lock key (the lock's resource_id)")
    .option("--type <resource-type>", `Lock resource type (default: ${DEFAULT_RESOURCE_TYPE})`)
    .option("-j, --json", "Output as JSON")
    .action(async (key, opts) => {
      const resourceId = resolveKey(key);
      const resourceType = resolveType(opts.type);

      const lock = await getStore().checkLock(resourceType, resourceId);

      if (opts.json) {
        printJson(lock ? { locked: true, ...lock } : { locked: false });
      } else if (lock) {
        printLine(chalk.yellow(`Locked: ${resourceType}/${resourceId}`) + chalk.dim(` by ${lock.agent_id} (${lock.lock_type}, expires ${lock.expires_at})`));
      } else {
        printLine(chalk.green(`Not locked: ${resourceType}/${resourceId}`));
      }

      closeDb();
      if (lock) process.exit(2);
    });

  locks
    .command("list")
    .description("List active locks with holder presence and expiry context")
    .option("--type <resource-type>", "Filter by resource type")
    .option("--agent <id>", "Filter by holding agent")
    .option("--limit <n>", "Max locks to show", parseInt)
    .option("--cursor <n>", "Skip first N locks for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const filter: { resource_type?: string; agent_id?: string } = {};
      if (typeof opts.type === "string" && opts.type.trim()) filter.resource_type = opts.type.trim();
      if (typeof opts.agent === "string" && opts.agent.trim()) filter.agent_id = opts.agent.trim();

      const locksList = await getStore().listLocksEnriched(filter);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(locksList, window);

      if (opts.json) {
        printJson({
          locks: page.items,
          count: page.count,
          total: page.total,
          next_cursor: page.nextCursor,
          has_more: page.hasMore,
        });
      } else if (locksList.length === 0) {
        printLine(chalk.dim("No active locks."));
      } else {
        for (const lock of page.items) {
          const online = lock.agent?.online ? chalk.green(" [online]") : "";
          printLine(`${chalk.magenta(`${lock.resource_type}/${lock.resource_id}`)} held by ${chalk.cyan(lock.agent_id)}${online} ${chalk.dim(`(${lock.lock_type}, expires in ${lock.expires_in_seconds}s, locked ${lock.locked_seconds_ago}s ago)`)}`);
        }
        printCompactFooter({
          shown: page.count,
          total: page.total,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          limitCapped: window.limitCapped,
        });
      }
      closeDb();
    });

  locks
    .command("clean")
    .description("Release expired locks and locks held by agents with stale heartbeats (>30 min)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const released_stale_agent = await getStore().releaseStaleAgentLocks();
      const released_expired = await getStore().cleanExpiredLocks();
      const total = released_stale_agent + released_expired;

      if (opts.json) {
        printJsonLine({ released_stale_agent, released_expired, total });
      } else {
        printLine(chalk.green(`Cleaned ${total} lock(s)`) + chalk.dim(` (${released_expired} expired, ${released_stale_agent} stale-agent)`));
      }
      closeDb();
    });
}
