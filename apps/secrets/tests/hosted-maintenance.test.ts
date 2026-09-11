import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encryptionReceipt } from "./encryption-fixture.js";

async function fixture(run:(cli:(...args:string[])=>Promise<{stdout:string;stderr:string;exitCode:number}>,state:{requests:string[];fail:()=>void;malformed:()=>void})=>Promise<void>) {
 const home=mkdtempSync(join(tmpdir(),"secrets-encryption-cli-"));const token=randomUUID();const requests:string[]=[];let failure=false,malformed=false;
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
  expect(req.headers.get("x-api-key")??req.headers.get("authorization")).toContain(token);
  const path=new URL(req.url).pathname;requests.push(`${req.method} ${path}`);
  if(failure)return Response.json({error:"unavailable"},{status:503});
  if(path==="/v1/encryption/status"&&req.method==="GET" || path==="/v1/encryption/repair"&&req.method==="POST")return Response.json(malformed?{verified:true}:encryptionReceipt());
  if(path==="/v1/secrets/prune-expired"&&req.method==="POST")return Response.json({pruned:1});
  return Response.json({error:"not found"},{status:404});
 }});
 const config=join(home,".hasna/secrets/config");mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,"credentials"),`HASNA_SECRETS_API_URL=${server.url.origin}\nHASNA_SECRETS_API_KEY=${token}\n`,{mode:0o600});
 const cli=async(...args:string[])=>{const p=Bun.spawn([process.execPath,"src/index.ts",...args],{cwd:join(import.meta.dir,".."),env:{PATH:process.env.PATH!,HOME:home,HASNA_STATION:`fixture-${randomUUID()}`,NO_COLOR:"1"},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>p.kill(),10000);try {const [stdout,stderr,exitCode]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {stdout,stderr,exitCode};}finally{clearTimeout(timer);}};
 try {await run(cli,{requests,fail:()=>{failure=true;},malformed:()=>{malformed=true;}});expect(readdirSync(home,{recursive:true}).map(String).filter(p=>/\.(db|sqlite|sqlite3)$|vault\.key|kms\.json/.test(p))).toEqual([]);}
 finally{server.stop(true);rmSync(home,{recursive:true,force:true});}
}
test("saved-account key operations verify service state; KMS setup cannot fabricate success",async()=>{
 await fixture(async(cli,state)=>{
  for(const args of [["key"],["key","init"],["key","exists"],["key","path"],["key","kms"]]) {const r=await cli(...args);expect(r.exitCode,r.stderr).toBe(0);}
  expect(state.requests).toEqual(Array(5).fill("GET /v1/encryption/status"));
  const kms=await cli("key","kms","setup","--key-id","alias/fixture");expect(kms.exitCode).toBe(1);expect(kms.stderr).toContain("operator-managed server binding");expect(state.requests.length).toBe(5);
  state.fail();const failed=await cli("key","exists");expect(failed.exitCode).toBe(1);expect(failed.stdout).not.toContain("yes");
 });
},30000);
test("saved-account repair and GC use server operations and reject incomplete evidence",async()=>{
 await fixture(async(cli,state)=>{
  const repair=await cli("encrypt-vault");expect(repair.exitCode,repair.stderr).toBe(0);expect(repair.stdout).toContain("4 already encrypted and verified");
  const gc=await cli("gc");expect(gc.exitCode,gc.stderr).toBe(0);expect(gc.stdout).toContain("Pruned 1");
  expect(state.requests).toEqual(["POST /v1/encryption/repair","POST /v1/secrets/prune-expired"]);
  state.malformed();const bad=await cli("encrypt-vault");expect(bad.exitCode).toBe(1);expect(bad.stdout).not.toContain("Encrypted");
 });
},30000);
// `encrypt-vault` reports one service outcome. The removed local branch used to
// print "already encrypted" without the server's verification wording, which is
// the only thing that distinguishes a verified repair from an unverified claim.
test("encrypt-vault reports only the service-verified outcome",async()=>{
 await fixture(async(cli,state)=>{
  const repair=await cli("encrypt-vault");
  expect(repair.exitCode,repair.stderr).toBe(0);
  expect(repair.stdout).toContain("payload(s)");
  expect(repair.stdout).toContain("already encrypted and verified");
  expect(repair.stdout).not.toContain("secret(s).");
  expect(state.requests).toEqual(["POST /v1/encryption/repair"]);
 });
},30000);
// The ~/.secrets env-file bridge is removed: `export-env` wrote hosted secret
// VALUES to plaintext files under a forbidden location and `import-env` read
// them back. `path` was a vestigial "where is the vault" verb superseded by
// `status`. None of the three may resolve to a command any more.
test("the removed env-file bridge and `path` are not commands",async()=>{
 await fixture(async(cli,state)=>{
  for(const args of [["import-env"],["import-env","--dry-run"],["export-env"],["export-env","--dry-run"],["path"]]) {
   const r=await cli(...args);
   expect(r.exitCode,`${args.join(" ")} must not run`).toBe(1);
   expect(r.stderr).toContain(`Unknown command: ${args[0]}`);
  }
  const docs=await cli("docs");
  expect(docs.exitCode,docs.stderr).toBe(0);
  expect(docs.stdout).not.toContain("import-env");
  expect(docs.stdout).not.toContain("export-env");
  // None of it touched the service, and nothing was written to ~/.secrets.
  expect(state.requests).toEqual([]);
 });
},30000);
