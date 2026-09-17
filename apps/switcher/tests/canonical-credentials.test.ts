import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientFromEnv } from "../src/sdk";
import { openCliRuntime, switcherHome } from "../src/runtime";
import { credentialBindingSchema, vaultEnvironment } from "../src/credentials";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
async function fixture() {
  const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/switcher-tests");
  await mkdir(scratch, {recursive:true});
  const root = await mkdtemp(join(scratch, "canonical-credentials-")); roots.push(root);
  const config = join(root, ".hasna/switcher/config"); await mkdir(config, {recursive:true,mode:0o700});
  return {root, config, env:{HOME:root}};
}
async function credentials(config: string, key: string, url?: string, profile?: string) {
  const path = join(config, profile ? `credentials-${profile}` : "credentials");
  await writeFile(path, `HASNA_SWITCHER_API_KEY=${key}\n${url ? `HASNA_SWITCHER_API_URL=${url}\n` : ""}`, {mode:0o600});
  return path;
}
const fakeKey = "fixture-canonical-operator-not-real";

test("canonical config selects remote without API env, resolves fresh and refuses authority changes", async () => {
  const f = await fixture();
  const calls: {url:string;key:string|null;version:string|null}[] = [];
  await credentials(f.config, fakeKey, "https://api.example/switcher");
  const client = clientFromEnv(f.env, {fetch:async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({url:String(input),key:headers.get("authorization"),version:headers.get("if-match")});
    return Response.json({data:[],total:0});
  }});
  expect(client.baseUrl).toBe("https://api.example/switcher");
  await client.listProviders();
  await credentials(f.config, "fixture-rotated-not-real", "https://api.example/switcher");
  await client.deleteProvider("fixture", 3);
  expect(calls.map(c=>c.key)).toEqual([`Bearer ${fakeKey}`,"Bearer fixture-rotated-not-real"]);
  expect(calls[1]?.version).toBe("3");
  await credentials(f.config, "fixture-other-authority", "https://other.example/switcher");
  await expect(client.listProviders()).rejects.toThrow(/authority changed/i);
  expect(calls).toHaveLength(2);
  const runtime = await openCliRuntime(f.env);
  try { expect(runtime.mode).toBe("remote"); expect(runtime.client.baseUrl).toBe("https://other.example/switcher"); }
  finally { await runtime.close(); }
  expect(await Bun.file(join(f.root,".hasna/switcher/switcher.db")).exists()).toBe(false);
});

test("key-only, aliases, profiles and both canonical root overrides use Contracts", async () => {
  const f = await fixture();
  expect(clientFromEnv({SWITCHER_API_KEY:fakeKey}).baseUrl).toBe("https://api.hasna.com/switcher");
  await credentials(f.config, fakeKey, "https://profile.example", "fixture");
  // Profiles select credentials; the common credentials file owns the URL.
  expect(clientFromEnv({...f.env,HASNA_PROFILE:"fixture"}).baseUrl).toBe("https://api.hasna.com/switcher");
  await credentials(f.config, fakeKey, "https://root.example");
  expect(clientFromEnv({HASNA_HOME:join(f.root,".hasna")}).baseUrl).toBe("https://root.example");
  const custom=join(f.root,"configuration/switcher"); await mkdir(custom,{recursive:true});
  await credentials(custom,fakeKey,"https://config.example");
  expect(clientFromEnv({HASNA_CONFIG_HOME:join(f.root,"configuration")}).baseUrl).toBe("https://config.example");
  expect(switcherHome(f.env)).toBe(join(f.root,".hasna/switcher"));
  expect(switcherHome({HASNA_HOME:join(f.root,"app-data")})).toBe(join(f.root,"app-data/switcher"));
  for (const HASNA_HOME of ["", "relative", " "]) expect(switcherHome({...f.env,HASNA_HOME})).toBe(join(f.root,".hasna/switcher"));
});

test("Keychain tier works without injected API env and never falls through when locked", async () => {
  let locked=false;
  const client=()=>clientFromEnv({HASNA_STATION:"fixture-station"}, {credentials:{keychain:{enabled:true,platform:"darwin",run:argv=>{
    expect(argv[argv.indexOf("-a")+1]).toBe("fixture-station");
    if (locked) return {status:36,stdout:"",stderr:"fixture locked"};
    return argv.includes("hasna.credentials.switcher.api-key") ? {status:0,stdout:fakeKey,stderr:""} : {status:44,stdout:"",stderr:""};
  }}}});
  expect(client().baseUrl).toBe("https://api.hasna.com/switcher");
  locked=true; expect(client).toThrow(/Keychain/i);
});

