// LIST-FILTER VALUES THE CLI USED TO SWALLOW.
//
// Two silent-wrong-answer shapes, both CLI-layer (tasks a126c676, 6d5ebed5):
//
//  * `inbox list --folder starrred` (any unknown folder) silently listed the
//    INBOX: `normalizeCliMailbox` mapped every unrecognised value to "inbox",
//    so a typo answered with the wrong folder's mail and exit 0.
//  * `scheduled list --status bogus` (and its `schedule list` twin) returned
//    `[]` with exit 0: the status was a blind type-cast, so a typo like
//    `--status canceled` read as "nothing is cancelled" — while the sibling
//    `email list --status bogus` on the same store correctly refuses.
//
// Both now refuse, naming the value and the valid set.
//
// The real CLI runs against authenticated loopback HTTP. Only the fixture owns
// an explicit memory adapter; clients receive no database setting or fallback.
// Async children let the parent serve HTTP, and direct CLI exits cannot stop Bun.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closeDatabase, getDatabase } from "../../db/database.js";
import { EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV } from "../../lib/client-settings.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import type { EmailStore } from "../../store/email-store.js";
import type { ListMessagesOptions, MessageInput } from "../../store/records.js";
import { startV1StoreApi, type V1StoreApi } from "../../test-support/v1-store-api.js";

const APP_ROOT = resolve(import.meta.dir, "../../..");
const WRONG_KEY = "fixture-list-filter-wrong-key";
let root: string;
let stateEnv: NodeJS.ProcessEnv;
let store: EmailStore;
let api: V1StoreApi;
let messageReads: ListMessagesOptions[];
let scheduledReads: Array<NonNullable<Parameters<EmailStore["scheduled"]["list"]>[0]>>;
let priorityReads: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "emails-list-filter-"));
  stateEnv = {};
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateEnv[key] = path;
  }
  for (const name of ["tmp", "transpiler"]) mkdirSync(join(root, name), { mode: 0o700 });
  closeDatabase();
  store = createSqliteEmailStore({ database: getDatabase(":memory:") });
  messageReads = [];
  scheduledReads = [];
  priorityReads = 0;
  const priority = store.prioritySenderRules!;
  api = startV1StoreApi({ store: { ...store,
    messages: { ...store.messages, async listMessages(options) {
      messageReads.push(options ?? {});
      return store.messages.listMessages(options);
    } },
    scheduled: { ...store.scheduled, async list(options) {
      scheduledReads.push(options ?? {});
      return store.scheduled.list(options);
    } },
    prioritySenderRules: { ...priority, async list(options) {
      priorityReads++;
      return priority.list(options);
    } },
  } });
});

afterEach(() => {
  try {
    // Compiler and temporary scratch are separate from all six client roots.
    for (const path of Object.values(stateEnv)) expect(readdirSync(path!)).toEqual([]);
  } finally {
    api?.stop();
    closeDatabase();
    rmSync(root, { recursive: true, force: true });
  }
});

