// `--json` SURFACES THAT DID NOT SPEAK JSON.
//
// Three lies, one family (tasks 15908bba, 7f2b4b6e, 1e8f179f):
//
//  * READ SURFACES AS PROSE. `template show/preview --json` and `sequence show
//    --json` never called `output()`; the patched console wrapped their prose
//    as {"output":["\nTemplate: ...","  ID: ..."]}, so a JSON consumer had to
//    screen-scrape subjects and steps out of display lines. `export <type>`
//    console.logged an already-JSON string, which the wrapper DOUBLE-encoded.
//    Mutation verbs (template add/remove, sequence create/enroll/step,
//    group create/members, contact suppress) returned prose only.
//
//  * SHAPE FLIP ON EMPTY. `inbox search --json` returned a bare array on any
//    hit but {"output":["No results for ..."]} on zero hits — a consumer
//    parsing for an array broke exactly when the answer was "none".
//
//  * ERRORS ON THE WRONG STREAM. `inbox read <missing> --json` wrote
//    {"error":...,"output":[]} to STDOUT via the exit hook, while sibling
//    not-found paths wrote {"error":{...}} to STDERR via handleError. Same
//    failure class, two streams, two shapes.
//
// WHY A SUBPROCESS: the error-path cases need `process.exit`; the rest reuse
// the same harness for uniformity. Environment scrubbed BY PREFIX (an operator
// shell may export this package's client configuration, and enumerating those
// keys here would add references the mode-axis ratchet counts).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "../../lib/client-settings.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";

const SCRUBBED_ENV_PREFIXES = ["EMAILS_", "HASNA_EMAILS_", "MAILERY_", "HASNA_MAILERY_"] as const;
const SCRUBBED_ENV_KEYS = [
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "RESEND_API_KEY",
] as const;

let inheritedEnv: NodeJS.ProcessEnv;
let fixtureRoot: string;
let stateRoots: string[];
let store: ReturnType<typeof createSqliteEmailStore>;
let api: V1StoreApi;
let messageReads: number;
let statusWrites: number;
let messageDeletes: number;
const children = new Set<{ kill(signal?: "SIGKILL"): void; exited: Promise<number> }>();

function scrubClientSettings(base: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(base)) {
    if (SCRUBBED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) delete base[key];
  }
  for (const key of SCRUBBED_ENV_KEYS) delete base[key];
  for (const key of CLIENT_DATABASE_SETTINGS) delete base[key];
}

function canonicalEnv(): NodeJS.ProcessEnv {
  // Only test-owned state/toolchain paths cross the child boundary. No inherited
  // credentials, pointers, provider configuration or database path can leak in.
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
  // The parent must remain asynchronous to serve the real HTTP requests. Use
  // the pinned test runtime, not whichever executable an inherited PATH finds.
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
  for (const key of [api.apiKey, env[EMAILS_API_KEY_ENV]].filter((value): value is string => Boolean(value))) {
    expect(result.stdout).not.toContain(key);
    expect(result.stderr).not.toContain(key);
  }
  return result;
}

/** Parse stdout as ONE JSON document and reject the console-wrapper shape. */
function structured(run: CliRun, what: string): unknown {
  expect(run.exitCode, `${what} failed: ${run.stderr}\n${run.stdout}`).toBe(0);
  expect(run.stderr, `${what} unexpectedly wrote to stderr`).toBe("");
  let doc: unknown;
  try {
    doc = JSON.parse(run.stdout);
  } catch (error) {
    throw new Error(`${what} stdout is not a JSON document: ${String(error)}\n${run.stdout}`);
  }
  if (doc && typeof doc === "object" && !Array.isArray(doc) && "output" in (doc as Record<string, unknown>)) {
    throw new Error(`${what} emitted the prose wrapper, not structured data: ${run.stdout.slice(0, 300)}`);
  }
  return doc;
}

function assertClientStateEmpty(): void {
  for (const path of stateRoots) expect(readdirSync(path)).toEqual([]);
}

