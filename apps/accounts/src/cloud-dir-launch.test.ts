/**
 * A cloud-store profile whose recorded `dir` is another host's path must not
 * crash local launches with ENOENT — it must resolve to the LOCAL profile dir.
 *
 * WHY THIS TEST EXISTS
 * On macOS (station03, /Users/hasna) with HASNA_ACCOUNTS_API_URL +
 * HASNA_ACCOUNTS_API_KEY set, `accounts launch <profile> --tool claude -- -p
 * --output-format json "..."` exited rc=1 with:
 *
 *   node:fs mkdir ENOENT path
 *   '/home/hasna/.hasna/accounts/profiles/claude/<profile>/.hasna/accounts'
 *   at recordConfigsPrelaunchAudit
 *
 * The cloud store's profile record carries the dir of the machine that created
 * it (the Linux server's /home/hasna home). On a second machine that path is a
 * foreign string that does not exist locally, and every local file operation
 * under it — the prelaunch audit write, profile env (CLAUDE_CONFIG_DIR),
 * keychain prep — targets a directory that is not there. Todos
 * `fa4dcf4d-be25-42da-9ada-b999b976f4bf`.
 *
 * THE FIX UNDER TEST: the ApiStore resolves the LOCAL managed profile dir
 * (`<ACCOUNTS_HOME>/profiles/<tool>/<name>`) when the recorded dir is not a
 * path on this machine, so the prelaunch audit and the launched tool operate
 * on the local profile root instead of the foreign one.
 *
 * WHAT MUST NOT REGRESS, pinned here as much as the defect:
 *  - the audit record lands under the LOCAL account root, never the foreign one
 *  - the launched tool receives CLAUDE_CONFIG_DIR pointing at the LOCAL dir
 *  - the instruction-home governance gate still applies: an ungoverned local
 *    home still refuses the launch
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStore } from "./lib/store.js";
import { getTool } from "./lib/tools.js";
import { readConfigsPrelaunchAudit } from "./lib/configs-prelaunch-status.js";

/**
 * The Linux server home that created the cloud records. Deliberately NOT the
 * local home — on macOS this is `/home/hasna` while the local box is
 * `/Users/hasna`; the test must reproduce the cross-host mismatch even when it
 * runs on a Linux box, so the foreign path is pinned to a sibling home tree
 * that must not exist here.
 */
const FOREIGN_ACCOUNTS_HOME = "/home/hasna/.hasna/accounts";
// Synthetic fixture value, same shape as src/store.test.ts's KEY. The resolver
// only requires the key to be present to select ApiStore; the value is never a
// real credential and only ever lands in a spawned test CLI's environment.
const KEY = "hasna_accounts_testkey_0000";

const repo = process.cwd();
const cli = join(repo, "src", "cli.ts");

let home: string;
let binDir: string;
let claudeLog: string;
let portFile: string;
/** The child process serving the fake accounts API. */
let serverProc: ChildProcess | undefined;
let previousUrl: string | undefined;
let previousKey: string | undefined;

const PROFILE_NAME = "cloud-probe";

