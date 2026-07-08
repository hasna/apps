import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

async function seedDomainDb(count: number): Promise<{ dbPath: string; dir: string; firstDomainId: string }> {
  const dir = mkdtempSync(join(tmpdir(), "domains-cli-compact-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "domains.db");
  process.env["DOMAINS_DB_PATH"] = dbPath;

  const { closeDatabase } = await import("../db/database.js");
  closeDatabase();
  const { createDnsRecord, createDomain } = await import("../db/domains.js");
  let firstDomainId = "";

  for (let i = 0; i < count; i += 1) {
    const domain = await createDomain({
      name: `compact-${String(i).padStart(2, "0")}.example`,
      registrar: "Example Registrar",
      expires_at: `2030-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      notes: `very long note ${i} ${"x".repeat(140)}`,
    });
    if (i === 0) firstDomainId = domain.id;
  }

  for (let i = 0; i < count; i += 1) {
    await createDnsRecord({
      domain_id: firstDomainId,
      type: "TXT",
      name: `record-${String(i).padStart(2, "0")}`,
      value: `long txt value ${i} ${"v".repeat(140)}`,
    });
  }

  closeDatabase();
  return { dbPath, dir, firstDomainId };
}

function runDomains(args: string[], dbPath: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DOMAINS_DB_PATH: dbPath, NO_COLOR: "1" },
  });
}

afterEach(async () => {
  const { closeDatabase } = await import("../db/database.js");
  closeDatabase();
  delete process.env["DOMAINS_DB_PATH"];

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("compact CLI output", () => {
  test("domain list is compact by default and keeps JSON full", async () => {
    const { dbPath, firstDomainId } = await seedDomainDb(25);

    const compact = runDomains(["domain", "list"], dbPath);
    const compactStdout = text(compact.stdout);
    expect(compact.exitCode).toBe(0);
    expect(compactStdout).toContain("Showing 20/25 domain(s)");
    expect(compactStdout).toContain("use --limit 20 --offset 20");
    expect(compactStdout).toContain("Use --verbose");
    expect(compactStdout).not.toContain("very long note 0");

    const verbose = runDomains(["domain", "list", "--limit", "1", "--verbose"], dbPath);
    const verboseStdout = text(verbose.stdout);
    expect(verbose.exitCode).toBe(0);
    expect(verboseStdout).toContain("notes:very long note");
    expect(verboseStdout).not.toContain("x".repeat(120));

    const json = runDomains(["domain", "list", "--json"], dbPath);
    expect(json.exitCode).toBe(0);
    const body = JSON.parse(text(json.stdout)) as { count: number; limit: number | null; domains: Array<{ notes: string | null }> };
    expect(body.count).toBe(25);
    expect(body.limit).toBeNull();
    expect(body.domains).toHaveLength(25);
    expect(body.domains[0]!.notes).toContain("x".repeat(120));

    const dns = runDomains(["dns", "list", firstDomainId], dbPath);
    const dnsStdout = text(dns.stdout);
    expect(dns.exitCode).toBe(0);
    expect(dnsStdout).toContain("Showing 20/25 record(s)");
    expect(dnsStdout).toContain("use --limit 25 or --all for more");
    expect(dnsStdout).not.toContain("--offset");

    const invalid = runDomains(["domain", "expiring", "--limit", "nope"], dbPath);
    const invalidStderr = text(invalid.stderr);
    expect(invalid.exitCode).toBe(1);
    expect(invalidStderr).toContain("--limit must be a non-negative integer");
    expect(invalidStderr).not.toContain("compact-output.ts");
  });
});
