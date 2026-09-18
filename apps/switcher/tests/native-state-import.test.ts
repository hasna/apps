import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { link, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyNativeStateWarnings, resolveNativeState } from "../src/native-state";
import { applyNativeStateImport, nativeStateImportDigest, nativeStateImportSummary, planNativeStateImport } from "../src/native-state-import";

async function fixture(body: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switcher-state-import-")));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function file(root: string, path: string, value: string) {
  const target = join(root, path), parent = target.slice(0, target.lastIndexOf("/"));
  await mkdir(parent, { recursive: true, mode: 0o700 });await writeFile(target, value, { mode: 0o600 });
}

test("dry-run creates nothing; explicit staging keeps original transcript/tool IDs and skips credentials, SQLite, index and runtime locks", () => fixture(async root => {
  const source = join(root, "legacy");await mkdir(source, { mode: 0o700 });
  const transcript = '{"type":"function_call","call_id":"original-tool-id","arguments":"exact"}\n{"type":"function_call_output","call_id":"original-tool-id","output":"keep"}\n';
  await file(source, "sessions/2026/turn.jsonl", transcript);
  for (const name of ["auth.json", "config.toml", "state_5.sqlite", "state_5.sqlite-wal", "session_index.jsonl", "thread-writer-locks/thread.lock", "plugins/cache"]) await file(source, name, "excluded fixture");
  await file(source, ".hasna/instructions/example.md", "synthetic instruction fixture");
  await file(source, "skills/example/SKILL.md", "synthetic shared skill fixture");
  const original = await stat(join(source, "sessions/2026/turn.jsonl"));
  const state = await resolveNativeState("codex", { HOME: root }, { create: false });
  const plan = await planNativeStateImport(state, source);
  expect(plan.files.map(file => file.path).sort()).toEqual([".hasna/instructions/example.md", "sessions/2026/turn.jsonl", "skills/example/SKILL.md"]);
  expect(await readdir(root)).toEqual(["legacy"]);
  const summary=nativeStateImportSummary(plan, false);
  expect(summary).toMatchObject({ mode: "dry-run", entries: expect.arrayContaining(["sessions",".hasna/instructions"]), newFiles: 3, cutoverComplete: false });
  expect(summary).not.toHaveProperty("source");expect(summary).not.toHaveProperty("destination");
  await applyNativeStateImport(plan);
  expect(await readFile(join(state.home, "sessions/2026/turn.jsonl"), "utf8")).toBe(transcript);
  expect(await readFile(join(source, "sessions/2026/turn.jsonl"), "utf8")).toBe(transcript);
  const after = await stat(join(source, "sessions/2026/turn.jsonl"));expect(after.ino).toBe(original.ino);expect(after.mtimeMs).toBe(original.mtimeMs);
  expect((await readdir(state.home)).sort()).toEqual([".hasna", "sessions", "skills"]);
  expect(nativeStateImportSummary(plan, true)).toMatchObject({ mode: "staged-snapshot", cutoverComplete: false, originalsPreserved: true, sqliteCopied: false });
  const repeated = await planNativeStateImport(state, source);expect(repeated.files.every(file => file.existing)).toBe(true);await applyNativeStateImport(repeated);
}));

test("plan digest binds reviewed empty-directory topology", () => fixture(async root => {
  const state=await resolveNativeState("codex",{HOME:root},{create:false}),source=join(root,"legacy");await mkdir(join(source,"sessions/empty"),{recursive:true,mode:0o700});
  const plan=await planNativeStateImport(state,source,["sessions"]),changed={...plan,directories:[...plan.directories,"sessions/unreviewed"]};
  expect(nativeStateImportDigest(plan)).not.toBe(nativeStateImportDigest(changed));
}));

test("one divergent collision prevents all writes, including previously unseen conversations", () => fixture(async root => {
  const state = await resolveNativeState("codex", { HOME: root }), source = join(root, "legacy");
  await file(source, "sessions/a-new.jsonl", "new");await file(source, "sessions/z-existing.jsonl", "legacy divergence");
  await file(state.home, "sessions/z-existing.jsonl", "canonical original");
  await expect(planNativeStateImport(state, source)).rejects.toMatchObject({ code: "native_state_import_conflict" });
  expect(await readdir(join(state.home, "sessions"))).toEqual(["z-existing.jsonl"]);
  expect(await readFile(join(state.home, "sessions/z-existing.jsonl"), "utf8")).toBe("canonical original");
}));

test("changed source after preflight refuses staging before creating the destination", () => fixture(async root => {
  const state = await resolveNativeState("codex", { HOME: root }, { create: false }), source = join(root, "legacy");
  await file(source, "sessions/thread.jsonl", "before");
  const plan = await planNativeStateImport(state, source);
  await file(source, "sessions/thread.jsonl", "after");
  await expect(applyNativeStateImport(plan)).rejects.toMatchObject({ code: "native_state_import_conflict" });
  expect(await readdir(root)).toEqual(["legacy"]);
}));

