// Live end-to-end proof that the seven `emails domain warm*` commands actually
// work. Every one of them used to be an unconditional `throw` claiming warming
// "is not available in the self-hosted client; it runs on the self-hosted
// server" — a refusal that fired in EVERY configuration even though the warming
// repository (src/db/warming.ts), the `warming_schedules` table, and the
// /v1/warming routes all existed.
//
// These tests therefore spawn the CLI as a real subprocess (bun src/cli/index.tsx,
// the same entrypoint `bun run dev:cli` and every other live CLI test uses)
// rather than registering the commands in-process: the bug class was "the source
// looks fine, invoking the command refuses", so invoking the command is what gets
// asserted on. No live provider or cloud credential is used — the env is scrubbed
// and an authenticated loopback API owns an explicit in-memory store. Separate
// CLI processes share that service, never a client database or an implicit fallback.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "../../lib/client-settings.js";
import type { ListMessagesOptions } from "../../store/records.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";

// Anything that could point the process at a real endpoint or account.
const SCRUBBED_ENV_KEYS = [
  "EMAILS_MODE", "HASNA_EMAILS_MODE", "EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH",
  "EMAILS_SELF_HOSTED_URL", "EMAILS_SELF_HOSTED_API_KEY", "EMAILS_SESSION_TOKEN",
  "EMAILS_CLIENT_ENV_SECRET", "EMAILS_DATABASE_URL", "HASNA_EMAILS_DATABASE_URL",
  "EMAILS_STORAGE_MODE", "HASNA_EMAILS_STORAGE_MODE",
  "MAILERY_MODE", "HASNA_MAILERY_MODE", "MAILERY_STORAGE_MODE", "HASNA_MAILERY_STORAGE_MODE",
  "MAILERY_API_URL", "MAILERY_API_KEY", "HASNA_MAILERY_API_URL", "HASNA_MAILERY_API_KEY",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "RESEND_API_KEY",
] as const;

const SCRUBBED_ENV_PREFIXES = ["EMAILS_", "HASNA_EMAILS_", "MAILERY_", "HASNA_MAILERY_"] as const;
let inheritedEnv: NodeJS.ProcessEnv;
let fixtureRoot: string;
let stateRoots: string[];
let store: ReturnType<typeof createSqliteEmailStore>;
let api: V1StoreApi;
let warmingReads: number;
let warmingWrites: number;
let messageQueries: ListMessagesOptions[];
const children = new Set<{ kill(signal?: "SIGKILL"): void; exited: Promise<number> }>();

function scrubClientSettings(base: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(base)) {
    if (SCRUBBED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) delete base[key];
  }
  for (const key of SCRUBBED_ENV_KEYS) delete base[key];
  for (const key of CLIENT_DATABASE_SETTINGS) delete base[key];
}