beforeEach(() => {
  inheritedEnv = { ...process.env };
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-json-truth-"));
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
  messageReads = statusWrites = messageDeletes = 0;
  api = startV1StoreApi({ store: { ...store, messages: { ...store.messages,
    async listMessages(options) { messageReads++; return store.messages.listMessages(options); },
    async getMessage(id) { messageReads++; return store.messages.getMessage(id); },
    async updateMessageStatus(id, patch) { statusWrites++; return store.messages.updateMessageStatus(id, patch); },
    async deleteMessage(id) { messageDeletes++; return store.messages.deleteMessage(id); },
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

async function seedMessage(direction: "inbound" | "outbound", subject = "JSON fixture sentinel") {
  const result = await store.messages.createMessage({ direction, from_addr: "sender@example.test",
    to_addrs: ["recipient@example.test"], subject, body_text: "Synthetic fixture body",
    status: direction === "inbound" ? "received" : "sent", received_at: new Date().toISOString() });
  if (!result.ok) throw new Error(`Message fixture failed: ${result.code}`);
  return result.value;
}

async function assertUntouched(id: string): Promise<void> {
  const result = await store.messages.getMessage(id);
  if (!result.ok || result.value === null) throw new Error("Fixture sentinel disappeared");
  expect(result.value.is_read).toBe(false);
  expect(statusWrites).toBe(0);
  expect(messageDeletes).toBe(0);
}

describe("template/sequence read surfaces are structured under --json", () => {
  it("template show --json returns the template row", async () => {
    const env = canonicalEnv();
    expect((await runCli(["template", "add", "welcome", "--subject", "Hi {{name}}", "--text", "Body {{name}}"], env)).exitCode).toBe(0);

    const doc = structured(await runCli(["--json", "template", "show", "welcome"], env), "template show") as Record<string, unknown>;
    expect(doc["name"]).toBe("welcome");
    expect(doc["subject_template"]).toBe("Hi {{name}}");
    expect(doc["text_template"]).toBe("Body {{name}}");
    expect(api.requestCount()).toBeGreaterThan(0);
  }, 120_000);

  it("template preview --json returns the rendered subject and body", async () => {
    const env = canonicalEnv();
    expect((await runCli(["template", "add", "welcome", "--subject", "Hi {{name}}", "--text", "Body {{name}}"], env)).exitCode).toBe(0);

    const doc = structured(
      await runCli(["--json", "preview", "welcome", "--vars", '{"name":"Ada"}'], env),
      "template preview",
    ) as Record<string, unknown>;
    expect(doc["subject"]).toBe("Hi Ada");
    expect(String(doc["text"] ?? doc["body"] ?? "")).toContain("Ada");
    expect(api.requestCount()).toBeGreaterThan(0);
  }, 120_000);

  it("sequence show --json returns the sequence with its steps", async () => {
    const env = canonicalEnv();
    expect((await runCli(["template", "add", "step-one", "--subject", "s", "--text", "b"], env)).exitCode).toBe(0);
    expect((await runCli(["sequence", "create", "drip", "--description", "d"], env)).exitCode).toBe(0);
    expect((await runCli(["sequence", "step", "add", "drip", "--step", "1", "--delay", "24", "--template", "step-one"], env)).exitCode).toBe(0);

    const doc = structured(await runCli(["--json", "sequence", "show", "drip"], env), "sequence show") as Record<string, unknown>;
    expect((doc["sequence"] as Record<string, unknown>)["name"]).toBe("drip");
    const steps = doc["steps"] as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.["template_name"]).toBe("step-one");
    expect(steps[0]?.["step_number"]).toBe(1);
    expect(steps[0]?.["delay_hours"]).toBe(24);
    expect(doc["enrollments"]).toEqual({ active: 0, completed: 0, cancelled: 0, total: 0 });
    expect(api.requestCount()).toBeGreaterThan(0);
  }, 120_000);

  it("export emails --json emits the export once, not a double-encoded string", async () => {
    const env = canonicalEnv();
    const doc = structured(await runCli(["--json", "export", "emails"], env), "export emails");
    expect(Array.isArray(doc), `export must be the exported rows, got: ${JSON.stringify(doc).slice(0, 200)}`).toBe(true);
    expect(doc).toEqual([]);
    const outbound = await seedMessage("outbound", "Exported synthetic subject");
    await seedMessage("inbound", "Excluded inbound subject");
    const rows = structured(await runCli(["--json", "export", "emails"], env), "populated export") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: outbound.id, subject: "Exported synthetic subject", status: "sent" });
    expect(messageReads).toBeGreaterThan(0);
  }, 120_000);
});

describe("mutation verbs answer structured data under --json", () => {
  it("template add/remove, sequence create, group create, contact suppress", async () => {
    const env = canonicalEnv();

    const added = structured(await runCli(["--json", "template", "add", "t", "--subject", "s", "--text", "b"], env), "template add") as Record<string, unknown>;
    expect(added["name"]).toBe("t");
    expect(typeof added["id"]).toBe("string");

    const removed = structured(await runCli(["--json", "template", "remove", "t"], env), "template remove") as Record<string, unknown>;
    expect(removed["removed"]).toBe(true);

    const seq = structured(await runCli(["--json", "sequence", "create", "s"], env), "sequence create") as Record<string, unknown>;
    expect(seq["name"]).toBe("s");

    const group = structured(await runCli(["--json", "group", "create", "g"], env), "group create") as Record<string, unknown>;
    expect(group["name"]).toBe("g");

    const suppressed = structured(await runCli(["--json", "contact", "suppress", "someone@example.com"], env), "contact suppress") as Record<string, unknown>;
    expect(suppressed["suppressed"]).toBe(true);
    expect(await store.templates.get(String(added["id"]))).toEqual({ ok: true, value: null });
    const contacts = await store.contacts.list();
    if (!contacts.ok) throw new Error("Contact fixture read failed");
    expect(contacts.value).toHaveLength(1);
    // This inspects physical fixture persistence, where suppressed is INTEGER;
    // the actual CLI's boolean output above remains unchanged and strict.
    expect(contacts.value[0]).toMatchObject({ email: "someone@example.com", suppressed: 1 });
    expect(api.requestCount()).toBeGreaterThan(0);
  }, 120_000);
});

describe("inbox search --json keeps one shape", () => {
  it("answers [] on zero hits, matching the non-empty array shape", async () => {
    const env = canonicalEnv();
    const sentinel = await seedMessage("inbound", "json-match-sentinel");
    const run = await runCli(["--json", "inbox", "search", "no-such-string-anywhere-zzz"], env);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    expect(run.stderr).toBe("");
    const hits = structured(await runCli(["--json", "inbox", "search", "json-match-sentinel"], env), "matching search") as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(hits[0]?.["id"]).toBe(sentinel.id);
    expect(messageReads).toBeGreaterThan(0);
    await assertUntouched(sentinel.id);
  }, 120_000);
});

describe("not-found errors converge on handleError", () => {
  for (const command of [
    ["inbox", "read", "zzzzzzzz"],
    ["inbox", "delete", "zzzzzzzz", "--yes"],
    ["inbox", "mark-read", "zzzzzzzz"],
  ] as const) {
    it(`\`${command.join(" ")}\` --json puts {"error":{...}} on stderr, nothing on stdout`, async () => {
      const env = canonicalEnv();
      const sentinel = await seedMessage("inbound");
      const run = await runCli(["--json", ...command], env);

      expect(run.exitCode).toBe(1);
      const failure = JSON.parse(run.stderr) as { error: { message: string } };
      // The local arm's id resolver phrases the miss as "Could not resolve ID";
      // the seam paths say "Email not found". Both are the same failure class —
      // what this suite pins is the STREAM and the SHAPE, not the wording.
      expect(failure.error.message).toMatch(/not found|could not resolve/i);
      expect(run.stdout.trim(), "the error document must not land on stdout").toBe("");
      expect(api.requestCount()).toBeGreaterThan(0);
      await assertUntouched(sentinel.id);
    }, 120_000);
  }
});

describe("canonical CLI fixture negative controls", () => {
  for (const invalid of ["wrong credential", "missing credential", "client database"] as const) {
    it(`refuses ${invalid} without reading or mutating the populated fixture`, async () => {
      const sentinel = await seedMessage("inbound", "protected-json-sentinel");
      const env = canonicalEnv();
      const positive = structured(await runCli(["--json", "inbox", "search", "protected-json-sentinel"], env), "authenticated control") as unknown[];
      expect(positive).toHaveLength(1);
      const requestsBefore = api.requestCount();
      const readsBefore = messageReads;
      if (invalid === "wrong credential") env[EMAILS_API_KEY_ENV] = "synthetic-rejected-json-credential";
      else if (invalid === "missing credential") delete env[EMAILS_API_KEY_ENV];
      else env[CLIENT_DATABASE_SETTINGS[0]] = ":memory:";

      for (const args of [["inbox", "search", "protected-json-sentinel"], ["contact", "suppress", "blocked@example.test"]]) {
        const run = await runCli(["--json", ...args], env);
        expect(run.exitCode).toBe(1);
        expect(run.stdout).toBe("");
        const failure = JSON.parse(run.stderr) as { error: { message: string } };
        expect(failure.error.message).toMatch(invalid === "wrong credential"
          ? /authentication required|unauthorized|401/i : /credential|API_KEY|SESSION_TOKEN|cannot configure/i);
        expect(failure.error.message).not.toMatch(/not found|could not resolve/i);
      }
      expect(messageReads).toBe(readsBefore);
      if (invalid === "wrong credential") expect(api.requestCount()).toBeGreaterThan(requestsBefore);
      else expect(api.requestCount()).toBe(requestsBefore);
      const contacts = await store.contacts.list();
      expect(contacts).toEqual({ ok: true, value: [] });
      await assertUntouched(sentinel.id);
    }, 120_000);
  }

  it("rejects prose, double documents, wrong-stream output and unexpected child exits", async () => {
    for (const stdout of ['{"output":["prose"]}', '{}\n{}', 'not JSON']) {
      expect(() => structured({ exitCode: 0, stdout, stderr: "" }, "invalid output control")).toThrow();
    }
    const encoded = structured({ exitCode: 0, stdout: JSON.stringify("[]"), stderr: "" }, "encoded export control");
    expect(Array.isArray(encoded)).toBe(false); // The original export assertion rejects this shape.
    expect(() => structured({ exitCode: 0, stdout: "{}", stderr: "{}" }, "wrong stream control")).toThrow();
    const exited = await runProcess(["-e", 'console.log("{}"); process.exit(73);'], canonicalEnv());
    expect(exited.exitCode).toBe(73);
    expect(() => structured(exited, "unexpected exit control")).toThrow();
    await expect(runProcess(["-e", "setInterval(() => {}, 1000)"], canonicalEnv(), 100)).rejects.toThrow("deadline");
    expect(children.size).toBe(0);
  }, 120_000);

  it("detects writes in all six state roots while retaining separate real compiler scratch", async () => {
    expect(stateRoots).toHaveLength(6);
    expect(stateRoots).not.toContain(process.env.TMPDIR);
    expect(stateRoots).not.toContain(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH);
    for (const path of stateRoots) {
      const marker = join(path, "unexpected-client-state");
      writeFileSync(marker, "synthetic state control");
      try { expect(() => assertClientStateEmpty()).toThrow(); }
      finally { unlinkSync(marker); }
    }
    // Exercise actual source compilation above Bun's cache size threshold, not
    // an ignored application directory or a fabricated cache file.
    const source = join(process.env.TMPDIR!, "compiler-control.ts");
    writeFileSync(source, `const value: string = ${JSON.stringify("x".repeat(60_000))};\nconsole.log(value.length);\n`);
    const compiled = await runProcess([source], canonicalEnv());
    expect(compiled.exitCode).toBe(0);
    expect(compiled.stdout.trim()).toBe("60000");
    expect(compiled.stderr).toBe("");
    expect(readdirSync(process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH!).some(name => name.endsWith(".pile"))).toBe(true);
    assertClientStateEmpty();
    expect(api.requestCount()).toBe(0);
  }, 120_000);
});
