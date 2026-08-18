import { describe, expect, it } from "bun:test";
import {
  parseVerdictLine,
  parseVerdictsFromBody,
  resolveVerdictAtHead,
  type ParsedVerdict,
} from "./verdict-parser.js";

/**
 * Verdict parser tests — pr-monitor design section 2.4 and acceptance
 * criterion 2 ("Verdict parser, two-sided").
 *
 * The fleet's canonical verdict line, as mandated by the review posting rule:
 *
 *   [REVIEW] <GO|NO_GO> — <owner/repo>#<n> @ <sha> — lens: <lens>, reviewer <name> (<i> of <n>)
 *
 * Two-sided fixtures: the exact canonical line yields GO/NO_GO at the sha it
 * names; a verdict at an older sha is ignored at head; NO_GO at head with no
 * newer GO resolves NO_GO; a newer GO at a newer head supersedes; malformed
 * lines and quoted bodies (GitHub quote-reply, fenced code blocks) never
 * match.
 */

const HEAD_SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b";
const OLD_SHA = "ab7890abcdefabcdefabcdefabcdefabcdefabcd";
const VERDICT_GO = `[REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA} — lens: correctness, reviewer vespasian (1 of 2)`;

describe("parseVerdictLine", () => {
  describe("positive fixtures", () => {
    it("parses the canonical GO line with owner/repo, sha, lens and reviewer", () => {
      const v = parseVerdictLine(VERDICT_GO);
      expect(v).not.toBeNull();
      expect(v!.verdict).toBe("GO");
      expect(v!.owner).toBe("hasna");
      expect(v!.repo).toBe("apps");
      expect(v!.number).toBe(123);
      expect(v!.sha).toBe(HEAD_SHA);
      expect(v!.lens).toBe("correctness");
      expect(v!.reviewer).toBe("vespasian");
    });

    it("parses the canonical NO_GO line", () => {
      const v = parseVerdictLine(
        `[REVIEW] NO_GO — hasna/apps#123 @ ${HEAD_SHA} — lens: secrets, reviewer fabricius (1 of 1)`,
      );
      expect(v).not.toBeNull();
      expect(v!.verdict).toBe("NO_GO");
      expect(v!.lens).toBe("secrets");
      expect(v!.reviewer).toBe("fabricius");
    });

    it("parses a short 7-hex abbreviated sha", () => {
      const v = parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ abc1234 — lens: correctness, reviewer vespasian`);
      expect(v).not.toBeNull();
      expect(v!.sha).toBe("abc1234");
    });

    it("normalizes an uppercase sha to lowercase", () => {
      const v = parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA.toUpperCase()} — lens: correctness, reviewer vespasian`);
      expect(v).not.toBeNull();
      expect(v!.sha).toBe(HEAD_SHA);
    });

    it("leaves lens and reviewer null when the tail is absent", () => {
      const v = parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA}`);
      expect(v).not.toBeNull();
      expect(v!.lens).toBeNull();
      expect(v!.reviewer).toBeNull();
    });

    it("accepts a hyphen or en-dash separator instead of the em-dash", () => {
      const hyphen = parseVerdictLine(`[REVIEW] GO - hasna/apps#123 @ ${HEAD_SHA}`);
      const enDash = parseVerdictLine(`[REVIEW] GO – hasna/apps#123 @ ${HEAD_SHA}`);
      expect(hyphen?.verdict).toBe("GO");
      expect(enDash?.verdict).toBe("GO");
    });

    it("accepts a bare repo#n reference without an owner", () => {
      const v = parseVerdictLine(`[REVIEW] NO_GO — apps#123 @ ${HEAD_SHA} — lens: correctness, reviewer vespasian`);
      expect(v).not.toBeNull();
      expect(v!.owner).toBeNull();
      expect(v!.repo).toBe("apps");
      expect(v!.number).toBe(123);
    });

    it("accepts a lens containing spaces, trimmed", () => {
      const v = parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA} — lens: base-movement check, reviewer vespasian`);
      expect(v).not.toBeNull();
      expect(v!.lens).toBe("base-movement check");
    });

    it("accepts reviewer names with hyphens (registered agent slugs)", () => {
      const v = parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA} — lens: correctness, reviewer agent-chief-staff (1 of 2)`);
      expect(v).not.toBeNull();
      expect(v!.reviewer).toBe("agent-chief-staff");
    });

    it("ignores trailing count-of-n parenthesis after the reviewer", () => {
      const v = parseVerdictLine(VERDICT_GO);
      expect(v).not.toBeNull();
      expect(v!.reviewer).toBe("vespasian");
    });
  });

  describe("negative fixtures (malformed and quoted must not match)", () => {
    it("rejects a missing [REVIEW] prefix", () => {
      expect(parseVerdictLine(`REVIEW GO — hasna/apps#123 @ ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a lowercase prefix", () => {
      expect(parseVerdictLine(`[review] GO — hasna/apps#123 @ ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a verdict value other than GO or NO_GO", () => {
      expect(parseVerdictLine(`[REVIEW] MAYBE — hasna/apps#123 @ ${HEAD_SHA}`)).toBeNull();
      expect(parseVerdictLine(`[REVIEW] GO! — hasna/apps#123 @ ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a missing @ before the sha", () => {
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps#123 ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a missing sha", () => {
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @`)).toBeNull();
    });

    it("rejects a sha that is too short or not hex", () => {
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ abc`)).toBeNull();
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps#123 @ xyz1234`)).toBeNull();
    });

    it("rejects a missing repo#n reference", () => {
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps @ ${HEAD_SHA}`)).toBeNull();
      expect(parseVerdictLine(`[REVIEW] GO — @ ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a PR reference with trailing junk glued to the number", () => {
      expect(parseVerdictLine(`[REVIEW] GO — hasna/apps#123abc @ ${HEAD_SHA}`)).toBeNull();
    });

    it("rejects a verdict embedded mid-sentence (not at line start)", () => {
      expect(parseVerdictLine(`I agree with the [REVIEW] GO — hasna/apps#123 @ ${HEAD_SHA} verdict.`)).toBeNull();
    });

    it("rejects an indented line", () => {
      expect(parseVerdictLine(`  ${VERDICT_GO}`)).toBeNull();
    });

    it("rejects prose and empty input", () => {
      expect(parseVerdictLine("looks good to me")).toBeNull();
      expect(parseVerdictLine("")).toBeNull();
      expect(parseVerdictLine(null)).toBeNull();
    });
  });
});

