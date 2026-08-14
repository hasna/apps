import { describe, expect, test } from "bun:test";
import { attachSendRedaction, describeSendRedaction } from "./content-safety";

/**
 * Regression for todos c400d5f0: rc=2 had TWO causes and a caller could not
 * tell them apart.
 *
 * Measured on installed 0.5.22, only the trailing newline varying:
 *
 *   arg WITH trailing newline    -> rc=2 + redaction warning   (message 650921)
 *   arg WITHOUT trailing newline -> rc=0                       (message 650922)
 *
 * Both bodies landed, and the rc=2 message's stored body was byte-identical to
 * what was sent apart from the stripped newline. The warning was FALSE.
 *
 * Root cause, read from source rather than inferred: the server trims every
 * message body — `str()` at src/server/api.ts:120-122 returns `v.trim()` and is
 * applied to `body.content` at api.ts:890 — while the CLI hands
 * `describeSendRedaction` the raw argv string (src/cli/commands/messaging.ts:69
 * keeps it deliberately untrimmed). The notice then compared the two with exact
 * string equality, so a stripped trailing newline read as "your body was
 * rewritten".
 *
 * The fix must DISTINGUISH the two causes, never suppress the warning. The
 * env-dump case below is the one worth keeping: a report that lands gutted
 * while reading as delivered is the silent-success shape, and rc=2 is currently
 * its only signal. Every test in the second describe block exists to fail if a
 * future change buys the false-positive fix by blinding the real detector.
 */

/** A KEY=value block, the shape the server replaces wholesale. */
const ENV_BLOCK = [
  "ASSIGNED_PENDING=14",
  "ASSIGNED_IN_PROGRESS=3",
  "UNASSIGNED_PENDING=41",
].join("\n");

describe("a whitespace-only difference is NOT a redaction", () => {
  test("a stripped trailing newline does not raise the notice", () => {
    // The exact 650921/650922 pair: identical bodies, one with the newline the
    // shell appended, and that alone flipped rc 0 -> 2.
    const submitted = "the body of an ordinary status report\n";
    const stored = "the body of an ordinary status report";

    const notice = describeSendRedaction(submitted, stored);

    expect(notice.redacted).toBe(false);
    expect(notice.message).toBe("");
    expect(notice.labels).toEqual([]);
  });

  test("leading whitespace and trailing spaces are equally cosmetic", () => {
    // A reader cannot see any of these, so none of them is "not what readers
    // will see".
    expect(describeSendRedaction("  padded both ends  ", "padded both ends").redacted).toBe(false);
    expect(describeSendRedaction("\n\nleading blank lines", "leading blank lines").redacted).toBe(false);
    expect(describeSendRedaction("trailing spaces   ", "trailing spaces").redacted).toBe(false);
    expect(describeSendRedaction("multi\nline\nbody\n", "multi\nline\nbody").redacted).toBe(false);
  });

  test("the notice rides on the returned message too, so the store funnel agrees", () => {
    // attachSendRedaction is what non-CLI callers see. It must not disagree
    // with the CLI about whether anything happened.
    const submitted = "an ordinary broadcast\n";
    const clean = attachSendRedaction(submitted, { id: 1, content: "an ordinary broadcast" });

    expect(clean.redaction).toBeUndefined();
  });
});

describe("a real redaction is STILL reported — the fix must not blind this", () => {
  test("a whole-body env-dump replacement still raises the notice", () => {
    // Message 651018: the block genuinely went, ASSIGNED_PENDING=14 and all.
    const notice = describeSendRedaction(ENV_BLOCK, "[REDACTED:ENV_DUMP]");

    expect(notice.redacted).toBe(true);
    expect(notice.message).toContain("ENTIRE body was replaced");
  });

  test("a SELECTIVE redaction still raises it, with prose surviving alongside", () => {
    // manius's 616670 from 2026-07-31: unredacted prose either side of a
    // replaced block. The trimmed forms still differ, so this must still fire.
    const submitted = `here is the queue snapshot\n${ENV_BLOCK}\nthat is the whole picture`;
    const stored = "here is the queue snapshot\n[REDACTED:ENV_DUMP]\nthat is the whole picture";

    const notice = describeSendRedaction(submitted, stored);

    expect(notice.redacted).toBe(true);
    expect(notice.message).toContain("redactions applied");
  });

  test("a real redaction that ALSO lost a trailing newline is still reported", () => {
    // The adversarial case for this fix: both differences present at once. The
    // whitespace exemption must not swallow the substantive one.
    const notice = describeSendRedaction(`${ENV_BLOCK}\n`, "[REDACTED:ENV_DUMP]");

    expect(notice.redacted).toBe(true);
  });

  test("a body dropped to empty is reported, not excused as whitespace", () => {
    // "" trims to "" and so does a whitespace-only submission. A body that was
    // really thrown away must not be read as a cosmetic trim.
    const notice = describeSendRedaction("a report that was discarded entirely", "");

    expect(notice.redacted).toBe(true);
  });

  test("an INTERNAL whitespace change is a real change, not a cosmetic one", () => {
    // Trimming the ends is the only normalisation the server performs. If some
    // layer ever collapses internal whitespace it is rewriting what readers
    // see, and the notice must say so.
    const notice = describeSendRedaction("one\n\ntwo", "one two");

    expect(notice.redacted).toBe(true);
  });
});
