import chalk from "chalk";
import { printErrorLine } from "../lib/stdout.js";
import { emitCliError } from "./cli-error.js";

/**
 * `--from` means two opposite things in this CLI, and the collision is silent.
 *
 * On roughly twenty subcommands — `send`, `reply`, `edit`, `delete`, `blockers`,
 * `notifications`, `watch`, `digest --mark-read`, and every `agents`,
 * `analytics`, `locks`, `channel` and `project` verb — `--from` names the CALLER:
 * who you are. On exactly three — `read`, `search`, `export` — it is a FILTER on
 * `m.from_agent`: who sent the message. Same spelling, opposite meaning, no
 * warning either way.
 *
 * The cost is not hypothetical. The canonical liveness probe a coordinator uses
 * to ask "did my dispatched sub-agent post its token?" is
 *
 *     conversations search <token> --channel <c> --from <me>
 *
 * written that way because `--from` is identity nearly everywhere else. A
 * sub-agent is by definition a DIFFERENT sender, so the appended predicate makes
 * the query unsatisfiable by construction: it can only ever return the
 * coordinator's own dispatch record. Measured against the live store at 0.5.22,
 * the flag form printed "No messages found." with an EMPTY stderr at rc=0, while
 * the identical query without `--from` returned message #661877 (todos 807d355d;
 * the same shape on `read` is e60b8820).
 *
 * WHAT THIS MODULE DOES NOT DO, deliberately: it does not flip `--from` to mean
 * identity on these three verbs. Two reasons, and the second is the load-bearing
 * one.
 *
 *   1. On `search` and `export` no identity is resolved at all, so "identity"
 *      would make the flag a silent no-op — a flag that accepts a value and
 *      ignores it is the same defect wearing different clothes.
 *   2. It would silently WIDEN every existing caller's result set. A script
 *      auditing "messages from X" would start receiving every sender's rows at
 *      rc=0 and read them as X's. This fleet has already measured that direction
 *      (`todos list --assigned ''` returning the entire store) and it is the more
 *      dangerous one for automation: a wrong-empty is noticed, a wrong-full is
 *      acted upon.
 *
 * So the filter keeps its meaning and stops being silent. `--sender` is the
 * unambiguous spelling; `--from` remains a working alias that always announces
 * what it did; and a zero produced by any filter says which filters produced it.
 */

/** Options shape shared by every sender-filtered verb. */
export interface SenderFilterOptions {
  from?: unknown;
  sender?: unknown;
  json?: boolean;
  contract?: boolean;
}

export interface ResolvedSenderFilter {
  /** The sender to filter on, or undefined when no filter was requested. */
  sender: string | undefined;
  /** True when the caller spelled it `--from`, which needs the alias note. */
  viaFromAlias: boolean;
  /** The spelling the caller actually typed, for messages that echo it back. */
  flag: string;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

/** The flag was present on the command line but carries nothing usable. */
function providedButBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim() === "";
}

/**
 * Resolve `--sender` / `--from` into one sender filter.
 *
 * Two different values is a hard error rather than a precedence rule. A caller
 * who passes both plainly holds two beliefs about what the flags mean, and
 * picking a winner silently would resolve that disagreement in favour of
 * whichever one the implementer happened to order first — invisibly, in the one
 * situation where the caller's confusion is already proven.
 */
export function resolveSenderFilter(opts: SenderFilterOptions): ResolvedSenderFilter {
  // A PRESENT but blank value is an error, never "no filter".
  //
  // `--sender "$WHO"` with WHO unset would otherwise drop the predicate and
  // return the ENTIRE channel at rc=0 in silence — the direction this file
  // argues is the more dangerous one, arriving through the flag added to fix
  // it. It is also a regression against the pre-change behaviour: `--from "   "`
  // used to filter on the literal whitespace and return nothing, so trimming it
  // away silently converts a wrong-empty into a wrong-full. Both spellings are
  // rejected rather than guessed.
  if (providedButBlank(opts.sender) || providedButBlank(opts.from)) {
    const flag = providedButBlank(opts.sender) ? "--sender" : "--from";
    emitCliError(
      `${flag} was given an empty value. A blank sender is refused rather than ignored, because dropping ` +
        `the filter would return every sender's messages at exit code 0 and read as one sender's. ` +
        `Pass a sender name, or omit ${flag} entirely to search all senders.`,
      opts,
    );
  }

  const fromValue = trimmed(opts.from);
  const senderValue = trimmed(opts.sender);

  if (fromValue && senderValue && fromValue !== senderValue) {
    emitCliError(
      `--from ${fromValue} and --sender ${senderValue} disagree about which sender to filter on. ` +
        `On this subcommand --from is an alias for --sender (a filter on who SENT the message), ` +
        `not your caller identity. Pass one of them, and set HASNA_CONVERSATIONS_AGENT_ID (legacy CONVERSATIONS_AGENT_ID) for identity.`,
      opts,
    );
  }

  // `--sender` is the spelling to echo whenever it was given, even alongside an
  // agreeing `--from`, because it is the one this CLI wants callers to keep.
  return {
    sender: senderValue ?? fromValue,
    viaFromAlias: Boolean(fromValue),
    flag: senderValue ? "--sender" : "--from",
  };
}

