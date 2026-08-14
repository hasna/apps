import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatDispatchComment,
  formatDispatchNotice,
  claimDeadlineFrom,
  DISPATCH_COMMENT_MARKER,
  type DelegationRecordInput,
} from "./delegation-record.js";
import {
  loadDelegationEmbargo,
  resolveDelegationDepthThreshold,
  DEFAULT_CLAIM_WINDOW_MINUTES,
} from "./delegation-policy.js";

const base: DelegationRecordInput = {
  taskId: "5601a640-d902-449e-9db1-e3f1a286abb5",
  worker: "lucilius",
  dispatcher: "agent-ceo",
  runtime: "claude-code-subagent",
  briefSource: "/tmp/brief.md",
  briefSha256: "a".repeat(64),
  briefBytes: 128,
  depth: 1,
  reportsTo: "agent-ceo",
  seatSlug: "agent-ceo",
  seatOpenTasks: 190,
  depthThreshold: null,
  override: null,
  identityOutcome: "created",
  dispatchedAt: "2026-08-05T12:00:00.000Z",
  claimDeadline: "2026-08-05T12:30:00.000Z",
};

/**
 * THE MARKER IS A CONTRACT, not decoration. The terminal-state counters this
 * verb is measured by are both greps over it:
 *
 *   N1  never-dispatched   — directive-cited rows with NO [DISPATCH] comment
 *   N2  dispatch-laundering — a [DISPATCH] comment older than the claim window
 *                             on a row whose started_at is still null
 *
 * If the marker moves off the first line, stops being anchored, or changes
 * spelling, both counters silently return zero — a clean bill of health for a
 * measurement that can no longer see anything. That is the accounts-health
 * failure applied to this remedy's own green surface, so it gets a test.
 */
describe("the [DISPATCH] marker, which the N1/N2 counters grep for", () => {
  it("is the FIRST thing on the FIRST line, so an anchored ^ pattern matches", () => {
    const comment = formatDispatchComment(base);
    expect(comment.split("\n")[0]!.startsWith(DISPATCH_COMMENT_MARKER)).toBe(true);
    expect(comment).toMatch(/^\[DISPATCH\]/);
  });

  it("carries the worker, dispatcher, brief digest, lineage and deadline", () => {
    const comment = formatDispatchComment(base);
    expect(comment).toContain("lucilius");
    expect(comment).toContain("agent-ceo");
    expect(comment).toContain(base.briefSha256);
    expect(comment).toContain("/tmp/brief.md");
    expect(comment).toContain("delegation_depth=1");
    expect(comment).toContain("2026-08-05T12:30:00.000Z");
  });

  it("states that started_at is deliberately unset, so a reader need not know it from elsewhere", () => {
    expect(formatDispatchComment(base)).toContain("started_at is deliberately NOT set");
  });

  it("records an override when one was used, and OMITS it when none was — both arms", () => {
    expect(formatDispatchComment({ ...base, override: "despite-depth", depthThreshold: 1 }))
      .toContain("OVERRIDE despite-depth");
    expect(formatDispatchComment({ ...base, override: "owner-directive", depthThreshold: 1 }))
      .toContain("OVERRIDE owner-directive");
    // Without this arm the two assertions above would also pass if the record
    // printed OVERRIDE unconditionally.
    expect(formatDispatchComment(base)).not.toContain("OVERRIDE");
  });

  it("reports an unset threshold as `unset` rather than as a number", () => {
    expect(formatDispatchComment(base)).toContain("threshold unset");
    expect(formatDispatchComment({ ...base, depthThreshold: 25 })).toContain("threshold 25");
  });
});

describe("the channel notice is ONE line", () => {
  it("never wraps, because a multi-line dispatch log is how a channel stops being read", () => {
    const notice = formatDispatchNotice({ ...base, override: "despite-depth" });
    expect(notice.includes("\n")).toBe(false);
    expect(notice).toContain("lucilius");
    expect(notice).toContain("5601a640");
    expect(notice).toContain("[despite-depth]");
  });

  it("omits the override marker when there is no override", () => {
    expect(formatDispatchNotice(base)).not.toContain("[despite-depth]");
  });
});

describe("claimDeadlineFrom", () => {
  it("adds exactly the window, in minutes", () => {
    const at = new Date("2026-08-05T12:00:00.000Z");
    expect(claimDeadlineFrom(at, 30)).toBe("2026-08-05T12:30:00.000Z");
    expect(claimDeadlineFrom(at, 45)).toBe("2026-08-05T12:45:00.000Z");
  });

  it("defaults to a 30-minute window, matching the steering-pass cadence", () => {
    expect(DEFAULT_CLAIM_WINDOW_MINUTES).toBe(30);
  });
});

describe("resolveDelegationDepthThreshold — unset by default, and that is deliberate", () => {
  const previous = process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"];
  afterEach(() => {
    if (previous === undefined) delete process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"];
    else process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"] = previous;
  });

  it("is UNSET with no flag and no env — seat queues sit at 190 open, so a shipped number would park everything", () => {
    delete process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"];
    const resolved = resolveDelegationDepthThreshold(undefined);
    expect(resolved.value).toBeNull();
    expect(resolved.source).toBe("unset");
  });

  it("reads the env when no flag is given", () => {
    process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"] = "12";
    expect(resolveDelegationDepthThreshold(undefined)).toEqual({ value: 12, source: "env" });
  });

  it("lets the flag win over the env", () => {
    process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"] = "12";
    expect(resolveDelegationDepthThreshold("3")).toEqual({ value: 3, source: "flag" });
  });

  it("accepts 0 — a falsy threshold that parks everything is a legitimate arming", () => {
    delete process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"];
    expect(resolveDelegationDepthThreshold("0")).toEqual({ value: 0, source: "flag" });
  });

  it("treats junk and negatives as unset rather than throwing mid-delegation", () => {
    delete process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"];
    expect(resolveDelegationDepthThreshold("not-a-number").value).toBeNull();
    expect(resolveDelegationDepthThreshold("-5").value).toBeNull();
  });
});

describe("loadDelegationEmbargo — data, never a constant", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function write(contents: string): string {
    dir = mkdtempSync(join(tmpdir(), "todos-embargo-"));
    const path = join(dir, "embargo.json");
    writeFileSync(path, contents);
    return path;
  }

  it("reads the { embargoed: [...] } shape", () => {
    const set = loadDelegationEmbargo(write(JSON.stringify({ embargoed: ["Vespasian", "porcia"] })));
    // Normalised, so case never decides whether an embargo applies.
    expect(set.has("vespasian")).toBe(true);
    expect(set.has("porcia")).toBe(true);
    expect(set.has("lucilius")).toBe(false);
  });

  it("reads a bare array too", () => {
    expect(loadDelegationEmbargo(write(JSON.stringify(["vespasian"]))).has("vespasian")).toBe(true);
  });

  it("reads { slug, reason } entries, so the file can carry WHY without a schema version", () => {
    const set = loadDelegationEmbargo(
      write(JSON.stringify({ embargoed: [{ slug: "vespasian", reason: "owner directive 2026-08-05" }] })),
    );
    expect(set.has("vespasian")).toBe(true);
  });

  it("DEGRADES to empty on a missing file — an e2b sandbox has no station-local config", () => {
    dir = mkdtempSync(join(tmpdir(), "todos-embargo-"));
    expect(loadDelegationEmbargo(join(dir, "absent.json")).size).toBe(0);
  });

  it("DEGRADES to empty on malformed JSON rather than throwing mid-delegation", () => {
    expect(loadDelegationEmbargo(write("{ not json at all")).size).toBe(0);
  });
});
