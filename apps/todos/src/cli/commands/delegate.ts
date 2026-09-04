/**
 * `todos delegate <task> <worker> --brief <path>` — one atomic verb for
 * handing a filed task to a worker.
 *
 * THE MEASURED CAUSE, because it decides the shape of everything below. At 24.8
 * actionable signals an hour — one every 2.4 minutes — the ATOMIC act survives
 * and the PIPELINE dies. Filing a task is one step and ran 13 times out of 14.
 * Dispatching one was six steps across three CLIs and ran 0 times out of 14. On
 * the same day, the single instructions config that landed unaided was the
 * one-step timezone note, while all six directive pipelines died. A prompt
 * cannot close that gap, because a prompt cannot make an announcement true;
 * only a verb that writes the record AS PART OF the act can.
 *
 * So the seven effects below are ONE invocation, and the verb is worth building
 * only while it stays one. Any change that adds a required second call — a
 * follow-up `start`, a manual post, a separate registration — reproduces the
 * failure this was built to remove, and will fail the same way, silently, while
 * looking implemented.
 *
 * THE SEVEN EFFECTS, in order:
 *   1. REFUSE an absent or empty brief. Runs first, before any write, so a bad
 *      invocation costs nothing. See `lib/delegation-brief.ts`.
 *   2. READ AND PRINT the receiving seat's open count; park only when a
 *      threshold is armed. See `lib/delegation-policy.ts` for why the default
 *      is unset.
 *   3. REGISTER the worker identity, lineage-linked to the dispatcher.
 *   4. ASSIGN the row and populate assigned_by / delegated_from /
 *      delegation_depth.
 *   5. APPEND the [DISPATCH] comment — this is what makes the act and the
 *      record one event rather than two things someone has to remember.
 *   6. POST the one-line channel notice, once.
 *   7. RECORD a claim deadline for the steering pass.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, and this is load-bearing rather than an
 * omission: it never writes `started_at`. The worker still claims with `todos
 * start`. That keeps `started_at` honest AND keeps this verb's own failure mode
 * countable — a dispatched row nobody claimed stays visibly unclaimed, so
 * "dispatch laundering" (a [DISPATCH] comment older than the claim window on a
 * row with a null started_at) is a query rather than a guess. A verb that
 * stamped started_at would launder its own failures into apparent progress.
 *
 * WHY IT IS NOT `dispatch`. That verb is taken, and it is the route operating
 * rule 12 forbids: it types a prompt into a tmux pane and presses Enter. It is
 * left entirely alone here, along with its `dispatch run` subcommand, its
 * sibling `dispatches`, and their two SQLite tables. `delegate` also fits the
 * data model rather than fighting it — `delegated_from` and `delegation_depth`
 * were already columns, so the noun existed and only the verb was missing.
 */
import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { getTodosCloudClient, cloudGetTask, cloudUpdateTask, cloudAddComment, cloudCountTasks, cloudRegisterAgent, cloudListAgents } from "../cloud-router.js";
import { getDatabase } from "../../db/database.js";
import { getTask, updateTask, countTasks } from "../../db/tasks.js";
import { addComment } from "../../db/comments.js";
import { getAgentByName, registerAgent, isAgentConflict } from "../../db/agents.js";
// `db/agent-names.ts` imports `bun:sqlite` as a TYPE only, so this is safe to
// pull on the cloud route where the SQLite fallback is disabled.
import { validateAgentName } from "../../db/agent-names.js";
import { resolveWritableIdentity } from "../../lib/creator-identity.js";
import { normalizeAgentNameInput } from "../../lib/agent-name-normalize.js";
import { resolveDelegationBrief } from "../../lib/delegation-brief.js";
import {
  loadDelegationEmbargo,
  resolveDelegationDepthThreshold,
  DEFAULT_CLAIM_WINDOW_MINUTES,
} from "../../lib/delegation-policy.js";
import {
  formatDispatchComment,
  formatDispatchNotice,
  claimDeadlineFrom,
  type DelegationRecordInput,
} from "../../lib/delegation-record.js";
import { missingDelegationLineage, partialDelegationMessage } from "../../lib/delegation-verify.js";
import { resolveValidatedAssignee } from "../assignee-guard.js";
import { handleError, output, resolveTaskIdForCommand } from "../helpers.js";
import type { Task } from "../../types/index.js";
import { env } from "../../lib/env.js";

