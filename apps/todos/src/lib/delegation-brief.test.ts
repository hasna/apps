import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { resolveDelegationBrief } from "./delegation-brief.js";

/**
 * THE GATE THAT MUST BE PROVEN TWO-SIDED.
 *
 * `todos delegate` exists because dispatching ran 0/14 while filing ran 13/14,
 * and the single most common way a dispatch is worthless is a worker that
 * receives no self-sufficient brief. So the refusal is the first effect the
 * verb runs, before any write.
 *
 * A suite that only proves a GOOD brief is accepted has not tested a gate — it
 * has tested that the happy path works, which would also pass if the gate were
 * deleted. Every refusal reason below therefore has a matching acceptance case
 * built from a real input, so each assertion can fail in both directions.
 */

const sources = (files: Record<string, string>, stdin?: string) => ({
  readFile(path: string): string {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return content;
  },
  readStdin(): string {
    if (stdin === undefined) throw new Error("no stdin provided");
    return stdin;
  },
});

describe("resolveDelegationBrief — REFUSES, and each refusal is reachable from a real input", () => {
  it("REFUSES when neither --brief nor --brief-text is given", () => {
    const verdict = resolveDelegationBrief({}, sources({}));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("missing");
    expect(verdict.message).toContain("--brief");
  });

  it("REFUSES when BOTH --brief and --brief-text are given", () => {
    const verdict = resolveDelegationBrief(
      { briefPath: "/tmp/b.md", briefText: "inline" },
      sources({ "/tmp/b.md": "on disk" }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("conflict");
  });

  it("REFUSES when the path cannot be read", () => {
    const verdict = resolveDelegationBrief({ briefPath: "/tmp/definitely-absent.md" }, sources({}));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("unreadable");
    // The message must name the path, or the caller debugs the wrong file.
    expect(verdict.message).toContain("/tmp/definitely-absent.md");
  });

  it("REFUSES a zero-byte file", () => {
    const verdict = resolveDelegationBrief({ briefPath: "/tmp/empty.md" }, sources({ "/tmp/empty.md": "" }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("empty");
  });

  it("REFUSES a whitespace-only file — the case a byte-length check would pass", () => {
    const verdict = resolveDelegationBrief(
      { briefPath: "/tmp/ws.md" },
      sources({ "/tmp/ws.md": "  \n\t \r\n  " }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("empty");
  });

  it("REFUSES whitespace-only --brief-text", () => {
    const verdict = resolveDelegationBrief({ briefText: "   " }, sources({}));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("empty");
  });

  it("REFUSES an empty stdin brief (`--brief -`)", () => {
    const verdict = resolveDelegationBrief({ briefPath: "-" }, sources({}, "\n\n"));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe("empty");
  });
});

describe("resolveDelegationBrief — ACCEPTS, so the refusals above are not a check that always fires", () => {
  it("ACCEPTS a real file and reports its source and byte count", () => {
    const body = "# Brief\n\nDo the thing, here is every fact you need.\n";
    const verdict = resolveDelegationBrief({ briefPath: "/tmp/good.md" }, sources({ "/tmp/good.md": body }));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.text).toBe(body);
    expect(verdict.source).toBe("/tmp/good.md");
    expect(verdict.bytes).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("ACCEPTS --brief-text", () => {
    const verdict = resolveDelegationBrief({ briefText: "inline brief with content" }, sources({}));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.source).toBe("(--brief-text)");
  });

  it("ACCEPTS stdin via `--brief -`", () => {
    const verdict = resolveDelegationBrief({ briefPath: "-" }, sources({}, "brief piped in"));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.text).toBe("brief piped in");
    expect(verdict.source).toBe("(stdin)");
  });

  it("ACCEPTS a brief whose content is only meaningful after trimming, and stores it UNTRIMMED", () => {
    // The emptiness test trims; the stored artefact must not be silently
    // rewritten, or the sha256 recorded in the [DISPATCH] comment would not
    // match the file the worker is told to read.
    const body = "\n  real content  \n";
    const verdict = resolveDelegationBrief({ briefPath: "/tmp/pad.md" }, sources({ "/tmp/pad.md": body }));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.text).toBe(body);
  });
});

describe("resolveDelegationBrief — the sha256 is the real digest of the real bytes", () => {
  it("matches an independently computed digest", () => {
    const body = "brief content whose digest goes into the [DISPATCH] comment";
    const verdict = resolveDelegationBrief({ briefPath: "/tmp/d.md" }, sources({ "/tmp/d.md": body }));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error(verdict.message);
    expect(verdict.sha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
  });

  it("DIFFERS for different content — a constant would satisfy the test above", () => {
    const a = resolveDelegationBrief({ briefText: "alpha" }, sources({}));
    const b = resolveDelegationBrief({ briefText: "beta" }, sources({}));
    if (!a.ok || !b.ok) throw new Error("both should be accepted");
    expect(a.sha256).not.toBe(b.sha256);
  });
});
