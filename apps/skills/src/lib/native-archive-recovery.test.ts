import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function probe(mode: string): Record<string, any> {
  const home = mkdtempSync(join(tmpdir(), "skills-archive-recovery-")); roots.push(home);
  const script = `import { mock } from "bun:test";
import * as original from "node:fs"; import { join, dirname } from "node:path";
const fs = { ...original }, home = ${JSON.stringify(home)}, mode = ${JSON.stringify(mode)}, dataDir = join(home, "data");
const vendor = join(home, ".claude/plugins/cache/fixture/vendor/1/skills/a"), a = mode.startsWith("vendor") ? vendor : join(home, ".claude/skills/a"), b = join(home, ".claude/skills/b"), c = join(home, ".claude/skills/c");
for (const [index, root] of [a,b,c].entries()) { fs.mkdirSync(root,{recursive:true}); fs.writeFileSync(join(root,"SKILL.md"),"Original fixture "+index); fs.writeFileSync(join(root,"asset.txt"),"Preserved asset "+index); }
const sourceA = mode.startsWith("vendor") ? join(a,"SKILL.md") : a;
let archiveRoot, archiveA, archiveB, nativeMoves = 0, failed = false, faulted = false, journalBeforeFirstMove = false, journalFileFlushed = false, journalDirectoryFlushed = false;
const descriptors = new Map();
mock.module("node:fs", () => ({ ...fs,
 openSync(path,...args) { const fd = fs.openSync(path,...args); descriptors.set(fd,String(path)); return fd; },
 closeSync(fd) { descriptors.delete(fd); return fs.closeSync(fd); },
 linkSync(source,destination) { if(mode === "vendor-race" && destination === sourceA) fs.writeFileSync(sourceA,"Concurrent source edit"); return fs.linkSync(source,destination); },
 fsyncSync(fd) {
  if (!faulted && (mode === "journal-before" || mode === "journal-after" && nativeMoves === 1)) { faulted = true; throw Error("controlled-journal-failure"); }
  const path = descriptors.get(fd) || ""; if(path.includes("receipt.json")) journalFileFlushed = true;
  if(path.endsWith("/native") && journalFileFlushed) journalDirectoryFlushed = true;
  return fs.fsyncSync(fd);
 },
 renameSync(source,destination) {
  if ([sourceA,b,c].includes(String(source)) && String(destination).includes("/migration/")) {
   archiveRoot = dirname(String(destination));
   if (nativeMoves === 0) { const receipt = join(archiveRoot,"receipt.json"); journalBeforeFirstMove = fs.existsSync(receipt) && journalFileFlushed && journalDirectoryFlushed; }
   if ((["rollback","vendor-conflict","vendor-race","archive-changed"].includes(mode) && source === b) || mode === "directory-conflict" && source === c) throw Error("controlled-move-failure");
   fs.renameSync(source,destination); nativeMoves++;
   if (mode === "crash-after-move") process.kill(process.pid,"SIGKILL");
   if (source === sourceA) { archiveA = String(destination);
    if (mode === "vendor-conflict") fs.writeFileSync(sourceA,"Concurrent source edit");
    if (mode === "archive-changed") fs.writeFileSync(join(archiveA,"SKILL.md"),"Changed archived bytes");
   }
   if (source === b) { archiveB=String(destination); if(mode === "directory-conflict") {fs.mkdirSync(b);fs.writeFileSync(join(b,"concurrent.txt"),"Concurrent directory edit");} }
   return;
  }
  return fs.renameSync(source,destination);
 }
}));
const { inventoryNativeSkills, archiveNativeSkills } = await import(${JSON.stringify(new URL("./agent-integration.ts", import.meta.url).href)});
const all = inventoryNativeSkills(home,{includeVendor:true}), order=[a,b,c];const inventory=all.filter(v=>order.includes(v.path)).sort((x,y)=>order.indexOf(x.path)-order.indexOf(y.path));
let result;try { result=archiveNativeSkills(inventory,{dataDir,includeUnmanaged:true,includeVendor:true}); } catch { failed=true; }
if(!archiveRoot && fs.existsSync(join(dataDir,"migration"))) {const directories=fs.readdirSync(join(dataDir,"migration"));if(directories.length===1)archiveRoot=join(dataDir,"migration",directories[0],"native");}
let receipt=null;try{receipt=JSON.parse(fs.readFileSync(join(archiveRoot,"receipt.json"),"utf8"));}catch{}
const read=path=>{try{return fs.readFileSync(path,"utf8");}catch{return null;}};
console.log(JSON.stringify({failed,nativeMoves,journalBeforeFirstMove,journalStatus:receipt?.status,journalVersion:receipt?.version,journalEntries:receipt?.entries?.map(v=>({status:v.status,conflict:v.conflict})),journalMode:receipt?fs.statSync(join(archiveRoot,"receipt.json")).mode&511:null,
 originalARestored:read(join(a,"SKILL.md"))==="Original fixture 0",originalBRestored:read(join(b,"SKILL.md"))==="Original fixture 1",concurrentFilePreserved:read(sourceA)==="Concurrent source edit",concurrentDirectoryPreserved:read(join(b,"concurrent.txt"))==="Concurrent directory edit",archiveARetained:!!archiveA&&fs.existsSync(archiveA),archiveBRetained:!!archiveB&&fs.existsSync(archiveB),changedArchivePreserved:!!archiveA&&read(join(archiveA,"SKILL.md"))==="Changed archived bytes",sourceAAbsent:!fs.existsSync(sourceA),successfulEntries:result?.entries?.length,assetsPreserved:mode==="vendor-conflict"?read(join(a,"asset.txt"))==="Preserved asset 0":!!archiveA&&read(join(archiveA,"asset.txt"))==="Preserved asset 0"}));`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
    cwd: home, env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe", timeout: 10000,
  });
  if (mode === "crash-after-move") {
    expect(child.signalCode).toBe("SIGKILL");
    const directory = join(home, "data/migration", readdirSync(join(home, "data/migration"))[0]!, "native");
    const journal = JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8"));
    return { journalStatus: journal.status, entryStatus: journal.entries[0].status, sourceMissing: !existsSync(journal.entries[0].source), archivePresent: existsSync(journal.entries[0].archive) };
  }
  expect(child.exitCode).toBe(0);
  return JSON.parse(child.stdout.toString());
}