type IdentityOutcome = "created" | "reused" | "skipped";

interface DelegateOptions {
  brief?: string;
  briefText?: string;
  depthThreshold?: string;
  despiteDepth?: boolean;
  ownerDirective?: boolean;
  seat?: string;
  runtime?: string;
  reportsTo?: string;
  reuseIdentity?: boolean;
  depth?: string;
  channel?: string;
  post?: boolean;
  claimWindow?: string;
  dryRun?: boolean;
  json?: boolean;
  assignSeat?: boolean;
}

export function registerDelegateCommands(program: Command): void {
  program
    .command("delegate <task> <worker>")
    .description("Hand a filed task to a worker in one call: brief, depth, lineage, assignment, record and notice")
    .option("--brief <path>", "Path to the self-sufficient brief; `-` reads stdin")
    .option("--brief-text <text>", "Inline brief, as an alternative to --brief")
    .option("--depth-threshold <n>", "Open-task count above which this delegation parks")
    .option("--despite-depth", "Proceed past an armed depth threshold; recorded in the [DISPATCH] comment")
    .option("--owner-directive", "Mark as an owner-directive dispatch: depth warns and never parks")
    .option("--seat <slug>", "Seat whose open count is read (default: the lineage parent)")
    .option("--runtime <name>", "Worker runtime label recorded in the comment (e.g. claude-code-subagent)")
    .option("--reports-to <agent>", "Lineage parent for the worker identity (default: the dispatcher)")
    .option("--reuse-identity", "Skip registration and reuse an existing worker identity")
    .option("--depth <n>", "Explicit delegation_depth (default: the task's current depth + 1)")
    .option("--channel <name>", "Channel for the one-line notice (default: $TODOS_DELEGATE_NOTICE_CHANNEL)")
    .option("--no-post", "Skip the channel notice")
    .option("--claim-window <minutes>", `Minutes before the claim deadline (default: ${DEFAULT_CLAIM_WINDOW_MINUTES})`)
    .option("--assign-seat", "Allow <worker> to name a durable seat (a seat queue has no session watching it)")
    .option("--dry-run", "Report all seven effects and perform none")
    .option("-j, --json", "Output as JSON")
    .action(async (taskRef: string, workerInput: string, opts: DelegateOptions) => {
      const globalOpts = program.opts();
      const useJson = Boolean(opts.json || globalOpts.json);

      try {
        // ── STEP 1: the brief gate, before any write ────────────────────────
        const brief = resolveDelegationBrief(
          { briefPath: opts.brief, briefText: opts.briefText },
          {
            readFile: (path: string) => readFileSync(path, "utf8"),
            readStdin: () => readFileSync(0, "utf8"),
          },
        );
        if (!brief.ok) handleError(new Error(brief.message));

        // ── The dispatcher identity. Needed for lineage, assigned_by and the
        // record, so it is resolved before anything is written.
        //
        // NOT `resolveClaimIdentity`: that resolver's refusal states "this
        // operation changes a task lock", which is FALSE for delegate — it
        // assigns, it does not claim. A message that asserts the wrong
        // mechanism sends the reader to debug the wrong subsystem, which is the
        // exact defect class this file's own record format exists to avoid. The
        // underlying resolver is shared; only the message differs.
        const dispatcherIdentity = resolveWritableIdentity(globalOpts.agent as string | undefined);
        if (!dispatcherIdentity.agent_id) {
          handleError(
            new Error(
              "Cannot delegate without a dispatcher identity: this verb records WHO handed the row over, " +
                "and a handover from nobody is not a handover. " +
                "Set TODOS_AGENT_ID=<name> for this session, or pass --agent <name>. " +
                "An identity persisted by `todos init` is deliberately not used — it is keyed on $HOME and names the station, not this session.",
            ),
          );
        }
        const dispatcher = dispatcherIdentity.agent_id;

        // The worker is validated on the same terms as every other assignment
        // surface, so a seat slug cannot be smuggled in as a worker. A seat
        // queue has no session watching it, which is precisely the state this
        // verb exists to stop producing.
        const worker = await resolveValidatedAssignee(
          workerInput,
          Boolean(opts.assignSeat),
          (v) => `${taskRef} ${v} --assign-seat`,
        );

        // ── The embargo. Data, never a constant — see lib/delegation-policy.ts.
        //
        // CHECKED AFTER RESOLUTION AND AGAINST BOTH FORMS, which is not
        // incidental: `resolveValidatedAssignee` accepts an agent ID and
        // returns that agent's NAME, so a check against the raw input alone is
        // bypassed by passing the embargoed agent's id instead of its name. An
        // embargo defeated by a different spelling of the same agent is not an
        // embargo. The raw form is still checked because a name that resolves
        // to nothing is returned unchanged and must not slip through either.
        const embargo = loadDelegationEmbargo();
        const embargoedForm = [workerInput, worker].find((candidate) =>
          embargo.has(normalizeAgentNameInput(candidate)),
        );
        if (embargoedForm !== undefined) {
          handleError(
            new Error(
              `'${embargoedForm}' is under a delegation embargo and must not receive dispatched work. ` +
                "The embargo list is a file, not a constant — see TODOS_DELEGATION_EMBARGO_PATH.",
            ),
          );
        }

        // The worker must be a name an agent can actually REGISTER as, and this
        // is checked BEFORE any write for two reasons.
        //
        // First, cost: `registerAgent` would raise the same error in step 3, but
        // by then the depth read has happened and the refusal is further from
        // the mistake. Second, and this is the one that matters —
        // `--reuse-identity` SKIPS step 3 entirely, so without this check an
        // unregisterable name would sail through and be written into
        // `assigned_to`. That is precisely the ghost-assignment class the
        // assignee validator exists to stop: 44 of 493 assigned rows measured on
        // this fleet named something that was not an agent at all. A row routed
        // to a name no session can ever hold is a row routed to nobody, and it
        // reads as covered to every audit that counts assignees.
        try {
          validateAgentName(worker);
        } catch (error) {
          handleError(
            new Error(
              `Cannot delegate to '${worker}': ${error instanceof Error ? error.message : String(error)} ` +
                "Nothing was written — the task is unchanged and still unassigned.",
            ),
          );
        }

        const reportsTo = (opts.reportsTo ?? dispatcher).trim();
        const seatSlug = (opts.seat ?? reportsTo).trim();
        const cloud = getTodosCloudClient();

        // ── Resolve the row, on whichever route is live ─────────────────────
        const taskId = await resolveTaskIdForCommand(taskRef, cloud);
        const db = cloud ? null : getDatabase();
        const task: Task | null = cloud ? await cloudGetTask(cloud, taskId) : getTask(taskId, db!);
        if (!task) handleError(new Error(`Task not found: ${taskRef}`));

        // ── STEP 2: seat depth. ALWAYS reported; parks only when armed ──────
        const threshold = resolveDelegationDepthThreshold(opts.depthThreshold);
        const seatOpenTasks = cloud
          ? await cloudCountTasks(cloud, { assigned_to: seatSlug, status: "pending" })
          : countTasks({ assigned_to: seatSlug, status: "pending" }, db!);

        const override: "despite-depth" | "owner-directive" | null = opts.ownerDirective
          ? "owner-directive"
          : opts.despiteDepth
            ? "despite-depth"
            : null;
        const overThreshold = threshold.value !== null && seatOpenTasks > threshold.value;
        // An owner-directive row is never parked. It still prints the number,
        // because the number is what the step is actually worth.
        const parked = overThreshold && override === null;

        if (overThreshold && override === "owner-directive") {
          console.error(
            chalk.yellow(
              `Warning: seat ${seatSlug} carries ${seatOpenTasks} open tasks (threshold ${threshold.value}); ` +
                "proceeding because this is an owner-directive dispatch.",
            ),
          );
        }
        if (parked) {
          handleError(
            new Error(
              `Seat ${seatSlug} carries ${seatOpenTasks} open tasks, above the armed threshold of ${threshold.value} ` +
                `(from ${threshold.source}). Re-run with --despite-depth to proceed and have the override recorded, ` +
                "or --owner-directive if this row is an owner directive.",
            ),
          );
        }

        const currentDepth = typeof task.delegation_depth === "number" ? task.delegation_depth : 0;
        const depth = opts.depth !== undefined ? Number.parseInt(opts.depth, 10) : currentDepth + 1;
        if (!Number.isSafeInteger(depth) || depth < 0) {
          handleError(new Error(`--depth must be a non-negative integer; got ${JSON.stringify(opts.depth)}`));
        }

        const dispatchedAtDate = new Date();
        const dispatchedAt = dispatchedAtDate.toISOString();
        const claimWindowMinutes = opts.claimWindow !== undefined
          ? Number.parseInt(opts.claimWindow, 10)
          : DEFAULT_CLAIM_WINDOW_MINUTES;
        if (!Number.isSafeInteger(claimWindowMinutes) || claimWindowMinutes <= 0) {
          handleError(new Error(`--claim-window must be a positive integer; got ${JSON.stringify(opts.claimWindow)}`));
        }
        const claimDeadline = claimDeadlineFrom(dispatchedAtDate, claimWindowMinutes);

        const record: DelegationRecordInput = {
          taskId: task.id,
          worker,
          dispatcher,
          runtime: opts.runtime ?? null,
          briefSource: brief.source,
          briefSha256: brief.sha256,
          briefBytes: brief.bytes,
          depth,
          reportsTo,
          seatSlug,
          seatOpenTasks,
          depthThreshold: threshold.value,
          override,
          identityOutcome: opts.reuseIdentity ? "skipped" : "created",
          dispatchedAt,
          claimDeadline,
        };

        // ── DRY RUN: report every effect, perform none ──────────────────────
        if (opts.dryRun) {
          const previewChannel = opts.channel ?? env.delegateNoticeChannel() ?? null;
          const preview = {
            dry_run: true,
            task: { id: task.id, short_id: task.short_id, title: task.title },
            delegation: summarize(record, {
              identityOutcome: opts.reuseIdentity ? "skipped" : "created",
              commentId: null,
              notice: { posted: false, channel: previewChannel, error: null },
            }),
            would: [
              "1. brief accepted (already validated)",
              `2. seat ${seatSlug}: ${seatOpenTasks} open, threshold ${threshold.value ?? "unset"}`,
              opts.reuseIdentity
                ? `3. registration SKIPPED (--reuse-identity); reusing ${worker}`
                : `3. register ${worker} with reports_to=${reportsTo}`,
              `4. assign to ${worker}; assigned_by=${dispatcher}, delegated_from=${dispatcher}, delegation_depth=${depth}`,
              "5. append the [DISPATCH] comment",
              opts.post === false
                ? "6. channel notice SKIPPED (--no-post)"
                : `6. post one notice to ${previewChannel ?? "(no channel resolved — set --channel or TODOS_DELEGATE_NOTICE_CHANNEL)"}`,
              `7. claim deadline ${claimDeadline}`,
            ],
          };
          if (useJson) { output(preview, true); return; }
          console.log(chalk.dim("[dry-run] no writes performed"));
          for (const line of preview.would) console.log(`  ${line}`);
          return;
        }

        // ── STEP 3: register the worker, lineage-linked ─────────────────────
        //
        // A name already registered is the ROUTINE case, not an error:
        // re-dispatching the same worker is normal, and failing the whole
        // delegation because the identity exists would break the atomic
        // property this verb is built on. An existing agent is REUSED and never
        // mutated — re-stamping another agent's reports_to from here would be a
        // write to a shared record that nobody asked for; `todos org --set`
        // owns that.
        let identityOutcome: IdentityOutcome = "skipped";
        if (!opts.reuseIdentity) {
          identityOutcome = await registerWorkerIdentity(worker, reportsTo, cloud, db);
        }
        record.identityOutcome = identityOutcome;

        // ── STEP 4 + 7: assign, stamp the lineage, carry the deadline ───────
        //
        // The metadata merge is read-modify-write on purpose: `metadata` is a
        // shared namespace and another writer's keys must survive. The claim
        // deadline goes here rather than only into the comment so a steering
        // pass can filter on a field instead of parsing prose.
        const mergedMetadata = {
          ...(task.metadata && typeof task.metadata === "object" ? task.metadata : {}),
          delegation: {
            worker,
            dispatcher,
            runtime: opts.runtime ?? null,
            brief_source: brief.source,
            brief_sha256: brief.sha256,
            dispatched_at: dispatchedAt,
            claim_deadline: claimDeadline,
            claim_window_minutes: claimWindowMinutes,
            depth,
            override,
          },
        };

        // An explicit field set, never a spread of the whole row: `started_at`
        // and `locked_by` must not appear here in any form.
        const patch = {
          assigned_to: worker,
          assigned_by: dispatcher,
          delegated_from: dispatcher,
          delegation_depth: depth,
          metadata: mergedMetadata,
        };

        const updated: Task = cloud
          ? await cloudUpdateTask(cloud, task.id, patch)
          : updateTask(task.id, { ...patch, version: task.version }, db!);

        // ── READ THE ROW BACK BEFORE CLAIMING THE HANDOVER ──────────────────
        //
        // A 200 means the request was accepted, not that the field was stored.
        // The /v1 authority is a separately deployed build, and every build
        // before this change silently dropped the lineage columns while
        // returning success — so without this check `delegate` would print a
        // [DISPATCH] comment asserting a handover the store never recorded, and
        // the row would be indistinguishable from a plain `todos assign`.
        //
        // Refusing BEFORE the comment is written is deliberate: a record that
        // claims a lineage the row does not carry is worse than no record,
        // because every later audit reads it as evidence.
        const missing = missingDelegationLineage(updated, {
          assignedTo: worker,
          assignedBy: dispatcher,
          delegatedFrom: dispatcher,
          depth,
        });
        if (missing.length > 0) {
          handleError(new Error(partialDelegationMessage(missing, task.id)));
        }

        // ── STEP 5: the record, in the same invocation as the act ───────────
        const commentBody = formatDispatchComment(record);
        const comment = cloud
          ? await cloudAddComment(cloud, task.id, { content: commentBody, agent_id: dispatcher })
          : addComment({ task_id: task.id, agent_id: dispatcher, content: commentBody }, db!);

        // ── STEP 6: the channel notice, once, and never transactional ───────
        const notice = opts.post === false
          ? { posted: false, channel: opts.channel ?? null, error: null as string | null }
          : postNotice(formatDispatchNotice(record), opts.channel ?? null);

        const payload = {
          task: updated,
          delegation: summarize(record, {
            identityOutcome,
            commentId: comment.id,
            notice,
          }),
        };

        if (useJson) { output(payload, true); return; }
        console.log(chalk.green(`Delegated ${updated.short_id ?? updated.id.slice(0, 8)} to ${worker}`));
        console.log(chalk.dim(`  by ${dispatcher}, depth ${depth}, seat ${seatSlug} has ${seatOpenTasks} open`));
        console.log(chalk.dim(`  brief ${brief.source} (sha256 ${brief.sha256.slice(0, 12)}…)`));
        console.log(chalk.dim(`  claim by ${claimDeadline}; the worker claims with \`todos start\``));
        if (!notice.posted && opts.post !== false) {
          console.error(chalk.yellow(`Warning: the channel notice was not posted: ${notice.error ?? "unknown reason"}`));
        }
      } catch (e) {
        handleError(e);
      }
    });
}

