import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanInputExposures, stagedScanExitCode } from "../src/scanner.js";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-scan-input-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Credential SHAPES are assembled at runtime, never written as a literal. A
// literal here is a finding in every scan of this repository — including the
// staged-scan commit gate that guards the commit adding this file.
function fakeStripeTestKey(): string {
  return ["sk", "test", "abcdefghij0123456789"].join("_");
}

function fakePackageRegistryToken(): string {
  return ["npm", "livevalueabcdefghijklmnopqrstuvwxyz"].join("_");
}

function runScan(args: string[], input?: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [join(rootDir, "src/index.ts"), "scan", ...args], {
    cwd: testDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input: input ?? "",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("scanInputExposures — library surface", () => {
  it("flags a credential shape in a supplied string", () => {
    const secret = fakeStripeTestKey();

    const result = scanInputExposures({ text: `stripe test key = ${secret}\n` });

    expect(result.schema).toBe("open-secrets.exposure-scan.v1");
    expect(result.source).toBe("input");
    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0].detector).toBe("stripe_secret_key");
    expect(result.findings[0].severity).toBe("high");
    expect(result.stats.bytesScanned).toBeGreaterThan(0);
    expect(result.stats.errors).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  // The negative arm. A scanner verified only in the detecting direction cannot
  // distinguish "clean" from "did not look", which is the defect this mode
  // exists to close rather than reproduce.
  it("returns no findings for a body that carries no credential", () => {
    const result = scanInputExposures({ text: "total 4\ndrwxr-xr-x 2 hasna hasna 4096 Aug 10 05:00 notes\n" });

    expect(result.source).toBe("input");
    expect(result.findingCount).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.stats.errors).toEqual([]);
    // Non-vacuous: it read the bytes and still found nothing.
    expect(result.stats.bytesScanned).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("never emits the matched value, only a redacted preview", () => {
    const secret = fakeStripeTestKey();

    const result = scanInputExposures({ text: `key=${secret}\n` });
    const serialized = JSON.stringify(result);

    expect(result.findingCount).toBe(1);
    expect(serialized).not.toContain(secret);
    expect(result.findings[0].preview).toContain("***REDACTED***");
  });

  it("reads a file when one is named", () => {
    const secret = fakePackageRegistryToken();
    const path = join(testDir, "captured-output.txt");
    writeFileSync(path, `//registry.npmjs.org/:_authToken=${secret}\n`);

    const result = scanInputExposures({ path });

    expect(result.source).toBe("input");
    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.detector === "package_registry_token")).toBe(true);
    expect(result.stats.filesScanned).toBe(1);
  });

  it("records an error rather than a clean result when the named file cannot be read", () => {
    const result = scanInputExposures({ path: join(testDir, "does-not-exist.txt") });

    expect(result.findingCount).toBe(0);
    expect(result.stats.errors.length).toBeGreaterThan(0);
    expect(result.stats.filesScanned).toBe(0);
  });

  it("skips and reports input larger than the byte bound instead of silently truncating", () => {
    const secret = fakeStripeTestKey();
    const text = `${"x".repeat(4096)}\nkey=${secret}\n`;

    const result = scanInputExposures({ text, maxBytes: 64 });

    expect(result.findingCount).toBe(0);
    expect(result.stats.skipped?.length ?? 0).toBeGreaterThan(0);
    expect(result.stats.skipped?.[0]?.reason).toBe("max_file_bytes");
  });

  it("finds a credential inside a printable run of binary input", () => {
    const secret = fakeStripeTestKey();
    const buffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]),
      Buffer.from(`token ${secret} end`, "utf8"),
      Buffer.from([0x00, 0x03, 0x04]),
    ]);

    const result = scanInputExposures({ buffer });

    expect(result.findingCount).toBe(1);
    expect(result.findings[0].detector).toBe("stripe_secret_key");
    expect(result.findings[0].binary).toBe(true);
  });
});

