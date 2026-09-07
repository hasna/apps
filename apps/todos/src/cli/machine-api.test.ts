import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TodosV1Client } from "../sdk/v1.generated.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = { id: "shared-station04", name: "station04", hostname: "fixture", platform: "darwin", metadata: { stable: "retained" }, is_primary: true, archived_at: null, ssh_address: null, created_at: "2026-01-01T00:00:00.000Z", last_seen_at: "2026-09-07T00:00:00.000Z" };
function setup(url: string) {
  const root = mkdtempSync(join(tmpdir(), "todos-api-machine-")); roots.push(root);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key,value]) => value !== undefined && !/^(HASNA_|TODOS_|DATABASE_URL$|PG|XDG_)/.test(key))) as Record<string,string>;
  env.HOME = root; env.HASNA_STATION = `fixture-${randomUUID()}`;
  env.HASNA_TODOS_DB_PATH = join(root,"trap.db");
  env.HASNA_TODOS_PROFILE = "full";
  const config = join(root,".hasna/todos/config"); mkdirSync(config,{recursive:true,mode:0o700});
  writeFileSync(join(config,"credentials"), `HASNA_TODOS_API_URL=${url}\nHASNA_TODOS_API_KEY=fixture-machine-api-key\n`,{mode:0o600});
  return {root,env};
}
function databaseFiles(root: string): string[] { return readdirSync(root,{recursive:true}).map(String).filter(path => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(path)); }
async function cli(args: string[], env: Record<string,string>) {
  const child = Bun.spawn([process.execPath, "src/cli/index.tsx", ...args], { cwd: join(import.meta.dir,"../.."), env, stdout:"pipe",stderr:"pipe" });
  const timer = setTimeout(() => child.kill(),20000);
  try { const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]); return {stdout,stderr,code}; }
  finally { clearTimeout(timer); }
}
test("saved credentials route real CLI machines to shared records without a SQLite file", async () => {
  let reads=0;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req) {
    expect(req.headers.get("authorization") === "Bearer fixture-machine-api-key" || req.headers.get("x-api-key") === "fixture-machine-api-key").toBe(true);
    if (new URL(req.url).pathname === "/v1/machines") { reads++; return Response.json({schema_version:1,machines:[fixture]}); }
    return Response.json({error:"fixture route missing"},{status:404});
  }});
  try { const {root,env}=setup(server.url.origin); const result=await cli(["machines","--json"],env); expect(result.code).toBe(0); expect(JSON.parse(result.stdout)).toEqual([fixture]); expect(reads).toBe(1); expect(databaseFiles(root)).toEqual([]); }
  finally { server.stop(true); }
},30000);
test("actual stdio MCP startup and machine read use saved API credentials without creating SQLite", async () => {
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req) { return new URL(req.url).pathname === "/v1/machines" ? Response.json({schema_version:1,machines:[fixture]}) : Response.json({error:"fixture route missing"},{status:404}); }});
  const {root,env}=setup(server.url.origin);
  const transport = new StdioClientTransport({ command:process.execPath,args:["src/mcp/index.ts","--profile","full"],cwd:join(import.meta.dir,"../.."),env,stderr:"pipe" });
  const client = new Client({name:"machine-fixture",version:"1"});
  try { await client.connect(transport); const result=await client.callTool({name:"machines_list",arguments:{include_archived:true}}); expect(JSON.stringify(result.content)).toContain(fixture.id); expect(result.isError).not.toBe(true); expect(databaseFiles(root)).toEqual([]); }
  finally { await client.close(); server.stop(true); }
},30000);
test("old API fails with upgrade guidance before machine import POST and never creates a database", async () => {
  let posts=0;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req) { if(req.method==="POST")posts++;return Response.json({error:"not found"},{status:404}); }});
  try { const {root,env}=setup(server.url.origin); const path=join(root,"snapshot.json");writeFileSync(path,JSON.stringify({machines:[fixture]})); const result=await cli(["machines","import",path],env);expect(result.code).not.toBe(0);expect(result.stderr).toContain("upgrade");expect(posts).toBe(0);expect(databaseFiles(root)).toEqual([]); }
  finally { server.stop(true); }
},30000);
test("generated SDK refuses machine-bearing snapshots before POST on old or incomplete API", async () => {
  for(const body of [{schema_version:0,machines:[]},{schema_version:1}]) {
    const calls:string[]=[];
    const client=new TodosV1Client({baseUrl:"https://fixture.test",fetch:async (_url,init) => {calls.push(init?.method ?? "GET");return Response.json(body);} });
    await expect(client.importSnapshot({machines:[fixture]})).rejects.toThrow("no snapshot was posted");expect(calls).toEqual(["GET"]);
  }
});
test("CLI imports complete machine rows and verifies field-identical receipt", async () => {
  let posted: unknown;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req) {
    if(req.method==="POST") {posted=await req.json();return Response.json({schema_version:1,machines:[fixture],inserted:1,skipped:0});}
    return Response.json({schema_version:1,machines:[]});
  }});
  try {const {root,env}=setup(server.url.origin);const path=join(root,"snapshot.json");writeFileSync(path,JSON.stringify({machines:[fixture]}));const result=await cli(["machines","import",path],env);expect(result.code).toBe(0);expect(posted).toEqual({action:"import",machines:[fixture]});expect(JSON.parse(result.stdout).machines).toEqual([fixture]);expect(databaseFiles(root)).toEqual([]);}
  finally {server.stop(true);}
},30000);
test("actual MCP reports older machine API as an upgrade error without local fallback", async () => {
  let posts=0;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req) {if(req.method==="POST")posts++;return Response.json({error:"not found"},{status:404});}});
  const {root,env}=setup(server.url.origin);
  const transport=new StdioClientTransport({command:process.execPath,args:["src/mcp/index.ts"],cwd:join(import.meta.dir,"../.."),env,stderr:"pipe"});
  const client=new Client({name:"machine-upgrade-fixture",version:"1"});
  try {await client.connect(transport);const result=await client.callTool({name:"machines_register",arguments:{name:"fixture"}});expect(result.isError).toBe(true);expect(JSON.stringify(result.content)).toContain("upgrade");expect(posts).toBe(0);expect(databaseFiles(root)).toEqual([]);}
  finally {await client.close();server.stop(true);}
},30000);
test("implicit storage cannot recreate a database under API credentials; explicit storage handle remains available", async () => {
  const {root,env}=setup("http://127.0.0.1:1");
  const source='import { getDatabase, resetDatabase } from "./src/db/database.ts"; let refused=false; try { getDatabase(); } catch (e) { refused=String(e).includes("API_DATABASE_FALLBACK_FORBIDDEN"); } if(!refused)process.exit(2); const explicit=getDatabase(":memory:"); if(!explicit.query("SELECT 1 AS n").get())process.exit(3); resetDatabase(); console.log("explicit-storage-preserved");';
  const child=Bun.spawn([process.execPath,"-e",source],{cwd:join(import.meta.dir,"../.."),env,stdout:"pipe",stderr:"pipe"});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(code).toBe(0);expect(stdout).toContain("explicit-storage-preserved");expect(stderr).not.toContain("fixture-machine-api-key");expect(databaseFiles(root)).toEqual([]);
},30000);
