import { beforeEach, afterEach, test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { configCommand } from "./config";
import { setConfigPath, setConfig, getConfig } from "../../core/config";
// Home-layout roots and the Keychain account pin, saved once at load and
// restored delete-if-undefined after each test: the resolver's disk tier
// roots at HASNA_HOME else $HOME/.hasna (HASNA_CONFIG_HOME overriding the
// config root), and `keychainAccount()` reads HASNA_STATION else the short
// hostname else USER. On a provisioned station those anchor the REAL
// `~/.hasna/attachments/config/credentials` (and on macOS a real keychain
// item under this machine's hostname), so the fail-closed probe below must
// run with every ambient root detached.
const AMBIENT_ROOT_KEYS = ["HOME", "HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATION"] as const;
const savedAmbient = new Map<string, string | undefined>(AMBIENT_ROOT_KEYS.map((key) => [key, process.env[key]]));
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attachments-config-"));
  setConfigPath(join(dir, "config.json"));
  // Hermetic: the shared seam's disk tier anchors here, so a station's real
  // ~/.hasna/attachments/config/credentials cannot satisfy the 'config test'
  // fail-closed probe (or flip any resolver decision) during the suite.
  for (const key of AMBIENT_ROOT_KEYS) {
    if (key === "HASNA_STATION") process.env[key] = "attachments-hermetic-test";
    else process.env[key] = dir;
  }
});
afterEach(() => {
  for (const key of AMBIENT_ROOT_KEYS) {
    const value = savedAmbient.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});
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
