import { test, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { prepareHarnessLaunch, validateHarnessConfiguration } from "../src/harnesses";
import { aiderArguments } from "../src/aider-args";
import { validateAiderConfiguration } from "../src/aider-config";
import { harnessEligible } from "../src/domain";
import { launch } from "../src/launcher";
import { fileURLToPath } from "node:url";

async function fixture(){const root=process.env.SWITCHER_TEST_ROOT??join(homedir(),"Workspace","scratch","switcher-tests");await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,"aider-"));return {dir,input:{harness:"aider" as const,version:"aider 0.86.2",cwd:dir,stateDir:join(dir,"launch"),sessionDir:join(dir,"sessions"),baseUrl:"https://example.com/prefix/v1",protocol:"openai-chat" as const,authStyle:"bearer" as const,model:"vendor/fixture",models:[{id:"vendor/fixture",name:"Fixture",outputModalities:["text"],supportedParameters:[]},{id:"vendor/second:tag",name:"Second"}],credential:"synthetic-provider-fixture"}};}
test("Aider handles argparse abbreviations, authority options, values and literal terminators",()=>{
  for(const args of [["--model=outside"],["--weak-m","outside"],["--openai-api-b","https://example.org"],["--set-e","AIDER_MODEL=outside"],["-cother"],["--alias","a:b"],["--chat-history-f","elsewhere"],["--lo","commands"],["--gui"]])expect(()=>aiderArguments(args)).toThrow();
  expect(aiderArguments(["--message","literal --model outside","--file","a.txt","--","--model=filename"]).args).toEqual(["--message","literal --model outside","--file","a.txt","--","--model=filename"]);
  expect(aiderArguments(["--restore-chat-hist","--message=--model=literal"]).restore).toBe(true);
  expect(harnessEligible({id:"text",name:"Text",supportedParameters:[],outputModalities:["text"]},"aider")).toBe(true);
  expect(harnessEligible({id:"text",name:"Text",supportedParameters:[],outputModalities:["text"]},"pi")).toBe(false);
  expect(harnessEligible({id:"audio",name:"Transcription",inputModalities:["audio"],outputModalities:["text"]},"aider")).toBe(false);
});
test("Aider rejects native startup conflicts before catalog, credential resolution or native detection",async()=>{
  const {dir}=await fixture();let refresh=0,credentials=0;
  try{
    for(const config of [{gui:true},{"--yes-always":true},{"yes-always":true},{upgrade:"yes"},{load:"commands.txt"},{test:true}]) {
      await writeFile(join(dir,".aider.conf.yml"),JSON.stringify(config));
      await expect(launch({getProfile:async()=>({harness:"aider",providerId:"fixture"}),refreshModels:async()=>{refresh++;}} as any,"profile",{cwd:dir,executable:"must-not-start",resolveCredential:async()=>{credentials++;return undefined;}})).rejects.toThrow("conflicts");
    }
    expect(refresh).toBe(0);expect(credentials).toBe(0);
    await writeFile(join(dir,"CONVENTIONS.md"),"Native convention fixture");
    await writeFile(join(dir,".aider.conf.yml"),JSON.stringify({"yes-always":false,"read":["CONVENTIONS.md"],"auto-commits":false}));
    await expect(validateHarnessConfiguration("aider",dir)).resolves.toBeUndefined();
    await writeFile(join(dir,".aider.model.settings.yml"),JSON.stringify([{name:"unselected",extra_params:{api_base:"https://example.org"}}]));
    await expect(validateAiderConfiguration(dir,[],dir)).rejects.toThrow("custom transport");
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("actual CLI rejects Aider startup configuration before opening the API or native executable",async()=>{
  const {dir}=await fixture();const home=join(dir,"home"),native=join(dir,"must-not-start"),marker=join(dir,"native-started"),state=join(dir,"switcher");
  try{
    await mkdir(home,{mode:0o700});await writeFile(join(dir,".aider.conf.yml"),'yes-always: true\n');
    await writeFile(native,`#!/bin/sh\n/usr/bin/touch '${marker}'\necho 'aider 0.86.2'\n`,{mode:0o700});
    const child=Bun.spawn([process.execPath,fileURLToPath(new URL('../src/cli.ts',import.meta.url)),"launch","aider","--provider","generic-openai-chat","--model","fixture","--executable",native],{cwd:dir,env:{PATH:process.env.PATH,HOME:home,HASNA_SWITCHER_HOME:state},stdin:"ignore",stdout:"pipe",stderr:"pipe",detached:true});
    const timer=setTimeout(()=>{try{process.kill(-child.pid,"SIGKILL");}catch{}},5000);
    try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code).not.toBe(0);expect(err).toContain("conflicts with a provider-bound launch");expect(out).toBe("");}
    finally{clearTimeout(timer);try{process.kill(-child.pid,"SIGKILL");}catch{}}
    expect(await Bun.file(marker).exists()).toBe(false);
    await expect(readFile(join(state,"switcher.db"))).rejects.toThrow();
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("Aider bridges all protocols/auth styles and keeps provider values out of native configs/environment",async()=>{
  const {dir,input}=await fixture();const calls:any[]=[];
  const upstream=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){calls.push({path:new URL(req.url).pathname,auth:req.headers.get("authorization"),key:req.headers.get("x-api-key"),body:await req.json()});return Response.json({ok:true});}});
  try{
    let n=0;
    for(const protocol of ["openai-chat","openai-responses","anthropic-messages"] as const)for(const authStyle of ["bearer","x-api-key"] as const) {
      const prepared=await prepareHarnessLaunch({...input,protocol,authStyle,baseUrl:upstream.url.origin+"/prefix/v1",stateDir:join(dir,`launch-${n++}`)});
      let bridge="";
      try{
        const settings=JSON.parse(await readFile(prepared.configPaths[1],"utf8"));
        expect(settings.slice(0,-1).map((m:any)=>m.name.split(/^(?:anthropic|openai\/responses|openai)\//)[1])).toEqual(input.models.map(m=>m.id));
        expect(JSON.stringify(prepared.env)).not.toContain(input.credential);expect(prepared.args.join(" ")).not.toContain(input.credential);
        for(const path of prepared.configPaths)expect(await readFile(path,"utf8")).not.toContain(input.credential);
        bridge=settings[0].extra_params.api_base+(protocol==="anthropic-messages"?"/v1":"");
        const route={"openai-chat":"/chat/completions","openai-responses":"/responses","anthropic-messages":"/messages"}[protocol];
        const request=(model:string)=>fetch(bridge+route,{method:"POST",headers:{authorization:`Bearer ${prepared.env.SWITCHER_HARNESS_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({model})});
        expect((await request(input.model)).status).toBe(200);
        expect((await request("outside")).status).toBe(403);
        expect(calls.at(-1).path).toBe("/prefix/v1"+route);expect(calls.at(-1).body.model).toBe(input.model);
        expect(calls.at(-1)[authStyle==="bearer"?"auth":"key"]).toBe(authStyle==="bearer"?`Bearer ${input.credential}`:input.credential);
      }finally{await prepared.cleanup?.();}
      await expect(fetch(bridge+"/models")).rejects.toThrow();
    }
    expect(calls).toHaveLength(6);
  }finally{await upstream.stop(true);await rm(dir,{recursive:true,force:true});}
});
test("Aider concurrent launches own separate histories and restoration never reopens a shared writable file",async()=>{
  const {dir,input}=await fixture();const prepared=[];
  try{
    for(let i=0;i<2;i++)prepared.push(await prepareHarnessLaunch({...input,stateDir:join(dir,`launch-${i}`)}));
    const configs=await Promise.all(prepared.map(async p=>JSON.parse(await readFile(p.configPaths[0],"utf8"))));
    expect(configs[0]["chat-history-file"]).not.toBe(configs[1]["chat-history-file"]);
    await writeFile(configs[0]["chat-history-file"],"#### User message\nASSISTANT retained fixture history\n");await prepared[0].cleanup?.();
    const restored=await prepareHarnessLaunch({...input,stateDir:join(dir,"launch-restored"),args:["--restore-chat-history"]});prepared.push(restored);
    const config=JSON.parse(await readFile(restored.configPaths[0],"utf8"));
    expect(config["restore-chat-history"]).toBe(true);expect(config["chat-history-file"]).not.toBe(configs[0]["chat-history-file"]);
    expect(await readFile(config["chat-history-file"],"utf8")).toContain("retained fixture history");
    await writeFile(config["chat-history-file"],"Independent fork\n");expect(await readFile(configs[0]["chat-history-file"],"utf8")).toContain("retained fixture history");
  }finally{await Promise.allSettled(prepared.map(p=>p.cleanup?.()));await rm(dir,{recursive:true,force:true});}
});
