import { describe, expect, test } from "bun:test";

import { scanInputExposures } from "./scanner";

/**
 * `secrets scan` is the instrument this fleet uses to decide whether it is safe
 * to LOOK at a capture. The credential-hygiene rule tells an agent to read the
 * finding instead of the file, on the stated ground that the scanner "redacts
 * its own preview". These tests hold that ground.
 *
 * Every credential shape below is a synthetic sentinel. None is a real key, and
 * none came from the vault.
 */

// Assembled at runtime so this file does not itself carry a literal credential
// shape — a scan of this repo would otherwise find one, in the scanner's own
// test, which is the joke that writes itself.
const join = (...parts: string[]): string => parts.join("");

const AWS_SENTINEL = join("AK", "IA", "QQQQSENTINEL0000");
const BARE_SENTINEL = "Zk9QmXw2Lp7Rt4Vy8Nc3Hf6Jd1Bg5Ae0";

// An assignment the `credential_assignment` detector matches, with a '#' its
// value class cannot cross. Assembled from fragments so this file does not
// contain the literal shape — a scan of this repo trips on it otherwise, and
// the commit gate is not something to switch off to land a test.
const ASSIGNMENT_KEY = join("DB_", "PASS", "WORD");
const ASSIGNMENT_HEAD = join("Sentinel", "AAAA");
const ASSIGNMENT_TAIL = "SentinelTAILBBBB";
const ASSIGNMENT_LINE = `${ASSIGNMENT_KEY}=${ASSIGNMENT_HEAD}#${ASSIGNMENT_TAIL}`;

describe("scan preview redaction", () => {
  test("a match at column 0 does not put the value in the preview", () => {
    const result = scanInputExposures({
      text: `${AWS_SENTINEL} trailing-context-after-the-match\n`,
      path: "col0.txt",
    });

    expect(result.findingCount).toBe(1);
    const finding = result.findings[0]!;
    expect(finding.detector).toBe("aws_access_key_id");
    expect(finding.column).toBe(1);
    expect(finding.preview).not.toContain(AWS_SENTINEL);
  });

  test("the preview carries no surrounding line content either", () => {
    // The old preview masked only the detected spans and emitted the rest of
    // the line raw. A secret no detector recognises therefore travelled in the
    // clear, beside `redacted: true`.
    const result = scanInputExposures({
      text: `bare=${BARE_SENTINEL} aws=${AWS_SENTINEL}\n`,
      path: "neighbour.txt",
    });

    expect(result.findingCount).toBe(1);
    expect(result.findings[0]!.preview).not.toContain(BARE_SENTINEL);
  });

  test("the tail of a value the detector matched only in part stays hidden", () => {
    // `credential_assignment` captures [^'"\s#]{8,}, so it cannot cross '#'.
    // Masking just that span left the rest of the very credential it matched
    // sitting in the preview.
    const result = scanInputExposures({ text: `${ASSIGNMENT_LINE}\n` });

    expect(result.findingCount).toBeGreaterThanOrEqual(1);
    expect(result.findings[0]!.detector).toBe("credential_assignment");
    for (const finding of result.findings) {
      expect(finding.preview).not.toContain(ASSIGNMENT_TAIL);
      expect(finding.preview).not.toContain(ASSIGNMENT_HEAD);
    }
  });

  test("no preview on any finding contains bytes from the scanned line", () => {
    const line = `prefix-${BARE_SENTINEL} ${AWS_SENTINEL} suffix-token-value`;
    const result = scanInputExposures({ text: `${line}\n`, path: "sweep.txt" });

    expect(result.findingCount).toBeGreaterThanOrEqual(1);
    for (const finding of result.findings) {
      // A constant marker, not a derivative of the line.
      expect(finding.preview).toBe("***REDACTED***");
      for (const fragment of ["prefix-", "suffix-", BARE_SENTINEL, AWS_SENTINEL]) {
        expect(finding.preview).not.toContain(fragment);
      }
    }
  });

  test("`redacted: true` is reported and the flag now describes the payload", () => {
    const result = scanInputExposures({ text: `${AWS_SENTINEL}\n`, path: "flag.txt" });
    expect(result.redacted).toBe(true);
    expect(result.findings[0]!.preview).not.toContain(AWS_SENTINEL);
  });

  // The negative half. A change that blanks previews must not also start
  // inventing findings, or reporting a clean file as dirty.
  test("a clean file still reports zero findings and no spurious preview", () => {
    const result = scanInputExposures({
      text: "just ordinary configuration text, nothing secret here\n",
      path: "clean.txt",
    });

    expect(result.findingCount).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  // Guards the load-bearing outputs. Blanking the preview is only acceptable
  // because these still locate the finding precisely.
  test("detector, line and column still locate the finding", () => {
    const result = scanInputExposures({
      text: `first line is clean\nsecond has one: ${AWS_SENTINEL}\n`,
    });

    expect(result.findingCount).toBe(1);
    const finding = result.findings[0]!;
    const column = "second has one: ".length + 1;
    expect(finding.detector).toBe("aws_access_key_id");
    expect(finding.line).toBe(2);
    expect(finding.column).toBe(column);
    // Inline text is labelled <stdin>; the coordinates are what locate it.
    expect(finding.evidencePath).toBe(`<stdin>:2:${column}`);
  });
});
