import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { createMessage } from "../db/messages.js";
import { createCall } from "../db/calls.js";

const roots: string[] = [];
afterEach(() => { closeDatabase(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("telephony CLI compact output", () => {
  test("sms list is bounded and compact by default with explicit full compatibility", () => {
    const home = mkdtempSync(join(tmpdir(), "telephony-cli-compact-")); roots.push(home);
    const dbPath = join(home, "telephony.db");
    process.env.HASNA_TELEPHONY_DB_PATH = dbPath;
    for (let i = 0; i < 75; i += 1) createMessage({ type: "sms_inbound", from_number: "+10000000000", to_number: "+12222222222", body: "b".repeat(500), status: "received" });
    closeDatabase(); delete process.env.HASNA_TELEPHONY_DB_PATH;
    const env = { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_TELEPHONY_LOCAL: "1", HASNA_TELEPHONY_DB_PATH: dbPath };
    const run = (args: string[]) => Bun.spawnSync({ cmd: ["bun", "run", new URL("./index.ts", import.meta.url).pathname, ...args], env, stdout: "pipe", stderr: "pipe" });

    const compact = run(["sms", "list", "--json"]);
    expect(compact.exitCode).toBe(0);
    const page = JSON.parse(new TextDecoder().decode(compact.stdout));
    expect(page.messages).toHaveLength(20);
    expect(page.next_cursor).toBe(20);
    expect(page.messages[0].metadata).toBeUndefined();
    expect(Buffer.byteLength(new TextDecoder().decode(compact.stdout))).toBeLessThan(12_000);

    const full = run(["sms", "list", "--json", "--full"]);
    const rows = JSON.parse(new TextDecoder().decode(full.stdout));
    expect(rows).toHaveLength(50);
    expect(rows[0].body).toBe("b".repeat(500));
  });

  test("local call pages progress across 45 rows without overlap", () => {
    const home = mkdtempSync(join(tmpdir(), "telephony-cli-calls-")); roots.push(home);
    const dbPath = join(home, "telephony.db");
    process.env.HASNA_TELEPHONY_DB_PATH = dbPath;
    for (let i = 0; i < 45; i += 1) createCall({ direction: "inbound", from_number: `+1000000${String(i).padStart(4, "0")}`, to_number: "+12222222222" });
    closeDatabase(); delete process.env.HASNA_TELEPHONY_DB_PATH;
    const env = { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_TELEPHONY_LOCAL: "1", HASNA_TELEPHONY_DB_PATH: dbPath };
    const run = (cursor: number) => Bun.spawnSync({ cmd: ["bun", "run", new URL("./index.ts", import.meta.url).pathname, "call", "list", "--json", "--limit", "20", "--cursor", String(cursor)], env, stdout: "pipe", stderr: "pipe" });
    const page = (cursor: number) => JSON.parse(new TextDecoder().decode(run(cursor).stdout)) as { calls: Array<{ id: string }>; next_cursor: number | null };
    const first = page(0); const second = page(20); const third = page(40);
    expect(first.next_cursor).toBe(20); expect(second.next_cursor).toBe(40); expect(third.next_cursor).toBeNull();
    const ids = [...first.calls, ...second.calls, ...third.calls].map((call) => call.id);
    expect(first.calls).toHaveLength(20); expect(second.calls).toHaveLength(20); expect(third.calls).toHaveLength(5);
    expect(new Set(ids).size).toBe(45);
  });

});
