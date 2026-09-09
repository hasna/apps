import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mintApiKey,verifyApiKey} from '@hasna/contracts/auth';
import {handleV1Request,type V1RequestDependencies} from './v1.js';
test('real signed different-tenant keys cannot read or mutate any shared V1 family before storage access',async()=>{
 const secret=randomUUID()+randomUUID();
 const key=mintApiKey({app:'todos',scopes:['todos:read','todos:write'],signingSecret:secret,agent:'fixture',tid:'other-tenant'});
 const verifier=verifyApiKey({app:'todos',signingSecret:secret,keyStatus:async kid=>kid===key.kid?'active':'unknown'});
 let access=0;
 const deps:V1RequestDependencies={getVerifier:()=>verifier,getMachineRegistryTenantId:()=> 'fixture-tenant',ensureSchema:async()=>{access++;throw new Error('Unexpected schema access');},getStorageAdapter:()=>{access++;throw new Error('Unexpected storage access');}};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>(await handleV1Request(req,new URL(req.url),deps))??new Response('not found',{status:404})});
 try{
  for(const path of ['tasks','projects','plans','templates','agents','activity','task-lists','dependencies','commits/fixture','refs/fixture','next','stats','integrity','import','machines','project-migrations','pr-groups','project-registration','task-manifest','task-subtree-transfer']) {
   for(const method of ['GET','POST']) {
    const response=await fetch(new URL(`/v1/${path}`,server.url),{method,headers:{Authorization:`Bearer ${key.token}`},...(method==='POST'?{body:'{}'}:{})});
    expect(response.status,`${method} ${path}`).toBe(403);
   }
  }
  expect(access).toBe(0);
  const anonymous=await fetch(new URL('/v1/tasks',server.url));expect(anonymous.status).toBe(401);expect(access).toBe(0);
 }finally{server.stop(true);}
});