describe("parseVerdictsFromBody", () => {
  it("parses a verdict line that is the first line of a comment body", () => {
    const verdicts = parseVerdictsFromBody(`${VERDICT_GO}\nReviewed against the design's acceptance criteria.`);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.verdict).toBe("GO");
  });

  it("parses a verdict line that follows a preamble line", () => {
    const verdicts = parseVerdictsFromBody(`Reviewed.\n\n${VERDICT_GO}`);
    expect(verdicts).toHaveLength(1);
  });

  it("parses multiple distinct verdict lines in one body", () => {
    const verdicts = parseVerdictsFromBody(
      `${VERDICT_GO}\n[REVIEW] NO_GO — hasna/apps#123 @ ${HEAD_SHA} — lens: secrets, reviewer fabricius`,
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts.map((v) => v.verdict).sort()).toEqual(["GO", "NO_GO"]);
  });

  it("dedupes an identical line repeated within one body", () => {
    const verdicts = parseVerdictsFromBody(`${VERDICT_GO}\n${VERDICT_GO}`);
    expect(verdicts).toHaveLength(1);
  });

  it("carries the comment id and createdAt through from the caller", () => {
    const verdicts = parseVerdictsFromBody(VERDICT_GO, { id: 4242, createdAt: "2026-08-18T10:00:00Z" });
    expect(verdicts[0]!.commentId).toBe(4242);
    expect(verdicts[0]!.createdAt).toBe("2026-08-18T10:00:00Z");
  });

  it("does not match a GitHub quote-reply body", () => {
    const body = `> ${VERDICT_GO}\n>\n> Looks right to me.`;
    expect(parseVerdictsFromBody(body)).toHaveLength(0);
  });

  it("does not match a verdict inside a fenced code block", () => {
    const body = `Example line:\n\`\`\`\n${VERDICT_GO}\n\`\`\``;
    expect(parseVerdictsFromBody(body)).toHaveLength(0);
  });

  it("does not match a verdict inside a tilde-fenced code block", () => {
    const body = `Example line:\n~~~\n${VERDICT_GO}\n~~~`;
    expect(parseVerdictsFromBody(body)).toHaveLength(0);
  });

  it("still parses a verdict line after a closed fence", () => {
    const body = `\`\`\`\n[REVIEW] NO_GO — hasna/apps#1 @ ${OLD_SHA}\n\`\`\`\n${VERDICT_GO}`;
    const verdicts = parseVerdictsFromBody(body);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.verdict).toBe("GO");
  });

  it("returns an empty list for prose, quoted, and malformed bodies", () => {
    expect(parseVerdictsFromBody("this is just prose")).toHaveLength(0);
    expect(parseVerdictsFromBody("")).toHaveLength(0);
    expect(parseVerdictsFromBody(null)).toHaveLength(0);
    expect(parseVerdictsFromBody(`> ${VERDICT_GO}`)).toHaveLength(0);
  });
});

