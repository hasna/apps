import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { registerOperationTools } from "./operation-tools.js";

test("managed MCP cloud submission retains the selected authority through credential configuration changes", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-mcp-cloud-authority-"));
  const source = join(home, "source"), data = join(home, "data");
  mkdirSync(source); mkdirSync(data);
  writeFileSync(join(data, "agent-policy.json"), JSON.stringify({ loading: "cli", profileId: "engineering" }));
  writeFileSync(join(source, "SKILL.md"), "---\nname: pdf-generate\ndescription: Exact cloud selection\nkind: executable\n---\nReviewed instructions.");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "pdf-generate", version: "1.0.0", bin: "run.ts" }));
  writeFileSync(join(source, "run.ts"), "throw Error('The MCP adapter must not execute this locally');");
  const bundle = packSkillBundle(source), credential = randomUUID(), posted: string[] = [];
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    posted.push(request.method);
    return Response.json({ contractVersion: 1, id: "run_unexpected", target: "cloud", skill: "pdf-generate", version: "1.0.0", bundleDigest: bundle.sha256, inputDigest: "a".repeat(64), runtimeImageDigest: "sha256:" + "b".repeat(64), status: "admitted", artifacts: [] });
  } });
  const selected = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname, authority = `${new URL(request.url).origin}/api/v1`;
    if (path === "/api/v1/profiles/engineering/resolve") {
      const selection = { authority, workspaceId: "workspace", profileRevision: "revision", slug: "pdf-generate", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
      return Response.json({ authority, workspaceId: "workspace", profileRevision: "revision", profileId: "engineering", selections: [selection] });
    }
    if (path === "/api/v1/skills/pdf-generate/versions/1.0.0/bundle") {
      // A long-lived MCP process may observe new connection configuration
      // while an immutable bundle fetch is in flight. Keep the prior authority.
      process.env.HASNA_SKILLS_API_URL = other.url.origin;
      return new Response(bundle.bytes);
    }
    return new Response(null, { status: 404 });
  } });
  const env = { HOME: home, HASNA_HOME: join(home, "hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_URL: selected.url.origin, HASNA_SKILLS_API_KEY: credential, HASNA_SKILLS_LOCAL: "0" };
  const names = [...Object.keys(env), "HASNA_SKILLS_SELECTION_PROFILE", "HASNA_SKILLS_API_KEY_OVERRIDE", "HASNA_SKILLS_API_KEY_REF", "HASNA_CONFIG_HOME", "HASNA_PROFILE", "SKILLS_API_URL", "SKILLS_API_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]])), previousCwd = process.cwd();
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, env); process.chdir(home);
    const handlers = new Map<string, (args: any) => Promise<any>>();
    registerOperationTools({ registerTool(name: string, _schema: unknown, handler: any) { handlers.set(name, handler); } } as any);
    const result = await handlers.get("run_skill")!({ name: "pdf-generate@1.0.0", target: "cloud", input: { content: "Reviewed input" }, idempotency_key: "authority-race" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(posted).toEqual([]);
  } finally {
    process.chdir(previousCwd);
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    selected.stop(true); other.stop(true); rmSync(home, { recursive: true, force: true });
  }
}, 15000);
