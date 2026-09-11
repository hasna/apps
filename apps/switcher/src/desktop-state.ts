import { Database } from "bun:sqlite";
import { readFile,writeFile,rm,lstat,rename,chmod } from "node:fs/promises";
import { Fault } from "./domain";

export async function safeDesktopRead(path:string):Promise<string|undefined> {
  try {
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.())
      throw new Fault(422,"desktop_state_permissions","Desktop settings must be regular files owned by this user.");
    return await readFile(path,"utf8");
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
}
export async function writeDesktopPrivate(path:string,text:string) {
  const temporary=path+"."+crypto.randomUUID()+".tmp";
  try {await writeFile(temporary,text,{mode:0o600,flag:"wx"});await rename(temporary,path);}
  finally {await rm(temporary,{force:true});}
}
export async function desktopLease(path:string):Promise<()=>void> {
  try {
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.())throw new Fault(422,"desktop_state_permissions","Desktop lease must be a regular file owned by this user.");
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const lease=new Database(path);
  try {await chmod(path,0o600);lease.exec("PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;");}
  catch {lease.close();throw new Fault(409,"desktop_busy","This desktop provider profile is already running. Quit that instance before launching it again.");}
  let closed=false;
  return()=>{if(!closed){closed=true;lease.close();}};
}
