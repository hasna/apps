import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanInputExposures } from "../src/scanner.js";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-scan-input-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("exits 0 with a zero byte count on empty stdin", () => {
    const result = runScan(["input", "--json"], "");
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.findingCount).toBe(0);
    expect(parsed.stats.bytesScanned).toBe(0);
  });
});