test("symlinks, excluded entries and overlapping directories cannot import credential or unrelated state", () => fixture(async root => {
  const state = await resolveNativeState("codex", { HOME: root }), source = join(root, "legacy");
  await file(source, "auth.json", "private synthetic fixture");await mkdir(join(source, ".hasna/instructions"), { recursive:true,mode: 0o700 });
  await symlink(join(source, "auth.json"), join(source, ".hasna/instructions/bad"));
  await expect(planNativeStateImport(state, source)).rejects.toMatchObject({ code: "native_state_import_conflict" });
  await expect(planNativeStateImport(state, source, ["auth.json"])).rejects.toMatchObject({ code: "native_state_import_conflict" });
  await expect(planNativeStateImport(state, source, ["../auth.json"])).rejects.toMatchObject({ code: "native_state_import_conflict" });
  await expect(planNativeStateImport(state, root)).rejects.toMatchObject({ code: "native_state_import_conflict" });
  expect(await readdir(state.home)).toEqual([]);
}));

test("normal launch reports legacy state as pending even after copy-only staging; SQLite names remain preserved", () => fixture(async root => {
  const state = await resolveNativeState("codex", { HOME: root }), switcher = join(root, "switcher-state"), source = join(switcher, "desktop/old-provider/codex");
  await file(source, "sessions/thread.jsonl", "retained");await file(source, "state_5.sqlite", "opaque fixture");
  const before = await legacyNativeStateWarnings(switcher, state);expect(before).toHaveLength(1);expect(before[0]).toContain("migration is pending");expect(before[0]).toContain(source);
  await applyNativeStateImport(await planNativeStateImport(state, source, ["sessions"]));
  expect(await legacyNativeStateWarnings(switcher, state)).toEqual(before);
  expect(await readFile(join(source, "state_5.sqlite"), "utf8")).toBe("opaque fixture");
}));

