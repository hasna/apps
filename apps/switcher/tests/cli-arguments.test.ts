import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { assertHarnessArguments } from "../src/harness-arguments";

test("Hermes profile authority follows argparse abbreviations, short values and chat oneshot arity", () => {
  for (const args of [
    ["-moutside"], ["chat", "-Qmoutside"], ["--prov=outside"],
    ["chat", "--mod", "outside"], ["chat", "--oneshot", "--model", "outside"],
    ["chat", "--safe-m"], ["-p", "outside"], ["chat", "--query", "--profile", "outside"],
  ]) expect(() => assertHarnessArguments("hermes", args)).toThrow("reserved");
  for (const args of [
    ["-z--model"], ["--oneshot", "--model"], ["chat", "-q--model"],
    ["chat", "--query=--model"], ["--reasoning", "--model"],
    ["chat", "--reasoning=--model"], ["chat", "--", "--model", "literal"],
    ["--resume", "--profile", "literal"], ["chat", "--oneshot", "-q", "hello"],
  ]) expect(() => assertHarnessArguments("hermes", args)).not.toThrow();
});

test("direct, saved and dry-run CLI overrides fail before discovery or native execution",async()=>{
  const base=process.env.SWITCHER_TEST_ROOT ?? join(homedir(),"Workspace/scratch/switcher-tests");
  await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"arguments-"));
  const requests:string[]=[];
  let harness: "codex" | "hermes" | "cline" | "opencode" | "kilo" = "codex";
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
    const path=new URL(request.url).pathname;requests.push(path);
    if(path==="/v1/profiles/saved")return Response.json({id:"saved",harness,providerId:"provider",model:"selected",name:"Saved",version:1,updatedAt:new Date().toISOString()});
    return Response.json({error:{code:"unexpected",message:"No discovery or launch should occur"}},{status:500});
  }});
  try{
    for(const selected of ["codex", "hermes", "cline", "opencode", "kilo"] as const)for(const direct of [true,false])for(const dry of [false,true]){
      harness = selected;
      requests.length=0;
      const native = harness === "codex" ? ["exec", "-moutside"] : harness === "hermes" ? ["chat", "--oneshot", "--prov=outside"] : harness === "kilo" ? ["run", "--title", "--model", "outside"] : harness === "opencode" ? ["run", "--pure", "--model", "switcher/outside"] : ["-Poutside"];
      const args=["launch",direct?harness:"saved",...(direct?["--provider","openrouter","--model","selected"]:[]),...(dry?["--dry-run"]:[]),"--executable",join(root,"must-not-run"),"--",...native];
      const child=Bun.spawn([process.execPath,join(import.meta.dir,"../src/cli.ts"),...args],{cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:root,HASNA_SWITCHER_HOME:join(root,"home"),HASNA_SWITCHER_API_URL:server.url.origin,HASNA_SWITCHER_API_KEY:"synthetic-test-operator"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
      const timer=setTimeout(()=>child.kill("SIGKILL"),5000);
      try{
        const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
        expect(code).toBe(1);expect(stdout).toBe("");expect(stderr).toContain("reserved by the launch profile");
        expect(requests).toEqual(direct?[]:["/v1/profiles/saved"]);
        expect(await readdir(join(root,"home")).catch(error=>{if(error.code==="ENOENT")return [];throw error;})).toEqual([]);
      }finally{clearTimeout(timer);}
    }
  }finally{await server.stop(true);await rm(root,{recursive:true,force:true});}
},15000);
