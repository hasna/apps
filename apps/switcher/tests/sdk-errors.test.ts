import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SwitcherClient, SwitcherError } from "../src/sdk";

async function failure(body: unknown, key = "fixture-operator/sdk+error=only", status = 401) {
  const client = new SwitcherClient({baseUrl:"http://127.0.0.1:1",apiKey:key,fetch:(async()=>Response.json(body,{status})) as typeof fetch});
  try { await client.listProviders(); throw new Error("Expected an API failure"); }
  catch (error) { expect(error).toBeInstanceOf(SwitcherError); return error as SwitcherError; }
}

test("API errors preserve bounded diagnostic fields and HTTP status", async () => {
  const error = await failure({error:{code:"version_conflict",message:"Refresh the profile before retrying.",requestId:"request-123:abc"}},undefined,409);
  expect(error.status).toBe(409);expect(error.code).toBe("version_conflict");
  expect(error.message).toBe("Refresh the profile before retrying.");expect(error.requestId).toBe("request-123:abc");
});

test("API error text redacts the credential used for this request and common representations", async () => {
  const key = 'fixture-operator/sdk+error="back\\slash"';
  const encoded = encodeURIComponent(key);
  const forms = [...new Set([key,JSON.stringify(key).slice(1,-1),encoded,encoded.replace(/%[0-9A-F]{2}/g,(part,index)=>index%2?part.toLowerCase():part),
    new URLSearchParams({key}).toString().slice(4),Buffer.from(key).toString("base64"),Buffer.from(key).toString("base64").replace(/=+$/,""),Buffer.from(key).toString("base64url")])];
  for (const representation of forms) {
    const error = await failure({error:{code:"unauthorized",message:`Denied Bearer ${representation}; ask the operator to verify access.`,requestId:"request-123"}},key);
    expect(error.code).toBe("unauthorized");expect(error.requestId).toBe("request-123");
    expect(error.message).toContain("[REDACTED]");expect(error.message).toContain("verify access");
    expect(error.message).not.toContain(representation);expect(error.stack).not.toContain(key);
  }
  const identifierKey="fixture_operator_credential_123456789";
  const error=await failure({error:{code:identifierKey,message:"No access.",requestId:identifierKey}},identifierKey);
  expect(error.code).toBe("api_error");expect(error.requestId).toBeUndefined();expect(JSON.stringify(error)).not.toContain(identifierKey);
});

test("API errors reject malformed, oversized and terminal-control diagnostic fields", async () => {
  const key="fixture-operator/sdk+error=only";
  for (const error of [null,[],"bad",{code:{key},message:[key],requestId:{key}},{code:42,message:0,requestId:true},
    {code:"x".repeat(500),message:"x".repeat(10000)+key,requestId:"x".repeat(500)}]) {
    const actual=await failure({error},key);
    expect(actual.code).toBe("api_error");expect(actual.message).toBe("Switcher API returned HTTP 401.");expect(actual.requestId).toBeUndefined();
    expect(JSON.stringify(actual)).not.toContain(key);
  }
  const control=await failure({error:{code:"bad\u001b[2J",message:"Invalid\nrequest\u001b[2J\u0000",requestId:"request\nforged"}});
  expect(control.code).toBe("api_error");expect(control.requestId).toBeUndefined();expect(control.message).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  expect(control.message).toContain("Invalid");
  const trailingControl=await failure({error:{code:"unauthorized\n",message:"x".repeat(3000),requestId:"request-123\n"}});
  expect(trailingControl.code).toBe("api_error");expect(trailingControl.requestId).toBeUndefined();expect(trailingControl.message).toHaveLength(2048);
});

test("credential rotation during an API request still redacts the credential actually sent", async () => {
  const sent="fixture-sent-operator-credential",later="fixture-next-operator-credential";let current=sent;let reads=0;
  const client=new SwitcherClient({baseUrl:"http://127.0.0.1:1",apiKey:()=>{reads++;return current;},fetch:(async(_url,init)=>{
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${sent}`);current=later;
    return Response.json({error:{code:"unauthorized",message:`Denied ${sent}`}}, {status:401});
  }) as typeof fetch});
  await expect(client.listProviders()).rejects.toThrow("Denied [REDACTED]");expect(reads).toBe(1);
});

test("actual CLI rejects reflected operator data without local fallback or malformed JSON error shapes", async () => {
  const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace","scratch","switcher-tests");await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,"sdk-error-"));const key="fixture-operator/sdk+cli=only";let mode=0;let requests=0;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    requests++;expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
    return Response.json({error:mode===0?{code:"unauthorized",message:`Denied ${key} ${encodeURIComponent(key)} ${Buffer.from(key).toString("base64")}`,requestId:"request-cli"}:{code:{key},message:[key],requestId:{key}}},{status:401});
  }});
  const cli=resolve(import.meta.dir,"../src/cli.ts");
  try {
    for (mode=0;mode<2;mode++) {
      const child=Bun.spawn([process.execPath,cli,"providers","list"],{cwd:dir,env:{PATH:process.env.PATH,HOME:dir,HASNA_SWITCHER_HOME:join(dir,"must-not-create"),HASNA_SWITCHER_API_URL:server.url.origin,HASNA_SWITCHER_API_KEY:key},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const result=await Promise.race([Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("CLI fixture exceeded deadline"));},10000);})]);
        const [code,stdout,stderr]=result;expect(code).toBe(1);expect(stdout).toBe("");
        for (const representation of [key,encodeURIComponent(key),Buffer.from(key).toString("base64")]) expect(stderr).not.toContain(representation);
        const error=JSON.parse(stderr).error;expect(typeof error.code).toBe("string");expect(typeof error.message).toBe("string");
        expect(error.requestId===undefined||typeof error.requestId==="string").toBe(true);
      } finally {if(timer)clearTimeout(timer);if(child.exitCode===null){child.kill("SIGKILL");await child.exited;}}
    }
    expect(requests).toBe(2);
    // Bun may create its own transpiler cache under HOME; remote mode must not
    // create the selected Switcher home or its default local data directory.
    const entries=await readdir(dir);expect(entries).not.toContain("must-not-create");expect(entries).not.toContain(".hasna");
  } finally {await server.stop(true);await rm(dir,{recursive:true,force:true});}
});