// Allowlisted child environment; the parent environment is never modified.
function clientEnv(credential = api.apiKey): NodeJS.ProcessEnv {
  return {
    ...stateEnv,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: join(root, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "transpiler"),
    [EMAILS_API_URL_ENV]: api.baseUrl, [EMAILS_API_KEY_ENV]: credential,
    AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1", TZ: "UTC",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  };
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  const child = Bun.spawn({
    cmd: [process.execPath, join(APP_ROOT, "src/cli/index.tsx"), ...args],
    cwd: APP_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    for (const output of [stdout, stderr]) {
      expect(output).not.toContain(api.apiKey);
      expect(output).not.toContain(WRONG_KEY);
      expect(output).not.toContain("fixture-inherited");
    }
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function seedFolders(): Promise<Record<string, string[]>> {
  const ids: Record<string, string> = {};
  const fixtures: Array<[string, Partial<MessageInput>]> = [
    ["read", { is_read: true }], ["unread", { is_read: false }],
    ["starred", { is_read: true, is_starred: true }],
    ["sent", { direction: "outbound" }], ["archived", { labels: ["archived"] }],
    ["spam", { labels: ["spam"] }], ["trash", { labels: ["trash"] }],
  ];
  for (const [index, [name, flags]] of fixtures.entries()) {
    const { labels, ...messageFlags } = flags;
    const result = await store.messages.createMessage({ from_addr: "sender@example.test",
      to_addrs: ["reader@example.test"], subject: `Folder ${name}`, direction: "inbound",
      received_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), ...messageFlags });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Could not seed synthetic folder row");
    // This suite tests reads. The retained adapter's INSERT strips spam/trash
    // labels before its label trigger derives flags; that separate write defect
    // is not repaired here. Its explicit status updater preserves folder state.
    for (const label of labels ?? []) {
      const patched = await store.messages.updateMessageStatus(result.value.id, { add_label: label });
      expect(patched.ok).toBe(true);
      if (!patched.ok) throw new Error("Could not seed synthetic folder state");
      expect(patched.value?.labels).toEqual(labels);
    }
    const stored = await store.messages.getMessage(result.value.id);
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error("Could not read synthetic folder state");
    expect(stored.value?.labels).toEqual(labels ?? []);
    ids[name] = result.value.id;
  }
  return { inbox: [ids.starred!, ids.unread!, ids.read!], unread: [ids.unread!],
    starred: [ids.starred!], sent: [ids.sent!], archived: [ids.archived!],
    spam: [ids.spam!], trash: [ids.trash!] };
}

async function seedSchedule(): Promise<string[]> {
  const provider = await store.providers.create({ name: "list-filter-fixture", type: "sandbox", active: true });
  expect(provider.ok).toBe(true);
  if (!provider.ok) throw new Error("Could not seed synthetic provider metadata");
  const pending: string[] = [];
  for (const [index, status] of ["pending", "sent", "pending"].entries()) {
    const created = await store.scheduled.create({ provider_id: provider.value.id,
      from_address: "sender@example.test", to_addresses: ["reader@example.test"],
      subject: `Schedule ${index}`, scheduled_at: new Date(Date.UTC(2026, 1, index + 1)).toISOString(), status });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Could not seed synthetic schedule row");
    if (status === "pending") pending.push(String(created.value.id));
  }
  return pending;
}

describe("inbox --folder validates its value", () => {
  // STRONG: the refusal, with the valid set named so the operator can fix the
  // typo instead of re-running blind.
  it("refuses `inbox list --folder starrred` instead of listing the inbox", async () => {
    const env = clientEnv();
    const run = await runCli(["--json", "inbox", "list", "--folder", "starrred", "--limit", "3"], env);

    expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message).toContain("starrred");
    for (const folder of ["inbox", "unread", "starred", "sent", "archived", "spam", "trash"]) {
      expect(failure.error.message).toContain(folder);
    }
    expect(api.requestCount()).toBe(0);
    expect(run.stdout.trim()).toBe("");
  }, 120_000);

  it("refuses `inbox search --folder bogus` the same way", async () => {
    const env = clientEnv();
    const run = await runCli(["--json", "inbox", "search", "anything", "--folder", "bogus"], env);

    expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
    const failure = JSON.parse(run.stderr) as { error: { message: string } };
    expect(failure.error.message).toContain("bogus");
    expect(failure.error.message).toContain("starred");
    expect(api.requestCount()).toBe(0);
    expect(run.stdout.trim()).toBe("");
  }, 120_000);

  // The complement: every valid folder still answers. An unconditional refusal
  // would also make the two cases above pass.
  it("still lists every valid folder on an empty store", async () => {
    const env = clientEnv();
    for (const folder of ["inbox", "unread", "starred", "sent", "archived", "spam", "trash"]) {
      const run = await runCli(["--json", "inbox", "list", "--folder", folder, "--limit", "1"], env);
      expect(run.exitCode, `--folder ${folder} failed: ${run.stderr}`).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual([]);
    }
    const folders = await seedFolders();
    for (const [folder, ids] of Object.entries(folders)) {
      const before = messageReads.length;
      const run = await runCli(["--json", "inbox", "list", "--folder", folder, "--limit", "10"], env);
      expect(run.exitCode, run.stderr).toBe(0);
      const rows = JSON.parse(run.stdout) as Array<{ id: string; subject: string }>;
      expect(rows.map((row) => row.id), `${folder}: ${rows.map((row) => row.subject).join(", ")}`).toEqual(ids);
      expect(messageReads.length).toBeGreaterThan(before);
      expect(messageReads.slice(before).every((options) => options.folder === (folder === "unread" ? "inbox" : folder)
        && options.direction === (folder === "sent" ? "outbound" : "inbound"))).toBe(true);
    }
    expect(priorityReads).toBe(14);
  }, 120_000);
});

describe("scheduled --status validates against the enum", () => {
  for (const command of [["scheduled", "list"], ["schedule", "list"]] as const) {
    it(`refuses \`${command.join(" ")} --status bogus\` instead of answering []`, async () => {
      const env = clientEnv();
      const run = await runCli(["--json", ...command, "--status", "bogus"], env);

      expect(run.exitCode, `expected a refusal, got: ${run.stdout}`).not.toBe(0);
      const failure = JSON.parse(run.stderr) as { error: { message: string } };
      expect(failure.error.message).toContain("bogus");
      for (const status of ["pending", "sent", "cancelled", "failed"]) {
        expect(failure.error.message).toContain(status);
      }
      // The refusal must not be dressed as a plausible empty answer.
      expect(run.stdout.trim()).not.toBe("[]");
      expect(run.stdout.trim()).toBe("");
      expect(api.requestCount()).toBe(0);
    }, 120_000);
  }

  it("still answers a valid --status filter", async () => {
    const env = clientEnv();
    const run = await runCli(["--json", "scheduled", "list", "--status", "pending"], env);
    expect(run.exitCode, `valid status refused: ${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([]);
    const pending = await seedSchedule();
    for (const command of ["scheduled", "schedule"]) {
      const before = scheduledReads.length;
      const populated = await runCli(["--json", command, "list", "--status", "pending"], env);
      expect(populated.exitCode, populated.stderr).toBe(0);
      const rows = JSON.parse(populated.stdout) as Array<{ id: string; status: string }>;
      expect(rows.map((row) => row.id)).toEqual(pending);
      expect(rows.map((row) => row.status)).toEqual(["pending", "pending"]);
      expect(scheduledReads.length).toBeGreaterThan(before);
      expect(scheduledReads.slice(before).every((options) => options.filters?.status === "pending")).toBe(true);
    }
  }, 120_000);
});

it("rejects a wrong key without reading populated folders or the schedule", async () => {
  await seedFolders();
  await seedSchedule();
  for (const args of [["inbox", "list", "--folder", "inbox"], ["scheduled", "list", "--status", "pending"],
    ["schedule", "list", "--status", "pending"]]) {
    const run = await runCli(["--json", ...args], clientEnv(WRONG_KEY));
    expect(run.exitCode).not.toBe(0);
    expect(run.stdout.trim()).toBe("");
    expect(JSON.parse(run.stderr).error.message).toMatch(/401|authentication/i);
  }
  expect(api.requestCount()).toBeGreaterThan(0);
  expect(messageReads).toEqual([]);
  expect(scheduledReads).toEqual([]);
  expect(priorityReads).toBe(0);
}, 120_000);
