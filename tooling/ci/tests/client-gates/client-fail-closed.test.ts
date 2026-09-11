/**
 * client-fail-closed — client gate, fleet-alignment wave (black box).
 *
 * Ruling (d), the acceptance probe from PLAN.md §6 / EXECUTION-RULES:
 *
 *   HASNA_STATION=no-such-station HOME=$(mktemp -d) <bin> <read-cmd>; echo $?   # non-zero
 *   find $HOME -name '*.db*'                                                    # empty
 *
 * For every hosted member with a built `<name>` bin, run its harmless read
 * verb (bins.ts HOSTED_READ_COMMANDS, the T4 probe set) in a scrubbed
 * process: an empty HOME, a station name no Keychain item exists for, no
 * `HASNA_*` / `<APP>_*` variables, stdin closed. A fail-closed client exits
 * non-zero and creates no `*.db*` file under HOME. Violations:
 *
 *   - exit 0 (the client answered from somewhere — a local store or a
 *     fabricated identity);
 *   - any `*.db*` created under the scratch HOME (a store was opened, even
 *     if the exit was non-zero);
 *   - a hang past the timeout (a fail-closed client must exit).
 *
 * Reads BUILT bins (client-gates CI job); unbuilt bins are `not-built` lines,
 * violations under HASNA_CLIENT_GATES_REQUIRE_BUILT=1.
 *
 * MODE: report-only at landing (GATE_MODES). Owners: W6 and each hosted
 * member's alignment PR (T1 §3.5 P0 list).
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR } from "../standard/census";
import { assertGate } from "../standard/gate-mode";
import { hostedMembersIn } from "../standard/hosted";
import { readCommandFor, requireBuilt, resolveBin } from "./bins";

export const GATE = "client-fail-closed";
const TIMEOUT_MS = 45_000;

export interface ProbeResult {
  member: string;
  status: "fail-closed" | "exit-zero" | "store-created" | "hung" | "not-built" | "undeclared";
  exitCode: number | null;
  dbFiles: string[];
  detail: string;
}

function findDbFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.db(?:$|[.-])|\.sqlite3?(?:$|[.-])/.test(e.name)) out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

/** Only what a bare process needs; every HASNA_* / <APP>_* / XDG_* variable is dropped. */
export function scrubbedEnv(home: string, member: string): Record<string, string> {
  const appPrefix = `${member.toUpperCase().replace(/-/g, "_")}_`;
  const env: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "SHELL", "TZ"]) {
    const v = process.env[key];
    if (v) env[key] = v;
  }
  void appPrefix;
  env.HOME = home;
  env.TMPDIR = path.join(home, "tmp");
  env.HASNA_STATION = "no-such-station";
  env.CI = "1";
  env.NO_COLOR = "1";
  env.TERM = "dumb";
  env.USER = "no-such-user";
  return env;
}

export async function probe(memberDir: string, member: string, command: string[] = readCommandFor(member)): Promise<ProbeResult> {
  const resolved = resolveBin(memberDir, member);
  if (!resolved) return { member, status: "undeclared", exitCode: null, dbFiles: [], detail: "package.json declares no <name> bin" };
  if (!resolved.exists) return { member, status: "not-built", exitCode: null, dbFiles: [], detail: `${resolved.declared} is not built in this checkout` };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `client-fail-closed-${member}-`));
  fs.mkdirSync(path.join(home, "tmp"));
  try {
    const proc = Bun.spawn(["bun", resolved.absolute, ...command], {
      cwd: home,
      env: scrubbedEnv(home, member),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const firstLine = (stderr.trim() || stdout.trim()).split("\n")[0]?.slice(0, 140) ?? "";
    const dbFiles = findDbFiles(home);
    const cmd = `${member} ${command.join(" ")}`;
    if (hung) return { member, status: "hung", exitCode: null, dbFiles, detail: `${cmd}: no exit within ${TIMEOUT_MS}ms` };
    if (dbFiles.length > 0) return { member, status: "store-created", exitCode, dbFiles, detail: `${cmd}: exit ${exitCode} but created ${dbFiles.join(", ")} under HOME` };
    if (exitCode === 0) return { member, status: "exit-zero", exitCode, dbFiles, detail: `${cmd}: exit 0 with no credential — ${firstLine}` };
    return { member, status: "fail-closed", exitCode, dbFiles, detail: `${cmd}: exit ${exitCode} — ${firstLine}` };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe("client gate: hosted clients fail closed without a credential (ruling d)", () => {
  test("every hosted member's <name> bin exits non-zero and creates no *.db under an empty HOME with HASNA_STATION=no-such-station", async () => {
    const results: ProbeResult[] = [];
    for (const member of hostedMembersIn(APPS_DIR)) results.push(await probe(path.join(APPS_DIR, member), member));
    const violations = results
      .filter((r) => r.status === "exit-zero" || r.status === "store-created" || r.status === "hung")
      .map((r) => `${r.member}: ${r.status}: ${r.detail}`);
    const notBuilt = results.filter((r) => r.status === "not-built");
    const closed = results.filter((r) => r.status === "fail-closed");
    console.info(`[${GATE}] census: ${closed.length} fail closed, ${violations.length} violation(s), ${notBuilt.length} not built across ${results.length} hosted member(s)`);
    for (const r of closed) console.info(`[${GATE}] ok: ${r.detail}`);
    for (const r of notBuilt) console.info(`[${GATE}] not-built: ${r.member}: ${r.detail}`);
    const all = requireBuilt() ? [...violations, ...notBuilt.map((r) => `${r.member}: not built — the client-gates job must build every hosted member before this test`)] : violations;
    assertGate(GATE, all, "resolve the credential through @hasna/contracts/client and exit non-zero when none resolves; never open a local store on the client path");
  }, 20 * 60_000);

  test("self-test: fires on a client that exits 0 and on one that creates a .db; stays silent on a client that exits non-zero and writes nothing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "client-fail-closed-self-test-"));
    try {
      const mk = (member: string, body: string) => {
        const dir = path.join(root, member);
        fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `@hasna/${member}`, bin: { [member]: "dist/cli.js" } }));
        fs.writeFileSync(path.join(dir, "dist", "cli.js"), body);
        return dir;
      };
      const open = mk("open", 'console.log("[]"); process.exit(0);\n');
      const store = mk("store", 'const fs = require("node:fs"); fs.mkdirSync(process.env.HOME + "/.hasna/store", { recursive: true }); fs.writeFileSync(process.env.HOME + "/.hasna/store/store.db", ""); console.error("no credential"); process.exit(1);\n');
      const closed = mk("closed", 'if (process.env.HASNA_STATION !== "no-such-station") process.exit(0); console.error("REMOTE_API_CREDENTIAL_INVALID: no credential resolved; failing closed"); process.exit(1);\n');
      expect((await probe(open, "open", ["list"])).status).toBe("exit-zero");
      const s = await probe(store, "store", ["list"]);
      expect(s.status).toBe("store-created");
      expect(s.dbFiles).toEqual([".hasna/store/store.db"]);
      const c = await probe(closed, "closed", ["list"]);
      expect(c.status).toBe("fail-closed");
      expect(c.exitCode).toBe(1);
      expect((await probe(path.join(root, "nope"), "nope", ["list"])).status).toBe("undeclared");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