test("native archives durably record every planned move before mutation and completion afterward", () => {
  expect(probe("success")).toMatchObject({ failed: false, journalBeforeFirstMove: true, journalStatus: "completed", journalVersion: 2, journalMode: 0o600, successfulEntries: 3, assetsPreserved: true });
});

test("ordinary archive failure restores unchanged owned sources and leaves a failure journal", () => {
  expect(probe("rollback")).toMatchObject({ failed: true, originalARestored: true, originalBRestored: true, journalBeforeFirstMove: true, journalStatus: "failed" });
});

test("vendor rollback preserves a concurrent discovery document and its owned archive", () => {
  expect(probe("vendor-conflict")).toMatchObject({ failed: true, concurrentFilePreserved: true, archiveARetained: true, assetsPreserved: true, journalStatus: "failed" });
});

test("an occupied directory does not stop compensation of other unchanged native sources", () => {
  expect(probe("directory-conflict")).toMatchObject({ failed: true, concurrentDirectoryPreserved: true, archiveBRetained: true, originalARestored: true, journalStatus: "failed" });
});

test("changed archive bytes are retained for review instead of restored into native discovery", () => {
  expect(probe("archive-changed")).toMatchObject({ failed: true, changedArchivePreserved: true, archiveARetained: true, sourceAAbsent: true, journalStatus: "failed" });
});

test("an undurable initial journal refuses before moving any native payload", () => {
  expect(probe("journal-before")).toMatchObject({ failed: true, nativeMoves: 0, originalARestored: true, originalBRestored: true });
});

test("a post-move journal failure compensates the already moved payload", () => {
  expect(probe("journal-after")).toMatchObject({ failed: true, originalARestored: true, originalBRestored: true, journalStatus: "failed" });
});


test("vendor compensation atomically refuses a document created after its absence check", () => {
  expect(probe("vendor-race")).toMatchObject({ failed: true, concurrentFilePreserved: true, archiveARetained: true, journalStatus: "failed" });
});

test("a killed worker leaves durable intent identifying an in-flight moved payload", () => {
  expect(probe("crash-after-move")).toEqual({ journalStatus: "archiving", entryStatus: "moving", sourceMissing: true, archivePresent: true });
});

test.skipIf(process.platform === "win32")("native archive ownership reads refuse a regular file replaced by a FIFO without hanging", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-archive-fifo-")); roots.push(home);
  const script = `import { mock } from "bun:test"; import * as original from "node:fs"; import { join } from "node:path";
const fs={...original},home=${JSON.stringify(home)},root=join(home,".claude/skills/a"),target=join(root,"SKILL.md");fs.mkdirSync(root,{recursive:true});fs.writeFileSync(target,"Original fixture");let swapped=false;
mock.module("node:fs",()=>({...fs,lstatSync(path,...args){const stat=fs.lstatSync(path,...args);if(String(path)===target&&!swapped){swapped=true;fs.unlinkSync(target);if(Bun.spawnSync(["mkfifo",target]).exitCode!==0)throw Error("fixture setup failed");}return stat;}}));
const {inventoryNativeSkills}=await import(${JSON.stringify(new URL("./agent-integration.ts", import.meta.url).href)});let refused=false;try{inventoryNativeSkills(home);}catch{refused=true;}console.log(JSON.stringify({swapped,refused}));`;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], { cwd: home, env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe", timeout: 3000 });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual({ swapped: true, refused: true });
});
