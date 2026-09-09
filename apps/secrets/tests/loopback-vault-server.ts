// Test-only HTTP fixture: explicit SQLite library backend outside client HOME.
// Client tests use real V1 requests; PostgreSQL/RLS behavior has separate tests.
import { LocalStore } from "../src/store/local.js";
import { createHandler } from "../src/server/serve.js";
const input = JSON.parse(await Bun.stdin.text());
const local = new LocalStore();
const store = new Proxy(local, { get(target, name) {
  if (name === "setSecret") return (key:any,value:any,type:any,label:any,expires:any,_actor:any,_tenant:any,opts:any) => target.setSecret(key,value,type,label,expires,opts);
  if (name === "listVersions") return (key:any,_actor:any,_tenant:any,limit:any) => target.listVersions(key,limit);
  if (name === "addFeedback") return (message:any,email:any,category:any) => target.sendFeedback(message,email,category);
  const value = Reflect.get(target,name);
  return typeof value === "function" ? value.bind(target) : value;
}});
const client = {
  async get(sql:string) {
    if(sql.includes("FROM pg_roles")) return {rolsuper:false,rolbypassrls:false,ownership_write:false,rls_tables:8};
    return {tenant_id:"11111111-2222-4333-8444-555555555555",ok:1};
  },
  async query(){return {rows:[{ok:1}],rowCount:1};}, async many(){return [];}, async execute(){},
};
const verifier = {async authenticate(header:(key:string)=>string|null) {
  if(header("x-api-key")!==input.token && header("authorization")!==`Bearer ${input.token}`) return {ok:false,status:401,reason:"invalid_token",message:"Fixture authentication required"};
  return {ok:true,principal:{kid:"fixture-client",agent:process.env.AGENT_ID ?? process.env.USER ?? "fixture"}};
}};
const handler = createHandler({client,store,verifier} as any);
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:handler});
console.log(JSON.stringify({port:server.port}));
process.on("SIGTERM",()=>{server.stop(true);process.exit(0)});
