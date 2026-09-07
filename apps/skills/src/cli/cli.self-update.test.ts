import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-self-update-")), binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type FixtureCase = { name: string; text?: string; versionExit?: number; installExit?: number; fault?: "spawn" | "read"; disabled?: boolean };
const cases: FixtureCase[] = [
  { name: "release", text: "0.4.2" }, { name: "prerelease", text: "1.2.3-rc.1+build.5" },
  { name: "nonzero-version", text: "0.4.2", versionExit: 7 }, { name: "empty-version", text: "" },
  { name: "invalid-version", text: "not-a-version" }, { name: "multiple-versions", text: "0.4.2\n0.4.3" },
  { name: "leading-zero-version", text: "01.2.3" }, { name: "version-spawn-failure", fault: "spawn" },
  { name: "version-read-failure", fault: "read" }, { name: "installer-failure", installExit: 7 },
  { name: "test-mode", disabled: true },
];

/** These are real owned children substituting only the two exact commands.
 * No global installer, registry-latest or PATH ownership behavior is exercised. */
for (const json of [false, true]) test(`self-update verifies the post-install child (${json ? "JSON" : "human"})`, async () => {
  for (const row of cases) {
    const root = mkdtempSync(join(scratch, "owned-")), home = join(root, "home"), guard = join(root, "guard.ts"), child = join(root, "child.ts");
    mkdirSync(home); writeFileSync(join(home, "keep"), "Caller credentials and profile are unchanged\n", { mode: 0o600 });
    const log = join(root, "calls.jsonl"), markers = join(root, "markers.jsonl"), ready = join(root, "ready");
    writeFileSync(log, ""); writeFileSync(markers, "");
    let httpRequests = 0;
    const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { httpRequests++; return new Response("Unexpected update fixture HTTP"); } });
    writeFileSync(child, `import {appendFileSync,writeFileSync} from "node:fs";
const phase=process.argv[2];appendFileSync(${JSON.stringify(markers)},JSON.stringify({phase,home:process.env.HOME})+"\\n");
if(phase==="install"){console.log("owned installer output");console.error("owned installer diagnostic");process.exitCode=${row.installExit ?? 0};}
else {${row.fault === "read" ? `writeFileSync(${JSON.stringify(ready)},"ready");await Bun.sleep(2000);` : ""}
${row.text ? `console.log(${JSON.stringify(row.text)});` : ""}process.exitCode=${row.versionExit ?? 0};}\n`);
    writeFileSync(guard, `import {appendFileSync,existsSync} from "node:fs";import cp from "node:child_process";import {syncBuiltinESMExports} from "node:module";
const isChild=process.argv[1]===${JSON.stringify(child)},note=row=>appendFileSync(${JSON.stringify(log)},JSON.stringify(row)+"\\n");
const deny=kind=>{note({kind,phase:isChild?"child":"cli"});throw Error("Owned update guard refusal");};
const fetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{if(/^https?:/.test(input instanceof Request?input.url:String(input)))return deny("http");return fetch(input,init);};
const spawn=Bun.spawn.bind(Bun);Bun.spawn=(args,options)=>{
 const install=JSON.stringify(args)===JSON.stringify(["bun","add","-g","@hasna/skills@latest"]),version=JSON.stringify(args)===JSON.stringify(["skills","--version"]);
 if(isChild||!install&&!version)return deny("bun");note({kind:"command",command:install?"install":"version"});
 if(version&&${JSON.stringify(row.fault)}==="spawn")throw Error("Owned version spawn refusal");
 const proc=spawn([process.execPath,"--no-env-file","--preload",${JSON.stringify(guard)},${JSON.stringify(child)},install?"install":"version"],{...options,stdin:"ignore"});note({kind:"pid",pid:proc.pid});
 if(version&&${JSON.stringify(row.fault)}==="read")return {stdout:new ReadableStream({async start(controller){const until=Date.now()+1000;while(!existsSync(${JSON.stringify(ready)})&&Date.now()<until)await Bun.sleep(5);if(!existsSync(${JSON.stringify(ready)}))throw Error("Owned child readiness missing");controller.error(Error("Owned stream read failure"));}}),get exitCode(){return proc.exitCode;},exited:proc.exited,kill:signal=>proc.kill(signal)};
 return proc;
};Bun.spawnSync=()=>deny("bun-sync");for(const key of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])cp[key]=()=>deny("node");syncBuiltinESMExports();
let controls=0;try{await globalThis.fetch(${JSON.stringify(trap.url.href)});}catch{controls++;}try{Bun.spawn([process.execPath,"--version"]);}catch{controls++;}try{cp.execFileSync(process.execPath,["--version"]);}catch{controls++;}if(controls!==3)throw Error("Owned guard controls failed");note({kind:"control",phase:isChild?"child":"cli"});\n`);
    const sources = [child, guard].map(path => [path, readFileSync(path, "utf8")] as const);
    const proc = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "self-update", ...(json ? ["--json"] : [])], {
      cwd: root, env: { HOME: home, PATH: "", TMPDIR: root, NO_COLOR: "1", TERM: "dumb", SKILLS_TEST_MODE: row.disabled ? "1" : "0", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      detached: process.platform !== "win32", stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const stop = () => {
      if (process.platform !== "win32" && Number.isSafeInteger(proc.pid) && proc.pid > 1) {
        try { process.kill(-proc.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      } else if (proc.exitCode === null) proc.kill("SIGKILL");
    };
    const deadline = setTimeout(stop, 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      const success = row.name === "release" || row.name === "prerelease", verificationFailure = !success && !row.disabled && !row.installExit;
      expect(exitCode).toBe(success ? 0 : 1);
      if (json) {
        const result = JSON.parse(stdout);
        if (success) expect(result).toEqual({ updated: true, version: row.text, stdout: "owned installer output\n", stderr: "owned installer diagnostic\n" });
        else if (row.disabled) expect(result).toEqual({ updated: false, error: "Self-update disabled in test mode" });
        else if (row.installExit) expect(result).toEqual({ updated: false, exitCode: 7, stdout: "owned installer output\n", stderr: "owned installer diagnostic\n" });
        else expect(result).toMatchObject({ updated: false, stage: "verification", error: expect.stringContaining("Installation may have completed"), stdout: "owned installer output\n", stderr: "owned installer diagnostic\n" });
      } else if (success) { expect(stdout).toContain("Updated to latest version"); expect(stdout).toContain(`Version: ${row.text}`); }
      else if (verificationFailure) { expect(stdout).not.toContain("Updated to latest version"); expect(stderr).toContain("Installation may have completed"); }
      else expect(stderr).toContain(row.disabled ? "Self-update disabled in test mode" : "Update failed");
      const observations = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(observations.filter(item => item.kind === "command").map(item => item.command)).toEqual(row.disabled ? [] : row.installExit ? ["install"] : ["install", "version"]);
      expect(observations.filter(item => item.phase === "cli").map(item => item.kind)).toEqual(["http", "bun", "node", "control"]);
      const ran = readFileSync(markers, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      expect(ran).toEqual((row.disabled ? [] : row.installExit || row.fault === "spawn" ? ["install"] : ["install", "version"]).map(phase => ({ phase, home })));
      expect(observations.filter(item => item.kind === "control" && item.phase === "child")).toHaveLength(ran.length);
      for (const item of observations.filter(item => item.kind === "pid")) {
        let gone = false; try { process.kill(item.pid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        expect(gone).toBe(true);
      }
      expect(httpRequests).toBe(0); expect(readdirSync(home)).toEqual(["keep"]);
      expect(readFileSync(join(home, "keep"), "utf8")).toBe("Caller credentials and profile are unchanged\n");
      for (const [path, bytes] of sources) expect(readFileSync(path, "utf8")).toBe(bytes);
    } finally { clearTimeout(deadline); stop(); await proc.exited; trap.stop(true); rmSync(root, { recursive: true, force: true }); }
  }
});
