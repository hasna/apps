import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationTransport } from "../src/migration/transport.js";

test("capability and import retain one resolver-validated binding; rotations never dispatch the body", async () => {
  const calls: string[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    calls.push(req.method);
    return Response.json({ ok: true });
  }});
  const env = { HASNA_SECRETS_API_URL: `http://127.0.0.1:${server.port}`, HASNA_SECRETS_API_KEY_OVERRIDE: randomBytes(32).toString("hex") };
  try {
    const transport = migrationTransport(env);
    await transport.get("/migrations/vault", { retry: false });
    await transport.post("/migrations/vault", { synthetic: true }, { retry: false });
    expect(calls).toEqual(["GET", "POST"]);
    env.HASNA_SECRETS_API_KEY_OVERRIDE = randomBytes(32).toString("hex");
    await expect(transport.post("/migrations/vault", { synthetic: true }, { retry: false })).rejects.toThrow("migration_destination_changed");
    expect(calls).toEqual(["GET", "POST"]);
  } finally { server.stop(true); }
});

test("bundled migration resolves a vault pointer before capturing its request binding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-pointer-fixture-"));
  try {
    const sdk = join(dir, "node_modules", "@hasna", "secrets");
    mkdirSync(sdk, { recursive: true, mode: 0o700 });
    writeFileSync(join(sdk, "package.json"), JSON.stringify({ name: "@hasna/secrets", main: "index.cjs" }));
    writeFileSync(join(sdk, "index.cjs"), `const key=require('node:crypto').randomBytes(32).toString('hex');const counts={reads:0};module.exports={key,counts,createSecretsClientFromEnv:()=>({getSecret:async()=>{counts.reads++;return {value:key}}})};`);
    const entry = join(dir, "fixture.ts");
    writeFileSync(entry, `
      import sdk from '@hasna/secrets';
      import {migrationTransport} from ${JSON.stringify(join(import.meta.dir, "../src/migration/transport.ts"))};
      let requests=0;
      const server=Bun.serve({port:0,hostname:'127.0.0.1',fetch(req){if(req.headers.get('x-api-key')!==sdk.key)throw new Error('wrong binding');requests++;return Response.json({ok:true})}});
      try {
        const transport=migrationTransport({HASNA_SECRETS_API_URL:'http://127.0.0.1:'+server.port,HASNA_SECRETS_API_KEY_REF:'synthetic/migration/client'});
        await transport.get('/migrations/vault',{retry:false});
        await transport.post('/migrations/vault',{synthetic:true},{retry:false});
        console.log(JSON.stringify({reads:sdk.counts.reads,requests}));
      } finally {server.stop(true)}
    `);
    const build = await Bun.build({ entrypoints: [entry], outdir: dir, target: "bun", external: ["@hasna/secrets"] });
    expect(build.success).toBe(true);
    const child = Bun.spawn([process.execPath, join(dir, "fixture.js")], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ reads: 2, requests: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a paired authority/key rotation before first dispatch sends neither capability nor plaintext", async () => {
  let calls = 0;
  const first = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { calls++; return Response.json({ ok: true }); }});
  const second = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { calls++; return Response.json({ ok: true }); }});
  const env = { HASNA_SECRETS_API_URL: `http://127.0.0.1:${first.port}`, HASNA_SECRETS_API_KEY_OVERRIDE: randomBytes(32).toString("hex") };
  try {
    const transport = migrationTransport(env);
    env.HASNA_SECRETS_API_URL = `http://127.0.0.1:${second.port}`;
    env.HASNA_SECRETS_API_KEY_OVERRIDE = randomBytes(32).toString("hex");
    await expect(transport.get("/migrations/vault", { retry: false })).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { first.stop(true); second.stop(true); }
});