/**
 * Announce, on stderr, that `--from` was applied as a SENDER FILTER.
 *
 * Emitted on EVERY use, not only when the result is empty. The measured defect
 * included a NON-empty wrong answer — `--from manius` returned manius's own row
 * and hid the sub-agent's — so a note that fired only on zero would have stayed
 * silent through exactly the case where the caller reads a plausible result and
 * never re-checks it.
 *
 * stderr rather than stdout so the `--json` array and the text result stay byte
 * compatible for existing readers, while anyone at a terminal still sees it.
 */
export function noteSenderFilterAlias(sender: string): void {
  printErrorLine(
    chalk.yellow(
      `Note: --from was applied as a SENDER filter (from_agent=${sender}), not as your caller identity. ` +
        `On read/search/export --from selects who SENT a message; on every other subcommand it sets who you are. ` +
        `Use --sender ${sender} to say so unambiguously, and HASNA_CONVERSATIONS_AGENT_ID (legacy CONVERSATIONS_AGENT_ID) to set identity.`,
    ),
  );
}

export interface AppliedFilters {
  query?: string;
  channel?: string;
  sender?: string;
  to?: string;
  session?: string;
  since?: string;
}

/** "query=\"tok\", channel=ops, sender=alice" — only the filters actually set. */
export function formatAppliedFilters(filters: AppliedFilters): string {
  const parts: string[] = [];
  if (filters.query) parts.push(`query="${filters.query}"`);
  if (filters.channel) parts.push(`channel=${filters.channel}`);
  if (filters.sender) parts.push(`sender=${filters.sender}`);
  if (filters.to) parts.push(`to=${filters.to}`);
  if (filters.session) parts.push(`session=${filters.session}`);
  if (filters.since) parts.push(`since=${filters.since}`);
  return parts.join(", ");
}

/**
 * Make an empty result legible by naming the filters that produced it.
 *
 * A bare "No messages found." cannot distinguish "this store holds no such
 * message" from "your own filter excluded it", and those two facts lead to
 * opposite actions — the first ends a search, the second is a query bug. Nothing
 * is emitted when no filter was applied, because a disclosure that always
 * appears carries no information and gets tuned out.
 *
 * Goes to stderr in both output modes: the text surface's stdout stays exactly
 * "No messages found." for anything matching on it, and the `--json` surface's
 * stdout stays a parseable machine payload without a prose warning mixed in.
 */
export function discloseEmptyResult(
  filters: AppliedFilters,
  opts: { senderFlag?: string } = {},
): void {
  const applied = formatAppliedFilters(filters);
  if (!applied) return;

  const lines = [`No matches. Filters applied: ${applied}.`];
  if (filters.sender) {
    // Name the spelling the caller actually typed. Telling someone who passed
    // --from to "drop --sender" reads as advice about a flag they did not use.
    const flag = opts.senderFlag ?? "--sender";
    lines.push(
      `A sender filter excludes every message sent by anyone else, including a sub-agent you dispatched — ` +
        `drop ${flag} to search all senders.`,
    );
  }
  printErrorLine(chalk.dim(lines.join(" ")));
}

/** Help text for `--from` wherever it is a sender filter rather than identity. */
export const FROM_ALIAS_HELP =
  "Alias for --sender: filter by who SENT the message, NOT your caller identity (use CONVERSATIONS_AGENT_ID for that)";

/** Help text for the unambiguous spelling. */
export const SENDER_HELP = "Filter by who SENT the message";
