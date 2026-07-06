#!/usr/bin/env bun
// Issue a real loops API key using the @hasna/contracts issuer primitives
// (mintApiKey + ApiKeyStore.insertMinted) — identical to `contracts issue-key`,
// but persists through the SSM tunnel with relaxed TLS (the tunnel terminates
// at localhost so the RDS cert hostname never matches; the in-cluster issuer
// path uses verify-full). Prints ONLY the kid to stdout; the secret token is
// written to $TOKEN_OUT (a /dev/shm file), never logged.
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../src/generated/storage-kit/query.js";

const signingSecret = process.env.HASNA_LOOPS_API_SIGNING_KEY?.trim();
const dsn = process.env.TUNNEL_DATABASE_URL?.trim();
const tokenOut = process.env.TOKEN_OUT?.trim();
if (!signingSecret) throw new Error("set HASNA_LOOPS_API_SIGNING_KEY");
if (!dsn) throw new Error("set TUNNEL_DATABASE_URL");
if (!tokenOut) throw new Error("set TOKEN_OUT");

const pool = new Pool({ connectionString: dsn.split("?")[0], ssl: { rejectUnauthorized: false }, max: 2 });
const client = createQueryClient(pool);
const keys = new ApiKeyStore(client);
await keys.ensureSchema();

const minted = await mintApiKey({
  app: "loops",
  agent: process.env.KEY_AGENT ?? "selfhost-proof",
  scopes: (process.env.KEY_SCOPES ?? "loops:*").split(","),
  signingSecret,
});
await keys.insertMinted(minted, "selfhost-proof");
await Bun.write(tokenOut, minted.token);
console.log(JSON.stringify({ evt: "key_issued", kid: minted.kid, app: "loops", scopes: minted.scopes, expiresAt: minted.expiresAt }));
await pool.end();
