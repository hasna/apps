#!/usr/bin/env bun
// Issue a tenant-bound loops API key using the @hasna/contracts minting
// primitive, then persist its immutable tenant/principal binding through the
// SSM tunnel with relaxed TLS (the tunnel terminates
// at localhost so the RDS cert hostname never matches; the in-cluster issuer
// path uses verify-full). Prints ONLY the kid to stdout; the secret token is
// written to $TOKEN_OUT (a /dev/shm file), never logged.
import { Pool } from "pg";
import { closeSync, constants, openSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../src/generated/storage-kit/query.js";

export function writeTokenFile(tokenOut: string, token: string): void {
  const resolvedTokenOut = resolve(tokenOut);
  if (dirname(resolvedTokenOut) !== "/dev/shm" || basename(resolvedTokenOut) !== basename(tokenOut)) {
    throw new Error("TOKEN_OUT must be a direct child of /dev/shm");
  }
  const tokenFd = openSync(
    resolvedTokenOut,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(tokenFd, token, { encoding: "utf8" });
  } finally {
    closeSync(tokenFd);
  }
}

async function main(): Promise<void> {
  const signingSecret = process.env.HASNA_LOOPS_API_SIGNING_KEY?.trim();
  const dsn = process.env.TUNNEL_DATABASE_URL?.trim();
  const tokenOut = process.env.TOKEN_OUT?.trim();
  const tenantId = process.env.KEY_TENANT_ID?.trim();
  const principalId = process.env.KEY_PRINCIPAL_ID?.trim();
  const tokenKind = process.env.KEY_TOKEN_KIND?.trim();
  if (!signingSecret) throw new Error("set HASNA_LOOPS_API_SIGNING_KEY");
  if (!dsn) throw new Error("set TUNNEL_DATABASE_URL");
  if (!tokenOut) throw new Error("set TOKEN_OUT");
  if (!tenantId) throw new Error("set KEY_TENANT_ID");
  if (!principalId) throw new Error("set KEY_PRINCIPAL_ID");
  if (!tokenKind || !["api_key", "service", "machine"].includes(tokenKind)) {
    throw new Error("set KEY_TOKEN_KIND to api_key, service, or machine");
  }

  const pool = new Pool({ connectionString: dsn.split("?")[0], ssl: { rejectUnauthorized: false }, max: 2 });
  try {
    const client = createQueryClient(pool);
    const minted = await mintApiKey({
      app: "loops",
      agent: principalId,
      scopes: (process.env.KEY_SCOPES ?? "loops:read").split(","),
      signingSecret,
    });
    let tokenWritten = false;
    try {
      await client.transaction(async (tx) => {
        await tx.execute("SET LOCAL ROLE open_loops_owner");
        await tx.get("SELECT set_config('open_loops.tenant_id', $1, true)", [tenantId]);
        const membership = await tx.get(
          "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND principal_id=$2 AND status='active'",
          [tenantId, principalId],
        );
        if (!membership) throw new Error("active tenant membership not found");
        await tx.execute(
          `INSERT INTO api_keys(
            kid, app, agent, scopes, token_hash, issued_at, expires_at, created_by,
            tenant_id, principal_id, token_kind
          ) VALUES ($1,'loops',$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
          [
            minted.kid,
            principalId,
            JSON.stringify(minted.claims.scopes),
            minted.tokenHash,
            new Date(minted.claims.iat * 1000).toISOString(),
            minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString(),
            principalId,
            tenantId,
            principalId,
            tokenKind,
          ],
        );
        writeTokenFile(tokenOut, minted.token);
        tokenWritten = true;
      });
    } catch (error) {
      if (tokenWritten) {
        try { unlinkSync(tokenOut); } catch {}
      }
      throw error;
    }
    console.log(JSON.stringify({
      evt: "key_issued",
      kid: minted.kid,
      app: "loops",
      tenantId,
      principalId,
      tokenKind,
      scopes: minted.claims.scopes,
      expiresAt: minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString(),
    }));
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