describe("secrets scan input — CLI gate", () => {
  it("exits 1 and reports the finding when stdin carries a credential", () => {
    const secret = fakeStripeTestKey();

    const result = runScan(["input", "--json"], `stripe config output\nkey = ${secret}\n`);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.source).toBe("input");
    expect(parsed.findingCount).toBe(1);
    expect(parsed.findings[0].detector).toBe("stripe_secret_key");
    // The gate's own output must not become the next copy of the leak.
    expect(result.stdout).not.toContain(secret);
  });

  it("exits 0 on clean stdin, having actually read it", () => {
    const result = runScan(["input", "--json"], "ordinary tool output with nothing sensitive\n");
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.source).toBe("input");
    expect(parsed.findingCount).toBe(0);
    expect(parsed.stats.bytesScanned).toBeGreaterThan(0);
    expect(parsed.stats.errors).toEqual([]);
  });

  it("exits 2 rather than 0 when the input could not be fully read", () => {
    const secret = fakeStripeTestKey();

    const result = runScan(["input", "--json", "--max-bytes", "16"], `padding padding padding\nkey=${secret}\n`);
    const parsed = JSON.parse(result.stdout);

    // 2 is a refusal, not a pass: "could not look" must never share an exit
    // code with "looked and found nothing".
    expect(result.exitCode).toBe(2);
    expect(parsed.findingCount).toBe(0);
    expect((parsed.stats.skipped ?? []).length).toBeGreaterThan(0);
  });

  it("scans a named file and accepts - as an explicit stdin path", () => {
    const secret = fakeStripeTestKey();
    const path = join(testDir, "capture.txt");
    writeFileSync(path, `key=${secret}\n`);

    const fromFile = runScan(["input", path, "--json"]);
    expect(fromFile.exitCode).toBe(1);
    expect(JSON.parse(fromFile.stdout).findingCount).toBe(1);

    const fromDash = runScan(["input", "-", "--json"], `key=${secret}\n`);
    expect(fromDash.exitCode).toBe(1);
    expect(JSON.parse(fromDash.stdout).findingCount).toBe(1);
  });

  // `stdin` and `text` are the two names measured returning a usage error while
  // the capability was missing. They resolve to this mode so that an agent
  // reaching for either gets the gate instead of a usage error.
  it("accepts stdin and text as aliases for input", () => {
    for (const alias of ["stdin", "text"]) {
      const result = runScan([alias, "--json"], "clean output\n");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).source).toBe("input");
    }
  });

  it("rejects an unsupported flag rather than scanning with it ignored", () => {
    const result = runScan(["input", "--subtree", "--json"], "clean output\n");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported option for secrets scan: --subtree");
    expect(result.stdout).toBe("");
  });

  // REVERSED DELIBERATELY. This assertion read `exitCode).toBe(0)` and was a
  // specified contract that contradicted the mode's own docstring, "2 means
  // could not look, never looked and it was clean". It is updated rather than
  // deleted so the reversal is visible in the diff.
  //
  // Zero bytes off stdin cannot be distinguished from a stdin that was never
  // connected — /dev/null, a closed descriptor and a dead producer all read as
  // a successful zero-byte read — so the gate refuses. filesScanned must be 0
  // here: the old result claimed one unit scanned while reading nothing, which
  // satisfied a caller sanity-checking filesScanned >= 1.
  it("exits 2 on empty stdin, and claims no scanned unit", () => {
    const result = runScan(["input", "--json"], "");
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(parsed.findingCount).toBe(0);
    expect(parsed.stats.bytesScanned).toBe(0);
    expect(parsed.stats.filesScanned).toBe(0);
    expect(parsed.stats.errors.length).toBeGreaterThan(0);
    expect(parsed.stats.errors[0]).toContain("0 bytes");
  });

  // The explicit `-` path resolves to the same stdin read and must refuse
  // identically; it was one of the three shapes measured returning 0.
  it("exits 2 on empty stdin given explicitly as -", () => {
    const result = runScan(["input", "-", "--json"], "");
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(2);
    expect(parsed.stats.filesScanned).toBe(0);
    expect(parsed.stats.bytesScanned).toBe(0);
  });

  // THE BOUNDARY, and it is the half that must NOT move. An empty FILE was
  // successfully opened, stat'd and read; we have positive evidence that a real
  // identified unit was examined and contained nothing. That is a true clean,
  // so it keeps exit 0 — and filesScanned 1 is accurate, because the unit is a
  // file that was read rather than a byte that was found. Staged mode counts an
  // empty blob the same way.
  it("exits 0 on a genuinely empty FILE, which was read and is truly clean", () => {
    const emptyPath = join(testDir, "empty.txt");
    writeFileSync(emptyPath, "");

    const result = runScan(["input", emptyPath, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.findingCount).toBe(0);
    expect(parsed.stats.bytesScanned).toBe(0);
    expect(parsed.stats.filesScanned).toBe(1);
    expect(parsed.stats.errors).toEqual([]);
  });

  // Same reasoning on the library surface: passing `text: ""` is the caller
  // affirmatively supplying a value, which the API distinguishes from supplying
  // nothing by the presence of the option. Not the indistinguishable case.
  it("exits 0 for inlined empty text and empty buffer on the library surface", () => {
    for (const options of [{ text: "" }, { buffer: Buffer.alloc(0) }]) {
      const result = scanInputExposures(options);

      expect(result.findingCount).toBe(0);
      expect(result.stats.bytesScanned).toBe(0);
      expect(result.stats.filesScanned).toBe(1);
      expect(result.stats.errors).toEqual([]);
      expect(stagedScanExitCode(result)).toBe(0);
    }
  });

  // Positive control on the refusal: the same mode still returns 0 on a clean
  // NON-empty stdin, so the 2 above is attributable to emptiness and not to the
  // gate having been broken into always refusing.
  it("still exits 0 on clean non-empty stdin, so the refusal is not blanket", () => {
    const result = runScan(["input", "--json"], "clean output\n");
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.stats.bytesScanned).toBeGreaterThan(0);
    expect(parsed.stats.filesScanned).toBe(1);
  });
});

