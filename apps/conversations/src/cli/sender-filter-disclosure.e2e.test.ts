import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * End-to-end cover for todos 807d355d (`search`) and e60b8820 (`read`) — the
 * same defect on two subcommands.
 *
 * `--from` means CALLER IDENTITY on ~20 of the CLI's subcommands and SENDER
 * FILTER on exactly three (`read`, `search`, `export`). A caller who learned the
 * dominant meaning and writes the canonical liveness probe
 *
 *     conversations search <token> --channel <c> --from <me>
 *
 * gets a SQL predicate `AND m.from_agent = <me>` bolted onto their query. The
 * probe exists to ask "did my sub-agent post?", and a sub-agent is by definition
 * a different sender — so the query is structurally unsatisfiable, and it
 * answers "No messages found." at rc=0 with an EMPTY stderr. Measured on the
 * live store at 0.5.22 before this change: the flag form returned 0 rows while
 * the identical query without `--from` returned message #661877.
 *
 * The fix does NOT flip the filter's meaning. Silently widening a filter into a
 * no-op is the same defect pointed the other way — the caller then gets every
 * sender's rows at rc=0 and reads it as their own. What changes is that the
 * filter is no longer SILENT, and that an unambiguous spelling exists.
 *
 * Every case below is asserted in both directions. A disclosure that never
 * appears and one that always appears are equally worthless, so the negative
 * cases — no filter, and a filter that legitimately matches nothing — are as
 * load-bearing as the positive ones.
 */

const TEST_DB = join(tmpdir(), `conversations-sender-filter-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

/** The measured scenario: a coordinator probing for a sub-agent's post. */
const CHANNEL = "senderfilter-probe";
const TOKEN = "placeholder-private-marker-807";
const SUBAGENT = "subagent-807";
const COORDINATOR = "coordinator-807";

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Precedence rule 1 in src/lib/store/index.ts: an explicit DB path wins
      // over exported API credentials, so fleet credentials in the ambient
      // environment cannot pull this suite onto the production store. Verified
      // by measurement, not assumed — see the task record.
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    /** Callers see one terminal; assert against both streams together. */
    get output() {
      return `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
    },
  };
}

