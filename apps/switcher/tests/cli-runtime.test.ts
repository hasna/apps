import { test, expect } from "bun:test";
import { SQL } from "bun";
import { mkdir, mkdtemp, writeFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCliRuntime } from "../src/runtime";
import { providerFromPreset, providerCredential } from "../src/presets";
import { SwitcherClient } from "../src/sdk";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/switcher-tests");
async function directory() { await mkdir(scratch, {recursive:true}); return mkdtemp(join(scratch, "cli-runtime-")); }
async function command(home: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn([process.execPath, cli, ...args], {cwd: home, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, HASNA_SWITCHER_HOME: join(home, "data"), ...extra,
  }, stdout: "pipe", stderr: "pipe", stdin: "ignore"});
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
  } finally { clearTimeout(timer); }
}

test("interactive model selection cancels on Ctrl-C, Ctrl-D and SIGTERM without leaving the owned API alive", async () => {
  const upstream = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({data:[{id:"fixture-model"}]})});
  try {
    for (const input of ["\x03","\x04","SIGTERM"] as const) {
      const dir = await directory();
      let output = "", cancelled = false, timedOut = false;
      const child = Bun.spawn([process.execPath,cli,"launch","claude","--provider","generic-anthropic-messages","--url",upstream.url.origin], {
        cwd:dir, env:{PATH:process.env.PATH,HOME:process.env.HOME,USER:process.env.USER,HASNA_SWITCHER_HOME:join(dir,"data")},
        terminal:{cols:120,rows:40,data(terminal,data) {
          output += new TextDecoder().decode(data);
          if (!cancelled && output.includes("Ctrl-C cancels): ")) {
            cancelled = true;
            if (input === "SIGTERM") child.kill("SIGTERM"); else terminal.write(input);
          }
        }},
      });
      const timer = setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},10_000);
      try {
        const code = await child.exited;
        expect(cancelled,output).toBe(true);
        expect(timedOut,output).toBe(false);
        expect(code,output).toBe(input === "SIGTERM" ? 143 : 130);
        expect(output).toContain("no harness was started");
        const runs = await command(dir,["runs","list"]);
        expect(runs.code,runs.stderr).toBe(0);
        expect(JSON.parse(runs.stdout).total).toBe(0);
      } finally { clearTimeout(timer);child.terminal?.close();await rm(dir,{recursive:true,force:true}); }
    }
  } finally { await upstream.stop(true); }
},40_000);

test("owned API is authenticated, persists data on reopen and closes its listener", async () => {
  const dir = await directory();
  let runtime: Awaited<ReturnType<typeof openCliRuntime>> | undefined;
  try {
    runtime = await openCliRuntime({HASNA_SWITCHER_HOME: join(dir, "data")});
    expect(runtime.mode).toBe("local");
    expect((await runtime.client.health()).backend).toBe("sqlite");
    expect((await runtime.client.ready()).ready).toBe(true);
    expect((await fetch(runtime.client.baseUrl + "/v1/providers")).status).toBe(401);
    expect((await runtime.client.getProviderPreset("deepseek")).protocols.find(p => p.protocol === "anthropic-messages")?.catalogBaseUrl).toBe("https://api.deepseek.com");
    await runtime.client.createProvider(providerFromPreset("deepseek", {harness:"claude"}));
    const address = runtime.client.baseUrl;
    await runtime.close(); await runtime.close();
    await expect(fetch(address + "/health")).rejects.toThrow();
    runtime = await openCliRuntime({HASNA_SWITCHER_HOME: join(dir, "data")});
    expect((await runtime.client.listProviders()).total).toBe(1);
    expect((await stat(join(dir, "data"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, "data/switcher.db"))).mode & 0o777).toBe(0o600);
    expect((await readdir(join(dir, "data"))).filter(name => /token|credential|key/i.test(name))).toEqual([]);
  } finally { await runtime?.close(); await rm(dir, {recursive:true,force:true}); }
});