function cloudProfileBody(name: string = PROFILE_NAME) {
  return {
    tool: "claude",
    name,
    dir: `${FOREIGN_ACCOUNTS_HOME}/profiles/claude/${name}`,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** The local managed dir this machine uses for a claude profile named `name`. */
function localManagedDir(name: string = PROFILE_NAME): string {
  return join(home, "profiles", "claude", name);
}

/**
 * Seed a governed local home for the profile: per-source instruction files,
 * the session render manifest, and the tool's index file. Without this the
 * governance gate refuses the launch on purpose — which is the correct
 * behaviour and is pinned by the third WHAT MUST NOT REGRESS clause.
 */
function seedGovernedLocalHome(name: string = PROFILE_NAME): string {
  const dir = localManagedDir(name);
  mkdirSync(join(dir, ".hasna", "instructions"), { recursive: true });
  writeFileSync(join(dir, ".hasna", "instructions", "01-hasna-agent-operating-rules.md"), "# rules\n");
  writeFileSync(join(dir, "CLAUDE.md"), "# governed\n");
  writeFileSync(
    join(dir, ".hasna", "session-render-manifest.json"),
    JSON.stringify({
      schema: "hasna.configs.session-render/v1",
      tool: "claude",
      profile: name,
      targetHome: dir,
      generatedAt: new Date().toISOString(),
      sources: [{ id: "hasna-agent-operating-rules", layer: "global" }],
      files: [],
      warnings: [],
    }) + "\n",
  );
  return dir;
}

function writeExecutable(name: string, source: string): string {
  const script = join(binDir, `fake-${name}.ts`);
  writeFileSync(script, source);
  const wrapper = join(binDir, name);
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" run "${script}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

const fakeClaudeSource = `
import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  configDir: process.env.CLAUDE_CONFIG_DIR,
}) + "\\n");
console.log("fake-claude-stdout");
process.exit(0);
`;

/** The stub accounts-serve API, run in its OWN process so it can answer the
 * spawned CLI's HTTP calls while the test process blocks on spawnSync. */
const serverSource = (foreignHome: string, profileName: string, portFile: string) => `
import { writeFileSync } from "node:fs";
const FOREIGN = ${JSON.stringify(foreignHome)};
const PROFILE = ${JSON.stringify(profileName)};
const profileBody = (name) => ({
  tool: "claude",
  name,
  dir: FOREIGN + "/profiles/claude/" + name,
  createdAt: "2026-01-01T00:00:00Z",
});
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/v1/tools") return Response.json({ tools: [] });
    if (path === "/v1/accounts" && request.method === "GET") {
      return Response.json({ accounts: [profileBody(PROFILE)] });
    }
    const accountMatch = path.match(/^\\/v1\\/accounts\\/([^/]+)\\/([^/]+)$/);
    if (accountMatch && request.method === "GET") {
      return Response.json(profileBody(accountMatch[2]));
    }
    if (path === "/v1/current/claude" && request.method === "PUT") {
      return Response.json({ tool: "claude", name: PROFILE, updatedAt: new Date().toISOString() });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});
writeFileSync(${JSON.stringify(portFile)}, String(server.port) + "\\n");
process.on("SIGTERM", () => process.exit(0));
`;

function startApiServer(): string {
  portFile = join(home, "server.port");
  const serverScript = join(home, "server.ts");
  writeFileSync(serverScript, serverSource(FOREIGN_ACCOUNTS_HOME, PROFILE_NAME, portFile));
  serverProc = spawn(process.execPath, ["run", serverScript], { stdio: "ignore" });
  const deadline = Date.now() + 10_000;
  while (!existsSync(portFile)) {
    if (Date.now() > deadline) throw new Error("accounts test API server did not start");
    // Busy-wait briefly; the server process is independent so this cannot block it.
    Bun.sleepSync(10);
  }
  const port = Number(readFileSync(portFile, "utf8").trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error(`accounts test API server reported bad port ${port}`);
  return `http://127.0.0.1:${port}`;
}

function baseEnv(apiUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_ENV: "test",
    ACCOUNTS_HOME: home,
    HASNA_ACCOUNTS_API_URL: apiUrl,
    HASNA_ACCOUNTS_API_KEY: KEY,
    FAKE_CLAUDE_LOG: claudeLog,
    ACCOUNTS_TEST_KEYCHAIN_LOCK_PATH: join(home, "keychain.lock"),
    ...extra,
  };
  const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  env[process.platform === "win32" ? "Path" : "PATH"] = `${binDir}${process.platform === "win32" ? ";" : ":"}${inheritedPath}`;
  return env;
}

function runCli(apiUrl: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["run", cli, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 60_000,
    env: baseEnv(apiUrl, extraEnv),
  });
}

function claudeEntries() {
  if (!existsSync(claudeLog)) return [];
  return readFileSync(claudeLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "accounts-cloud-dir-"));
  binDir = mkdtempSync(join(tmpdir(), "accounts-cloud-dir-bin-"));
  claudeLog = join(home, "fake-claude.jsonl");
  writeExecutable("claude", fakeClaudeSource);
  previousUrl = process.env.HASNA_ACCOUNTS_API_URL;
  previousKey = process.env.HASNA_ACCOUNTS_API_KEY;
  process.env.HASNA_ACCOUNTS_API_URL = "http://127.0.0.1:9"; // real value replaced per-test via startApiServer
  process.env.HASNA_ACCOUNTS_API_KEY = KEY;
  process.env.ACCOUNTS_HOME = home;
  delete process.env.ACCOUNTS_STORE_PATH;
});

