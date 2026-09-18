import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCodexSessions, resolveCodexResumeArguments } from "../src/codex-session-discovery";
import { HarnessSettlementError } from "../src/harness-process";
import type { PreparedLaunch } from "../src/harness-types";

async function fixture(body: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switcher-discovery-lifecycle-")));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const id = "00000000-0000-0000-0000-000000000001";

test.skipIf(process.platform === "win32")("picker revalidates after input and binary drift prevents the next page process", () => fixture(async root => {
  const binary = join(root, "native"), calls = join(root, "calls"), driver = join(root, "driver.ts");
  await writeFile(binary, `#!${process.execPath}\nimport{appendFileSync}from'node:fs';import{createInterface}from'node:readline';
appendFileSync(${JSON.stringify(calls)},'spawn\\n');
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/list')console.log(JSON.stringify({id:r.id,result:{data:[{id:${JSON.stringify(id)},cwd:${JSON.stringify(root)},name:'Fixture session'}],nextCursor:'second-page'}}));});\n`, { mode: 0o700 });
  await writeFile(driver, `import{codexFileGuard}from ${JSON.stringify(join(import.meta.dir, "../src/codex-native.ts"))};
import{listCodexSessions,resolveCodexResumeArguments}from ${JSON.stringify(join(import.meta.dir, "../src/codex-session-discovery.ts"))};
const prepared={executable:${JSON.stringify(binary)},args:[],env:{HOME:${JSON.stringify(root)}},configPaths:[],warnings:[]};
const guard=await codexFileGuard(prepared.executable,1024*1024,undefined,true);
try{await resolveCodexResumeArguments(prepared,['resume'],${JSON.stringify(root)},(p,c,q)=>listCodexSessions(p,c,q,guard));process.exitCode=90;}
catch(error){console.log('REFUSED:'+error.code);process.exitCode=23;}
`, { mode: 0o600 });
  let output = "", edited = false, timedOut = false;
  const child = Bun.spawn([process.execPath, driver], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, terminal: {
    data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!edited && output.includes("Number, search text")) {
        edited = true;
        void writeFile(binary, "changed native fixture\n").then(() => terminal.write("n\n"));
      }
    },
  } });
  const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 8000);
  try {
    expect(await child.exited, output).toBe(23); expect(timedOut).toBe(false); expect(edited).toBe(true);
    expect(output).toContain("REFUSED:codex_native_unverified");
    expect(await readFile(calls, "utf8")).toBe("spawn\n");
  } finally { clearTimeout(timeout); child.terminal?.close(); }
}), 10000);

for (const pipes of ["inherit", "ignore"] as const) {
  test.skipIf(process.platform === "win32")(`discovery settles descendants with ${pipes} output after leader exit`, () => fixture(async root => {
    const childScript = join(root, "descendant.ts"), leader = join(root, "leader.ts"), pidFile = join(root, "descendant.pid"), groupFile = join(root, "group.pid");
    await writeFile(childScript, `import{writeFileSync}from'node:fs';process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),100));writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`, { mode: 0o600 });
    await writeFile(leader, `import{spawn}from'node:child_process';import{writeFileSync,existsSync}from'node:fs';import{createInterface}from'node:readline';
writeFileSync(${JSON.stringify(groupFile)},String(process.pid));spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(childScript)}],{stdio:${JSON.stringify(pipes)}});
createInterface({input:process.stdin}).on('line',async line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/list'){while(!existsSync(${JSON.stringify(pidFile)}))await Bun.sleep(5);process.stdout.write(JSON.stringify({id:r.id,result:{data:[],nextCursor:null}})+'\\n',()=>process.exit(0));}});`, { mode: 0o600 });
    const prepared: PreparedLaunch = { executable: process.execPath, args: [leader], env: { HOME: root }, configPaths: [], warnings: [] };
    let group: number | undefined;
    try {
      expect(await listCodexSessions(prepared, root, { limit: 1 })).toEqual({ data: [], nextCursor: null });
      group = Number(await readFile(groupFile, "utf8"));
      expect(() => process.kill(-group!, 0)).toThrow();
      expect(() => process.kill(Number(require("node:fs").readFileSync(pidFile, "utf8")), 0)).toThrow();
    } finally {
      group ??= Number(await readFile(groupFile, "utf8").catch(() => "0"));
      if (group > 0) { try { process.kill(-group, "SIGKILL"); } catch {} }
    }
  }), 15000);
}

test("missing discovery close event is bounded and reports settlement uncertainty", async () => {
  const stdout = new PassThrough();
  const stdin = new Writable({ write(chunk, _encoding, done) {
    const request = JSON.parse(chunk.toString());
    if (request.method === "initialize" || request.method === "thread/list") queueMicrotask(() => stdout.write(JSON.stringify({ id: request.id,
      result: request.method === "initialize" ? {} : { data: [], nextCursor: null } }) + "\n"));
    done();
  } });
  // A synthetic leader is already exited but never reports closed pipes. There
  // is no native process to kill; this checks the deadline independently.
  const signals: Array<string | number | undefined> = [];
  const fake = Object.assign(new EventEmitter(), { stdin, stdout, pid: 2147483000, exitCode: 0, signalCode: null,
    kill(signal: NodeJS.Signals) { signals.push(signal); } });
  // No OS process is addressed. A group already known gone must not receive a
  // delayed KILL merely because some unrelated pipe still prevents `close`.
  const kill = spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0) throw Object.assign(new Error("Synthetic group is gone"), { code: "ESRCH" });
    signals.push(signal); return true;
  });
  const spawn = spyOn(childProcess, "spawn").mockReturnValue(fake as any);
  const started = performance.now();
  try {
    await expect(listCodexSessions({ executable: "not-executed", args: [], env: {}, configPaths: [], warnings: [] }, "/", { limit: 1 }))
      .rejects.toBeInstanceOf(HarnessSettlementError);
    expect(performance.now() - started).toBeLessThan(8000);
    expect(stdout.destroyed).toBe(true); expect(stdin.destroyed).toBe(true);
    expect(signals).not.toContain("SIGKILL");
  } finally { spawn.mockRestore(); kill.mockRestore(); stdout.destroy(); stdin.destroy(); }
}, 10000);

test("exact resume IDs and exec commands never invoke discovery", async () => {
  const prepared: PreparedLaunch = { executable: "not-executed", args: [], env: {}, configPaths: [], warnings: [] };
  let called = 0;
  const refuse = async () => { called++; throw new Error("Discovery must not run"); };
  for (const args of [["resume", id], ["exec", "resume", id], ["exec", "--", "resume"], ["--", "resume"]])
    expect(await resolveCodexResumeArguments(prepared, args, "/", refuse)).toEqual(args);
  expect(called).toBe(0);
});
