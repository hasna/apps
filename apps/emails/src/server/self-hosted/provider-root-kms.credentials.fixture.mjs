import assert from 'node:assert/strict';
import {buildProviderRootKms} from './provider-root-kms.ts';

// Executed in a child process by provider-root-kms.test.ts so this fixture
// cannot change the test runner's AWS environment or credential caches.
let metadataAvailable=true;
const signedBy=[];
let metadataCalls=0;
const plaintext=Buffer.alloc(32,7).toString('base64');
const ciphertext=Buffer.from('fixture-ciphertext').toString('base64');
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
 const path=new URL(request.url).pathname;
 if(path==='/credentials'){
  metadataCalls++;
  if(!metadataAvailable)return new Response('',{status:403});
  return Response.json({AccessKeyId:'fixture-metadata-key',SecretAccessKey:'fixture-metadata-secret',Token:'fixture-token',Expiration:new Date(Date.now()+3600000).toISOString()});
 }
 if(path==='/kms'||path==='/kms/'){
  const authorization=request.headers.get('authorization')??'';
  signedBy.push(authorization.includes('Credential=fixture-metadata-key/')?'metadata':authorization.includes('Credential=fixture-env-key/')?'environment':'unknown');
  return Response.json({KeyId:'alias/provider-fixture',Plaintext:plaintext,CiphertextBlob:ciphertext},{headers:{'content-type':'application/x-amz-json-1.1'}});
 }
 return new Response('',{status:404});
}});

let stage='initialization';
try{
 process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI=`http://127.0.0.1:${server.port}/credentials`;
 process.env.AWS_ENDPOINT_URL_KMS=`http://127.0.0.1:${server.port}/kms`;
 process.env.AWS_ACCESS_KEY_ID='fixture-env-key';
 process.env.AWS_SECRET_ACCESS_KEY='fixture-env-secret';
 process.env.EMAILS_PROVIDER_KMS_KEY_ID='alias/provider-fixture';
 process.env.EMAILS_PROVIDER_KMS_REGION='us-east-1';
 const context={app:'emails',tenant:'tenant-fixture',root:'root-fixture',purpose:'provider-root'};
 const kms=buildProviderRootKms();
 assert.ok(kms);
 stage='container credentials';
 const generated=await kms.generate(context,AbortSignal.timeout(3000));
 assert.equal(generated.plaintext.length,32);
 const decrypted=await kms.decrypt(generated.ciphertext,context,AbortSignal.timeout(3000));
 assert.equal(decrypted.length,32);
 assert.deepEqual(signedBy,['metadata','metadata']);
 stage='metadata failure';
 metadataAvailable=false;
 const before=signedBy.length;
 await assert.rejects(kms.generate(context,AbortSignal.timeout(3000)),error=>error.message==='Provider root KMS generation failed; check server key permissions and availability');
 await assert.rejects(kms.decrypt(generated.ciphertext,context,AbortSignal.timeout(3000)),error=>error.message==='Provider root KMS decryption failed; check server key permissions and availability');
 assert.equal(signedBy.length,before);
 stage='non-container credentials';
 delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
 const local=buildProviderRootKms();
 assert.ok(local);
 await local.generate(context,AbortSignal.timeout(3000));
 assert.deepEqual(signedBy,['metadata','metadata','environment']);
 console.log(JSON.stringify({containerCalls:2,metadataFailureBlocked:true,nonContainerCalls:1,metadataCallsAtLeast:metadataCalls>=4}));
}catch{
 console.error(`provider KMS credential fixture failed at ${stage}`);
 process.exitCode=1;
}finally{
 server.stop(true);
}
