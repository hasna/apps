#!/usr/bin/env bun
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ApiKeyStore, normalizeTenantId, resolveSigningSecret } from "@hasna/contracts/auth";
import { PgTrashStore } from "../api/store.js";
import { stationNameSchema } from "../api/domain.js";
import { provisionCredential } from "./provision.js";

export async function main(env = process.env) {
  const subject = stationNameSchema.parse(env.MINT_SUBJECT); const kind = env.MINT_KIND;
  if (kind !== "station" && kind !== "backup-worker") throw new Error("Invalid mint kind.");
  const tenant = normalizeTenantId(env.MINT_TENANT ?? "");
  const secretId = `trash/prod/clients/${subject}`;
  if (env.MINT_SECRET_ID !== secretId) throw new Error("Credential destination does not match the signed subject.");
  const databaseUrl = env.HASNA_TRASH_DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error("Configure the Trash database.");
  // hasna-credential-seam-waiver: inbound service signing authority for the dedicated operator mint task.
  const signingSecret = resolveSigningSecret("trash", env, { envName: "HASNA_TRASH_API_SIGNING_KEY" }).value;
  const secrets = new SecretsManagerClient({ region: env.AWS_REGION ?? "us-east-1", maxAttempts: 2 });
  const vault = {
    async read() {
      try {
        const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }), { abortSignal: AbortSignal.timeout(30_000) });
        if (typeof result.SecretString !== "string" || result.SecretString.length > 4096) throw new Error("Invalid credential envelope.");
        return result.SecretString;
      } catch (error) { if ((error as { name?: string }).name === "ResourceNotFoundException") return null; throw error; }
    },
    async write(token: string, version: string) { await secrets.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: token, ClientRequestToken: version }), { abortSignal: AbortSignal.timeout(30_000) }); },
  };
  const store = await PgTrashStore.open(databaseUrl);
  try {
    const receipt = await store.sql.begin(async (tx) => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`trash-provision:${secretId}`]);
      return provisionCredential({ keys: new ApiKeyStore(store.authQueryClient(tx)), vault, signingSecret, tenant, subject, kind });
    });
    console.log(JSON.stringify({ event: "credential_provisioned", ...receipt }));
  } finally { await store.close(); secrets.destroy(); }
}
if (import.meta.main) main().catch(() => { console.error(JSON.stringify({ error: "credential_provision_failed", message: "Check the exact Trash database, vault destination and issued-to subject. Pending or revoked credentials remain denied." })); process.exitCode = 1; });