function summarize(
  record: DelegationRecordInput,
  extra: {
    identityOutcome: IdentityOutcome;
    commentId: string | null;
    notice: { posted: boolean; channel: string | null; error: string | null };
  },
) {
  return {
    worker: record.worker,
    dispatcher: record.dispatcher,
    runtime: record.runtime,
    depth: record.depth,
    reports_to: record.reportsTo,
    brief: { source: record.briefSource, sha256: record.briefSha256, bytes: record.briefBytes },
    seat: {
      slug: record.seatSlug,
      open_tasks: record.seatOpenTasks,
      threshold: record.depthThreshold,
      parked: false,
      override: record.override,
    },
    identity: { name: record.worker, reports_to: record.reportsTo, outcome: extra.identityOutcome },
    comment_id: extra.commentId,
    dispatched_at: record.dispatchedAt,
    claim_deadline: record.claimDeadline,
    notice: extra.notice,
    started_at_written: false,
  };
}

/**
 * Register the worker, or reuse an identity that already exists.
 *
 * Both routes converge on the same three outcomes so the JSON payload means the
 * same thing regardless of where the CLI is pointed.
 */
async function registerWorkerIdentity(
  worker: string,
  reportsTo: string,
  cloud: ReturnType<typeof getTodosCloudClient>,
  db: ReturnType<typeof getDatabase> | null,
): Promise<IdentityOutcome> {
  if (cloud) {
    // This roster read is BOUNDED and the fleet carries well over a thousand
    // agent rows, so a worker that exists past the page cap reads as absent —
    // the classic "a page is not a population" trap. That is tolerable HERE and
    // only here, because the write below is the authoritative check: the
    // authority answers 409 for a name already held, and that 409 is handled as
    // the reuse case. The list read is an optimisation that avoids a pointless
    // round trip, never the thing correctness rests on.
    const existing = (await cloudListAgents(cloud)).find(
      (a) => normalizeAgentNameInput(a.name) === normalizeAgentNameInput(worker),
    );
    if (existing) return "reused";
    try {
      await cloudRegisterAgent(cloud, { name: worker, reports_to: reportsTo });
      return "created";
    } catch (error) {
      // A 409 means the name is already held — either it sat past the page cap
      // above, or another session took it between the read and the write. Both
      // are the reuse case arriving by a different route, not a delegation
      // failure.
      const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
      if (status === 409) return "reused";
      throw error;
    }
  }

  if (getAgentByName(worker, db!)) return "reused";
  const result = registerAgent({ name: worker, reports_to: reportsTo }, db!);
  return isAgentConflict(result) ? "reused" : "created";
}

