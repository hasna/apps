import { API_KEY_ISSUANCE_PENDING_REASON, apiKeyPrefix, hashToken, mintApiKey, normalizeTenantId, verifyApiKeyToken, type ApiKeyStore, type MintedApiKey } from "@hasna/contracts/auth";
import { stationNameSchema } from "../api/domain.js";
export type IssuanceStore = Pick<ApiKeyStore, "findByKid" | "insertMintedPending" | "activatePending">;
export type CredentialVault = { read(): Promise<string | null>; write(token: string, version: string): Promise<void> };

/** Caller serializes this operation by its exact vault destination. Tokens never enter the result or logs. */
export async function provisionCredential(options: { keys: IssuanceStore; vault: CredentialVault; signingSecret: string | Buffer; tenant: string; subject: string; kind: "station" | "backup-worker" }) {
  try {
    const subject = stationNameSchema.parse(options.subject); const tenant = normalizeTenantId(options.tenant);
    if (!["station", "backup-worker"].includes(options.kind) || (options.kind === "backup-worker" && subject !== "backup-worker") || (options.kind === "station" && subject === "backup-worker")) throw new Error();
    if (Buffer.byteLength(typeof options.signingSecret === "string" ? options.signingSecret.trim() : options.signingSecret) < 32) throw new Error();
    const scopes = options.kind === "station" ? ["trash:read", "trash:write"] : ["trash:read", "trash:backup"];
    let token = await options.vault.read(); let minted: MintedApiKey;
    if (token === null) {
      minted = mintApiKey({ app: "trash", signingSecret: options.signingSecret, tid: tenant, agent: subject, scopes, ttlSeconds: 365 * 86400 });
      await options.keys.insertMintedPending(minted, "trash-provision");
      try { await options.vault.write(minted.token, minted.tokenHash); }
      catch { /* Delivery may have committed before the response was lost. Exact readback decides. */ }
      token = await options.vault.read();
      if (token !== minted.token) throw new Error();
    } else {
      if (typeof token !== "string" || token.length > 4096) throw new Error();
      const verified = verifyApiKeyToken(token, { signingSecret: options.signingSecret, expectedApp: "trash", expectedTid: tenant, requiredScopes: scopes });
      if (!verified.ok || verified.agent !== subject || JSON.stringify([...verified.claims.scopes].sort()) !== JSON.stringify([...scopes].sort()) || verified.claims.exp === null) throw new Error();
      minted = { token, kid: verified.kid, claims: verified.claims, tokenHash: hashToken(token), prefix: apiKeyPrefix("trash") };
      // A previous DB transaction may have rolled back after its vault write committed.
      // The exact signed vault authority can recover only an absent record, never a revocation.
      if (!await options.keys.findByKid(minted.kid)) await options.keys.insertMintedPending(minted, "trash-provision-recovery");
    }
    const record = await options.keys.findByKid(minted.kid);
    if (!record || record.app !== "trash" || record.agent !== subject || record.tid !== tenant || record.tokenHash !== minted.tokenHash ||
      JSON.stringify([...record.scopes].sort()) !== JSON.stringify([...scopes].sort()) ||
      (record.revokedAt !== null && record.revokedReason !== API_KEY_ISSUANCE_PENDING_REASON)) throw new Error();
    if (await options.vault.read() !== minted.token || !await options.keys.activatePending(minted.kid, minted.tokenHash)) throw new Error();
    return { app: "trash", kid: minted.kid, subject, tenant, scopes, expiresAt: new Date(minted.claims.exp! * 1000).toISOString() };
  } catch { throw new Error("Trash credential provisioning failed; inspect the configured authority and pending issuance. No credential value is returned."); }
}
