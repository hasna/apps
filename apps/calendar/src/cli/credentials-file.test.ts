/**
 * Canonical station credential pickup: `~/.hasna/calendar/config/credentials`.
 *
 * The station credential now lives at ~/.hasna/calendar/config/credentials
 * (0600, `HASNA_CALENDAR_API_URL=` then `HASNA_CALENDAR_API_KEY=` lines) and
 * the fleet env files are gone. A CLI started with NO credential environment
 * (env -i HOME USER PATH) must resolve BOTH the authority and the API key from
 * that file — the @hasna/contracts disk tier — and drive every read through
 * it, with no mode selector and no env fallback in between.
 *
 * Hermetic setup: a scratch HOME with the credentials file written in the
 * documented format, an HTTPS /v1 mock on loopback (self-signed cert minted
 * with openssl, trusted via NODE_EXTRA_CA_CERTS — the same pattern the PG TLS
 * boundary suite uses), and a child CLI spawned with an `env -i`-style
 * dictionary that contains ONLY HOME/USER/PATH plus the CA pointer. The mock
 * verifies the request carries the file's key, so a render where the resolver
 * skipped the file (or defaulted to the gateway) fails this test.
 *
 * Negative control: with the file absent, the same minimal env must fail
 * closed naming the missing configuration — never a silent local-store
 * default, never a local database created under the scratch home.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const FIXTURE_KEY = "credential-file-fixture-key";
const FIXTURE_ORGS = [
  { id: "org-cred-1", name: "File Resolved Org", slug: "file-resolved-org", created_at: "2026-09-07T00:00:00.000Z" },
];

interface SpawnResult { stdout: string; stderr: string; exitCode: number }

/**
 * Spawn the real CLI with an env -i-style environment: only the listed
 * variables are present — nothing else inherits from the test process, so no
 * API URL/key can leak in from the host machine.
 */
async function runCliIsolated(args: string[], env: Record<string, string>): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function mintCert(dir: string): Promise<{ cert: string; key: string }> {
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "2",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  return { cert, key };
}

async function writeCredentialsFile(home: string, url: string, key: string): Promise<void> {
  const dir = join(home, ".hasna", "calendar", "config");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "credentials"), `HASNA_CALENDAR_API_URL=${url}\nHASNA_CALENDAR_API_KEY=${key}\n`, { mode: 0o600 });
}

function isolatedEnv(home: string, certPath: string): Record<string, string> {
  return {
    HOME: home,
    USER: "calendar-test-fixture",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    NODE_EXTRA_CA_CERTS: certPath,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

test("env -i CLI resolves the authority AND key from ~/.hasna/calendar/config/credentials", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "calendar-credential-file-"));
  try {
    const { cert } = await mintCert(scratch);
    let seenKey: string | null = null;
    let seenUrl: string | null = null;
    const mock = Bun.serve({
      tls: { cert: await Bun.file(cert).text(), key: await Bun.file(join(scratch, "key.pem")).text() },
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        seenUrl = url.origin;
        seenKey = req.headers.get("x-api-key");
        if (req.method === "GET" && url.pathname === "/v1/orgs") {
          return Response.json({ orgs: FIXTURE_ORGS });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const base = `https://127.0.0.1:${mock.port}`;
    await writeCredentialsFile(scratch, base, FIXTURE_KEY);

    const result = await runCliIsolated(["--json", "org-list"], isolatedEnv(scratch, cert));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const orgs = JSON.parse(result.stdout) as Array<{ id: string; name: string }>;
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ id: "org-cred-1", name: "File Resolved Org" });
    // The request reached the URL written in the FILE, carrying the key from
    // the FILE — a resolver that skipped the file would have missed the mock.
    expect(seenUrl).toBe(base);
    expect(seenKey).toBe(FIXTURE_KEY);
    mock.stop(true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("env -i CLI without the credentials file fails closed and creates no local database", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "calendar-credential-file-"));
  try {
    const result = await runCliIsolated(["--json", "org-list"], isolatedEnv(scratch, join(scratch, "unused.pem")));

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { error: string };
    expect(payload.error).toContain("HASNA_CALENDAR_API_URL is required");
    // Fail closed — never a silent local-store fallback or a created db.
    const hasna = join(scratch, ".hasna");
    const exists = await Bun.file(hasna).stat().then(() => true, () => false);
    expect(exists).toBe(false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});