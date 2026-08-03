import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createChannel, getChannel, listChannels } from "./channels";
import { sendMessage, readMessages } from "./messages";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Regression for todos 4cc80a4d: a send to an unknown channel wrote an ORPHAN.
 *
 * Measured on installed 0.5.22 against the live store:
 *
 *   conversations send --channel zzz-no-such-channel-…  -> message 650193 created
 *   conversations digest <that channel>                 -> reads the message back
 *   conversations channel list                          -> ABSENT from all 1050 rows
 *   conversations channel archive <that channel>        -> 404, nothing to archive
 *
 * A typo'd channel name silently swallowed the message into a namespace nobody
 * could list, subscribe to, or clean up. Composed with the rc=2 ambiguity in
 * c400d5f0 it was sharp: an agent typos `#incidnets`, sees a non-zero rc,
 * applies the correct "rc=2 means it landed" rule, and concludes delivery —
 * into a void.
 *
 * Root cause: `messages.channel` is free text with NO foreign key to and no
 * existence check against `channels` (see the INSERT in sendMessage below, and
 * the identical one at src/server/api.ts POST /messages). `channels.name` is a
 * PRIMARY KEY in a separate table, which is why `channel list` — which selects
 * `FROM channels` — cannot see the row that `digest` reads back out of
 * `messages`.
 *
 * This is NOT a new policy. Every other channel-facing verb ALREADY requires
 * the row: `channel read` refuses an unknown channel (stated verbatim at
 * src/cli/read-recency.e2e.test.ts:94), `channel archive` 404s, and
 * src/mcp/tools/channels.test.ts asserts "returns error for nonexistent
 * channel" eight times over. `send` was the single hole in an otherwise
 * enforced contract, so closing it makes the surface consistent rather than
 * stricter.
 */

// A DB file PER TEST. A single shared path leaked channel rows between tests
// here — `createChannel("general")` in one test hit `UNIQUE constraint failed:
// channels.name` in the next — which made the positive control fail for a
// reason that had nothing to do with the code under test. A control that fails
// for the wrong reason is worse than no control: it reads as a real defect.
let TEST_DB = "";
let dbSeq = 0;

beforeEach(() => {
  TEST_DB = join(tmpdir(), `conversations-test-orphan-${process.pid}-${Date.now()}-${dbSeq++}.db`);
  // BOTH names, highest-precedence first. src/lib/db.ts resolves
  // HASNA_CONVERSATIONS_DB_PATH BEFORE CONVERSATIONS_DB_PATH, so setting only
  // the latter leaves an ambient HASNA_-prefixed value in charge and every test
  // in the file quietly shares one database.
  process.env.HASNA_CONVERSATIONS_DB_PATH = TEST_DB;
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  delete process.env.HASNA_CONVERSATIONS_DB_PATH;
  delete process.env.CONVERSATIONS_DB_PATH;
});