describe("resolveVerdictAtHead", () => {
  const goAtHead: ParsedVerdict = {
    verdict: "GO",
    owner: "hasna",
    repo: "apps",
    number: 123,
    sha: HEAD_SHA,
    lens: "correctness",
    reviewer: "vespasian",
    commentId: 10,
    createdAt: "2026-08-18T10:00:00Z",
  };
  const goAtOld: ParsedVerdict = {
    ...goAtHead,
    sha: OLD_SHA,
    commentId: 5,
    createdAt: "2026-08-18T09:00:00Z",
  };
  const noGoAtHead: ParsedVerdict = {
    verdict: "NO_GO",
    owner: "hasna",
    repo: "apps",
    number: 123,
    sha: HEAD_SHA,
    lens: "secrets",
    reviewer: "fabricius",
    commentId: 11,
    createdAt: "2026-08-18T10:05:00Z",
  };

  it("yields GO when a GO verdict names the head sha", () => {
    expect(resolveVerdictAtHead([goAtHead], HEAD_SHA)?.verdict).toBe("GO");
  });

  it("ignores a verdict at an older sha when resolving at head", () => {
    expect(resolveVerdictAtHead([goAtOld], HEAD_SHA)).toBeNull();
  });

  it("resolves NO_GO at head with no newer GO", () => {
    expect(resolveVerdictAtHead([noGoAtHead], HEAD_SHA)?.verdict).toBe("NO_GO");
  });

  it("lets a newer GO at a newer head supersede an older NO_GO", () => {
    const noGoAtOld: ParsedVerdict = { ...noGoAtHead, sha: OLD_SHA, commentId: 8, createdAt: "2026-08-18T09:30:00Z" };
    const resolved = resolveVerdictAtHead([noGoAtOld, goAtHead], HEAD_SHA);
    expect(resolved?.verdict).toBe("GO");
    expect(resolved?.sha).toBe(HEAD_SHA);
  });

  it("takes the newest verdict when two verdicts name the same sha", () => {
    const goLater: ParsedVerdict = { ...goAtHead, commentId: 20, createdAt: "2026-08-18T11:00:00Z" };
    expect(resolveVerdictAtHead([noGoAtHead, goLater], HEAD_SHA)?.verdict).toBe("GO");
    expect(resolveVerdictAtHead([goAtHead, noGoAtHead], HEAD_SHA)?.verdict).toBe("NO_GO");
  });

  it("breaks createdAt ties by comment id", () => {
    const goSameTime: ParsedVerdict = { ...goAtHead, commentId: 99, createdAt: noGoAtHead.createdAt };
    expect(resolveVerdictAtHead([noGoAtHead, goSameTime], HEAD_SHA)?.verdict).toBe("GO");
  });

  it("sorts comments without a createdAt as oldest", () => {
    const untimed: ParsedVerdict = { ...goAtHead, createdAt: null };
    expect(resolveVerdictAtHead([untimed], HEAD_SHA)?.verdict).toBe("GO");
    expect(resolveVerdictAtHead([untimed, noGoAtHead], HEAD_SHA)?.verdict).toBe("NO_GO");
  });

  it("compares shas case-insensitively", () => {
    const upper = { ...goAtHead, sha: HEAD_SHA.toUpperCase() };
    expect(resolveVerdictAtHead([upper], HEAD_SHA)?.verdict).toBe("GO");
  });

  it("returns null for an empty list, a null head sha, or no matching verdict", () => {
    expect(resolveVerdictAtHead([], HEAD_SHA)).toBeNull();
    expect(resolveVerdictAtHead([goAtHead], null)).toBeNull();
    expect(resolveVerdictAtHead([goAtHead], "ffffffffffffffffffffffffffffffffffffffff")).toBeNull();
  });
});
