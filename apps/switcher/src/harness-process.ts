import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, openSync, closeSync, writeSync, readSync, constants } from "node:fs";
import { terminalDescriptorDuplicator } from "./terminal-descriptors";

/** Own a POSIX process group; interactive children get a controlling terminal. */
export async function runHarnessProcess(options: {executable:string;args:string[];cwd:string;env:NodeJS.ProcessEnv;timeoutMs?:number}): Promise<{code:number;interrupted:boolean}> {
  const tty=[Boolean(process.stdin.isTTY),Boolean(process.stdout.isTTY),Boolean(process.stderr.isTTY)];
  const grouped=process.platform!=="win32",interactive=grouped&&tty.some(Boolean);
  const redirects=interactive?tty.flatMap((value,index)=>value?[]:[index]):[];
  const duplicator=redirects.length?await terminalDescriptorDuplicator():undefined;
  return new Promise((resolveResult,reject) => {
    const wasRaw=process.stdin.isRaw,wasFlowing=process.stdin.readableFlowing;
    let controllingInput:number|undefined;
    let inputTimer:ReturnType<typeof setInterval>|undefined;
    let terminalFailure: Error | undefined;
    let terminal:Bun.Terminal|undefined;
    let terminalMode:string|undefined;
    let controllingOutput:number|undefined;
    const output=tty[1]?process.stdout:tty[2]?process.stderr:undefined;
    const stty=(args:string[])=>{
      const descriptor=openSync("/dev/tty","r+");
      try {
        const result=spawnSync(existsSync("/bin/stty")?"/bin/stty":"/usr/bin/stty",args,{stdio:[descriptor,"pipe","pipe"],env:{PATH:"/usr/bin:/bin",LANG:"C"},encoding:"utf8",timeout:1000,maxBuffer:4096});
        if(result.status!==0)throw new Error("Terminal mode could not be configured.");
        return result.stdout.trim();
      } finally {closeSync(descriptor);}
    };
    let relay:((chunk:Buffer)=>void)|undefined;
    let resize:(()=>void)|undefined;
    const child:EventEmitter & {pid?:number;kill:(signal:NodeJS.Signals)=>unknown} = (()=>{
      if (!interactive) return spawn(options.executable,options.args,{cwd:options.cwd,env:options.env,stdio:"inherit",shell:false,detached:grouped});
      const duplicates:number[]=[];
      let native:Bun.Subprocess;
      try {
        if(!output)controllingOutput=openSync("/dev/tty","w");
        const [rows,cols]=stty(["size"]).split(/\s+/).map(Number);
        for(const fd of redirects)duplicates.push(duplicator!.duplicate(fd));
        const script=redirects.map((fd,index)=>`exec ${fd}${fd===0?"<&":">&"}${index+3};`).join(" ")+" "+redirects.map((_,index)=>`exec ${index+3}<&-;`).join(" ")+' exec "$@"';
        const command=redirects.length?["/bin/sh","-c",script,"switcher-native",options.executable,...options.args]:[options.executable,...options.args];
        native=Bun.spawn(command,{
          cwd:options.cwd,env:options.env,stdio:["inherit","inherit","inherit",...duplicates],
          terminal:{cols,rows,name:options.env.TERM??"xterm-256color",data(_terminal,data){
            try {if(output)output.write(data);else if(controllingOutput!==undefined)writeSync(controllingOutput,data);}
            catch {failTerminal();}
          }},
        });
      } catch(error) {if(controllingOutput!==undefined){closeSync(controllingOutput);controllingOutput=undefined;}throw error;}
      finally {for(const fd of duplicates)closeSync(fd);duplicator?.close();}
      terminal=native.terminal!;
      const events=Object.assign(new EventEmitter(),{pid:native.pid,kill:(signal:NodeJS.Signals)=>native.kill(signal)});
      void native.exited.then(code=>events.emit("exit",native.signalCode?null:code,native.signalCode),()=>events.emit("error"));
      relay=(chunk)=>{try {terminal?.write(chunk);}catch {failTerminal();}};
      resize=()=>{try {const [rows,cols]=stty(["size"]).split(/\s+/).map(Number);terminal?.resize(cols,rows);}catch {failTerminal();}};
      return events;
    })();
    let interrupted = false;
    let interruptionExitCode: number | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const signalGroup = (signal:NodeJS.Signals) => {
      if (!child.pid) return;
      try { if (grouped) process.kill(-child.pid,signal); else child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.error("switcher: Could not signal an owned harness process."); }
    };
    const groupExists = () => {
      if (!grouped || !child.pid) return false;
      try { process.kill(-child.pid,0);return true; } catch { return false; }
    };
    const forward = (signal:NodeJS.Signals) => {
      interruptionExitCode ??= signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
      interrupted = true;signalGroup(signal);
      killTimer ??= setTimeout(()=>signalGroup("SIGKILL"),5000).unref();
    };
    const failTerminal=()=>{
      terminalFailure ??= new Error("Terminal I/O failed; the owned harness was stopped.");
      forward("SIGTERM");
    };
    const onInt=()=>forward("SIGINT"),onTerm=()=>forward("SIGTERM"),onHangup=()=>forward("SIGHUP");
    // The parent remains the terminal's foreground process group. Forward its
    // window notification to the native group so full-screen clients can resize.
    const onResize=()=>{if(resize)resize();else signalGroup("SIGWINCH");};
    process.on("SIGINT",onInt);process.on("SIGTERM",onTerm);process.on("SIGHUP",onHangup);
    if (grouped) process.on("SIGWINCH",onResize);
    const timeout=options.timeoutMs?setTimeout(()=>forward("SIGTERM"),options.timeoutMs):undefined;
    let cleaned=false;
    const cleanup=()=>{
      if(cleaned)return;cleaned=true;
      let failed=false;
      const attempt=(operation:()=>void)=>{try{operation();}catch{failed=true;}};
      attempt(()=>{process.off("SIGINT",onInt);process.off("SIGTERM",onTerm);process.off("SIGHUP",onHangup);process.off("SIGWINCH",onResize);});
      if(timeout)clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);
      if(relay)attempt(()=>{process.stdin.off("data",relay!);});
      attempt(()=>{process.stdin.off("error",failTerminal);output?.off("error",failTerminal);});
      if(resize)attempt(()=>{output?.off("resize",resize!);});
      if(interactive){if(tty[0])attempt(()=>{process.stdin.setRawMode(wasRaw);});if(terminalMode)attempt(()=>{stty([terminalMode!]);});if(tty[0]&&wasFlowing!==true)attempt(()=>{process.stdin.pause();});}
      if(inputTimer)clearInterval(inputTimer);
      if(controllingInput!==undefined)attempt(()=>{closeSync(controllingInput!);controllingInput=undefined;});
      attempt(()=>{terminal?.close();});
      if(controllingOutput!==undefined)attempt(()=>{closeSync(controllingOutput!);controllingOutput=undefined;});
      if(failed)console.error("switcher: Terminal restoration was incomplete; the owned harness has stopped.");
    };
    child.once("error",()=>{cleanup();reject(new Error("Harness process could not start; check executable and permissions."));});
    child.once("exit",async(code:number|null,signal:string|null)=>{
      // A native CLI may exit while its tool process is still running. Keep
      // bridges/settings alive until that owned group is stopped, even on success.
      if (timeout)clearTimeout(timeout);
      if (groupExists()) {
        signalGroup("SIGTERM");
        const deadline=Date.now()+5000;
        while (groupExists() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
        if(groupExists())signalGroup("SIGKILL");
      }
      cleanup();
      if(terminalFailure){reject(terminalFailure);return;}
      // Native clients may handle termination and exit zero. A caller's
      // cancellation or expired deadline must still be visible to automation.
      const exitCode=interruptionExitCode??code??(signal==="SIGINT"?130:signal==="SIGTERM"?143:signal==="SIGHUP"?129:137);
      resolveResult({code:exitCode,interrupted:interrupted||exitCode===130||exitCode===143||exitCode===129});
    });
    if(interactive) {
      try {
        terminalMode=stty(["-g"]);
        output?.on("error",failTerminal);
        if(tty[0]) {
          process.stdin.on("error",failTerminal);
          process.stdin.setRawMode(true);process.stdin.on("data",relay!);process.stdin.resume();
        } else {
          controllingInput=openSync("/dev/tty",constants.O_RDONLY|constants.O_NONBLOCK);
          stty(["raw","-echo"]);
          const buffer=Buffer.alloc(4096);
          // Bun 1.3.14's tty.ReadStream leaves a blocking read alive after
          // destroy. A bounded nonblocking reader has no pending I/O at close.
          inputTimer=setInterval(()=>{
            try {
              for(let bytes=0;bytes<65536;) {
                const count=readSync(controllingInput!,buffer);
                if(!count){failTerminal();break;}
                terminal?.write(buffer.subarray(0,count));bytes+=count;
              }
            } catch(error) {
              if(!["EAGAIN","EWOULDBLOCK","EINTR"].includes((error as NodeJS.ErrnoException).code??""))failTerminal();
            }
          },16);
        }
        // The inner terminal alone owns output processing. Otherwise both TTYs
        // translate LF, corrupting raw output and producing CR CR LF.
        stty(["-opost"]);
        output?.on("resize",resize!);
      } catch {
        terminalFailure=new Error("The native terminal could not be initialized; the owned harness was stopped.");
        signalGroup("SIGKILL");
      }
    }
  });
}
