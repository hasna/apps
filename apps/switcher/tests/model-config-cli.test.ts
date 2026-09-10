import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cli=new URL("../src/cli.ts",import.meta.url).pathname;
async function run(home:string,args:string[]){
  const p=Bun.spawn([process.execPath,cli,...args],{cwd:home,env:{PATH:process.env.PATH,HOME:home,HASNA_SWITCHER_HOME:join(home,"data"),HASNA_STATION:"model-config-fixture"},stdout:"pipe",stderr:"pipe",stdin:"ignore"});
  const timer=setTimeout(()=>p.kill("SIGKILL"),15000);
  try{const [code,stdout,stderr]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);return {code,stdout,stderr};}finally{clearTimeout(timer);}
}
test("CLI creates a custom manual provider and edits/selects models without provider JSON",async()=>{
  const home=await mkdtemp(join(tmpdir(),"switcher-config-cli-"));
  try{
    const add=await run(home,["providers","add","deployment","--url","http://127.0.0.1:9997/v1","--protocol","openai-responses","--catalog-format","none","--model","vendor/first"]);
    expect(add.code,add.stderr).toBe(0);expect(JSON.parse(add.stdout).manualModels).toEqual([{id:"vendor/first",name:"vendor/first"}]);
    const file=join(home,"model.json");await writeFile(file,JSON.stringify({id:"vendor/second",name:"Second",contextWindow:64000,supportedParameters:["tools"]}));
    const second=await run(home,["models","add","deployment","vendor/second","--file",file]);expect(second.code,second.stderr).toBe(0);
    const config=await run(home,["models","config","deployment"]);expect(config.code,config.stderr).toBe(0);expect(JSON.parse(config.stdout).manualModels).toHaveLength(2);
    const listed=await run(home,["models","deployment"]);expect(listed.code,listed.stderr).toBe(0);expect(JSON.parse(listed.stdout).data).toHaveLength(2);
    const plan=await run(home,["launch","codex","--provider","deployment","--model","vendor/second","--dry-run"]);expect(plan.code,plan.stderr).toBe(0);expect(JSON.parse(plan.stdout).profile.model).toBe("vendor/second");
    const updated=await run(home,["models","update","deployment","vendor/second","--name","Retired","--expires-on","2000-01-01"]);expect(updated.code,updated.stderr).toBe(0);
    const expired=await run(home,["launch","codex","--provider","deployment","--model","vendor/second","--dry-run"]);expect(expired.code).toBe(1);expect(expired.stderr).toContain("model_expired");
    expect((await run(home,["models","remove","deployment","vendor/second"])).code).toBe(0);
    const remaining=await run(home,["models","config","deployment"]);expect(JSON.parse(remaining.stdout).manualModels).toEqual([{id:"vendor/first",name:"vendor/first"}]);
  }finally{await rm(home,{recursive:true,force:true});}
},30000);
test("CLI imports a model array, rejects duplicates and secret-bearing metadata before saving",async()=>{
  const home=await mkdtemp(join(tmpdir(),"switcher-config-cli-"));
  try{
    const file=join(home,"models.json");await writeFile(file,JSON.stringify([{id:"a",name:"A"},{id:"b",name:"B"}]));
    const added=await run(home,["providers","add","custom","--url","https://provider.example/v1","--protocol","openai-chat","--models-file",file]);expect(added.code,added.stderr).toBe(0);expect(JSON.parse(added.stdout)).toMatchObject({manualModels:[],additionalModels:[{id:"a",name:"A"},{id:"b",name:"B"}]});
    await writeFile(file,JSON.stringify([{id:"a",name:"A"},{id:"a",name:"Duplicate"}]));
    expect((await run(home,["providers","add","duplicate","--url","https://provider.example","--protocol","openai-chat","--models-file",file])).code).toBe(1);
    const bad=join(home,"bad.json");await writeFile(bad,JSON.stringify({id:"secret",name:"Secret",apiKey:"never-save-fixture"}));
    const rejected=await run(home,["models","add","custom","secret","--file",bad]);expect(rejected.code).toBe(1);expect(rejected.stderr).not.toContain("never-save-fixture");
    const config=await run(home,["models","config","custom"]);expect(JSON.parse(config.stdout).additionalModels).toHaveLength(2);
    for(const args of [
      ["providers","update","custom","--model","silently-ignored"],
      ["models","custom","--models-file",""],
      ["models","add","custom","empty-file","--file",""],
      ["providers","add","empty-file","--url","https://provider.example","--protocol","openai-chat","--models-file",""],
      ["models","add","custom","mismatched-id","--file",bad],
    ]) expect((await run(home,args)).code).toBe(1);
    expect(JSON.parse((await run(home,["models","config","custom"])).stdout)).toEqual(JSON.parse(config.stdout));
  }finally{await rm(home,{recursive:true,force:true});}
},30000);