/** Count rows in `messages` for a channel, bypassing every read helper. */
function rawMessageCount(channel: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE channel = ?`)
    .get(channel) as { n: number };
  return row.n;
}

describe("a send to an unknown channel does not create an orphan", () => {
  test("the send is refused, and the error names the channel and the remedy", () => {
    expect(() =>
      sendMessage({ from: "alice", to: "", channel: "zzz-no-such-channel", content: "into the void" }),
    ).toThrow(/zzz-no-such-channel/);

    // And the remedy is actionable, not just a refusal.
    expect(() =>
      sendMessage({ from: "alice", to: "", channel: "zzz-no-such-channel", content: "into the void" }),
    ).toThrow(/channel create/);
  });

  test("NOTHING is persisted — the orphan row must not exist at all", () => {
    // The whole harm was a message that existed but belonged nowhere. A refusal
    // that still inserted would be no better than the defect.
    try {
      sendMessage({ from: "alice", to: "", channel: "incidnets", content: "typo'd incident report" });
    } catch { /* expected */ }

    expect(rawMessageCount("incidnets")).toBe(0);
    expect(readMessages({ channel: "incidnets" })).toHaveLength(0);
  });

  test("the typo case: a near-miss of a real channel is refused, not silently accepted", () => {
    createChannel("incidents", "alice");

    expect(() =>
      sendMessage({ from: "alice", to: "", channel: "incidnets", content: "an incident correction" }),
    ).toThrow();

    // The real channel is untouched by the failed send.
    expect(rawMessageCount("incidents")).toBe(0);
  });

  test("no channel row is invented as a side effect of the attempt", () => {
    // Auto-creating on send would also close the orphan, and was rejected: it
    // turns every typo into permanent visible litter in a list that already
    // carries over a thousand rows.
    try {
      sendMessage({ from: "alice", to: "", channel: "zzz-not-a-channel", content: "x" });
    } catch { /* expected */ }

    expect(getChannel("zzz-not-a-channel")).toBeNull();
    expect(listChannels().map((c) => c.name)).not.toContain("zzz-not-a-channel");
  });
});

describe("the guard is narrow — these must keep working", () => {
  test("positive control: a send to a channel that EXISTS still succeeds", () => {
    // Without this, a guard that refused every channel send would pass the
    // tests above while breaking the product.
    createChannel("general", "alice");

    const msg = sendMessage({ from: "alice", to: "", channel: "general", content: "hello" });

    expect(msg.id).toBeGreaterThan(0);
    expect(msg.channel).toBe("general");
    expect(rawMessageCount("general")).toBe(1);
  });

  test("a direct message with no channel is unaffected", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "a DM" });

    expect(msg.id).toBeGreaterThan(0);
    expect(msg.channel).toBeNull();
  });

  test("name normalisation still resolves: '#General' reaches the 'general' row", () => {
    // The existence check must run against the NORMALIZED name, or every send
    // using a display-style '#Name' would be refused against a real channel.
    createChannel("general", "alice");

    const msg = sendMessage({ from: "alice", to: "", channel: "#General", content: "normalised" });

    expect(msg.channel).toBe("general");
  });

  test("a reply into a PRE-EXISTING orphan channel is still allowed", () => {
    // Found by adversarial review (Aulus, NO-GO on PR #80). The guard's own
    // comment promises that only an EXPLICITLY REQUESTED channel is checked, so
    // that replies to messages already sitting in orphan channels — legacy data
    // the author did not write — are not punished. On the SQLite path that
    // carve-out never fired: `conversations reply` derives the parent's channel
    // and passes it EXPLICITLY (src/cli/commands/messaging.ts:509), so
    // requestedChannel is non-null for every channel reply.
    //
    // The server path already had this right (`requestedChannel && !replyParent`
    // at src/server/api.ts), so the two backends disagreed while carrying the
    // identical comment — the exact divergence unknownChannelMessage was put in
    // channel-names.ts to prevent.
    const db = getDb();
    // Seed a legacy orphan directly: a message row whose channel has no row in
    // `channels`, which is precisely what the pre-guard code produced.
    db.prepare(
      `INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("aaaaaaaabbbbccccddddeeeeeeeeeeee", "channel:legacy-orphan", "alice", "legacy-orphan", "legacy-orphan", "the original report");
    // Assert the orphan really is one, rather than assuming it.
    expect(getChannel("legacy-orphan")).toBeNull();

    const parent = db.prepare(`SELECT id, uuid FROM messages WHERE channel = ?`).get("legacy-orphan") as { id: number; uuid: string };

    const reply = sendMessage({
      from: "bob",
      to: "",
      channel: "legacy-orphan",
      content: "a correction to the original report",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });

    expect(reply.id).toBeGreaterThan(0);
    expect(reply.reply_to).toBe(parent.id);
  });

  test("an archived channel still accepts sends, so this changes only existence", () => {
    // Archival policy is a separate question with its own verbs. Conflating it
    // here would smuggle in a second behaviour change under one fix.
    createChannel("retired", "alice");
    getDb().prepare(`UPDATE channels SET archived_at = ? WHERE name = ?`).run(new Date().toISOString(), "retired");

    const msg = sendMessage({ from: "alice", to: "", channel: "retired", content: "late arrival" });

    expect(msg.id).toBeGreaterThan(0);
  });
});
