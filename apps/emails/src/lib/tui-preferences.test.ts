import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const modulePath = new URL("./tui-preferences.ts", import.meta.url).pathname;
const dataPath = new URL("../cli/tui/data.remote.ts", import.meta.url).pathname;
function child(root: string, code: string) {
  const result = spawnSync(process.execPath, ["--no-env-file", "-e", code], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, EMAILS_HOME: root, HASNA_STATION: "synthetic-preference-test" } });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}
test("fresh API data clients reload all device preferences without SQLite or legacy config reads", () => {
  const root = mkdtempSync(join(tmpdir(), "emails-preferences-"));
  try {
    mkdirSync(join(root, "config"), { mode: 0o700 });
    writeFileSync(join(root, "config.json"), "unreadable legacy config sentinel");
    const expected = { autoPull: false, dimRead: true, defaultMailbox: "sent", defaultAddress: "inbox@example.test", defaultFrom: "sender@example.test", theme: "dark", autoRefresh: false, expandCode: true, expandQuotes: true };
    child(root, `import {saveTuiPreference,loadTuiPreferences} from ${JSON.stringify(modulePath)}; for(const [key,value] of Object.entries(${JSON.stringify(expected)}))saveTuiPreference(key,value);console.log(JSON.stringify(loadTuiPreferences()));`);
    expect(child(root, `import {loadTuiPreferences} from ${JSON.stringify(modulePath)};console.log(JSON.stringify(loadTuiPreferences()));`)).toEqual(expected);
    expect(child(root, `import {getSettings} from ${JSON.stringify(dataPath)};console.log(JSON.stringify(getSettings()));`)).toEqual({ autoPull: false, dimRead: true, defaultMailbox: "sent", defaultAddress: "inbox@example.test", defaultFrom: "sender@example.test", theme: "dark" });
    expect(readFileSync(join(root, "config.json"), "utf8")).toBe("unreadable legacy config sentinel");
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(join(directory, item.name)) : [join(directory, item.name)]);
    expect(files(root).filter(path => /\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/.test(path))).toEqual([]);
    expect(readdirSync(join(root, "config"))).toEqual(["tui-preferences.json"]);
    expect(statSync(join(root, "config", "tui-preferences.json")).mode & 0o777).toBe(0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("invalid preferences and unrelated config fields never become persisted settings", () => {
  const root = mkdtempSync(join(tmpdir(), "emails-preference-validation-"));
  try {
    mkdirSync(join(root, "config"), { mode: 0o700 });
    writeFileSync(join(root, "config", "tui-preferences.json"), JSON.stringify({ theme: "unknown", defaultAddress: "bad", apiKey: "synthetic-unrelated", expandCode: "yes" }));
    const value = child(root, `import {saveTuiPreference,loadTuiPreferences} from ${JSON.stringify(modulePath)};let rejected=0;for(const [k,v] of [["apiKey","synthetic"],["theme",{}],["defaultMailbox","unknown"],["defaultAddress",String.fromCharCode(0)+"x@example.test"]])try{saveTuiPreference(k,v)}catch{rejected++}saveTuiPreference("dimRead",true);console.log(JSON.stringify({rejected,preferences:loadTuiPreferences()}));`);
    expect(value.rejected).toBe(4);
    expect(value.preferences).toMatchObject({ theme: "light", defaultAddress: null, expandCode: false, dimRead: true });
    expect(readFileSync(join(root, "config", "tui-preferences.json"), "utf8")).not.toContain("synthetic");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
