import { test, expect } from "bun:test";
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, stat, chmod, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CredentialBindings, CredentialResolver, bindingTarget, credentialBindingSchema, validateVaultExecutable } from "../src/credentials";
import { providerFromPreset } from "../src/presets";
import { openCliRuntime } from "../src/runtime";

const cli = fileURLToPath(new URL("../src/cli.ts",import.meta.url));
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(),"Workspace/scratch/switcher-tests");
async function directory() { await mkdir(scratch,{recursive:true}); return mkdtemp(join(scratch,"credentials-")); }
const envFor = (dir: string, extra: NodeJS.ProcessEnv = {}) => ({PATH:process.env.PATH,HOME:process.env.HOME,USER:process.env.USER,HASNA_SWITCHER_HOME:join(dir,"data"),...extra});
async function command(dir: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn([process.execPath,cli,...args],{cwd:dir,env:envFor(dir,extra),stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const timeout = setTimeout(()=>child.kill("SIGKILL"),25_000);
  try {
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    return {stdout,stderr,code};
  } finally { clearTimeout(timeout); }
}
const keychainBinding = () => credentialBindingSchema.parse({schema:1,...bindingTarget("deepseek"),source:{kind:"keychain",service:"fixture-provider",account:"fixture-account"}});

test("bindings publish atomically, reject replacement and unsafe file permissions without storing a value",async()=>{
  const dir = await directory(); const bindings = new CredentialBindings(envFor(dir));
  try {
    const input = keychainBinding();
    const results = await Promise.all(Array.from({length:20},()=>bindings.bind(input)));
    expect(results).toEqual(Array(20).fill(input));
    expect(await readdir(bindings.directory)).toEqual(["SWITCHER_PROVIDER_DEEPSEEK.json"]);
    const path = join(bindings.directory,"SWITCHER_PROVIDER_DEEPSEEK.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path,"utf8"))).toEqual(input);
    await expect(bindings.bind({...input,origins:["https://other.example"]})).rejects.toMatchObject({code:"credential_binding_exists"});
    await chmod(path,0o644);
    await expect(bindings.get(input.credentialEnv)).rejects.toMatchObject({code:"credential_binding_permissions"});
    await chmod(path,0o600); await bindings.remove(input.credentialEnv);
    await symlink(join(dir,"missing"),path);
    await expect(bindings.get(input.credentialEnv)).rejects.toMatchObject({code:"credential_binding_unreadable"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("configured bindings authorize every origin and never fall back to an ambient key",async()=>{
  const dir = await directory(); let reads = 0;
  const env = envFor(dir,{DEEPSEEK_API_KEY:"fixture-alias",SWITCHER_PROVIDER_DEEPSEEK:"fixture-explicit"});
  const resolver = new CredentialResolver(env,async()=>{ reads++; throw new Error("Fixture Keychain locked"); });
  try {
    await resolver.bindings.bind(keychainBinding());
    const provider = providerFromPreset("deepseek",{harness:"claude"});
    await expect(resolver.resolve({...provider,baseUrl:"https://other.example"})).rejects.toMatchObject({code:"credential_authority"});
    expect(reads).toBe(0);
    await expect(resolver.resolve(provider)).rejects.toThrow("Fixture Keychain locked");
    expect(reads).toBe(1);
    await resolver.bindings.remove("SWITCHER_PROVIDER_DEEPSEEK");
    expect(await resolver.resolve(provider)).toBe("fixture-explicit");
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("vault executable errors distinguish a missing command from unsafe installed permissions",async()=>{
  const dir = await directory(); const file = join(dir,"fixture-cli");
  try {
    await expect(validateVaultExecutable(file)).rejects.toMatchObject({code:"vault_exec_unavailable"});
    await writeFile(file,"#!/bin/sh\nexit 0\n",{mode:0o700}); await chmod(file,0o777);
    await expect(validateVaultExecutable(file)).rejects.toMatchObject({code:"vault_exec_permissions"});
    await chmod(file,0o755);
    await symlink(file,join(dir,"installed-cli"));
    await expect(validateVaultExecutable(join(dir,"installed-cli"))).resolves.toBeUndefined();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("binding CLI validates metadata/source flags before creating data or opening an API",async()=>{
  const dir = await directory();
  try {
    for (const key of ["--help"," ","../key","a/../key","a\nkey"]) {
      const result = credentialBindingSchema.safeParse({schema:1,...bindingTarget("deepseek"),source:{kind:"vault",key,url:"https://vault.example",executable:process.execPath,operator:{kind:"env"}}});
      expect(result.success).toBe(false);
    }
    for (const args of [["credentials","bind","deepseek","--vault-key","fixture/key"],["credentials","list","--vault-key","fixture/key"],["launch","claude","--vault-account","fixture"],["credentials","bind","deepseek","--keychain-service","fixture","--keychain-account","fixture","--vault-key","fixture/key"]]) {
      expect((await command(dir,args)).code).toBe(1);
    }
    expect(await readdir(dir)).toEqual([]);
    const bind = await command(dir,["credentials","bind","deepseek","--keychain-service","fixture-provider","--keychain-account","fixture-account"]);
    expect(bind.code,bind.stderr).toBe(0);
    expect(await readdir(join(dir,"data"))).toEqual(["config"]);
    expect(JSON.parse((await command(dir,["credentials","list"])).stdout)).toHaveLength(1);
    expect((await command(dir,["credentials","remove","deepseek"])).code).toBe(0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

async function vaultFixture(dir: string, origin: string, key = "fixture/live/provider") {
  const executable = join(dir,"secrets-fixture");
  await writeFile(executable,`#!${process.execPath}
const args=process.argv.slice(2);
if(process.env.HASNA_SECRETS_API_URL!=='https://vault.example' || process.env.HASNA_SECRETS_API_KEY!=='fixture-operator' || process.env.HASNA_SECRETS_API_KEY_OVERRIDE!=='fixture-operator' || process.env.SECRETS_API_URL || process.env.HASNA_PROFILE || process.env.HASNA_SECRETS_API_KEY_REF || process.env.UNRELATED_API_KEY) process.exit(8);
if(args[0]==='get' && args[2]==='--check') { console.log('key='+args[1]+' length=12 sha256='+'a'.repeat(64)); process.exit(0); }
if(args[0]!=='exec' || args[1]!=='fixture/live/provider' || args[2]!=='--as' || args[4]!=='--') process.exit(9);
const url=process.env.SWITCHER_CREDENTIAL_DELIVERY_URL;
const nonce=process.env.SWITCHER_CREDENTIAL_DELIVERY_NONCE;
if((await fetch(url,{method:'POST',headers:{authorization:'Bearer wrong'},body:JSON.stringify('fixture-provider-key')})).status!==404) process.exit(10);
if((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+nonce},body:JSON.stringify({value:'fixture-provider-key'})})).status!==400) process.exit(11);
await Bun.write(${JSON.stringify(join(dir,"vault-invoked.json"))},JSON.stringify({pid:process.pid,args:args.slice(0,5),deliveryAddress:url}));
const child=Bun.spawn(args.slice(5),{env:{...process.env,[args[3]]:'fixture-provider-key'},stdin:'ignore',stdout:'inherit',stderr:'inherit'});
const code=await child.exited;
if((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+nonce},body:JSON.stringify('fixture-provider-key')})).status!==404) process.exit(12);
process.exit(code);
`,{mode:0o700});
  const bind = await command(dir,["credentials","bind","SWITCHER_PROVIDER_FIXTURE","--origin",origin,"--vault-key",key,"--vault-url","https://vault.example","--vault-cli",executable]);
  expect(bind.code,bind.stderr).toBe(0);
  return executable;
}

test("actual CLI resolves its vault binding, launches directly, preserves exit codes and excludes credentials from files/output",async()=>{
  const dir = await directory(); let requests = 0;
  const upstream = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){ requests++; expect(req.headers.get("authorization")).toBe("Bearer fixture-provider-key"); return Response.json({data:[{id:"fixture-pro"},{id:"fixture-flash"}]}); }});
  try {
    await vaultFixture(dir,upstream.url.origin);
    const executable = join(dir,"claude-fixture");
    await writeFile(executable,`#!${process.execPath}
if(process.argv.includes('--version')) console.log('2.1.263 (Claude Code)');
else { console.log(JSON.stringify({auth:process.env.ANTHROPIC_AUTH_TOKEN==='fixture-provider-key',model:process.env.ANTHROPIC_DEFAULT_MODEL,subagent:process.env.CLAUDE_CODE_SUBAGENT_MODEL,leaked:Object.keys(process.env).filter(n=>/^(HASNA_|SWITCHER_CREDENTIAL_)/.test(n))})); process.exit(7); }
`,{mode:0o700});
    const args = ["launch","claude","--provider","generic-anthropic-messages","--url",upstream.url.origin,"--credential-env","SWITCHER_PROVIDER_FIXTURE","--model","fixture-pro","--executable",executable];
    const poisoned = {HASNA_SECRETS_API_KEY:"fixture-operator",HASNA_SECRETS_API_KEY_OVERRIDE:"fixture-wrong",HASNA_SECRETS_API_KEY_REF:"fixture/wrong",HASNA_PROFILE:"wrong",SECRETS_API_URL:"https://wrong.example",SECRETS_API_KEY:"fixture-wrong",UNRELATED_API_KEY:"fixture-unrelated"};
    const result = await command(dir,args,poisoned);
    expect(result.code,result.stderr).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual({auth:true,model:"fixture-pro",subagent:"fixture-pro",leaked:[]});
    expect(requests).toBe(1);
    const invocation = await Bun.file(join(dir,"vault-invoked.json")).json();
    await expect(fetch(invocation.deliveryAddress)).rejects.toThrow();
    expect(result.stdout+result.stderr).not.toContain("fixture-provider-key");
    expect(result.stdout+result.stderr).not.toContain("fixture-operator");
    expect(await readdir(join(dir,"data/state"))).toEqual([]);
    for (const name of ["switcher.db","config/credential-bindings/SWITCHER_PROVIDER_FIXTURE.json"]) {
      const data = await readFile(join(dir,"data",name));
      expect(data.includes(Buffer.from("fixture-provider-key"))).toBe(false);
      expect(data.includes(Buffer.from("fixture-operator"))).toBe(false);
    }
    const check = await command(dir,["credentials","check","SWITCHER_PROVIDER_FIXTURE"],poisoned);
    expect(check.code,check.stderr).toBe(0);
    expect(JSON.parse(check.stdout)).toMatchObject({available:true,length:12,sha256:"a".repeat(64),providerAuthentication:"not tested"});
    const missing = await command(dir,args,{SWITCHER_PROVIDER_FIXTURE:"fixture-fallback"});
    expect(missing.code).toBe(1); expect(JSON.parse(missing.stderr).error.code).toBe("vault_operator_missing");
    expect(requests).toBe(1);
  } finally { await upstream.stop(true); await rm(dir,{recursive:true,force:true}); }
},30_000);

test("owned API checks the current catalog origin before resolving a bound credential",async()=>{
  const dir = await directory(); let reads = 0;
  const resolver = new CredentialResolver(envFor(dir),async()=>{ reads++; return "fixture-key"; });
  const runtime = await openCliRuntime(envFor(dir),p=>resolver.resolve(p));
  try {
    await resolver.bindings.bind(keychainBinding());
    const input = providerFromPreset("deepseek");
    const provider = await runtime.client.createProvider(input);
    await runtime.client.updateProvider({...input,baseUrl:"https://other.example",catalogBaseUrl:"https://other.example"},provider.version);
    await expect(runtime.client.refreshModels(provider.id)).rejects.toMatchObject({code:"credential_authority"});
    expect(reads).toBe(0);
  } finally { await runtime.close(); await rm(dir,{recursive:true,force:true}); }
});

for (const signal of ["SIGTERM","SIGINT"] as const) test(`${signal} during vault lookup kills its owned process group and closes the API`,async()=>{
  const dir = await directory();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const executable = await vaultFixture(dir,"https://api.deepseek.com");
    const marker = join(dir,"vault-processes.json");
    await writeFile(executable,`#!${process.execPath}
const nested=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
await Bun.write(${JSON.stringify(marker)},JSON.stringify([process.pid,nested.pid]));
await nested.exited;
`,{mode:0o700});
    child = Bun.spawn([process.execPath,cli,"models","deepseek","--credential-env","SWITCHER_PROVIDER_FIXTURE","--refresh"],{cwd:dir,env:envFor(dir,{HASNA_SECRETS_API_KEY:"fixture-operator"}),stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const deadline=Date.now()+10_000;
    while (!await Bun.file(marker).exists() && Date.now()<deadline) await Bun.sleep(20);
    expect(await Bun.file(marker).exists()).toBe(true);
    const pids:number[] = await Bun.file(marker).json();
    child.kill(signal);
    const [code,stderr] = await Promise.all([child.exited,new Response(child.stderr).text()]);
    expect(code,stderr).toBe(signal === "SIGTERM" ? 143 : 130);
    expect(JSON.parse(stderr).error.code).toBe("interrupted");
    await Bun.sleep(100);
    for (const pid of pids) expect(()=>process.kill(pid,0)).toThrow();
    expect((await command(dir,["providers","list"])).code).toBe(0);
  } finally { child?.kill("SIGKILL"); await rm(dir,{recursive:true,force:true}); }
},30_000);
