import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { createMessage } from "../db/messages.js";

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
});
