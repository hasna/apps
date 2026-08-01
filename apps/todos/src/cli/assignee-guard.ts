/**
 * The CLI-facing half of assignee validation, shared by every command that
 * takes an assignee.
 *
 * It lives in its own module because it is needed from BOTH `task-commands.ts`
 * (`add` / `update` / `upsert`) and `query-commands.ts` (the bare
 * `todos assign <id> <agent>` subcommand). That subcommand was missed on the
 * first pass of todos 056f3597 and only surfaced when the failing-suite A/B
 * against pristine main pointed at `remote-entrypoint.test.ts`, which drives
 * it directly. It is the most literally-named assignment surface there is, so
 * leaving it unguarded would have made the whole change trivially bypassable.
 */
import chalk from "chalk";
import { validateAssignee } from "../lib/assignee-validation.js";
import { loadAssigneeContext } from "../lib/assignee-context.js";
import { listAgents } from "../db/agents.js";
import { getTodosCloudClient, cloudListAgents } from "./cloud-router.js";
import { handleError } from "./helpers.js";

/**
 * Validate an EXPLICIT assignee and return the canonical name to store.
 *
 * Only explicit input is checked. The implicit fallback to the caller's own
 * resolved identity is left alone deliberately: self-assignment from an
 * unregistered session is legitimate and common, and refusing it would turn a
 * routing fix into an outage.
 *
 * Refusal exits the process via `handleError` (typed `never`), so a caller
 * cannot accidentally fall through to a silent self-assign.
 */
export async function resolveValidatedAssignee(value: string, allowSeat: boolean): Promise<string> {
  const cloud = getTodosCloudClient();
  const ctx = await loadAssigneeContext(() => (cloud ? cloudListAgents(cloud) : listAgents()), allowSeat);
  const verdict = validateAssignee(value, ctx);
  if (!verdict.ok) {
    handleError(new Error(`Cannot assign to '${value}'. ${verdict.message}`));
  }
  if (verdict.warning) {
    console.error(chalk.yellow(`Warning: ${verdict.warning}`));
  }
  return verdict.assignee;
}
