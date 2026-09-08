import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, realpathSync, writeSync, type Stats } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { darwinOps, type NativeOps } from "./darwin-private-filesystem.js";
import { attachmentDownloadValidation } from "./attachment-download.js";

const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const same = (a:Stats,b:Stats) => a.dev===b.dev && a.ino===b.ino;
function privateFile(stat:Stats,uid:number,links=1) {
  if (!stat.isFile() || stat.uid!==uid || (stat.mode&0o777)!==0o600 || stat.nlink!==links) throw new Error("controlled file must be a single owner-only regular file");
}
async function directory(path:string,fd:number,identity:Stats,uid:number,ops:NativeOps) {
  await attachmentDownloadValidation.assertTrustedOutputPath(path,identity,uid);
  if ((identity.mode&0o777)!==0o700) throw new Error("controlled parent must be mode 0700");
  ops.assertPrivateAcl(fd);
  let ancestor=dirname(path);
  while(true) {
    const parent=openSync(ancestor,flags|constants.O_DIRECTORY);
    try { ops.assertPrivateAcl(parent); } finally {closeSync(parent);}
    const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;
  }
  await attachmentDownloadValidation.assertTrustedOutputPath(path,identity,uid);
}
async function pin(path:string) {
  const ops=await darwinOps();const uid=process.geteuid?.();
  if (!Number.isSafeInteger(uid) || uid! < 0) throw new Error("controlled files require a valid effective user id");
  const parent=dirname(path);
  if(realpathSync(parent)!==parent)throw new Error("controlled parent must not contain symbolic links");
  const fd=openSync(parent,flags|constants.O_DIRECTORY);const identity=fstatSync(fd);
  try {await directory(parent,fd,identity,uid!,ops);return {ops,uid:uid!,parent,fd,identity};}
  catch(error){closeSync(fd);throw error;}
}
function entry(ops:NativeOps,fd:number,name:string):Stats|null {
  let opened:number;
  try {opened=ops.open(fd,name,flags);} catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
  try{return fstatSync(opened);}finally{closeSync(opened);}
}

function receiptBytes(fd:number,expected:Buffer,inode:Stats,uid:number,links:number,ops:NativeOps) {
  const before=fstatSync(fd);privateFile(before,uid,links);ops.assertPrivateAcl(fd);
  if(!same(before,inode)||before.size!==expected.length)throw new Error("controlled receipt identity changed");
  const actual=Buffer.alloc(expected.length+1);let offset=0;
  while(offset<actual.length){const count=readSync(fd,actual,offset,actual.length-offset,offset);if(!count)break;offset+=count;}
  const after=fstatSync(fd);privateFile(after,uid,links);ops.assertPrivateAcl(fd);
  if(offset!==expected.length||!actual.subarray(0,offset).equals(expected)||!same(before,after)||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error("controlled receipt bytes changed");
}

export async function readDarwinControlledFile(pathValue:string,maxBytes:number):Promise<Buffer> {
  const path=resolve(pathValue);const pinned=await pin(path);const {ops,uid,fd,parent,identity}=pinned;
  let file:number|undefined;
  try {
    file=ops.open(fd,basename(path),flags);const before=fstatSync(file);privateFile(before,uid);
    ops.assertPrivateAcl(file);if(before.size>maxBytes)throw new Error("controlled input exceeds size limit");
    const bytes=Buffer.alloc(before.size+1);const count=readSync(file,bytes,0,bytes.length,0);
    const after=fstatSync(file);privateFile(after,uid);ops.assertPrivateAcl(file);
    const named=entry(ops,fd,basename(path));
    if(count!==before.size || after.size!==before.size || !same(before,after) || !named || !same(after,named) || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs)throw new Error("controlled input changed while reading");
    await directory(parent,fd,identity,uid,ops);return bytes.subarray(0,count);
  } finally {if(file!==undefined)closeSync(file);closeSync(fd);}
}

export async function reserveDarwinControlledReceipt(pathValue:string) {
  const path=resolve(pathValue);const {ops,uid,fd,parent,identity}=await pin(path);
  const leaf=basename(path);const temporary=`.controlled-send-${createHash("sha256").update(path).digest("hex").slice(0,32)}.pending`;
  let file:number|undefined;let owned:Stats|undefined;
  try {
    if(entry(ops,fd,leaf))throw new Error("controlled receipt already exists");
    file=ops.open(fd,temporary,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    owned=fstatSync(file);privateFile(owned,uid);ops.assertPrivateAcl(file);
    if(owned.size!==0 || entry(ops,fd,leaf))throw new Error("controlled receipt collision");
    await directory(parent,fd,identity,uid,ops);fsyncSync(file);fsyncSync(fd);
  } catch(error) {
    if(file!==undefined)closeSync(file);
    if(owned){const current=entry(ops,fd,temporary);if(current&&same(current,owned))ops.unlink(fd,temporary);}
    closeSync(fd);throw error;
  }
  const held=file!;const inode=owned!;
  return {path,async finalize(receipt:unknown) {
    let linked=false;
    try {
      await directory(parent,fd,identity,uid,ops);privateFile(fstatSync(held),uid);ops.assertPrivateAcl(held);
      const bytes=Buffer.from(JSON.stringify(receipt,null,2)+"\n");let offset=0;
      while(offset<bytes.length){const count=writeSync(held,bytes,offset,bytes.length-offset,offset);if(!count)throw new Error("controlled receipt write stopped");offset+=count;}
      fsyncSync(held);const named=entry(ops,fd,temporary);const written=fstatSync(held);privateFile(written,uid);
      if(!named||!same(inode,named)||written.size!==bytes.length)throw new Error("controlled receipt reservation changed");
      await directory(parent,fd,identity,uid,ops);receiptBytes(held,bytes,inode,uid,1,ops);
      ops.link(fd,temporary,leaf);linked=true;fsyncSync(fd);
      const published=entry(ops,fd,leaf);if(!published||!same(inode,published))throw new Error("controlled receipt publication changed");
      privateFile(published,uid,2);await directory(parent,fd,identity,uid,ops);
      receiptBytes(held,bytes,inode,uid,2,ops);
      ops.unlink(fd,temporary);fsyncSync(fd);
      const final=entry(ops,fd,leaf);if(!final||!same(inode,final))throw new Error("controlled receipt disappeared");privateFile(final,uid);receiptBytes(held,bytes,inode,uid,1,ops);
    } catch(error) {
      if(linked){const current=entry(ops,fd,leaf);if(current&&same(inode,current)){ops.unlink(fd,leaf);fsyncSync(fd);}}
      throw error;
    } finally {closeSync(held);closeSync(fd);}
  }};
}