test("actual local import CLI defaults to a read-only dry run without accessing the Switcher API", () => fixture(async root => {
  const source = join(root, "legacy");await file(source, "sessions/thread.jsonl", "fixture");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "state", "import", "codex", "--from", source], {
    env: { HOME: root, PATH: process.env.PATH }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
  expect(await child.exited, error).toBe(0);const receipt=JSON.parse(output);expect(receipt).toMatchObject({ mode: "dry-run", newFiles: 1, cutoverComplete: false });
  expect(receipt.source).toBeUndefined();expect(receipt.destination).toBeUndefined();expect(output).not.toContain(source);expect(receipt.planDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await readdir(root)).not.toContain(".codex");
  const wrong=Bun.spawn([process.execPath,join(import.meta.dir,"../src/cli.ts"),"state","import","codex","--from",source,"--apply","--plan-digest","0".repeat(64)],{env:{HOME:root,PATH:process.env.PATH},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const [wrongCode,wrongOut,wrongError]=await Promise.all([wrong.exited,new Response(wrong.stdout).text(),new Response(wrong.stderr).text()]);expect(wrongCode).toBe(1);expect(wrongOut).toBe("");expect(wrongError).toContain("native_state_plan_mismatch");expect(await readdir(root)).not.toContain(".codex");
  const apply=Bun.spawn([process.execPath,join(import.meta.dir,"../src/cli.ts"),"state","import","codex","--from",source,"--apply","--plan-digest",receipt.planDigest],{env:{HOME:root,PATH:process.env.PATH},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const [applyCode,applyOut,applyError]=await Promise.all([apply.exited,new Response(apply.stdout).text(),new Response(apply.stderr).text()]);expect(applyCode,applyError).toBe(0);expect(JSON.parse(applyOut)).toMatchObject({planDigest:receipt.planDigest,publishedFiles:1,cutoverComplete:false});expect(applyOut).not.toContain(source);
  expect(await readFile(join(root,".codex/sessions/thread.jsonl"),"utf8")).toBe("fixture");
  expect(await readFile(join(source, "sessions/thread.jsonl"), "utf8")).toBe("fixture");
}));

test("hardlinked aliases cannot copy an excluded authentication file through shared instructions", () => fixture(async root => {
  const state=await resolveNativeState("codex",{HOME:root}),source=join(root,"legacy");
  await file(source,"auth.json","synthetic private fixture");await mkdir(join(source,".hasna/instructions"),{recursive:true,mode:0o700});await link(join(source,"auth.json"),join(source,".hasna/instructions/alias.txt"));
  await expect(planNativeStateImport(state,source)).rejects.toMatchObject({code:"native_state_import_conflict"});expect(await readdir(state.home)).toEqual([]);
}));

test("divergent session IDs at different paths refuse import; identical IDs deduplicate across archived and active corpus", () => fixture(async root => {
  const state=await resolveNativeState("codex",{HOME:root}),source=join(root,"legacy"),id="00000000-0000-0000-0000-000000000001";
  const rollout=(text:string)=>JSON.stringify({type:"session_meta",payload:{id}})+"\n"+JSON.stringify({type:"response_item",payload:{type:"function_call_output",call_id:"retained-call",output:text}})+"\n";
  await file(source,"sessions/old/rollout.jsonl",rollout("old"));await file(state.home,"archived_sessions/new/rollout.jsonl",rollout("different"));
  await expect(planNativeStateImport(state,source)).rejects.toMatchObject({code:"native_state_import_conflict"});
  expect(await Bun.file(join(state.home,"sessions/old/rollout.jsonl")).exists()).toBe(false);
  await file(state.home,"archived_sessions/new/rollout.jsonl",rollout("old"));
  const identical=await planNativeStateImport(state,source);expect(identical.files[0]).toMatchObject({sessionId:id,existing:true});await applyNativeStateImport(identical);
  expect(await Bun.file(join(state.home,"sessions/old/rollout.jsonl")).exists()).toBe(false);
  await file(source,"sessions/other/rollout.jsonl",rollout("divergent source duplicate"));
  await expect(planNativeStateImport(state,source)).rejects.toMatchObject({code:"native_state_import_conflict"});
}));


test("exclusive staging collision preserves the competing temporary file", () => fixture(async root => {
  const source=join(root,"legacy"),state=await resolveNativeState("codex",{HOME:root});
  await file(source,"sessions/fixture.jsonl","original fixture\n");
  const plan=await planNativeStateImport(state,source,["sessions"]),originalOpen=fs.open;
  let collision="";
  const open=spyOn(fs,"open").mockImplementation(async (path:any,flags:any,mode:any)=>{
    if(String(path).includes(".switcher-import-")&&flags==="wx") {
      collision=String(path);await writeFile(collision,"competing writer",{mode:0o600,flag:"wx"});
    }
    return originalOpen(path,flags,mode);
  });
  try {await expect(applyNativeStateImport(plan)).rejects.toMatchObject({code:"EEXIST"});}
  finally {open.mockRestore();}
  expect(collision).not.toBe("");expect(await readFile(collision,"utf8")).toBe("competing writer");
  expect(await readFile(join(source,"sessions/fixture.jsonl"),"utf8")).toBe("original fixture\n");
  expect(await Bun.file(join(state.home,"sessions/fixture.jsonl")).exists()).toBe(false);
}));

for(const replacement of ["during-copy","after-copy"] as const)
  test(`staging cleanup preserves a replaced temporary inode ${replacement}`, () => fixture(async root => {
    const source=join(root,"legacy"),state=await resolveNativeState("codex",{HOME:root});
    await file(source,"sessions/a.jsonl","original a\n");await file(source,"sessions/b.jsonl","original b\n");
    const plan=await planNativeStateImport(state,source,["sessions"]),originalOpen=fs.open;
    let first="",replaced=false;let competing:Awaited<ReturnType<typeof stat>>|undefined;
    const open=spyOn(fs,"open").mockImplementation(async (path:any,flags:any,mode:any)=>{
      const handle=await originalOpen(path,flags,mode);
      if(String(path).includes(".switcher-import-")&&flags==="wx") {
        first ||= String(path);
        if(!replaced&&(replacement==="during-copy"||String(path)!==first)) {
          replaced=true;await fs.rename(first,join(root,"owned-temp-moved-by-fixture"));
          await writeFile(first,"replacement writer",{mode:0o600,flag:"wx"});competing=await stat(first);
        }
      }
      return handle;
    });
    try {await expect(applyNativeStateImport(plan)).rejects.toBeDefined();}
    finally {open.mockRestore();}
    expect(replaced).toBe(true);expect(await readFile(first,"utf8")).toBe("replacement writer");
    const after=await stat(first);expect(after.ino).toBe(competing!.ino);expect(after.mtimeMs).toBe(competing!.mtimeMs);
    expect(await Bun.file(join(state.home,"sessions/a.jsonl")).exists()).toBe(false);
    expect(await Bun.file(join(state.home,"sessions/b.jsonl")).exists()).toBe(false);
    expect(await readFile(join(source,"sessions/a.jsonl"),"utf8")).toBe("original a\n");
    expect(await readFile(join(source,"sessions/b.jsonl"),"utf8")).toBe("original b\n");
    expect(await readdir(join(state.home,"sessions"))).toEqual([first.slice(first.lastIndexOf("/")+1)]);
  }));
