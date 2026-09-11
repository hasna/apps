import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile, link, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { repairVaultExecutablePermissions, validateVaultExecutable } from "../src/credentials";
const digest=(bytes:string)=>createHash("sha256").update(bytes).digest("hex");
const content="#!/bin/sh\nprintf 'must-never-execute' > executed\n";
async function fixture(){const base=process.env.SWITCHER_TEST_ROOT??join(homedir(),".cache/switcher-permission-tests");await mkdir(base,{recursive:true,mode:0o700});const root=await mkdtemp(join(base,"repair-"));const path=join(root,"secrets");await writeFile(path,content,{mode:0o755});return {root,path};}
test("verified repair replaces writable inode, preserves bytes, revokes old writers and is idempotent",async()=>{
 const {root,path}=await fixture();try{
  const alias=join(root,"alias");await symlink(path,alias);await chmod(path,0o777);const before=await lstat(path);
  await expect(validateVaultExecutable(alias)).rejects.toMatchObject({code:"vault_exec_permissions"});
  const writer=await open(path,"r+");
  try {
   expect(await repairVaultExecutablePermissions(alias,digest(content))).toMatchObject({changed:true,mode:"0755",sha256:digest(content)});
   await writer.writeFile("changed through pre-existing writable fd"); await writer.sync();
  }finally{await writer.close();}
  const installed=await lstat(path);expect(installed.ino).not.toBe(before.ino);expect(await readFile(path,"utf8")).toBe(content);
  expect(await validateVaultExecutable(alias)).toBe(path);
  expect(await repairVaultExecutablePermissions(alias,digest(content))).toMatchObject({changed:false,mode:"0755"});
  expect((await lstat(path)).ino).toBe(installed.ino);
  expect(await Bun.file(join(root,"executed")).exists()).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("repair refuses mismatches and unsafe ancestors, detaches cache hardlinks, and refuses missing execute bit",async()=>{
 const {root,path}=await fixture();try{
  await chmod(path,0o777);
  await expect(repairVaultExecutablePermissions(path,digest("different trusted archive"))).rejects.toMatchObject({code:"vault_exec_digest_mismatch"});
  expect((await lstat(path)).mode&0o777).toBe(0o777);
  await chmod(root,0o777);await expect(repairVaultExecutablePermissions(path,digest(content))).rejects.toMatchObject({code:"vault_exec_permissions"});await chmod(root,0o700);
  const hardlink=join(root,"hardlink");await link(path,hardlink);const cached=await lstat(hardlink);
  await repairVaultExecutablePermissions(path,digest(content));
  expect((await lstat(hardlink)).mode&0o777).toBe(0o777);expect((await lstat(hardlink)).ino).toBe(cached.ino);expect((await lstat(path)).ino).not.toBe(cached.ino);expect(await readFile(hardlink,"utf8")).toBe(content);
  await chmod(path,0o666);await expect(repairVaultExecutablePermissions(path,digest(content))).rejects.toMatchObject({code:"vault_exec_unavailable"});
  expect((await lstat(path)).mode&0o777).toBe(0o666);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("actual CLI requires an explicit trusted digest and repairs the selected binding without vault access",async()=>{
 const {root,path}=await fixture();const cli=new URL("../src/cli.ts",import.meta.url).pathname;
 const run=async(args:string[])=>{const p=Bun.spawn([process.execPath,cli,...args],{cwd:root,env:{PATH:process.env.PATH,HOME:root,HASNA_SWITCHER_HOME:join(root,"data"),HASNA_STATION:"repair-fixture"},stdout:"pipe",stderr:"pipe"});const [code,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);return {code,out,err};};
 try{
  await chmod(path,0o777);
  expect((await run(["credentials","bind","deepseek","--vault-key","fixture/live/deepseek","--vault-cli",path])).code).toBe(1);
  expect((await run(["credentials","repair-executable","--vault-cli",path,"--sha256",digest(content)])).code).toBe(0);
  expect((await run(["credentials","bind","deepseek","--vault-key","fixture/live/deepseek","--vault-cli",path])).code).toBe(0);await chmod(path,0o777);
  for(const extra of [[],["--sha256","invalid"],["--sha256",digest("wrong")],["--sha256",digest(content),"--vault-cli",path]]){
   expect((await run(["credentials","repair-executable","deepseek",...extra])).code).toBe(1);expect((await lstat(path)).mode&0o777).toBe(0o777);
  }
  const result=await run(["credentials","repair-executable","deepseek","--sha256",digest(content)]);expect(result.code,result.err).toBe(0);expect(JSON.parse(result.out)).toMatchObject({changed:true,mode:"0755"});
  expect(await Bun.file(join(root,"executed")).exists()).toBe(false);expect(await Bun.file(join(root,"data/switcher.sqlite")).exists()).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("actual Bun package bin installation is finalized against its trusted artifact member",async()=>{
 const {root,path}=await fixture();
 try{
  const producer=join(root,"producer"),consumer=join(root,"consumer");await mkdir(producer,{mode:0o700});await mkdir(consumer,{mode:0o700});
  await writeFile(join(producer,"package.json"),JSON.stringify({name:"fixture-vault-bin-permissions",version:"1.0.0",bin:{"fixture-vault":"cli.js"}}));
  await writeFile(join(producer,"cli.js"),content,{mode:0o755});await writeFile(join(consumer,"package.json"),'{"private":true}');
  const env={HOME:homedir(),PATH:process.env.PATH};
  const pack=Bun.spawn(["npm","pack","--ignore-scripts","--json","--pack-destination",root],{cwd:producer,env,stdout:"pipe",stderr:"pipe"});
  const [packed,packError,packCode]=await Promise.all([new Response(pack.stdout).text(),new Response(pack.stderr).text(),pack.exited]);expect(packCode,packError).toBe(0);
  const install=Bun.spawn([process.execPath,"add","--ignore-scripts",join(root,JSON.parse(packed)[0].filename)],{cwd:consumer,env,stdout:"pipe",stderr:"pipe"});
  const [installOutput,installError,installCode]=await Promise.all([new Response(install.stdout).text(),new Response(install.stderr).text(),install.exited]);expect(installCode,installOutput+installError).toBe(0);
  const installed=join(consumer,"node_modules/fixture-vault-bin-permissions/cli.js");
  expect(await readFile(installed,"utf8")).toBe(content);
  // Bun 1.3.14 produces 0777 here even from a 0755 package member. Future
  // installers may fix it; either shape must finish as a trusted executable.
  await repairVaultExecutablePermissions(installed,digest(content));
  expect((await lstat(installed)).mode&0o022).toBe(0);expect(await validateVaultExecutable(installed)).toBe(installed);
  expect(await Bun.file(join(consumer,"executed")).exists()).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