test("partial, unsafe, conflicting and revoked canonical configuration never selects local data", async () => {
  const f=await fixture();
  const path=await credentials(f.config,fakeKey,"https://api.example");
  await chmod(path,0o644);
  await expect(openCliRuntime(f.env)).rejects.toThrow(/unsafe/i);
  await chmod(path,0o600);
  await expect(openCliRuntime({...f.env,HASNA_SWITCHER_API_URL:"https://other.example"})).rejects.toThrow(/authorit/i);
  await expect(openCliRuntime({...f.env,HASNA_SWITCHER_API_KEY_OVERRIDE:""})).rejects.toThrow();
  await writeFile(path,"HASNA_SWITCHER_API_URL=https://api.example\n");
  await expect(openCliRuntime(f.env)).rejects.toThrow();
  expect(await Bun.file(join(f.root,".hasna/switcher/switcher.db")).exists()).toBe(false);
  let requests=0;
  const client=clientFromEnv({HASNA_SWITCHER_API_KEY:fakeKey},{fetch:async()=>{requests++;return Response.json({error:{message:fakeKey}},{status:401});}});
  let failure:unknown;
  try { await client.listProviders(); } catch(error) { failure=error; }
  expect(failure).toMatchObject({status:401});
  expect(String(failure)+JSON.stringify(failure)).not.toContain(fakeKey);
  expect(requests).toBe(1);
});

test("vault operator uses canonical Secrets credentials and URL without manual injection", async () => {
  const f=await fixture(), config=join(f.root,".hasna/secrets/config");
  await mkdir(config,{recursive:true});
  const path=join(config,"credentials");
  await writeFile(path,"HASNA_SECRETS_API_KEY=fixture-vault-operator\nHASNA_SECRETS_API_URL=https://vault.example\n",{mode:0o600});
  const binding=credentialBindingSchema.parse({schema:1,credentialEnv:"SWITCHER_PROVIDER_DEEPSEEK",origins:["https://api.deepseek.com"],source:{kind:"vault",key:"fixture/live/provider",executable:process.execPath,operator:{kind:"contracts"}}});
  const first=await vaultEnvironment(binding,{...f.env,UNRELATED_API_KEY:"fixture-unrelated"});
  expect(first.HASNA_SECRETS_API_KEY_OVERRIDE).toBe("fixture-vault-operator");
  expect(first.HASNA_SECRETS_API_URL).toBe("https://vault.example");
  expect(first.UNRELATED_API_KEY).toBeUndefined();
  await writeFile(path,"HASNA_SECRETS_API_KEY=fixture-rotated-vault\nHASNA_SECRETS_API_URL=https://vault.example\n");
  expect((await vaultEnvironment(binding,f.env)).HASNA_SECRETS_API_KEY_OVERRIDE).toBe("fixture-rotated-vault");
  await writeFile(path,"HASNA_SECRETS_API_KEY=fixture-rotated-vault\nHASNA_SECRETS_API_URL=https://vault.example/v1\n");
  expect((await vaultEnvironment(binding,f.env)).HASNA_SECRETS_API_URL).toBe("https://vault.example/v1");
  await expect(vaultEnvironment(binding,{...f.env,HASNA_SECRETS_API_URL:"https://wrong.example"})).rejects.toMatchObject({code:"vault_operator_unavailable"});
  await chmod(path,0o644);
  await expect(vaultEnvironment(binding,f.env)).rejects.toMatchObject({code:"vault_operator_unavailable"});
});

test("pinned vault Keychain failure is terminal and recovers on the next call without account fallback", async () => {
  let locked=true;
  const binding=credentialBindingSchema.parse({schema:1,credentialEnv:"SWITCHER_PROVIDER_DEEPSEEK",origins:["https://api.deepseek.com"],source:{kind:"vault",key:"fixture/live/provider",url:"https://vault.example",executable:process.execPath,operator:{kind:"keychain",account:"fixture-pinned"}}});
  const env={HASNA_SECRETS_API_KEY:"fixture-must-not-rescue",HASNA_STATION:"fixture-other"};
  const options={keychain:{platform:"darwin",run:(argv:readonly string[])=>{
    expect(argv[argv.indexOf("-a")+1]).toBe("fixture-pinned");
    return locked ? {status:36,stdout:"fixture-must-not-leak",stderr:"fixture denied"} : {status:0,stdout:"fixture-pinned-key",stderr:""};
  }}};
  let failure:unknown;
  try { await vaultEnvironment(binding,env,options); } catch(error) { failure=error; }
  expect(failure).toMatchObject({code:"vault_operator_unavailable"});
  expect(String(failure)).toContain("Keychain");
  expect(String(failure)+JSON.stringify(failure)).not.toContain("fixture-must-not-leak");
  locked=false;
  expect((await vaultEnvironment(binding,env,options)).HASNA_SECRETS_API_KEY_OVERRIDE).toBe("fixture-pinned-key");
});

