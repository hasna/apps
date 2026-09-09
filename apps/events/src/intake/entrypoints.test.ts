import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test("all intake help paths work with no credentials and no data files",()=>{
  const home=mkdtempSync(join(tmpdir(),"events-intake-help-"));
  try{
    // Keep Bun's transpilation cache out of the app-data sentinel.
    const env={BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",PATH:process.env.PATH!,HOME:home,HASNA_HOME:join(home,".hasna"),HASNA_STATION:`intake-${randomUUID()}`,TMPDIR:tmpdir()};
    for(const [entry,args] of [["../server/serve-entry.ts",["--help"]],["../mcp/intake.ts",["--help"]],["../cli/index.ts",["intake","--help"]]] as const){
      const result=Bun.spawnSync([process.execPath,"--no-env-file",join(import.meta.dir,entry),...args],{env,stdout:"pipe",stderr:"pipe"});
      expect(result.exitCode,new TextDecoder().decode(result.stderr)).toBe(0);expect(new TextDecoder().decode(result.stdout)).toContain("intake");
    }
    expect(readdirSync(home)).toEqual([]);
  }finally{rmSync(home,{recursive:true,force:true});}
});

test("intake actions refuse missing auth and retired directory selection before opening a local store",()=>{
  const home=mkdtempSync(join(tmpdir(),"events-intake-noauth-"));
  try{
    // Keep Bun's transpilation cache out of the app-data sentinel.
    const env={BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0",PATH:process.env.PATH!,HOME:home,HASNA_HOME:join(home,".hasna"),HASNA_STATION:`intake-${randomUUID()}`,TMPDIR:tmpdir()};
    const entry=join(import.meta.dir,"../cli/index.ts");
    const selectors=["--tenant-id",randomUUID(),"--sink-id",randomUUID(),"--producer-id",randomUUID(),"--corpus-id",randomUUID(),"--source-authority-id",randomUUID()];
    for(const args of [["intake","capability",...selectors],["--dir",join(home,"forbidden"),"intake","capability",...selectors]]){
      const result=Bun.spawnSync([process.execPath,"--no-env-file",entry,...args],{env,stdout:"pipe",stderr:"pipe"});expect(result.exitCode).toBe(1);
    }
    expect(readdirSync(home)).toEqual([]);
  }finally{rmSync(home,{recursive:true,force:true});}
});