/**
 * Post the one-line notice through the `conversations` CLI.
 *
 * THIS STEP CANNOT BE TRANSACTIONAL WITH STEPS 3-5. It crosses into a different
 * CLI backed by a different service, so steps 1-5 are the commit point and this
 * runs last. A failure here is REPORTED AND NEVER THROWN: a conversations
 * outage must not become a delegation outage, and it must not roll back a row
 * that has already been handed over.
 *
 * It is also never retried inside the verb. A duplicated notice trains readers
 * to ignore the channel, which is the failure the whole verb is fighting. The
 * recovery path is a re-run with --no-post.
 *
 * The binary is resolved from configuration so the cross-CLI hop is testable in
 * BOTH directions without touching the real service — a suppression-only test
 * would pass even if the notice never worked at all.
 */
function postNotice(line: string, channel: string | null): { posted: boolean; channel: string | null; error: string | null } {
  // WHY THERE IS NO PROJECT-CHANNEL DEFAULT, stated here because the obvious
  // design is to read the task's project and use its
  // `integrations.conversations_channel`: THAT FIELD DOES NOT EXIST IN THIS
  // PACKAGE. `Project` here carries id, name, path, description, task_list_id,
  // task_prefix, task_counter and timestamps — no integrations map at all.
  // The channel lives in `@hasna/projects`, a different package with a
  // different store, and reaching into it would drag a second module graph and
  // a second credential path into a CLI that deliberately keeps one per domain.
  //
  // So the default is configuration instead: set TODOS_DELEGATE_NOTICE_CHANNEL
  // once per session and the verb stays a single call, which is the whole
  // property it is built on.
  const resolved = channel || env.delegateNoticeChannel() || null;
  if (!resolved) {
    return {
      posted: false,
      channel: null,
      error:
        "no channel resolved: pass --channel <name>, set TODOS_DELEGATE_NOTICE_CHANNEL, " +
        "or pass --no-post to skip the notice deliberately",
    };
  }
  channel = resolved;
  const bin = env.delegateNotifyBin() || "conversations";
  try {
    const proc = Bun.spawnSync([bin, "send", "--channel", channel, line], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr).trim();
      return { posted: false, channel, error: stderr || `${bin} exited ${proc.exitCode}` };
    }
    return { posted: true, channel, error: null };
  } catch (error) {
    return { posted: false, channel, error: error instanceof Error ? error.message : String(error) };
  }
}
