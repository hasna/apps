import {test,expect} from "bun:test";
import {randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";

const app=join(import.meta.dir,"..");
test("fresh CLI/MCP and client config never copy or open legacy vaults",async()=>{
 const home=mkdtempSync(join(tmpdir(),"secrets-no-copy-")),token=randomUUID();const legacy=join(home,".secrets");mkdirSync(legacy,{mode:0o700});
 const sentinel=Buffer.from("synthetic legacy database must stay unchanged");
 for(const name of ["vault.db","vault.db-wal","vault.db-shm"])writeFileSync(join(legacy,name),sentinel,{mode:0o600});
 let requests=0;
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
  expect(req.headers.get("x-api-key")).toBe(token);requests++;
  if(new URL(req.url).pathname==="/v1/secrets")return Response.json({secrets:[{key:"shared/fixture",type:"token",created_at:"2026-01-01",updated_at:"2026-01-01"}]});
  return Response.json({error:"unknown"},{status:404});
 }});
 const config=join(home,".hasna/secrets/config");mkdirSync(config,{recursive:true,mode:0o700});writeFileSync(join(config,"credentials"),`HASNA_SECRETS_API_URL=${server.url.origin}\nHASNA_SECRETS_API_KEY=${token}\n`,{mode:0o600});
 const env={PATH:process.env.PATH!,HOME:home,HASNA_STATION:`fixture-${randomUUID()}`,NO_COLOR:"1"};
 const run=async(args:string[],extra:Record<string,string>={},entry="src/index.ts")=>{
  const p=Bun.spawn([process.execPath,entry,...args],{cwd:app,env:{...env,...extra},stdin:"ignore",stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>p.kill(),10000);
  try{const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {stdout,stderr,code};}finally{clearTimeout(timer);}
 };
 let mcp:Client|undefined;
 try {
  const list=await run(["list","--json"]);expect(list.code,list.stderr).toBe(0);expect(list.stdout).toContain("shared/fixture");
  const before=requests;
  for(const name of ["HASNA_SECRETS_LOCAL_VAULT","HASNA_SECRETS_DB_PATH","OPEN_SECRETS_DB"]) {
   const failure=await run(["list"],{[name]:join(legacy,"vault.db")});expect(failure.code).toBe(1);expect(failure.stderr).toContain("no longer supported");
  }
  for(const flag of ["--local","--local-vault","--db","--db-path","--storage-mode"])expect((await run(["list",flag,"fixture"])).code).toBe(1);
  expect(requests).toBe(before);
  const badMcp=await run([],{HASNA_SECRETS_LOCAL_VAULT:"1"},"src/mcp-server.ts");expect(badMcp.code).toBe(1);expect(badMcp.stderr).toContain("no longer supported");
  const badFlag=await run(["--db",join(legacy,"vault.db")],{},"src/mcp-server.ts");expect(badFlag.code).toBe(1);expect(badFlag.stderr).toContain("selection flags");
  mcp=new Client({name:"fixture",version:"1"});
  await mcp.connect(new StdioClientTransport({command:process.execPath,args:[join(app,"src/mcp-server.ts")],env,stderr:"pipe"}));
  const result=await mcp.callTool({name:"list_secrets",arguments:{}});expect(JSON.stringify(result)).toContain("shared/fixture");expect(requests).toBeGreaterThan(before);
  const serve=await run(["serve","token"]);expect(serve.code,serve.stderr).toBe(0);expect(serve.stdout.trim().length).toBeGreaterThan(20);

  // Exercise the actual interactive CLI configuration command. All inputs are synthetic;
  // it only writes client config and never constructs an AWS request.
  const configure=Bun.spawn([process.execPath,"src/index.ts","aws","configure"],{cwd:app,env,stdin:"pipe",stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>configure.kill(),10000);
  try {
   const prompts=["AWS Access Key ID: ","AWS Secret Access Key: ","AWS Region [us-east-1]: ","Key prefix (optional, e.g. secrets/prod): "];
   const answers=[randomUUID(),randomUUID(),"us-east-1","fixture"];let pending=0,output="";
   const reader=configure.stdout.getReader();
   while(true){const chunk=await reader.read();if(chunk.done)break;output+=new TextDecoder().decode(chunk.value);if(pending<prompts.length&&output.includes(prompts[pending]!)){configure.stdin.write(`${answers[pending++]}\n`);await configure.stdin.flush();}}
   expect(await configure.exited).toBe(0);expect(output).toContain("configuration saved");
  }finally{clearTimeout(timer);configure.kill();}
  const files=readdirSync(home,{recursive:true}).map(String).filter(p=>/vault\.db(?:-wal|-shm|-journal)?$/.test(p)).sort();
  expect(files).toEqual([".secrets/vault.db",".secrets/vault.db-shm",".secrets/vault.db-wal"]);
  for(const name of ["vault.db","vault.db-wal","vault.db-shm"])expect(readFileSync(join(legacy,name)).equals(sentinel)).toBe(true);
 } finally {await mcp?.close();server.stop(true);rmSync(home,{recursive:true,force:true});}
},30000);