test("actual CLI auto-configures split DeepSeek catalog, launches a harness, reuses profile and cleans state", async () => {
  const dir = await directory();
  const requested: string[] = [];
  const upstream = Bun.serve({hostname:"127.0.0.1", port:0, fetch(req) {
    const path = new URL(req.url).pathname; requested.push(path);
    if (req.headers.get("authorization") !== "Bearer fixture-deepseek-key") return new Response("Unauthorized", {status:401});
    return path === "/models" ? Response.json({data:[{id:"fixture-pro"},{id:"fixture-flash"}]}) : new Response("Not found",{status:404});
  }});
  try {
    const executable = join(dir,"claude-fixture");
    await writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--version')) { console.log('2.1.261 (Claude Code)'); } else {\nconst args=process.argv.slice(2); const file=args[args.indexOf('--settings')+1]; const settings=await Bun.file(file).json();\nconsole.log(JSON.stringify({model:process.env.ANTHROPIC_MODEL,base:process.env.ANTHROPIC_BASE_URL,catalog:settings.modelPicker.options.map(m=>m.model),authCorrect:process.env.ANTHROPIC_AUTH_TOKEN==='fixture-deepseek-key',operatorPresent:!!process.env.HASNA_SWITCHER_API_KEY,unrelatedPresent:!!process.env.UNRELATED_API_KEY,args}));\n}\n`, {mode:0o700});
    const args = ["launch","claude","--provider","deepseek","--model","fixture-pro","--url",upstream.url.origin+"/anthropic/v1","--catalog-url",upstream.url.origin,"--credential-env","SWITCHER_PROVIDER_FIXTURE","--executable",executable];
    for (let i=0; i<2; i++) {
      const result = await command(dir,args,{SWITCHER_PROVIDER_FIXTURE:"fixture-deepseek-key",UNRELATED_API_KEY:"fixture-unrelated"});
      expect(result.code, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.model).toBe("fixture-pro"); expect(output.catalog).toEqual(["fixture-pro","fixture-flash"]);
      expect(output.base).toBe(upstream.url.origin+"/anthropic");
      expect(output.authCorrect).toBe(true); expect(output.operatorPresent).toBe(false); expect(output.unrelatedPresent).toBe(false);
      expect(result.stdout).not.toContain("fixture-deepseek-key");
    }
    expect(requested).toEqual(["/models","/models"]);
    const profiles = await command(dir,["profiles","list"]);
    expect(profiles.code, profiles.stderr).toBe(0); expect(JSON.parse(profiles.stdout).total).toBe(1);
    const runs = await command(dir,["runs","list"]);
    expect(JSON.parse(runs.stdout).data.map((r:any)=>r.status)).toEqual(["exited","exited"]);
    expect(await readdir(join(dir,"data/state"))).toEqual([]);
    const invalid = await command(dir,args.map((value,i)=>i===5?"absent":value),{SWITCHER_PROVIDER_FIXTURE:"fixture-deepseek-key"});
    expect(invalid.code).toBe(1); expect(JSON.parse(invalid.stderr).error.code).toBe("model_missing");
  } finally { await upstream.stop(true); await rm(dir,{recursive:true,force:true}); }
}, 60_000);

