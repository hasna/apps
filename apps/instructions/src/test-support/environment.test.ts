import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRoot } from "../lib/test-temp-root";
import { isolatedInstructionsTestEnv } from "./environment";

test("CLI fixtures ignore inherited routing and credentials in the test home", async () => {
  const home = makeTempRoot("instructions-env-regression-");
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch() { requests++; return Response.json({ error: "synthetic authority trap" }, { status: 403 }); },
  });
  try {
    const authority = `http://127.0.0.1:${server.port}/instructions`;
    const parent = {
      PATH: process.env.PATH,
      HOME: join(home, "owner"),
      HASNA_HOME: join(home, "owner", ".hasna"),
      HASNA_CONFIG_HOME: join(home, "owner", "config"),
      HASNA_INSTRUCTIONS_API_URL: authority,
      HASNA_INSTRUCTIONS_API_KEY_OVERRIDE: "synthetic-isolation-trap",
      HASNA_INSTRUCTIONS_API_KEY_REF: "synthetic-reference",
      HASNA_PROFILE: "synthetic-profile",
      NODE_AUTH_TOKEN: "synthetic-unrelated-secret",
      CODEX_HOME: join(home, "owner", ".codex"),
    };
    const env = isolatedInstructionsTestEnv(home, parent);
    for (const key of ["HASNA_INSTRUCTIONS_API_URL", "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE", "HASNA_INSTRUCTIONS_API_KEY_REF", "HASNA_PROFILE", "NODE_AUTH_TOKEN", "CODEX_HOME"]) {
      expect(key in env).toBe(false);
    }
    expect(env.HOME).toBe(home);
    expect(env.HASNA_INSTRUCTIONS_LOCAL).toBe("1");
    const credentials = join(home, ".hasna", "instructions", "config", "credentials");
    mkdirSync(join(home, ".hasna", "instructions", "config"), { recursive: true });
    writeFileSync(credentials, `HASNA_INSTRUCTIONS_API_URL=${authority}\nHASNA_INSTRUCTIONS_API_KEY=synthetic-isolation-trap\n`, { mode: 0o600 });
    const source = join(home, "sample.md");
    writeFileSync(source, "synthetic fixture\n");
    const run = async (childEnv: NodeJS.ProcessEnv) => {
      const child = Bun.spawn([process.execPath, "--no-env-file", "src/cli/index.tsx", "add", source, "--name", "synthetic fixture"], {
        cwd: join(import.meta.dir, "../.."), env: childEnv, stdout: "pipe", stderr: "pipe",
      });
      const [exit] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return exit;
    };
    // Positive control: the same synthetic endpoint records an explicit request.
    expect(await run({ ...env, HASNA_INSTRUCTIONS_API_URL: authority, HASNA_INSTRUCTIONS_API_KEY_OVERRIDE: "synthetic-isolation-trap" })).not.toBe(0);
    expect(requests).toBeGreaterThan(0);
    requests = 0;
    expect(await run(env)).toBe(0);
    expect(requests).toBe(0);
    expect(existsSync(join(home, "db.sqlite"))).toBe(true);
  } finally {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});
