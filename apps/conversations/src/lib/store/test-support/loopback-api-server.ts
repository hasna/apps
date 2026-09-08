// Test-only child: real HTTP router/auth with the existing in-memory SQL fixture.
// This is transport/contract coverage, not a substitute for PostgreSQL tests.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { startApiServer, type ApiServerDeps } from "../../../server/api.js";
import { makeFakeClient } from "./api-query-fixture.js";
import { publishLoopbackReadiness } from "./loopback-api-readiness.js";

const [home, readyPath] = process.argv.slice(2);
if (!home || !readyPath) throw new Error("Fixture paths are required");
const signingSecret = randomBytes(32);
const minted = mintApiKey({ tid: "default", app: "conversations", agent: "fixture", scopes: ["conversations:read", "conversations:write"], signingSecret });
const registered = new Set([minted.kid]);
const fake = makeFakeClient([]);
const client = fake as unknown as ApiServerDeps["client"];
const server = startApiServer({ port: 0, host: "127.0.0.1", deps: {
  client, keys: new ApiKeyStore(client), incidentProjector: null,
  verifier: verifyApiKey({ app: "conversations", signingSecret,
    keyStatus: async kid => registered.has(kid) ? "active" : "unknown" }),
} });
const url = `http://127.0.0.1:${server.port}`;
const config = join(home, ".hasna", "conversations", "config");
mkdirSync(config, { recursive: true, mode: 0o700 });
writeFileSync(join(config, "credentials"), `HASNA_CONVERSATIONS_API_URL=${url}\nHASNA_CONVERSATIONS_API_KEY=${minted.token}\n`, { mode: 0o600 });
publishLoopbackReadiness(readyPath, { url });

// Private child IPC only: legacy/corrupt fixtures never become public HTTP routes.
process.on("message", (input: unknown) => {
  const request = input as { id: string; patchMessages?:Array<{id:number;pinned_at:string|null}>; inspect?:boolean; channels?:Array<Record<string,any>>; presence?:Array<Record<string,any>>; removeChannels?:string[]; authorized?: boolean; messages?: Array<Record<string, unknown>>; channel?: { row: Record<string, unknown>; members: string[] } };
  try {
    if (request.authorized !== undefined) { registered.clear(); if (request.authorized) registered.add(minted.kid); }
    if (request.messages) fake.__debug.seedMessages(request.messages);
    for (const patch of request.patchMessages ?? []) {
      const row = fake.__debug.messages.find((message:any) => Number(message.id) === patch.id);
      if (!row || !Number.isSafeInteger(patch.id) || !(patch.pinned_at === null || typeof patch.pinned_at === "string")) throw new Error("Invalid fixture message patch");
      row.pinned_at = patch.pinned_at;
    }
    if (request.channel) fake.__debug.seedChannel(request.channel.row, request.channel.members, []);
    for (const channel of request.channels ?? []) fake.__debug.channels[String(channel.name)] = {...fake.__debug.channels[String(channel.name)], ...channel};
    for (const name of request.removeChannels ?? []) delete fake.__debug.channels[name];
    for (const row of request.presence ?? []) { const key=String(row.agent).toLowerCase(); fake.__debug.agentPresence.set(key,{...fake.__debug.agentPresence.get(key),...row}); }
    process.send?.({ id: request.id, ok: true, ...(request.inspect ? {data:{messages:fake.__debug.messages,channels:Object.values(fake.__debug.channels),presence:[...fake.__debug.agentPresence.values()],presenceArchive:fake.__debug.agentPresenceReapArchive}} : {}) });
  } catch {
    process.send?.({ id: request.id, ok: false });
  }
});