/** Only fixture-owned state paths and synthetic API configuration cross the boundary. */
function canonicalWarmingEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
    "XDG_STATE_HOME", "TMPDIR", "BUN_RUNTIME_TRANSPILER_CACHE_PATH"]) env[key] = process.env[key];
  scrubClientSettings(env);
  return { ...env, HASNA_EMAILS_HOME: process.env.HASNA_EMAILS_HOME, NO_COLOR: "1",
    AWS_EC2_METADATA_DISABLED: "true", [EMAILS_API_URL_ENV]: api.baseUrl, [EMAILS_API_KEY_ENV]: api.apiKey };
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runProcess(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000): Promise<CliRun> {
  // Async children let the parent answer HTTP. Use the pinned test executable.
  const child = Bun.spawn({
    cmd: [process.execPath, "--no-env-file", "--no-install", ...args],
    cwd: process.cwd(),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  children.add(child);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (timedOut) throw new Error("CLI fixture child exceeded its deadline");
    return { exitCode, stdout, stderr };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timer);
    children.delete(child);
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  const result = await runProcess(["src/cli/index.tsx", ...args], env);
  for (const key of [api.apiKey, env[EMAILS_API_KEY_ENV]].map(value => value?.trim()).filter((value): value is string => Boolean(value))) {
    expect(result.stdout).not.toContain(key);
    expect(result.stderr).not.toContain(key);
  }
  return result;
}

async function runJson<T>(args: string[], env: NodeJS.ProcessEnv): Promise<T> {
  const result = await runCli(["--json", ...args], env);
  return parseJsonSuccess<T>(result, args);
}

function parseJsonSuccess<T>(result: CliRun, args: string[]): T {
  expect(result.exitCode, `${args.join(" ")} failed: ${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as T;
}

interface CliError { error: { message: string; code: string; fix_commands: string[] } }

async function runJsonError(args: string[], env: NodeJS.ProcessEnv): Promise<CliError> {
  const result = await runCli(["--json", ...args], env);
  expect(result.exitCode, `${args.join(" ")} unexpectedly succeeded: ${result.stdout}`).toBe(1);
  expect(result.stdout).toBe("");
  return JSON.parse(result.stderr) as CliError;
}

interface WarmingSchedulePayload {
  id: string;
  domain: string;
  provider_id: string | null;
  target_daily_volume: number;
  start_date: string;
  status: "active" | "paused" | "completed";
}

interface WarmStatusPayload {
  schedule: WarmingSchedulePayload;
  current_day: number;
  total_days: number;
  progress_percent: number;
  today_limit: number | null;
  today_sent: number;
}

// The exact refusal these commands used to emit. It was false in BOTH
// directions (local and self-hosted), so no warming surface may reproduce it.
const RETIRED_REFUSALS = [
  "not available in the self-hosted client",
  "it runs on the self-hosted server",
];

function expectNoRetiredRefusal(text: string): void {
  for (const phrase of RETIRED_REFUSALS) expect(text).not.toContain(phrase);
}

/** N days before today's UTC calendar date — the calendar the ramp is anchored on. */
function utcDaysAgo(count: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function assertClientStateEmpty(): void {
  for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
}

beforeEach(() => {
  inheritedEnv = { ...process.env };
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-warming-"));
  scrubClientSettings(process.env);
  for (const key of ["HASNA_HOME", "HASNA_DATA_HOME", "CODEWITH_HOME"]) delete process.env[key];
  stateRoots = Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" }).map(([key, name]) => {
    const path = join(fixtureRoot, name);
    mkdirSync(path, { mode: 0o700 });
    process.env[key] = path;
    return path;
  });
  process.env.TMPDIR = join(fixtureRoot, "tmp");
  process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(fixtureRoot, "compiler");
  mkdirSync(process.env.TMPDIR, { mode: 0o700 });
  mkdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH, { mode: 0o700 });
  closeDatabase();
  store = createSqliteEmailStore({ database: getDatabase(":memory:") });
  warmingReads = warmingWrites = 0;
  messageQueries = [];
  api = startV1StoreApi({ store: { ...store, warming: { ...store.warming,
    async list(options) { warmingReads++; return store.warming.list(options); },
    async get(id) { warmingReads++; return store.warming.get(id); },
    async create(input) { warmingWrites++; return store.warming.create(input); },
    async update(id, patch) { warmingWrites++; return store.warming.update(id, patch); },
    async remove(id) { warmingWrites++; return store.warming.remove(id); },
  }, messages: { ...store.messages,
    async listMessages(options) { messageQueries.push({ ...options }); return store.messages.listMessages(options); },
  } } });
});

afterEach(async () => {
  try {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all([...children].map(child => child.exited));
    children.clear();
    assertClientStateEmpty();
  } finally {
    api?.stop();
    closeDatabase();
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(inheritedEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, inheritedEnv);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("emails domain warm* (real CLI, authenticated loopback store)", () => {
  it("drives the whole schedule lifecycle: warm -> status -> list -> pause -> resume -> complete", async () => {
    const env = canonicalWarmingEnv();
    // Started 6 days ago so the ramp is mid-flight and the day/limit math is
    // observable rather than always "day 1, limit 50".
    const startDate = utcDaysAgo(6);

    // 1. warm — creates the schedule and reports the plan.
    const created = (await runJson<WarmStatusPayload & { plan_days: number; final_day: number }>(
      ["domain", "warm", "ramp.example.com", "--target", "5000", "--start-date", startDate],
      env,
    ));
    expect(created.schedule).toMatchObject({
      domain: "ramp.example.com",
      target_daily_volume: 5000,
      start_date: startDate,
      status: "active",
      provider_id: null,
    });
    expect(created.schedule.id).toBeTruthy();
    // Exact, in every timezone: the ramp is anchored on the UTC calendar date,
    // the same anchor the self-hosted server enforces the cap with.
    expect(created.current_day).toBe(7);
    expect(created.total_days).toBe(15);
    expect(created.final_day).toBe(15);
    expect(created.progress_percent).toBe(47);
    // Day 7 of a 5000/day ramp: 50 -> 100 -> 200 -> 400.
    expect(created.today_limit).toBe(400);
    expect(created.today_sent).toBe(0);

    // 2. warm-status — reflects the schedule `warm` just created.
    const status = (await runJson<WarmStatusPayload>(["domain", "warm-status", "ramp.example.com"], env));
    expect(status.schedule).toMatchObject({
      id: created.schedule.id,
      domain: "ramp.example.com",
      status: "active",
      target_daily_volume: 5000,
    });
    expect(status.current_day).toBe(created.current_day);
    expect(status.today_limit).toBe(created.today_limit);

    // 3. warm-list — the schedule shows up, in JSON and in the human table.
    const listed = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env));
    expect(listed.map((row) => row.domain)).toEqual(["ramp.example.com"]);

    const table = (await runCli(["domain", "warm-list"], env));
    expect(table.exitCode, table.stderr).toBe(0);
    expect(table.stdout).toContain("ramp.example.com");
    expect(table.stdout).toContain("active");
    expect(table.stdout).toContain(String(created.today_limit));
    expect(table.stdout).toContain("Showing 1 warming schedule");

    // A second domain proves listing and --status filtering are not single-row luck.
    (await runJson(["domain", "warm", "second.example.com", "--target", "300"], env));
    const both = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env));
    // Newest-first, like every other list command.
    expect(both.map((row) => row.domain)).toEqual(["second.example.com", "ramp.example.com"]);

    // --limit/--offset must survive the collapsed family's dual argument orders
    // (the published surface admits both (status, opts) and (status, store, opts)),
    // so a dropped options argument here would silently return the whole table.
    const firstPage = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list", "--limit", "1"], env));
    expect(firstPage.map((row) => row.domain)).toEqual(["second.example.com"]);
    const secondPage = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list", "--limit", "1", "--offset", "1"], env));
    expect(secondPage.map((row) => row.domain)).toEqual(["ramp.example.com"]);

    // 4. warm-pause — status transitions and the daily cap disappears.
    const paused = (await runJson<WarmingSchedulePayload>(["domain", "warm-pause", "ramp.example.com"], env));
    expect(paused).toMatchObject({ domain: "ramp.example.com", status: "paused" });
    const pausedStatus = (await runJson<WarmStatusPayload>(["domain", "warm-status", "ramp.example.com"], env));
    expect(pausedStatus.schedule.status).toBe("paused");
    // A paused schedule imposes no limit (send.local.ts keys off exactly this).
    expect(pausedStatus.today_limit).toBeNull();

    const pausedOnly = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list", "--status", "paused"], env));
    expect(pausedOnly.map((row) => row.domain)).toEqual(["ramp.example.com"]);
    const activeOnly = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list", "--status", "active"], env));
    expect(activeOnly.map((row) => row.domain)).toEqual(["second.example.com"]);

    // 5. warm-resume — back to active, and the mid-ramp cap comes back.
    const resumed = (await runJson<WarmingSchedulePayload>(["domain", "warm-resume", "ramp.example.com"], env));
    expect(resumed).toMatchObject({ domain: "ramp.example.com", status: "active" });
    const resumedStatus = (await runJson<WarmStatusPayload>(["domain", "warm-status", "ramp.example.com"], env));
    expect(resumedStatus.schedule.status).toBe("active");
    expect(resumedStatus.today_limit).toBe(created.today_limit);

    // 6. warm-complete — graduated; no warming cap applies any more.
    const completed = (await runJson<WarmingSchedulePayload>(["domain", "warm-complete", "ramp.example.com"], env));
    expect(completed).toMatchObject({ domain: "ramp.example.com", status: "completed" });
    const completedStatus = (await runJson<WarmStatusPayload>(["domain", "warm-status", "ramp.example.com"], env));
    expect(completedStatus.schedule.status).toBe("completed");
    expect(completedStatus.today_limit).toBeNull();

    // The state survived every separate CLI process in the service-owned store.
    const finalRows = (await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env));
    expect(finalRows.map((row) => [row.domain, row.status]).sort()).toEqual([
      ["ramp.example.com", "completed"],
      ["second.example.com", "active"],
    ]);

    // 7. warm-delete — the only way to retarget a domain, so `warm` works again after it.
    const deleted = (await runJson<{ deleted: boolean; schedule: WarmingSchedulePayload }>(
      ["domain", "warm-delete", "ramp.example.com", "--yes"],
      env,
    ));
    expect(deleted).toMatchObject({ deleted: true, schedule: { domain: "ramp.example.com" } });
    expect((await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env)).map((row) => row.domain))
      .toEqual(["second.example.com"]);

    const retargeted = (await runJson<WarmStatusPayload>(
      ["domain", "warm", "ramp.example.com", "--target", "900"],
      env,
    ));
    expect(retargeted.schedule).toMatchObject({ target_daily_volume: 900, status: "active" });
    // A brand-new ramp, not the old one resurrected.
    expect(retargeted.schedule.id).not.toBe(created.schedule.id);
    expect(retargeted.current_day).toBe(1);
    expect(retargeted.today_limit).toBe(50);
  }, 180_000);

  it("refuses to silently create a duplicate schedule for the same domain", async () => {
    const env = canonicalWarmingEnv();
    (await runJson(["domain", "warm", "dup.example.com", "--target", "100"], env));

    const failure = (await runJsonError(["domain", "warm", "dup.example.com", "--target", "999"], env));
    expect(failure.error.message).toContain("already has a warming schedule");
    // Every recovery path it names must exist as a real command.
    expect(failure.error.message).toContain("emails domain warm-status dup.example.com");
    expect(failure.error.message).toContain("emails domain warm-delete dup.example.com");
    expectNoRetiredRefusal(failure.error.message);

    // The original schedule is untouched and there is still exactly one.
    const status = (await runJson<WarmStatusPayload>(["domain", "warm-status", "dup.example.com"], env));
    expect(status.schedule.target_daily_volume).toBe(100);
    expect((await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env))).toHaveLength(1);
  }, 90_000);

  it("fails loud (and truthfully) when the domain has no schedule", async () => {
    const env = canonicalWarmingEnv();

    for (const command of ["warm-status", "warm-pause", "warm-resume", "warm-complete", "warm-delete"]) {
      const failure = (await runJsonError(["domain", command, "ghost.example.com"], env));
      expect(failure.error.code).toBe("not_found");
      expect(failure.error.message).toContain("Warming schedule not found for domain: ghost.example.com");
      expect(failure.error.message).toContain("emails domain warm ghost.example.com --target");
      expect(failure.error.fix_commands).toContain("emails domain warm-list --json");
      expectNoRetiredRefusal(failure.error.message);
    }

    // An empty store is a valid answer for a list, not an error.
    const empty = (await runCli(["--json", "domain", "warm-list"], env));
    expect(empty.exitCode, empty.stderr).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual([]);
  }, 90_000);

  it("validates --target, --start-date, and --status instead of storing junk", async () => {
    const env = canonicalWarmingEnv();

    const badTarget = (await runJsonError(["domain", "warm", "bad.example.com", "--target", "not-a-number"], env));
    expect(badTarget.error.message).toContain("Invalid --target");

    const zeroTarget = (await runJsonError(["domain", "warm", "bad.example.com", "--target", "0"], env));
    expect(zeroTarget.error.message).toContain("Invalid --target");

    const badDate = (await runJsonError(
      ["domain", "warm", "bad.example.com", "--target", "100", "--start-date", "07/20/2026"],
      env,
    ));
    expect(badDate.error.message).toContain("Invalid --start-date");

    const badStatus = (await runJsonError(["domain", "warm-list", "--status", "warming"], env));
    expect(badStatus.error.message).toContain("Invalid --status");

    // None of the rejected inputs created a row.
    expect((await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env))).toEqual([]);
  }, 90_000);

  it("advertises the warming commands in --help and never repeats the retired refusal", async () => {
    const env = canonicalWarmingEnv();
    const help = (await runCli(["domain", "--help"], env));
    expect(help.exitCode, help.stderr).toBe(0);
    for (const command of ["warm ", "warm-status", "warm-list", "warm-pause", "warm-resume", "warm-complete", "warm-delete"]) {
      expect(help.stdout).toContain(command);
    }

    // Every warming surface, success or failure, stdout or stderr.
    const invocations = [
      ["domain", "warm", "truth.example.com", "--target", "100"],
      ["domain", "warm-status", "truth.example.com"],
      ["domain", "warm-list"],
      ["domain", "warm-pause", "truth.example.com"],
      ["domain", "warm-resume", "truth.example.com"],
      ["domain", "warm-complete", "truth.example.com"],
      ["domain", "warm-delete", "truth.example.com", "--yes"],
    ];
    for (const args of invocations) {
      const result = (await runCli(args, env));
      expect(result.exitCode, `${args.join(" ")}: ${result.stderr}`).toBe(0);
      expectNoRetiredRefusal(`${result.stdout}\n${result.stderr}`);
    }
  }, 120_000);
});

describe("warming CLI fixture transport and isolation controls", () => {
  it("counts only today's outbound rows for the requested domain through the real HTTP ledger", async () => {
    const env = canonicalWarmingEnv();
    const created = await runJson<WarmStatusPayload>(
      ["domain", "warm", "counts.example.com", "--target", "5000", "--start-date", utcDaysAgo(6)], env,
    );
    expect(created.today_sent).toBe(0);
    const today = utcDaysAgo(0);
    const tomorrow = utcDaysAgo(-1);
    for (const [direction, domain, day] of [
      ["outbound", "counts.example.com", today],
      ["outbound", "COUNTS.EXAMPLE.COM", today],
      ["inbound", "counts.example.com", today],
      ["outbound", "sibling.example.com", today],
      ["outbound", "counts.example.com", utcDaysAgo(1)],
      ["outbound", "counts.example.com", tomorrow],
    ] as const) {
      const result = await store.messages.createMessage({ direction, from_addr: `sender@${domain}`,
        to_addrs: ["recipient@example.test"], subject: "Synthetic warming count sentinel",
        status: direction === "inbound" ? "received" : "sent", received_at: `${day}T00:00:01.000Z` });
      expect(result.ok).toBe(true);
    }
    messageQueries = [];
    const writesBefore = warmingWrites;
    const requestsBefore = api.requestCount();
    const status = await runJson<WarmStatusPayload>(["domain", "warm-status", "counts.example.com"], env);
    expect(status.schedule.id).toBe(created.schedule.id);
    expect(status.today_sent).toBe(2);
    expect(status.today_limit).toBe(400);
    expect(messageQueries).toHaveLength(1);
    // The ledger pushes down direction only, then applies its UTC window over
    // the complete stream. Yesterday/tomorrow rows above prove that filtering.
    expect(messageQueries[0]).toMatchObject({ direction: "outbound" });
    expect(messageQueries[0]?.since).toBeUndefined();
    const listed = await runJson<WarmingSchedulePayload[]>(["domain", "warm-list"], env);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject(created.schedule);
    expect(messageQueries).toHaveLength(2); // warm-list uses one batched ledger read.
    // JSON is the schedule array; the human table carries the derived counts.
    const table = await runCli(["domain", "warm-list"], env);
    expect(table.exitCode).toBe(0);
    expect(table.stderr).toBe("");
    expect(table.stdout).toContain("Sent Today");
    expect(table.stdout.split("\n").find(line => line.startsWith("counts.example.com"))).toMatch(/\s2\s*$/);
    expect(messageQueries).toHaveLength(3);
    expect(warmingWrites).toBe(writesBefore);
    expect(warmingReads).toBeGreaterThan(0);
    expect(api.requestCount()).toBeGreaterThan(requestsBefore);
  }, 120_000);

  it("wrong or missing credentials and client database settings cannot read, mutate or fall back", async () => {
    const env = canonicalWarmingEnv();
    const created = await runJson<WarmStatusPayload>(["domain", "warm", "guard.example.com", "--target", "100"], env);
    const before = await store.warming.get(created.schedule.id);
    expect(before.ok).toBe(true);
    if (!before.ok || before.value === null) throw new Error("Warming sentinel was not created");
    const inputs: Array<{ name: string; env: NodeJS.ProcessEnv; reachesAuth: boolean }> = [
      { name: "wrong credential", env: { ...env, [EMAILS_API_KEY_ENV]: "synthetic-wrong-warming-key" }, reachesAuth: true },
      { name: "missing credential", env: { ...env, [EMAILS_API_KEY_ENV]: undefined }, reachesAuth: false },
      { name: "blank credential", env: { ...env, [EMAILS_API_KEY_ENV]: " " }, reachesAuth: false },
      { name: "missing endpoint", env: { ...env, [EMAILS_API_URL_ENV]: undefined }, reachesAuth: false },
      ...CLIENT_DATABASE_SETTINGS.flatMap(setting => ["", join(fixtureRoot, "must-not-exist.db")].map(value => ({
        name: setting, env: { ...env, [setting]: value }, reachesAuth: false,
      }))),
    ];
    for (const input of inputs) {
      const requestsBefore = api.requestCount();
      const readsBefore = warmingReads;
      const writesBefore = warmingWrites;
      for (const command of ["warm-status", "warm-pause"]) {
        const failure = await runJsonError(["domain", command, "guard.example.com"], input.env);
        // Existing CLI classification checks "required" before "auth". Bind
        // this test to denial/diagnostics, not an invented error-code contract.
        expect(failure.error.message, input.name).toMatch(input.reachesAuth
          ? /authentication required|unauthorized|401/i : /required|credential|blank|cannot configure/i);
        expect(failure.error.message).not.toMatch(/not found|could not resolve/i);
      }
      if (input.reachesAuth) expect(api.requestCount()).toBeGreaterThan(requestsBefore);
      else expect(api.requestCount()).toBe(requestsBefore);
      expect(warmingReads).toBe(readsBefore);
      expect(warmingWrites).toBe(writesBefore);
      expect(await store.warming.get(created.schedule.id)).toEqual(before);
      expect(await store.warming.list()).toEqual({ ok: true, value: [before.value] });
      assertClientStateEmpty();
      expect(readdirSync(fixtureRoot).sort()).toEqual(["app", "cache", "compiler", "config", "data", "home", "state", "tmp"]);
    }
  }, 120_000);

  it("rejects unexpected hard exits, incomplete JSON, wrong-stream output and timed-out children", async () => {
    const env = canonicalWarmingEnv();
    const exited = await runProcess(["-e", 'console.log("{}"); process.exit(73);'], env);
    expect(exited.exitCode).toBe(73);
    expect(() => parseJsonSuccess(exited, ["hard-exit control"])).toThrow();
    const incomplete = await runProcess(["-e", 'process.stdout.write("{"); process.exit(0);'], env);
    expect(incomplete.exitCode).toBe(0);
    expect(() => parseJsonSuccess(incomplete, ["incomplete JSON control"])).toThrow();
    expect(() => parseJsonSuccess({ exitCode: 0, stdout: "{}", stderr: "unexpected diagnostic" }, ["wrong stream control"])).toThrow();
    await expect(runProcess(["-e", "setInterval(() => {}, 1000)"], env, 100)).rejects.toThrow("deadline");
    expect(children.size).toBe(0);
    expect(api.requestCount()).toBe(0);
  }, 120_000);

  it("detects writes in each client state root while allowing only separate compiler scratch", async () => {
    expect(stateRoots).toHaveLength(6);
    expect(stateRoots).not.toContain(process.env.TMPDIR);
    expect(stateRoots).not.toContain(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH);
    for (const path of stateRoots) {
      const marker = join(path, "unexpected-client-state");
      writeFileSync(marker, "synthetic state control");
      try { expect(() => assertClientStateEmpty()).toThrow(); }
      finally { unlinkSync(marker); }
    }
    const source = join(process.env.TMPDIR!, "compiler-control.ts");
    writeFileSync(source, `const value: string = ${JSON.stringify("x".repeat(60_000))};\nconsole.log(value.length);\n`);
    const compiled = await runProcess([source], canonicalWarmingEnv());
    expect(compiled.exitCode).toBe(0);
    expect(compiled.stdout.trim()).toBe("60000");
    expect(compiled.stderr).toBe("");
    expect(readdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH!).some(name => name.endsWith(".pile"))).toBe(true);
    assertClientStateEmpty();
    expect(api.requestCount()).toBe(0);
  }, 120_000);
});
