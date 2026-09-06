import {expect, test} from "bun:test";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

test.skipIf(process.platform === "win32")("interruption stays nonzero when a native harness traps the signal and exits successfully", async () => {
  const root=join(homedir(),"Workspace/scratch/switcher-tests");
  await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,"signal-exit-"));
  const native=join(dir,"native.ts"),worker=join(dir,"worker.ts");
  await writeFile(native,`import {writeFileSync} from "node:fs";
for(const signal of ["SIGINT","SIGTERM","SIGHUP"])process.on(signal,()=>process.exit(0));
writeFileSync(process.argv[2],"ready");
if(process.argv[3]==="normal")process.exit(0);
setInterval(()=>{},1000);
`);
  await writeFile(worker,`import {existsSync,writeFileSync} from "node:fs";
import {runHarnessProcess} from ${JSON.stringify(new URL("../src/harness-process.ts",import.meta.url).pathname)};
const mode=process.argv[2],ready=process.argv[3],resultFile=process.argv[4];
const timer=mode.startsWith("SIG")?setInterval(()=>{if(existsSync(ready)){clearInterval(timer);process.kill(process.pid,mode);}},10):undefined;
try {
 const result=await runHarnessProcess({executable:process.execPath,args:[${JSON.stringify(native)},ready,mode],cwd:${JSON.stringify(dir)},env:{PATH:process.env.PATH},timeoutMs:mode==="timeout"?500:undefined});
 writeFileSync(resultFile,JSON.stringify(result));
}finally{if(timer)clearInterval(timer);}
`);
  try {
    for(const [mode,code] of [["normal",0],["timeout",143],["SIGINT",130],["SIGTERM",143],["SIGHUP",129]] as const) {
      const resultFile=join(dir,mode+".json");
      const child=Bun.spawn([process.execPath,worker,mode,join(dir,mode+".ready"),resultFile],{env:{PATH:process.env.PATH},stdout:"ignore",stderr:"pipe"});
      const deadline=setTimeout(()=>child.kill("SIGKILL"),5000);
      try {
        expect(await child.exited).toBe(0);
        expect(JSON.parse(await readFile(resultFile,"utf8"))).toEqual({code,interrupted:mode!=="normal"});
      } finally {clearTimeout(deadline);}
    }
  } finally {await rm(dir,{recursive:true,force:true});}
},15_000);
