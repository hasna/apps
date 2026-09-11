import { describe, expect, test, afterAll } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const API_URL_ENV = "HASNA_INSTRUCTIONS_API_URL";
const API_KEY_ENV = "HASNA_INSTRUCTIONS_API_KEY";
const LOCAL_OPT_IN_ENV = "HASNA_INSTRUCTIONS_LOCAL";

/** Every name that can select a hosted transport or the local opt-in, for a scrub. */
const AUTHORITY_SCRUB = [
  API_URL_ENV,
  API_KEY_ENV,
  "INSTRUCTIONS_API_URL",
  "INSTRUCTIONS_API_KEY",
  "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE",
  "HASNA_INSTRUCTIONS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_INSTRUCTIONS_DB_PATH",
  "HASNA_CONFIGS_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
  LOCAL_OPT_IN_ENV,
];

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of AUTHORITY_SCRUB) {
    delete childEnv[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    childEnv[key] = value;
  }
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...childEnv,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

/**
 * A loopback `/v1` stub running as its OWN process (spawnSync in the test
 * would starve an in-process Bun.serve event loop — the CLI child could dial
 * but never get answered). The stub writes its bound port and every request
 * (path + x-api-key header) into files under the probe home.
 */
const STUB_SCRIPT = `
import { writeFileSync } from "node:fs";
const portFile = process.argv[2];
const logFile = process.argv[3];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    writeFileSync(logFile, JSON.stringify({ path: url.pathname, apiKey: req.headers.get("x-api-key") }) + "\\n", { flag: "a" });
    if (url.pathname === "/instructions/v1/configs") return Response.json({ configs: [] });
    if (url.pathname === "/instructions/v1/stats") return Response.json({ total: 0 });
    return new Response("nope", { status: 404 });
  },
});
writeFileSync(portFile, String(server.port));
setInterval(() => {}, 1000);
`;

async function startStub(home: string): Promise<{ stop: () => Promise<void>; portFile: string; logFile: string }> {
  const stubPath = join(home, "stub.ts");
  const portFile = join(home, "stub-port");
  const logFile = join(home, "stub-requests.log");
  writeFileSync(stubPath, STUB_SCRIPT);
  const proc = Bun.spawn(["bun", stubPath, portFile, logFile], { cwd: home });
  const deadline = Date.now() + 10_000;
  while (!existsSync(portFile) && Date.now() < deadline) {
    await Bun.sleep(25);
  }
  if (!existsSync(portFile)) {
    proc.kill();
    throw new Error("stub server did not publish its port");
  }
  return {
    portFile,
    logFile,
    stop: async () => {
      proc.kill();
      await proc.exited;
    },
  };
}

const stubs: { stop: () => Promise<void> }[] = [];
afterAll(async () => {
  await Promise.all(stubs.map((s) => s.stop()));
});

function writeCredentialsFile(home: string, port: number, mode: number): string {
  const credsDir = join(home, ".hasna", "instructions", "config");
  mkdirSync(credsDir, { recursive: true, mode: 0o700 });
  const credentialsPath = join(credsDir, "credentials");
  writeFileSync(
    credentialsPath,
    `HASNA_INSTRUCTIONS_API_URL=http://127.0.0.1:${port}/instructions\nHASNA_INSTRUCTIONS_API_KEY=from-file-key-123\n`,
    { mode: 0o600 },
  );
  if (mode !== 0o600) chmodSync(credentialsPath, mode);
  return credentialsPath;
}

/**
 * Credential-chain tier 4 (disk) resolution through the ONE shared resolver
 * (owner directive 2026-09-04 + station-credential adoption 2026-09-07).
 *
 * The canonical station credential lives at
 * `~/.hasna/<app>/config/credentials` with lines
 * `HASNA_INSTRUCTIONS_API_URL=...` / `HASNA_INSTRUCTIONS_API_KEY=...`
 * (owner-only 0400/0600). A CLI run with NO sourced env — nothing but HOME,
 * USER, and PATH — must resolve that file, dial the authority named in it, and
 * authenticate with the key written in it.
 *
 * Every probe is hermetic: a temporary HOME carries the credentials file, an
 * out-of-process loopback stub serves the `/v1` surface named in the file, and
 * the child env is scrubbed of every store/credential variable (including the
 * local opt-in, which the test-runner preload pins for the local-mode suite).
 */
describe("credentials file at ~/.hasna/instructions/config/credentials", () => {
  test("a clean env resolves URL and key from the file and dials the hosted API", async () => {
    const home = makeTempRoot("cred-file-");
    const stub = await startStub(home);
    stubs.push(stub);
    const port = Number(readFileSync(stub.portFile, "utf-8").trim());
    writeCredentialsFile(home, port, 0o600);

    const result = runCli(["list", "--json"], { HOME: home, USER: "tester" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("[]");
    // The run must have reached the API named in the FILE, never the local store.
    const requests = readFileSync(stub.logFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { path: string; apiKey: string | null });
    expect(requests.some((r) => r.path === "/instructions/v1/configs" && r.apiKey === "from-file-key-123")).toBe(true);
    // No local-mode notice: this was a hosted run resolved from disk.
    expect(result.stderr).not.toContain("local mode");
  });

  test("a non-owner-readable credentials file is refused, not silently ignored", async () => {
    const home = makeTempRoot("cred-file-unsafe-");
    const stub = await startStub(home);
    stubs.push(stub);
    const port = Number(readFileSync(stub.portFile, "utf-8").trim());
    writeCredentialsFile(home, port, 0o644);

    const result = runCli(["list"], { HOME: home, USER: "tester" });

    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("REMOTE_API_CREDENTIAL_INVALID");
    // Refused configurations never fall through to the local store.
    expect(result.stderr).not.toContain("local mode");
  });
});