// REGRESSION AGE10-00616 — "scan input takes N paths, scans ONLY THE FIRST,
// reports rc=0: argument order decides the verdict and nothing says a file was
// skipped". Measured on @hasna/secrets 0.3.7: `secrets scan input FILE1 FILE2`
// captured only the first positional in the CLI (`const [rawTarget = "workspace",
// root] = positional`) and handed it to a scanner that reads exactly one file, so
// FILE2 never appeared in the output at all — not in findings, not in stats, not
// in an error — and a clean-first ordering exited 0 with a credential-bearing
// second file unscanned. The contract pinned here: EVERY named path is scanned,
// findings carry the path they came from, and a path that could not be scanned
// is VISIBLE in the result and forces a non-clean verdict. Nothing is silently
// dropped.
describe("secrets scan input — every named path is scanned (AGE10-00616)", () => {
  it("finds a credential in the SECOND file when the first is clean", () => {
    const secret = fakeStripeTestKey();
    const cleanPath = join(testDir, "first-clean.txt");
    const dirtyPath = join(testDir, "second-dirty.txt");
    writeFileSync(cleanPath, "ordinary configuration text\n");
    writeFileSync(dirtyPath, `key=${secret}\n`);

    const result = runScan(["input", cleanPath, dirtyPath, "--json"]);
    const parsed = JSON.parse(result.stdout);

    // The bug's signature: clean-first ordered scans reported rc=0 with the
    // credential-bearing second file never scanned. Scanning every named path
    // must find it.
    expect(result.exitCode).toBe(1);
    expect(parsed.stats.filesScanned).toBe(2);
    expect(parsed.findingCount).toBe(1);
    expect(parsed.findings[0].detector).toBe("stripe_secret_key");
    expect(parsed.findings[0].path).toBe(dirtyPath);
  });

  it("reports per-file results with findings attributed to their own path", () => {
    const firstSecret = fakeStripeTestKey();
    const secondSecret = fakePackageRegistryToken();
    const firstPath = join(testDir, "first.txt");
    const secondPath = join(testDir, "second.txt");
    writeFileSync(firstPath, `stripe=${firstSecret}\n`);
    writeFileSync(secondPath, `npm=${secondSecret}\n`);

    const result = runScan(["input", firstPath, secondPath, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(parsed.stats.filesScanned).toBe(2);
    const detectors = new Set(parsed.findings.map((f) => f.detector));
    expect(detectors).toContain("stripe_secret_key");
    expect(detectors).toContain("package_registry_token");
    for (const finding of parsed.findings) {
      expect([firstPath, secondPath]).toContain(finding.path);
    }
  });

  it("never silently drops a path: an unscannable path is visible and blocks a clean verdict", () => {
    const cleanPath = join(testDir, "clean.txt");
    const missingPath = join(testDir, "does-not-exist.txt");
    writeFileSync(cleanPath, "ordinary text\n");

    const result = runScan(["input", cleanPath, missingPath, "--json"]);
    const parsed = JSON.parse(result.stdout);

    // The path that could not be scanned must be REPORTED (a skipped entry or
    // an error naming it) — never absent from the output as if the command had
    // not been given it. And a scan that did not look at everything must not
    // answer "clean".
    const mentionsMissing = [...(parsed.stats.skipped ?? []), ...(parsed.stats.errors ?? [])]
      .some((entry) =>
        typeof entry === "string" ? entry.includes(missingPath) : entry.path === missingPath
      );
    expect(mentionsMissing).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