afterEach(() => {
  serverProc?.kill("SIGTERM");
  serverProc = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
  delete process.env.ACCOUNTS_HOME;
  if (previousUrl === undefined) delete process.env.HASNA_ACCOUNTS_API_URL;
  else process.env.HASNA_ACCOUNTS_API_URL = previousUrl;
  if (previousKey === undefined) delete process.env.HASNA_ACCOUNTS_API_KEY;
  else process.env.HASNA_ACCOUNTS_API_KEY = previousKey;
});

describe("cloud-profile dir resolution for local launches", () => {
  test("ApiStore returns the LOCAL managed dir for a profile recorded on another host", async () => {
    const apiUrl = startApiServer();
    process.env.HASNA_ACCOUNTS_API_URL = apiUrl;

    const store = resolveStore(process.env);
    const profile = await store.getProfile(PROFILE_NAME, "claude");
    expect(profile.dir).toBe(localManagedDir(PROFILE_NAME));
    expect(profile.dir).not.toContain(FOREIGN_ACCOUNTS_HOME);
    // The foreign path must not have been created by the read itself.
    expect(existsSync(`${FOREIGN_ACCOUNTS_HOME}/profiles/claude/${PROFILE_NAME}`)).toBe(false);
  });

  test("a launch through the CLI writes the prelaunch audit under the LOCAL root, not the foreign host path", () => {
    const apiUrl = startApiServer();
    const localDir = seedGovernedLocalHome();

    const result = runCli(apiUrl, [
      "launch", PROFILE_NAME, "--tool", "claude", "--", "-p", "--output-format", "json", "Say OK",
    ]);

    // Before the fix this exits 1 with the ENOENT stack from
    // recordConfigsPrelaunchAudit trying to mkdir under /home/hasna/...
    expect(result.status, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain("fake-claude-stdout");

    // The audit landed in the LOCAL profile root.
    const audit = readConfigsPrelaunchAudit(
      { name: PROFILE_NAME, tool: "claude", dir: localDir, createdAt: "2026-01-01T00:00:00Z" },
      getTool("claude"),
    );
    expect(audit).toBeDefined();
    expect(audit?.profile).toBe(PROFILE_NAME);
    expect(existsSync(join(localDir, ".hasna", "accounts", "prelaunch-status.json"))).toBe(true);

    // The launched tool received CLAUDE_CONFIG_DIR pointing at the LOCAL dir.
    const entries = claudeEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.configDir).toBe(localDir);
    expect(entries[0]?.args).toEqual(["-p", "--output-format", "json", "Say OK"]);
  });

  test("the governance gate still refuses an ungoverned local home", () => {
    const apiUrl = startApiServer();
    // Seed only an empty local dir — no instructions, no manifest, no index.
    const localDir = localManagedDir(PROFILE_NAME);
    mkdirSync(localDir, { recursive: true });

    const result = runCli(apiUrl, [
      "launch", PROFILE_NAME, "--tool", "claude", "--", "-p", "Say OK",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to launch");
    expect(result.stderr).toContain("no operating rules");
    expect(existsSync(join(localDir, ".hasna", "accounts", "prelaunch-status.json"))).toBe(true);
    expect(claudeEntries()).toEqual([]);
  });
});