test("remote configuration never creates local data, including missing keys and unavailable servers", async () => {
  const dir = await directory();
  const offline = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response()});
  const url = offline.url.href; await offline.stop(true);
  try {
    for (const env of [{HASNA_SWITCHER_API_URL:url},{HASNA_SWITCHER_API_KEY:"fixture-operator-key-that-is-not-real"},{HASNA_SWITCHER_API_URL:url,HASNA_SWITCHER_API_KEY:"fixture-operator-key-that-is-not-real"}]) {
      const result = await command(dir,["providers","list"],env);
      expect(result.code).toBe(1); expect(result.stderr).not.toContain("fixture-operator-key-that-is-not-real");
      expect(await readdir(dir)).toEqual([]);
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("concurrent first-run CLI processes share SQLite without startup-lock failures or duplicate writes", async () => {
  const dir = await directory();
  try {
    const results = await Promise.all(Array.from({length:12},(_,i)=>command(dir,["providers","add",`concurrent-${i}`,"--preset","openrouter","--protocol","openai-chat"])));
    expect(results.map(r=>({code:r.code,stderr:r.stderr}))).toEqual(results.map(()=>({code:0,stderr:""})));
    const list = await command(dir,["providers","list"]);
    expect(list.code, list.stderr).toBe(0); expect(JSON.parse(list.stdout).total).toBe(12);
    const [a,b] = await Promise.all([openCliRuntime({HASNA_SWITCHER_HOME:join(dir,"data")}),openCliRuntime({HASNA_SWITCHER_HOME:join(dir,"data")})]);
    try {
      const input=providerFromPreset("deepseek");
      const [first,second] = await Promise.all([a.client.createProvider(input,"cross-process-idempotent"),b.client.createProvider(input,"cross-process-idempotent")]);
      expect(first).toEqual(second);
      const writes = await Promise.allSettled([a.client.updateProvider({...input,name:"First"},1),b.client.updateProvider({...input,name:"Second"},1)]);
      expect(writes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
      expect((writes.find(r=>r.status==="rejected") as PromiseRejectedResult).reason.code).toBe("version_conflict");
    } finally { await a.close(); await b.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
}, 60_000);

test("preset aliases cannot follow endpoint overrides to a different origin", () => {
  expect(()=>providerFromPreset("deepseek",{harness:"codex"})).toThrow("compatible");
  expect(()=>providerFromPreset("deepseek",{baseUrl:"https://other.example/v1"})).toThrow("credential-env");
  const original=providerFromPreset("deepseek",{harness:"claude"});
  expect(providerCredential(original,{DEEPSEEK_API_KEY:"fixture-alias"})).toBe("fixture-alias");
  expect(providerCredential({...original,baseUrl:"https://other.example/v1"},{DEEPSEEK_API_KEY:"fixture-alias"})).toBeUndefined();
});


test.skipIf(!process.env.SWITCHER_TEST_DATABASE_URL)("CLI-owned PostgreSQL API persists across separate command processes", async () => {
  const dir = await directory();
  const admin = new SQL(process.env.SWITCHER_TEST_DATABASE_URL!);
  const schema = `switcher_cli_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.SWITCHER_TEST_DATABASE_URL!); url.searchParams.set("options", `-c search_path=${schema}`);
    const env = {HASNA_SWITCHER_DATABASE_URL:url.href};
    const add = await command(dir,["providers","add","pg-deepseek","--preset","deepseek","--protocol","anthropic-messages"],env);
    expect(add.code,add.stderr).toBe(0);
    const read = await command(dir,["providers","get","pg-deepseek"],env);
    expect(read.code,read.stderr).toBe(0);
    expect(JSON.parse(read.stdout).catalogBaseUrl).toBe("https://api.deepseek.com");
    expect(await readdir(dir)).toEqual([]);
    const runtime = await openCliRuntime(env);
    try { expect((await runtime.client.health()).backend).toBe("postgresql"); expect((await runtime.client.listProviders()).total).toBe(1); }
    finally { await runtime.close(); }
  } finally { await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.close(); await rm(dir,{recursive:true,force:true}); }
}, 30_000);

test("CLI remote mode writes to the chosen API and leaves local data absent", async () => {
  const dir = await directory();
  const remoteDir = join(dir,"client"); await mkdir(remoteDir);
  try {
    // A dedicated server with an explicit public test token allows an independent CLI process.
    const {startServer} = await import("../src/server");
    const service = await startServer({apiKey:"fixture-remote-operator-token-not-real",sqlitePath:join(dir,"remote.db")});
    try {
      const result = await command(remoteDir,["providers","add","remote-provider","--preset","openrouter"],{
        HASNA_SWITCHER_API_URL:service.url,HASNA_SWITCHER_API_KEY:"fixture-remote-operator-token-not-real",
        HASNA_SWITCHER_DATABASE_URL:"postgresql://invalid.example/should-not-be-used",
      });
      expect(result.code,result.stderr).toBe(0);
      const client = new SwitcherClient({baseUrl:service.url,apiKey:"fixture-remote-operator-token-not-real"});
      expect((await client.getProvider("remote-provider")).baseUrl).toBe("https://openrouter.ai/api/v1");
      expect(await readdir(remoteDir)).toEqual([]);
    } finally { await service.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});


test("CLI rejects conflicting file and saved-profile overrides before opening any API", async () => {
  const dir = await directory();
  try {
    for (const flags of [["--catalog-url","https://other.example"],["--auth-style","x-api-key"],["--preset","deepseek"],["--search","ignored"],["--refresh"]]) {
      const result = await command(dir,["launch","saved",...flags]);
      expect(result.code).toBe(1); expect(JSON.parse(result.stderr).error.code).toBe("conflicting_options");
    }
    const result = await command(dir,["providers","add","fixture","--file","absent.json","--url","https://other.example"]);
    expect(result.code).toBe(1); expect(JSON.parse(result.stderr).error.code).toBe("conflicting_options");
    expect(await readdir(dir)).toEqual([]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
