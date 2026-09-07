import {resolveEmailsHostedTransport} from "./emails-credentials.js";
import {loadEmailsClientEnvSecret} from "./client-env.js";
export interface ProviderSecretStatus {
  source:string; complete:true; checked:boolean; activeKeyId:string|null; availableKeyIds:string[]; referencedKeyIds:string[]; managed_envelopes:number;
  capabilities:{status:boolean;rewrap:boolean;rotate_root:boolean;revoke_root:boolean}; lifecycle_requirement:string;
  default_sender:{type:string;credential_source:string;externally_managed:boolean}|null;
  providers:Array<{provider_id:string;name:string;type:string;active:boolean;configured:boolean;credential_source:string;externally_managed:boolean}>;
}
export type ProviderSecretOperation="rewrap"|"rotate-root"|"revoke-root";
export async function providerSecretApi(path:string,body?:unknown,options:{baseUrl?:string;credentials?:string[];fetchImpl?:typeof fetch}={}):Promise<Record<string,unknown>> {
  let {baseUrl,credentials}=options;
  if(!baseUrl||!credentials){loadEmailsClientEnvSecret(process.env);const transport=resolveEmailsHostedTransport(process.env);baseUrl=transport.baseUrl;credentials=[transport.credential,...(transport.credentialFallbacks??[]).map(x=>x.value)];}
  for(let index=0;index<credentials.length;index++){
    const response=await (options.fetchImpl??fetch)(`${baseUrl}/providers/secrets/${path}`,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${credentials[index]}`,"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401&&index<credentials.length-1){await response.body?.cancel().catch(()=>{});continue;}
    if(response.status===404||response.status===405){await response.body?.cancel().catch(()=>{});throw new Error("The Emails API needs an update to support server provider-secret management.");}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(`Provider-secret API request failed (HTTP ${response.status}).`);}
    return await response.json() as Record<string,unknown>;
  }
  throw new Error("No Emails API credential is configured.");
}
export async function fetchProviderSecretStatus(options:Parameters<typeof providerSecretApi>[2]={}):Promise<ProviderSecretStatus>{
  const value=await providerSecretApi("status",undefined,options) as unknown as ProviderSecretStatus;
  if(value.complete!==true||value.checked!==false||typeof value.source!=="string"||!Array.isArray(value.providers)||!Array.isArray(value.availableKeyIds)||!Array.isArray(value.referencedKeyIds)||!value.capabilities||value.capabilities.status!==true||typeof value.managed_envelopes!=="number"||typeof value.lifecycle_requirement!=="string") throw new Error("The Emails API returned an invalid provider-secret status.");
  return value;
}
export function requireProviderSecretOperation(status:ProviderSecretStatus,operation:ProviderSecretOperation):void{
  const key=operation.replaceAll("-","_") as "rewrap"|"rotate_root"|"revoke_root";
  if(status.capabilities[key]!==true) throw new Error(status.lifecycle_requirement);
}

/** Generated SDK operations share normal credential resolution and authentication fallback. */
async function managedRequest<T>(operation:(client:import("../selfhost.js").EmailsSelfHostClient)=>Promise<T>):Promise<T>{
  const {EmailsSelfHostClient,ApiError}=await import("../selfhost.js");
  loadEmailsClientEnvSecret(process.env);
  const transport=resolveEmailsHostedTransport(process.env);
  const baseUrl=transport.baseUrl.replace(/\/v1\/?$/,"").replace(/\/$/,"");
  const credentials=[transport.credential,...(transport.credentialFallbacks??[]).map(item=>item.value)];
  for(let index=0;index<credentials.length;index++){
    try{return await operation(new EmailsSelfHostClient({baseUrl,bearerToken:credentials[index]}));}
    catch(error){
      if(error instanceof ApiError&&error.status===401&&index<credentials.length-1)continue;
      if(error instanceof ApiError&&(error.status===404||error.status===405))throw Error("Credential operation or tenant resource unavailable; verify the ID and update the Emails API if this operation is unsupported.");
      if(error instanceof ApiError&&[400,409,503].includes(error.status)){
        const detail=error.body&&typeof error.body==="object"?(error.body as Record<string,unknown>).error:undefined;
        throw Error(typeof detail==="string"&&detail.length<=1024?detail:`Provider credential operation failed (HTTP ${error.status}); inspect job or credential status before retrying.`);
      }
      throw error;
    }
  }
  throw Error("No Emails API credential is configured.");
}
export type ProviderSecretJobReceipt=Awaited<ReturnType<import("../selfhost.js").EmailsSelfHostClient["getProviderSecretJob"]>>;
function validJob(job:ProviderSecretJobReceipt):ProviderSecretJobReceipt{
  if(!job||typeof job.id!=="string"||typeof job.root_id!=="string"||!["rewrap","rotate-root","revoke-root"].includes(job.operation)||!["pending","complete"].includes(job.status)||!Number.isSafeInteger(job.remaining)||job.remaining<0||!Number.isSafeInteger(job.processed)||job.processed<0||(job.status==="complete"&&job.remaining!==0))throw Error("The API returned an unconfirmed provider credential job receipt.");
  return job;
}
export async function beginProviderSecretJob(operation:ProviderSecretOperation,key:string,root?:string):Promise<ProviderSecretJobReceipt>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw Error("Supply a reusable UUID with --idempotency-key; reuse it after uncertain retries.");
  const body={idempotency_key:key};
  return validJob(await managedRequest(client=>operation==="rewrap"?client.rewrapProviderSecrets(body):operation==="rotate-root"?client.rotateProviderSecretRoot(body):client.revokeProviderSecretRoot({...body,key_id:root??""})));
}
export async function readProviderSecretJob(id:string,advance=false):Promise<ProviderSecretJobReceipt>{
  return validJob(await managedRequest(client=>advance?client.advanceProviderSecretJob(id,{limit:20}):client.getProviderSecretJob(id)));
}
export async function installApiProviderCredentials(id:string,credentials:unknown,revision:number|null){
  const {validateManagedProviderCredentials}=await import("../server/self-hosted/managed-provider-crypto.js");
  const validated=validateManagedProviderCredentials(credentials);
  const receipt=await managedRequest(client=>client.installProviderCredentials(id,{credentials:validated,expected_revision:revision}));
  if(receipt.status!=="complete"||receipt.checked!==false||!Number.isSafeInteger(receipt.revision))throw Error("The API did not confirm credential installation; inspect provider secret status before retrying.");
  return receipt;
}
