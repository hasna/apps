import type {ManagedProviderSecrets} from "./managed-provider-secrets.js";
import type { TenantScopedStore } from "./store.js";
import type { SenderResolver, SelfHostedSender } from "./sender.js";
import { resourceSpecForPath } from "./resources.js";

/** Registry and binding metadata only: never initialize a keyring or probe credentials. */
export async function readProviderSecretStatus(store: TenantScopedStore, tenant: string, resolveSender?: SenderResolver, defaultSender?: SelfHostedSender, managed?: ManagedProviderSecrets) {
  const metadata=await managed?.metadata();
  const providers: Array<{provider_id:string;name:string;type:string;active:boolean;configured:boolean;credential_source:string;externally_managed:boolean}> = [];
  const seen = new Set<string>();
  for (let page=0;page<100;page++) {
    const rows=await store.listResource(resourceSpecForPath("providers")!,{limit:500,offset:providers.length});
    if (!rows.length) return {
      source:metadata ? "server_managed_and_references" : "server_references", complete:true, checked:false,
      activeKeyId:metadata?.roots.find(root=>root.state==="active")?.id ?? null, availableKeyIds:metadata?.roots.filter(root=>root.state!=="revoked").map(root=>root.id) ?? [], referencedKeyIds:[...new Set(metadata?.envelopes.map(envelope=>envelope.root_id) ?? [])], managed_envelopes:metadata?.envelopes.length ?? 0,
      capabilities:{status:true,rewrap:false,rotate_root:false,revoke_root:false},
      lifecycle_requirement:metadata ? "Managed credential storage is configured; lifecycle API is not enabled in this build. Injected credentials remain externally managed." : "A server-managed tenant credential envelope backend is required for rewrap, rotate-root and revoke-root; injected credentials and workload roles remain externally managed.",
      default_sender:defaultSender ? {type:defaultSender.provider,credential_source:defaultSender.credentialSource ?? "server_binding",externally_managed:true} : null,
      providers,
    };
    for (const row of rows) {
      const id=String(row.id ?? "");if(!id||seen.has(id)) throw new Error("Provider registry changed during enumeration; retry secret status.");
      seen.add(id);
      const envelope=metadata?.envelopes.find(item=>item.provider_id===id);
      // Metadata status must not unwrap or probe managed credentials.
      if(envelope){providers.push({provider_id:id,name:String(row.name??id),type:String(row.type),active:row.active!==false,configured:true,credential_source:"managed_envelope",externally_managed:false});continue;}
      const sender=await resolveSender?.(tenant,id), compatible=!!sender&&sender.provider===row.type;
      providers.push({provider_id:id,name:String(row.name??id),type:String(row.type),active:row.active!==false,configured:compatible,credential_source:compatible ? sender.credentialSource ?? "server_binding" : sender ? "binding_type_mismatch" : "unconfigured",externally_managed:compatible});
    }
  }
  throw new Error("Provider registry enumeration incomplete; retry secret status.");
}
