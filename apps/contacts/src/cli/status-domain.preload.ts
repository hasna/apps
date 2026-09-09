/** Test-only boundaries around the REAL CLI, transport and credential resolver. */
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { appendFileSync, lstatSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { diskFixtureKey, envFixtureKey, fixtureStation } from "./status-fixture";

const home = process.env.HOME ?? "";
const info = lstatSync(home);
if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(home) !== home ||
    info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 ||
    !basename(home).startsWith("contacts-status-") || process.env.HASNA_HOME !== home ||
    process.env.HASNA_STATION !== fixtureStation) throw new Error("Invalid Contacts fixture HOME/station");
const args = process.argv.slice(2).join(" ");
if (!["status", "status --json", "--fixture-boundary-probe"].includes(args)) {
  throw new Error("Contacts fixture command is not allowlisted");
}
const mode = process.env.CONTACTS_STATUS_FIXTURE_MODE;
if (!["unconfigured", "failure", "success"].includes(mode ?? "")) throw new Error("Invalid Contacts fixture mode");
const audit = (event: object) => appendFileSync(join(home, "status-fixture.jsonl"), `${JSON.stringify(event)}\n`, { mode: 0o600 });
const refuse = () => { throw new Error("Contacts fixture blocked a non-fixture operation"); };
const spawnSync = (command: string, argv: string[] = []) => {
  if (command !== "/usr/bin/security" || argv.length !== 6 ||
      argv[0] !== "find-generic-password" || argv[1] !== "-a" || argv[2] !== fixtureStation ||
      argv[3] !== "-s" || !["hasna.credentials.contacts.api-key", "hasna.credentials.contacts.api-url"].includes(argv[4]!) ||
      argv[5] !== "-w") return refuse();
  audit({ kind: "keychain", service: argv[4], status: 44 });
  return { status: 44, stdout: "", stderr: "fixture item absent", error: undefined };
};
mock.module("node:child_process", () => ({ ...childProcess, spawnSync, spawn: refuse,
  exec: refuse, execSync: refuse, execFile: refuse, execFileSync: refuse, fork: refuse }));
Bun.spawn = refuse as typeof Bun.spawn;
Bun.spawnSync = refuse as typeof Bun.spawnSync;
Bun.connect = refuse as typeof Bun.connect;
Bun.listen = refuse as typeof Bun.listen;
Bun.serve = refuse as typeof Bun.serve;
globalThis.WebSocket = function () { return refuse(); } as unknown as typeof WebSocket;

// No environment rewrite and no originalFetch fallback: disk/env selection,
// normalized authority and headers must come from @hasna/contracts itself.
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const origin = mode === "success" ? "https://contacts.example.test" : "https://contacts.example.invalid";
  const expectedKey = mode === "success" || process.env.HASNA_CONTACTS_API_KEY !== undefined ? envFixtureKey : diskFixtureKey;
  if (mode === "unconfigured" || url.origin !== origin || request.method !== "GET" ||
      !["/v1/contacts", "/v1/companies"].includes(url.pathname) || url.search !== "?limit=1" ||
      request.headers.get("x-api-key") !== expectedKey || request.headers.get("authorization") !== `Bearer ${expectedKey}` ||
      request.redirect !== "manual") return refuse();
  audit({ kind: "request", path: url.pathname, authenticated: true, status: mode === "failure" ? 403 : 200 });
  // A terminal HTTP failure is deterministic, unlike DNS failure/retries. An
  // auth-error body deliberately echoes the FICTIONAL key: production must
  // discard it while retaining the actual credential source/tier in the error.
  if (mode === "failure") return Response.json({ error: `rejected ${expectedKey}` }, { status: 403 });
  return url.pathname === "/v1/companies"
    ? Response.json({ companies: [{ id: "company-1", name: "Acme" }], count: 1 })
    : Response.json({ contacts: [{ id: "contact-1", display_name: "Ada" }], count: 2 });
}, { preconnect: refuse }) as typeof fetch;

if (args === "--fixture-boundary-probe") {
  const guarded = await import("node:child_process");
  const attempts = [() => guarded.spawn("/usr/bin/security", ["help"]),
    () => guarded.spawnSync("/usr/bin/security", ["find-generic-password", "-a", "wrong-account", "-s", "hasna.credentials.contacts.api-key", "-w"]),
    () => guarded.spawnSync("/usr/bin/security", ["find-generic-password", "-a", fixtureStation, "-s", "other-service", "-w"]),
    () => guarded.exec("security help"), () => guarded.execSync("security help"),
    () => guarded.execFile("/usr/bin/security", ["help"]), () => guarded.execFileSync("/usr/bin/security", ["help"]),
    () => guarded.fork("/usr/bin/security"), () => Bun.spawn(["/usr/bin/security", "help"]),
    () => Bun.spawnSync(["/usr/bin/security", "help"]), () => Bun.connect({ hostname: "127.0.0.1", port: 9, socket: { data() {} } }),
    () => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }), () => new WebSocket("ws://127.0.0.1:9"),
    () => fetch.preconnect("https://contacts.example.invalid"),
    () => fetch("https://other.example.invalid/v1/contacts?limit=1"),
    () => fetch("https://contacts.example.invalid/v1/unexpected?limit=1"),
    () => fetch("https://contacts.example.invalid/v1/contacts?limit=1", { headers: { "x-api-key": "wrong-fixture-key" } })];
  let blocked = 0;
  for (const attempt of attempts) {
    try { await attempt(); } catch (error) { if (String(error).includes("Contacts fixture blocked")) blocked++; }
  }
  const absent = guarded.spawnSync("/usr/bin/security", ["find-generic-password", "-a", fixtureStation, "-s", "hasna.credentials.contacts.api-key", "-w"]);
  console.log(JSON.stringify({ blocked, attempted: attempts.length, absentStatus: absent.status, platform: process.platform }));
  process.exit(0);
}