test("ordinary CLI launch reads canonical vault config with no API-key environment", async () => {
  const f=await fixture(), vault=join(f.root,"secrets-fixture"), native=join(f.root,"claude-fixture");
  const config=join(f.root,".hasna/secrets/config"); await mkdir(config,{recursive:true});
  await writeFile(join(config,"credentials"),"HASNA_SECRETS_API_KEY=fixture-vault-operator\nHASNA_SECRETS_API_URL=https://vault.example\n",{mode:0o600});
  await writeFile(vault,`#!${process.execPath}
const args=process.argv.slice(2);
if(process.env.HASNA_SECRETS_API_URL!=='https://vault.example'||process.env.HASNA_SECRETS_API_KEY_OVERRIDE!=='fixture-vault-operator')process.exit(81);
if(args[0]!=='exec'||args[1]!=='fixture/live/provider'||args[2]!=='--as'||args[4]!=='--')process.exit(82);
const child=Bun.spawn(args.slice(5),{env:{...process.env,[args[3]]:'fixture-provider-from-vault'},stdin:'ignore',stdout:'ignore',stderr:'ignore'});
process.exit(await child.exited);
`,{mode:0o700});
  await writeFile(native,`#!${process.execPath}
if(process.argv.includes('--version')){console.log('2.1.263 (Claude Code)');process.exit(0);}
if(process.env.HASNA_SECRETS_API_KEY||process.env.HASNA_SECRETS_API_KEY_OVERRIDE)process.exit(83);
if(process.env.ANTHROPIC_DEFAULT_MODEL!=='fixture-model'||process.env.CLAUDE_CODE_SUBAGENT_MODEL!=='fixture-model')process.exit(84);
console.log('CANONICAL_LAUNCH_OK');
`,{mode:0o700});
  let requests=0;
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,fetch:req=>{
    expect(req.headers.get("authorization")).toBe("Bearer fixture-provider-from-vault");requests++;
    return Response.json({data:[{id:"fixture-model"}]});
  }});
  const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
  const command=async(args:string[])=>{
    const child=Bun.spawn([process.execPath,cli,...args],{cwd:f.root,env:{HOME:f.root,PATH:process.env.PATH,HASNA_STATION:"switcher-canonical-fixture",HASNA_SWITCHER_LOCAL:"1"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
    const timeout=setTimeout(()=>child.kill("SIGKILL"),15000);
    try { const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,stdout,stderr}; }
    finally {clearTimeout(timeout);}
  };
  try {
    for (const account of ["", "   ", " fixture"]) {
      const rejected=await command(["credentials","bind","deepseek","--vault-key","fixture/live/provider","--vault-cli",vault,"--vault-url","https://vault.example","--vault-account",account]);
      expect(rejected.code).toBe(1);
      expect(await Bun.file(join(f.config,"credential-bindings/SWITCHER_PROVIDER_DEEPSEEK.json")).exists()).toBe(false);
    }
    const bind=await command(["credentials","bind","SWITCHER_PROVIDER_FIXTURE","--origin",upstream.url.origin,"--vault-key","fixture/live/provider","--vault-cli",vault]);
    expect(bind.code,bind.stderr).toBe(0);
    expect(JSON.parse(bind.stdout).source.operator.kind).toBe("contracts");
    const result=await command(["launch","claude","--provider","generic-anthropic-messages","--url",upstream.url.origin,"--credential-env","SWITCHER_PROVIDER_FIXTURE","--model","fixture-model","--executable",native]);
    expect(result.code,result.stderr).toBe(0); expect(result.stdout).toContain("CANONICAL_LAUNCH_OK");
    expect(result.stdout+result.stderr).not.toContain("fixture-vault-operator");
    expect(result.stdout+result.stderr).not.toContain("fixture-provider-from-vault");
    expect(requests).toBe(1);
    const runs=await command(["runs","list"]);
    expect(runs.code,runs.stderr).toBe(0); expect(JSON.parse(runs.stdout).data[0]).toMatchObject({status:"exited",exitCode:0});
  } finally {await upstream.stop(true);}
},30000);
