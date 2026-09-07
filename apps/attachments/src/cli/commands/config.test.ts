import { beforeEach, afterEach, test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configCommand } from "./config";
import { setConfigPath, setConfig, getConfig } from "../../core/config";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "attachments-config-")); setConfigPath(join(dir, "config.json")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
async function run(args: string[]) { let output = ""; const spy = spyOn(process.stdout, "write").mockImplementation(c => { output += String(c); return true; }); try { const cmd = configCommand().exitOverride(); for (const sub of cmd.commands) sub.exitOverride(); await cmd.parseAsync(args, { from: "user" }); return output; } finally { spy.mockRestore(); } }
test("show reports preferences without creating state or leaking historical S3 credentials", async () => {
 expect(await run(["show"])).toContain("defaults"); expect(existsSync(join(dir, "config.json"))).toBe(false);
 setConfig({ s3: { secretAccessKey: "sensitive-fixture", accessKeyId: "fixture-id" } });
 const output = await run(["show"]); expect(output).not.toContain("sensitive-fixture"); expect(output).not.toContain("fixture-id");
});
test("set changes only supported preferences", async () => { await run(["set", "--expiry", "1h", "--link-type", "server"]); expect(getConfig().defaults).toEqual({ expiry: "1h", linkType: "server" }); });
for (const args of [["set", "--expiry", "nonsense"], ["set", "--link-type", "local"], ["set", "--storage-backend", "local"], ["set", "--secret-key", "fixture"]]) test("rejects unsupported or invalid config " + args[1], async () => { await expect(run(args)).rejects.toThrow(); expect(existsSync(join(dir, "config.json"))).toBe(false); });
test("config test requires explicit credentials or the local opt-in", async () => {
  // No authority env, no local opt-in, and a scratch HASNA_HOME so the
  // station's own ~/.hasna credential file cannot resolve for the fixture:
  // `config test` must refuse rather than silently picking a dataset.
  const saved = { ...process.env };
  const scratchHome = mkdtempSync(join(tmpdir(), "attachments-config-cfgtest-"));
  try {
    for (const k of Object.keys(process.env)) if (k.includes("ATTACHMENTS")) delete process.env[k];
    process.env.HASNA_HOME = scratchHome;
    await expect(run(["test"])).rejects.toThrow();
    // The deliberate local opt-in is the other way this command can answer.
    process.env.HASNA_ATTACHMENTS_LOCAL = "1";
    process.env.HASNA_ATTACHMENTS_DB_PATH = join(scratchHome, "db.sqlite");
    expect(await run(["test"])).toContain("local");
  } finally {
    process.env = saved;
    rmSync(scratchHome, { recursive: true, force: true });
  }
});
