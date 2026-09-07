import { expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import { DEFAULT_TENANT_ID } from "./migrations.js";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { ManagedProviderSecretError, type ManagedProviderSecrets } from "./managed-provider-secrets.js";

function fixture() {
  const client = { query: async () => ({ rows: [], rowCount: 0 }), many: async () => [], get: async () => null, one: async () => ({}), execute: async () => {} } as TypedQueryClient;
  const signingSecret = crypto.randomUUID();
  const calls: unknown[][] = [];
  const job = { id: crypto.randomUUID(), root_id: crypto.randomUUID(), operation: "rotate-root", status: "pending", processed: 0, remaining: 2 };
  const backend = {
    begin: async (...args: unknown[]) => { calls.push(["begin", ...args]); return job; },
    advance: async (...args: unknown[]) => { calls.push(["advance", ...args]); return { ...job, status: "complete", processed: 2, remaining: 0 }; },
    getJob: async (...args: unknown[]) => { calls.push(["job", ...args]); return job; },
    install: async (...args: unknown[]) => { calls.push(["install", ...args]); return { provider_id: "provider", revision: 1, root_id: job.root_id }; },
  } as unknown as ManagedProviderSecrets;
  const deps = { client, store: selfScopedStore(client), verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }), version: "fixture", migrations: [], ...testAuthDeps(client, signingSecret), env: {}, managedProviderSecrets: (tenant: string) => { calls.push(["tenant", tenant]); return backend; } } as SelfHostedServiceDeps;
  const request = (path: string, method: string, body?: unknown, scopes = ["emails:*"]) => handleSelfHostedRequest(deps, new Request(`https://fixture/v1/providers/${path}`, { method, headers: { Authorization: `Bearer ${mintApiKey({app:"emails",scopes,signingSecret}).token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { request, calls, backend, deps, job };
}

test("authenticated lifecycle uses tenant backend and authenticated actor with honest pending receipts", async () => {
  const f = fixture(), key = crypto.randomUUID();
  const response = (await f.request("secrets/rotate-root", "POST", {idempotency_key:key}))!;
  expect(response.status).toBe(202); expect(await response.json()).toEqual(f.job);
  expect(f.calls[0]).toEqual(["tenant", DEFAULT_TENANT_ID]);
  expect(f.calls[1]?.slice(0,3)).toEqual(["begin", "rotate-root", key]);
  expect(typeof f.calls[1]?.[3]).toBe("string");
  expect((await f.request(`secrets/jobs/${f.job.id}`, "GET"))!.status).toBe(202);
  expect((await f.request(`secrets/jobs/${f.job.id}/advance`, "POST", {limit:2}))!.status).toBe(200);
});

test("reader and writer credentials cannot mutate or inspect lifecycle jobs", async () => {
  const f = fixture();
  for (const scopes of [["emails:read"], ["emails:write"]]) {
    expect((await f.request("secrets/rewrap", "POST", {idempotency_key:crypto.randomUUID()}, scopes))!.status).toBe(403);
    expect((await f.request(`secrets/jobs/${f.job.id}`, "GET", undefined, scopes))!.status).toBe(403);
    expect((await f.request("provider/credentials", "PUT", {credentials:{}}, scopes))!.status).toBe(403);
  }
  expect(f.calls).toHaveLength(0);
});

test("credential installation redacts values and rejects actor injection or missing revision", async () => {
  const f = fixture();
  const body = {credentials:{type:"resend",api_key:"synthetic-fixture-only"},expected_revision:null};
  const response = (await f.request("provider/credentials", "PUT", body))!;
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("synthetic-fixture-only");
  expect(f.calls[1]?.[3]).toBeNull();
  expect((await f.request("provider/credentials", "PUT", {credentials:body.credentials}))!.status).toBe(400);
  expect((await f.request("provider/credentials", "PUT", {...body,actor:"injected"}))!.status).toBe(400);
  expect((await f.request("provider/credentials", "PUT", {...body,credentials:{type:"resend",secret_key:"wrong-field"}}))!.status).toBe(400);
});

test("unconfigured, conflicting and uncertain credential operations never return success or secret details", async () => {
  const f = fixture();
  f.backend.begin = async () => {throw new ManagedProviderSecretError("Lifecycle already pending");};
  expect((await f.request("secrets/rewrap", "POST", {idempotency_key:crypto.randomUUID()}))!.status).toBe(409);
  f.backend.begin = async () => {throw Error("private-KMS-fixture-detail");};
  const failed = (await f.request("secrets/rewrap", "POST", {idempotency_key:crypto.randomUUID()}))!;
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private-KMS");
  f.deps.managedProviderSecrets = undefined;
  expect((await f.request("secrets/rewrap", "POST", {idempotency_key:crypto.randomUUID()}))!.status).toBe(503);
});

test("fresh CLI uses generated API lifecycle operations and reports pending jobs unsuccessfully", async () => {
  const {mkdtemp,rm,access}=await import("node:fs/promises");
  const {tmpdir}=await import("node:os");const {join}=await import("node:path");
  const home=await mkdtemp(join(tmpdir(),"emails-managed-cli-")),f=fixture();
  const signingSecret=crypto.randomUUID();
  f.deps.verifier=verifyApiKey({app:"emails",signingSecret,keyStatus:async()=>"active"});
  f.deps.managedProviderSecrets=()=>f.backend;
  f.backend.metadata=async()=>({roots:[],envelopes:[]});
  let registered:Record<string,unknown>|null=null;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async req=>{
    if(new URL(req.url).pathname==="/v1/providers/secrets/status")return Response.json({source:"server_managed_and_references",complete:true,checked:false,activeKeyId:null,availableKeyIds:[],referencedKeyIds:[],managed_envelopes:0,capabilities:{status:true,rewrap:true,rotate_root:true,revoke_root:true},lifecycle_requirement:"managed fixture",default_sender:null,providers:registered?[{provider_id:registered.id,credential_source:"managed_envelope",revision:registered.revision}]:[]});
    if(registered&&new URL(req.url).pathname===`/v1/providers/${registered.id}`&&req.method==="GET")return Response.json(registered);
    return (await handleSelfHostedRequest(f.deps,req))??new Response(null,{status:404});
  }});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("EMAILS_")&&!key.startsWith("HASNA_EMAILS_")));
  Object.assign(env,{HOME:home,HASNA_EMAILS_HOME:home,EMAILS_HOME:home,HASNA_EMAILS_API_URL:server.url.origin,HASNA_EMAILS_API_KEY:mintApiKey({app:"emails",scopes:["emails:*"],signingSecret}).token,EMAILS_CLIENT_ENV_LOADED:"1",NO_COLOR:"1"});
  async function cli(args:string[],secrets=true){const child=Bun.spawn({cmd:[process.execPath,"--no-env-file","src/cli/index.tsx","--json","provider",...(secrets?["secrets"]:[]),...args],env,stdout:"pipe",stderr:"pipe"});const [code,out,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return{code,out,error};}
  try{
    const key=crypto.randomUUID(),completed=await cli(["rotate-root","--idempotency-key",key]);
    expect(completed.code).toBe(0);expect(JSON.parse(completed.out).status).toBe("complete");
    expect(f.calls.some(call=>call[0]==="begin"&&call[2]===key)).toBe(true);
    f.backend.advance=async()=>f.job as Awaited<ReturnType<ManagedProviderSecrets["advance"]>>;
    const pending=await cli(["job",f.job.id,"--advance"]);expect(pending.code).not.toBe(0);expect(pending.out+pending.error).toContain(f.job.id);
    const before=f.calls.length;expect((await cli(["rotate-root"])).code).not.toBe(0);expect(f.calls.length).toBe(before);
    f.backend.install=async(id,input,revision,actor,options)=>{f.calls.push(["install",id,input,revision,actor,options]);registered={id,tenant_id:DEFAULT_TENANT_ID,name:options?.metadata?.name??"Fixture",type:"ses",region:"eu-west-1",active:true,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),revision:(revision??0)+1};return{provider_id:id,revision:(revision??0)+1,root_id:f.job.root_id};};
    const providerId=crypto.randomUUID();
    const created=await cli(["add","--name","Fixture","--type","ses","--region","eu-west-1","--access-key","synthetic-access","--secret-key","synthetic-secret","--id",providerId],false);expect(created.code).toBe(0);expect(JSON.parse(created.out)).toMatchObject({provider_id:providerId,checked:true,revision:1});expect(created.out+created.error).not.toContain("synthetic-secret");
    const updated=await cli(["update",providerId,"--secret-key","synthetic-updated","--skip-validation"],false);expect(updated.error).toBe("");expect(updated.code).toBe(0);expect(JSON.parse(updated.out)).toMatchObject({revision:2,checked:false});const last=f.calls.filter(call=>call[0]==="install").at(-1)!;expect(last[2]).toEqual({secret_key:"synthetic-updated"});expect(last[3]).toBe(1);expect(last[5]).toMatchObject({partial:true});expect(last[5]).not.toHaveProperty("validate");
    await expect(access(join(home,"emails.db"))).rejects.toThrow();
  }finally{server.stop(true);await rm(home,{recursive:true,force:true});}
},20000);