describe("sender filter is never silent", () => {
  beforeAll(() => {
    // A channel send is refused outright if the channel does not exist.
    const created = runCli(["channel", "create", CHANNEL], COORDINATOR);
    expect(created.exitCode).toBe(0);

    // The sub-agent posts the token the coordinator is looking for...
    const sub = runCli(
      ["send", `[${TOKEN}] sub-agent reporting in`, "--channel", CHANNEL],
      SUBAGENT,
    );
    expect(sub.exitCode).toBe(0);

    // ...and the coordinator has its own unrelated post in the same channel,
    // so "0 rows" cannot be explained by an empty channel.
    const coord = runCli(
      ["send", "dispatch record, no token here", "--channel", CHANNEL],
      COORDINATOR,
    );
    expect(coord.exitCode).toBe(0);
  }, 30_000);

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
    }
  });

  // ---- the message is reachable at all (fixture control) ----

  test("CONTROL: without a sender filter the sub-agent's post is found", () => {
    const res = runCli(["search", TOKEN, "--channel", CHANNEL], COORDINATOR);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
  });

  // ---- POSITIVE: findable via an unambiguous spelling ----

  test("--sender selects the sub-agent's post", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--sender", SUBAGENT],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
  });

  test("--sender works on read as well as search", () => {
    const res = runCli(
      ["read", "--channel", CHANNEL, "--sender", SUBAGENT],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
  });

  // ---- POSITIVE: the false absence is disclosed ----

  test("search: a zero caused by --from names the sender filter", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--from", COORDINATOR],
      COORDINATOR,
    );
    // The filter still filters — the row genuinely does not match.
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain(SUBAGENT);
    // ...but the caller is told WHY, and told that --from is a sender filter
    // here rather than their identity.
    expect(res.output).toContain("sender");
    expect(res.output).toContain(COORDINATOR);
    expect(res.output.toLowerCase()).toContain("--sender");
  });

  test("read: a zero caused by --from names the sender filter", () => {
    const res = runCli(
      ["read", "--channel", CHANNEL, "--from", "nobody-sent-anything"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain("sender");
    expect(res.output).toContain("nobody-sent-anything");
  });

  test("--from is disclosed even when it returns rows, because a filtered non-zero is wrong too", () => {
    // The measured case included a NON-empty wrong answer: `--from manius`
    // returned manius's own row and hid the sub-agent's. Warning only on zero
    // would leave that case silent.
    const res = runCli(["search", TOKEN, "--from", SUBAGENT], COORDINATOR);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
    expect(res.stderr.toLowerCase()).toContain("--sender");
  });

  // ---- NEGATIVE: the disclosure is not unconditional ----

  test("an unfiltered zero does NOT claim a sender filter was applied", () => {
    const res = runCli(
      ["search", "zzqxnotarealtokenhere", "--channel", CHANNEL],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.output).not.toContain("--sender");
    // A second assertion here used to check for the absence of the string
    // "filtered by sender", which appears nowhere in src/ except that assertion
    // — so it could not fail in any state. Removed rather than reworded: an
    // assertion that cannot fail is exactly the defect class this suite is about.
    expect(res.output).not.toContain("sender=");
  });

  test("a clean unfiltered search does NOT emit the alias note", () => {
    const res = runCli(["search", TOKEN, "--channel", CHANNEL], COORDINATOR);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).not.toContain("--sender");
  });

  // ---- NEGATIVE: the filter still filters ----

  test("--sender is a real filter, not silently widened into a no-op", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--sender", COORDINATOR],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain(SUBAGENT);
    expect(res.stdout).toContain("No messages found.");
  });

  test("--from keeps its existing filter semantics exactly", () => {
    // Existing callers must not silently start receiving other senders' rows.
    const res = runCli(["search", TOKEN, "--from", COORDINATOR], COORDINATOR);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain(SUBAGENT);
  });

  // ---- conflicting spellings never guess ----

  test("--from and --sender disagreeing is a hard error, not a silent winner", () => {
    const res = runCli(
      ["search", TOKEN, "--from", COORDINATOR, "--sender", SUBAGENT],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(1);
    // Naming BOTH values is what distinguishes a real conflict error from
    // commander's generic "unknown option '--sender'", which also exits 1 and
    // would let this test pass against an unfixed build.
    expect(res.output).toContain(COORDINATOR);
    expect(res.output).toContain(SUBAGENT);
  });

  test("--from and --sender agreeing is accepted", () => {
    const res = runCli(
      ["search", TOKEN, "--from", SUBAGENT, "--sender", SUBAGENT],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
  });

  // ---- export: the third sender-filtered verb ----

  test("export: a zero caused by --sender names the sender filter", () => {
    // Found in adversarial review: --sender on export was strictly MORE silent
    // than the --from it is offered as an improvement on, because it gets no
    // alias note by design and had no empty-result disclosure either. It printed
    // "[]" with 0 bytes of stderr at rc=0.
    const res = runCli(
      ["export", "--channel", CHANNEL, "--sender", "ghostsender"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).count).toBe(0);
    expect(JSON.parse(res.stdout).detail).toBe("preview");
    expect(res.stderr).toContain("ghostsender");
    expect(res.stderr).toContain("--sender");
  });

  test("export: a NON-empty result stays silent, so the notice means something", () => {
    const res = runCli(
      ["export", "--channel", CHANNEL, "--sender", SUBAGENT],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).count).toBe(1);
    expect(JSON.parse(res.stdout).detail).toBe("preview");
    // Local mode announces itself once on stderr (hasna/apps#1720).
    expect(res.stderr).toContain("LOCAL mode");
  });

  test("export: csv format discloses an empty export too", () => {
    const res = runCli(
      ["export", "--channel", CHANNEL, "--sender", "ghostsender", "--format", "csv"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("ghostsender");
  });

  // ---- a blank sender is refused, never silently widened ----

  test("--sender '' is a hard error, not an unfiltered read of the whole channel", () => {
    // The dangerous direction: `--sender "$WHO"` with WHO unset would otherwise
    // return every sender's messages at rc=0 and read as one sender's.
    const res = runCli(["read", "--channel", CHANNEL, "--sender", ""], COORDINATOR);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).not.toContain(SUBAGENT);
    expect(res.output).toContain("--sender");
  });

  test("--from with a whitespace-only value is refused rather than dropped", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--from", "   "], COORDINATOR);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).not.toContain(SUBAGENT);
  });

  test("a padded sender value still filters, rather than erroring", () => {
    // Trimming a real value is the beneficial half and must survive the guard.
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--sender", ` ${SUBAGENT} `],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(SUBAGENT);
  });

  // ---- the empty-result hint echoes the caller's own spelling ----

  test("the hint names --from when the caller passed --from", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--from", "ghostsender"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("drop --from to search all senders");
  });

  test("the hint names --sender when the caller passed --sender", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--sender", "ghostsender"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("drop --sender to search all senders");
  });

  // ---- the --json compact envelope stays parseable ----

  test("--json: stdout stays a compact envelope and the disclosure goes to stderr", () => {
    const res = runCli(
      ["search", TOKEN, "--channel", CHANNEL, "--from", COORDINATOR, "--json"],
      COORDINATOR,
    );
    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload).toMatchObject({ count: 0, has_more: false, next_cursor: null, compact: true });
    expect(payload.messages).toHaveLength(0);
    // Human guidance stays off the structured stdout surface.
    expect(res.stderr.toLowerCase()).toContain("--sender");
  });

  // ---- help says what the flag does ----

  test("search --help distinguishes the sender filter from caller identity", () => {
    const res = runCli(["search", "--help"], COORDINATOR);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("--sender");
    expect(res.stdout).toContain("identity");
  });
});
