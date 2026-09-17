import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
async function boundedJson(response: Response): Promise<any> {
  if (!response.body) throw new Error();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 65536) throw new Error(); chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** The destination is fixed before consuming the deployment-only credential. */
export async function verifyClientCredential(key: string, version: string, fetchImpl: Fetch = fetch) {
  try {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) || typeof key !== "string" || key.length < 64 || key.length > 4096 || /\s/.test(key)) throw new Error();
    const proofs = [undefined, "trash-release-invalid-control", key];
    for (const token of proofs) {
      const response = await fetchImpl("https://api.hasna.com/trash/v1/status", {
        redirect: "error", signal: AbortSignal.timeout(15_000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "hasna-trash-release-probe/1.0" },
      });
      const body = await boundedJson(response);
      if (token === key) {
        if (response.status !== 200 || body.app !== "trash" || body.version !== version || body.listLimit?.default !== 20 || body.listLimit?.max !== 100) throw new Error();
      } else if (![401, 403].includes(response.status) || typeof body.error?.code !== "string" || !body.error.code.startsWith("auth_")) throw new Error();
    }
    return { app: "trash", version, authenticated: true, anonymousDenied: true, invalidDenied: true };
  } catch { throw new Error("Client acceptance failed."); }
}

async function main() {
  const version = process.argv[2];
  if (!version || process.argv.length !== 3) throw new Error();
  const vault = new SecretsManagerClient({ region: "us-east-1", maxAttempts: 2 });
  try {
    const value = await vault.send(new GetSecretValueCommand({ SecretId: "trash/prod/clients/deploy-probe" }), { abortSignal: AbortSignal.timeout(15_000) });
    if (typeof value.SecretString !== "string") throw new Error();
    console.log(JSON.stringify(await verifyClientCredential(value.SecretString, version)));
  } finally { vault.destroy(); }
}
if (import.meta.main) main().catch(() => { console.error("Trash client acceptance failed; verify the dedicated deployment credential and canonical API."); process.exitCode = 1; });
