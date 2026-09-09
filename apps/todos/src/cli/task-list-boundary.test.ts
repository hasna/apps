import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeTodosCliAuthority} from './stage-a.js';
test('all task-list aliases reject database selectors before command imports without exposing values',async()=>{
 const root=mkdtempSync(join(tmpdir(),'todos-lists-boundary-'));const privatePath=join(root,'private-location.db');
 try{
 for(const alias of ['lists','task-lists','tl']){
  for(const selector of ['HASNA_TODOS_DB_PATH','TODOS_DB_PATH','HASNA_TODOS_LOCAL','TODOS_LOCAL'])expect(()=>initializeTodosCliAuthority([alias],{[selector]:privatePath})).toThrow('shared API');
  const child=Bun.spawn([process.execPath,'--no-env-file','src/cli/index.tsx',alias,'--add','fixture'],{cwd:join(import.meta.dir,'../..'),env:{PATH:process.env.PATH??'',HOME:root,TMPDIR:root,HASNA_STATION:`fixture-${randomUUID()}`,HASNA_TODOS_DB_PATH:privatePath},stdout:'pipe',stderr:'pipe'});
  const [stderr,code]=await Promise.all([new Response(child.stderr).text(),child.exited]);expect(code).not.toBe(0);expect(stderr).toContain('HASNA_TODOS_API_KEY');expect(stderr).not.toContain(privatePath);
  const missing=Bun.spawn([process.execPath,'--no-env-file','src/cli/index.tsx',alias],{cwd:join(import.meta.dir,'../..'),env:{PATH:process.env.PATH??'',HOME:root,TMPDIR:root,HASNA_STATION:`fixture-${randomUUID()}`},stdout:'pipe',stderr:'pipe'});
  const [missingError,missingCode]=await Promise.all([new Response(missing.stderr).text(),missing.exited]);expect(missingCode).not.toBe(0);expect(missingError).toContain('HASNA_TODOS_API_KEY');expect(missingError).not.toContain('HASNA_TODOS_LOCAL=1');
  expect(initializeTodosCliAuthority([alias,'--help'],{HASNA_TODOS_LOCAL:'1'}).route).toBe('remote-diagnostic');
 }
 expect(readdirSync(root,{recursive:true}).map(String).filter(path=>path.endsWith('.db'))).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
