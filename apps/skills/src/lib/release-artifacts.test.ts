import { expect, test } from "bun:test";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const releaseArtifactTest = process.env.HASNA_SKILLS_RELEASE_ARTIFACT_TEST === "1" ? test : test.skip;
const packageRoot = resolve(import.meta.dir, "../..");
const repoRoot = resolve(packageRoot, "../..");
const VAULT_REFERENCE = "fixture/skills/live/api_key";
const BOOTSTRAP_KEY = "fixture-bootstrap-key-not-a-secret";
const RESOLVED_KEY = "fixture-resolved-key-not-a-secret";

function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env): string {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode})\n${result.stdout.toString()}\n${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

function packInto(directory: string, producerRoot: string): string {
  const raw = run(
    ["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", directory],
    producerRoot,
    { ...process.env, npm_config_ignore_scripts: "true", npm_config_dry_run: "false" },
  );
  const manifest = JSON.parse(raw) as Array<{ filename: string }>;
  expect(manifest).toHaveLength(1);
  return join(directory, manifest[0]!.filename);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function spawnCli(
  cli: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "--no-env-file", cli, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

releaseArtifactTest("two clean builds produce byte-identical npm packs and a fresh installed CLI resolves a vault reference", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "skills-release-artifact-"));
  try {
    const producer = join(scratch, "producer");
    const excludedRoots = new Set(["bin", "dist", "node_modules", ".turbo"]);
    cpSync(packageRoot, producer, {
      recursive: true,
      filter(source) {
        const rel = relative(packageRoot, source);
        if (!rel) return true;
        const root = rel.split(sep)[0]!;
        return !excludedRoots.has(root) && !rel.endsWith(".tgz");
      },
    });
    const producerHome = join(scratch, "producer-home");
    const producerCache = join(scratch, "producer-cache");
    mkdirSync(producerHome);
    mkdirSync(producerCache);
    run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], producer, {
      PATH: process.env.PATH,
      HOME: producerHome,
      BUN_INSTALL_CACHE_DIR: producerCache,
    });

    const firstPackDir = join(scratch, "pack-one");
    const secondPackDir = join(scratch, "pack-two");
    mkdirSync(firstPackDir);
    mkdirSync(secondPackDir);

    run(["bun", "run", "build"], producer);
    const firstArchive = packInto(firstPackDir, producer);
    run(["bun", "run", "build"], producer);
    const secondArchive = packInto(secondPackDir, producer);
    expect(sha256(secondArchive)).toBe(sha256(firstArchive));

    // The outer npm pack must ship the exact standalone-lock artifacts just
    // verified above. Copy them back only after the second build agrees byte
    // for byte; no later lifecycle hook is allowed to regenerate a different
    // workspace-linked dist tree.
    rmSync(join(packageRoot, "bin"), { recursive: true, force: true });
    rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
    cpSync(join(producer, "bin"), join(packageRoot, "bin"), { recursive: true });
    cpSync(join(producer, "dist"), join(packageRoot, "dist"), { recursive: true });

    const consumer = join(scratch, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, dependencies: { "@hasna/skills": `file:${secondArchive}` } }, null, 2) + "\n",
    );
    const installHome = join(scratch, "install-home");
    const installCache = join(scratch, "install-cache");
    mkdirSync(installHome);
    mkdirSync(installCache);
    run(["bun", "install", "--ignore-scripts"], consumer, {
      PATH: process.env.PATH,
      HOME: installHome,
      BUN_INSTALL_CACHE_DIR: installCache,
    });

    const installedRoot = join(consumer, "node_modules", "@hasna", "skills");
    const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(installedManifest.dependencies?.["@hasna/secrets"]).toBe("0.4.2");
    expect(lstatSync(installedRoot).isSymbolicLink()).toBe(false);
    expect(realpathSync(installedRoot).startsWith(realpathSync(repoRoot))).toBe(false);
    expect(lstatSync(join(consumer, "node_modules", "@hasna", "secrets")).isSymbolicLink()).toBe(false);

    const cli = join(installedRoot, "bin", "index.js");
    const emptyHome = join(scratch, "empty-home");
    mkdirSync(emptyHome);
    const beforeServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 500 }) });
    const unconfigured = await spawnCli(cli, ["list", "--json"], consumer, {
      PATH: process.env.PATH,
      HOME: emptyHome,
      HASNA_STATION: "skills-release-test-no-keychain",
      BUN_CONFIG_REGISTRY: beforeServer.url.origin,
    });
    beforeServer.stop(true);
    expect(unconfigured.code).not.toBe(0);
    expect(unconfigured.stderr).toContain("failing closed");
    expect(unconfigured.stdout).toBe("");

    const requestPaths: string[] = [];
    let correctCredentials = true;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url);
      requestPaths.push(url.pathname);
      if (url.pathname === "/v1/secrets/get") {
        correctCredentials &&= request.headers.get("x-api-key") === BOOTSTRAP_KEY;
        correctCredentials &&= url.searchParams.get("key") === VAULT_REFERENCE;
        return Response.json({ key: VAULT_REFERENCE, value: RESOLVED_KEY });
      }
      if (url.pathname === "/api/auth/whoami") {
        correctCredentials &&= request.headers.get("authorization") === `Bearer ${RESOLVED_KEY}`;
        return Response.json({
          user: { id: "fixture-user", email: "fixture@example.test", role: "owner" },
          organization: { id: "fixture-org", slug: "fixture" },
        });
      }
      if (url.pathname === "/api/v1/capabilities") {
        correctCredentials &&= request.headers.get("authorization") === `Bearer ${RESOLVED_KEY}`;
        return Response.json({
          contractVersion: 1,
          apiVersion: 1,
          capabilities: ["skills.registry"],
          scopes: ["skills:read"],
          permissions: { publish: false, profilesWrite: false },
        });
      }
      return new Response(null, { status: 404 });
    } });

    try {
      const home = join(scratch, "credential-home");
      const skillsFile = join(home, ".hasna", "skills", "config", "credentials");
      const secretsFile = join(home, ".hasna", "secrets", "config", "credentials");
      mkdirSync(dirname(skillsFile), { recursive: true, mode: 0o700 });
      mkdirSync(dirname(secretsFile), { recursive: true, mode: 0o700 });
      writeFileSync(
        skillsFile,
        `HASNA_SKILLS_API_KEY_REF=${VAULT_REFERENCE}\n` +
          `HASNA_SKILLS_API_URL=${server.url.origin}\n` +
          `HASNA_SKILLS_BOUND_API_URL=${server.url.origin}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        secretsFile,
        `HASNA_SECRETS_API_KEY=${BOOTSTRAP_KEY}\nHASNA_SECRETS_API_URL=${server.url.origin}\n`,
        { mode: 0o600 },
      );

      const result = await spawnCli(cli, ["auth", "whoami", "--json"], consumer, {
        PATH: process.env.PATH,
        HOME: home,
        HASNA_STATION: "skills-release-test-no-keychain",
        BUN_CONFIG_REGISTRY: server.url.origin,
      });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "authenticated", userId: "fixture-user" });
      expect(correctCredentials).toBe(true);
      expect(requestPaths).toEqual(["/v1/secrets/get", "/api/auth/whoami", "/api/v1/capabilities"]);
      for (const sensitive of [BOOTSTRAP_KEY, RESOLVED_KEY, VAULT_REFERENCE]) {
        expect(result.stdout).not.toContain(sensitive);
        expect(result.stderr).not.toContain(sensitive);
      }
    } finally {
      server.stop(true);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
