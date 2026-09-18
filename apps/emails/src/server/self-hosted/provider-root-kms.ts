import {KMSClient,GenerateDataKeyCommand,DecryptCommand} from "@aws-sdk/client-kms";
import {fromContainerMetadata} from "@aws-sdk/credential-providers";
import type {ProviderRootKms,RootContext} from "./managed-provider-crypto.js";
interface KmsTransport {send(command:GenerateDataKeyCommand|DecryptCommand,options:{abortSignal:AbortSignal}):Promise<{Plaintext?:Uint8Array;CiphertextBlob?:Uint8Array}>;destroy():void}
type KmsFactory=(region:string,useContainerRole:boolean)=>KmsTransport;
const defaultFactory:KmsFactory=(region,useContainerRole)=>new KMSClient({region,maxAttempts:2,...(useContainerRole?{credentials:fromContainerMetadata()}:{})});
/** Deployment-owned KMS key selection: never accept a key ID or endpoint from a tenant request. */
export function buildProviderRootKms(env:NodeJS.ProcessEnv=process.env,factory:KmsFactory=defaultFactory):ProviderRootKms|undefined {
 const key=env.EMAILS_PROVIDER_KMS_KEY_ID?.trim(),region=env.EMAILS_PROVIDER_KMS_REGION?.trim();
 if(!key&&!region)return undefined;
 if(!key||!region||key.length>2048||/[\s\x00-\x1f\x7f]/.test(key)||!/^[-a-z0-9]+$/.test(region))throw new Error("Configure EMAILS_PROVIDER_KMS_KEY_ID and EMAILS_PROVIDER_KMS_REGION together");
 // ECS tasks may also carry namespaced SES credentials and legacy AWS env credentials.
 // Bind only KMS to the task role; a broken metadata endpoint must fail closed.
 const useContainerRole=Boolean(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim()||env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim());
 const context=(value:RootContext)=>({app:value.app,tenant:value.tenant,root:value.root,purpose:value.purpose});
 return{
  async generate(value,signal){const client=factory(region,useContainerRole);try{
   const result=await client.send(new GenerateDataKeyCommand({KeyId:key,KeySpec:"AES_256",EncryptionContext:context(value)}),{abortSignal:signal});
   if(!result.Plaintext||!result.CiphertextBlob||result.Plaintext.length!==32||!result.CiphertextBlob.length){result.Plaintext?.fill(0);throw new Error("Provider root KMS generation did not return usable key material");}
   const plaintext=Buffer.from(result.Plaintext);result.Plaintext.fill(0);return{plaintext,ciphertext:Buffer.from(result.CiphertextBlob)};
  }catch{throw new Error("Provider root KMS generation failed; check server key permissions and availability");}finally{client.destroy();}},
  async decrypt(ciphertext,value,signal){const client=factory(region,useContainerRole);try{
   const result=await client.send(new DecryptCommand({KeyId:key,CiphertextBlob:ciphertext,EncryptionAlgorithm:"SYMMETRIC_DEFAULT",EncryptionContext:context(value)}),{abortSignal:signal});
   if(!result.Plaintext||result.Plaintext.length!==32){result.Plaintext?.fill(0);throw new Error("Provider root KMS decryption did not return usable key material");}
   const plaintext=Buffer.from(result.Plaintext);result.Plaintext.fill(0);return plaintext;
  }catch{throw new Error("Provider root KMS decryption failed; check server key permissions and availability");}finally{client.destroy();}},
 };
}

/** Preserve managed ownership checks when deployment key configuration is removed. */
export const unconfiguredProviderRootKms:ProviderRootKms={configured:false,generate:async()=>{throw Error("Managed provider KMS is not configured");},decrypt:async()=>{throw Error("Managed provider KMS is not configured");}};
