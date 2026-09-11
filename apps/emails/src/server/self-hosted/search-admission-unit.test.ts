import { createQueryClient } from "../../storage-kit/query.js";
import { describe, expect, test } from "bun:test";
import { runMessageListQuery, MessageSearchBusyError, MessageSearchTimeoutError, messageSearchErrorResponse } from "./search-admission.js";

const scoped = {} as any;
const ordinary = (query: (client: any) => Promise<any>, search?: string, tenantId = "tenant-a", atomicClient?: any) => runMessageListQuery({search,tenantId,scopedClient:scoped,atomicClient,query});
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }

describe("message search isolation", () => {
  test("one permit is shared across tenants; overload never starts DB work, ordinary reads remain available", async () => {
    const gate=deferred<string>();let extraCalls=0;
    const first=ordinary(()=>gate.promise,"alpha","tenant-a");
    await expect(ordinary(async()=>{extraCalls++;return "wrong"},"beta","tenant-b")).rejects.toBeInstanceOf(MessageSearchBusyError);
    expect(extraCalls).toBe(0);
    expect(await ordinary(async client=>{expect(client).toBe(scoped);return "inbox"})).toBe("inbox");
    expect(await ordinary(async()=>"spaces","   ")).toBe("spaces");
    gate.resolve("first");expect(await first).toBe("first");
    expect(await ordinary(async()=>"next","beta","tenant-b")).toBe("next");
  });
  test("failure releases admission and is not converted to a successful empty result", async () => {
    const failure=new Error("database unavailable");
    await expect(ordinary(async()=>{throw failure},"alpha")).rejects.toBe(failure);
    expect(await ordinary(async()=>[1],"beta")).toEqual([1]);
  });
  test("search alone uses transaction-local timeout and the correct tenant before the original SELECT", async () => {
    const calls:any[]=[];
    const tx={execute:async(sql:string,params?:unknown[])=>{calls.push([sql,params])}};
    const atomic={transaction:async(fn:any)=>{calls.push(["BEGIN"]);try {const value=await fn(tx);calls.push(["COMMIT"]);return value;}catch(e){calls.push(["ROLLBACK"]);throw e;}}};
    const result=await ordinary(async client=>{expect(client).toBe(tx);calls.push(["SELECT original"]);return {items:[1],next_cursor:"unchanged"}},"alpha","tenant-b",atomic);
    expect(result).toEqual({items:[1],next_cursor:"unchanged"});
    expect(calls).toEqual([["BEGIN"],["SELECT set_config('app.current_tenant', $1, true)",["tenant-b"]],["SET LOCAL statement_timeout = '30s'",undefined],["SELECT original"],["COMMIT"]]);
    calls.length=0;
    expect(await ordinary(async client=>{expect(client).toBe(scoped);return "ordinary"},undefined,"tenant-b",atomic)).toBe("ordinary");
    expect(calls).toEqual([]);
  });
  test("SQL cancellation rolls back before permit is released and maps only a search cancellation", async () => {
    const rollback=deferred<void>();let inRollback=false;
    const tx={execute:async()=>{}};
    const atomic={transaction:async(fn:any)=>{try{return await fn(tx)}catch(e){inRollback=true;await rollback.promise;throw e}}};
    const cancelled=ordinary(async()=>{throw {code:"57014"}},"alpha","tenant-a",atomic);
    // Observe the transaction callback reaching rollback before testing reuse.
    for(let i=0;i<8&&!inRollback;i++)await Promise.resolve();
    expect(inRollback).toBe(true);
    await expect(ordinary(async()=>1,"beta")).rejects.toBeInstanceOf(MessageSearchBusyError);
    rollback.resolve();await expect(cancelled).rejects.toBeInstanceOf(MessageSearchTimeoutError);
    expect(await ordinary(async()=>2,"beta")).toBe(2);
    const unrelated={code:"57014"};await expect(ordinary(async()=>{throw unrelated})).rejects.toBe(unrelated);
  });
  test("transaction acquisition or SET LOCAL failure also releases admission", async () => {
    for(const atomic of [
      {transaction:async()=>{throw new Error("connect failed")}},
      {transaction:async(fn:any)=>fn({execute:async()=>{throw new Error("setup failed")}})},
    ]) {
      await expect(ordinary(async()=>"unreached","alpha","tenant-a",atomic)).rejects.toBeInstanceOf(Error);
      expect(await ordinary(async()=>"after","beta")).toBe("after");
    }
  });
  test("busy and timeout responses are explicit with retry advice; unrelated errors retain old handler", async () => {
    for(const [error,status,code] of [[new MessageSearchBusyError(),429,"search_busy"],[new MessageSearchTimeoutError(),504,"search_timeout"]] as const) {
      const response=messageSearchErrorResponse(error)!;expect(response.status).toBe(status);expect(response.headers.get("Retry-After")).toBe("5");expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({error:error.message,code});
    }
    expect(messageSearchErrorResponse(new Error("other"))).toBeNull();
  });

});

test("actual transaction wrapper holds admission through COMMIT and releases connection before permit reuse", async () => {
  const committing=deferred<void>();let commitStarted=false;let released=false;
  const connection={query:async(sql:string)=>{if(sql==="COMMIT"){commitStarted=true;await committing.promise;}return {rows:[],rowCount:0}},release:()=>{released=true}};
  const pool=createQueryClient({connect:async()=>connection,query:async()=>({rows:[],rowCount:0})} as any);
  const first=ordinary(async()=>"result","alpha","tenant-a",pool);
  for(let i=0;i<20&&!commitStarted;i++)await Promise.resolve();
  expect(commitStarted).toBe(true);expect(released).toBe(false);
  await expect(ordinary(async()=>"blocked","beta")).rejects.toBeInstanceOf(MessageSearchBusyError);
  committing.resolve();expect(await first).toBe("result");expect(released).toBe(true);
  expect(await ordinary(async()=>"next","beta")).toBe("next");
});

test("actual transaction wrapper rolls back and releases on57014 before another search", async () => {
  const calls:string[]=[];const connection={query:async(sql:string)=>{calls.push(sql);return {rows:[],rowCount:0}},release:()=>calls.push("RELEASE")};
  const pool=createQueryClient({connect:async()=>connection,query:async()=>({rows:[],rowCount:0})} as any);
  await expect(ordinary(async()=>{throw {code:"57014"}},"alpha","tenant-a",pool)).rejects.toBeInstanceOf(MessageSearchTimeoutError);
  expect(calls.slice(-2)).toEqual(["ROLLBACK","RELEASE"]);
  expect(await ordinary(async()=>"next","beta")).toBe("next");
});
