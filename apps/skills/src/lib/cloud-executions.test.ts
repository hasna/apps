import {
  useDefaultTestTimeout,
  withoutDataDirOverrideEnv,
} from "../test-preload.js";
useDefaultTestTimeout();
import { describe, expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { packSkillBundle } from "./skill-bundle.js";
import { CloudExecutionClient } from "./cloud-executions.js";
const receipt = {
  contractVersion: 1,
  id: "run_test_123",
  target: "cloud",
  skill: "pdf-generate",
  version: "1.0.0",
  bundleDigest: "a".repeat(64),
  inputDigest: "b".repeat(64),
  runtimeImageDigest: "sha256:" + "c".repeat(64),
  status: "succeeded",
  exitCode: 0,
  artifacts: [],
};
describe("cloud execution CLI and transport", () => {
  test("CLI sends a named exact version through the executions API, including flags after the skill", async () => {
    const requests: { path: string; body: unknown; authenticated: boolean }[] =
      [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request): Promise<Response> {
        requests.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
          authenticated:
            request.headers.get("authorization") ===
            "Bearer synthetic-test-transport",
        });
        return Response.json(receipt);
      },
    });
    const home = mkdtempSync(join(tmpdir(), "skills-cloud-cli-"));
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          resolve(import.meta.dir, "../cli/index.tsx"),
          "run",
          "pdf-generate@1.0.0",
          "--target",
          "cloud",
          "--input",
          JSON.stringify({ content: "CLI exact-version proof" }),
          "--json",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...withoutDataDirOverrideEnv({ ...process.env }),
            HOME: home,
            HASNA_SKILLS_API_URL: server.url.origin,
            HASNA_SKILLS_API_KEY: "synthetic-test-transport",
            HASNA_SKILLS_LOCAL: "0",
            SKILLS_LOCAL: "0",
          },
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stderr).toBe("");
      expect(exitCode, stdout).toBe(0);
      expect(JSON.parse(stdout).id).toBe(receipt.id);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.path).toBe("/api/v1/executions/pdf-generate");
      expect(requests[0]!.authenticated).toBe(true);
      expect(requests[0]!.body).toMatchObject({
        version: "1.0.0",
        input: { content: "CLI exact-version proof" },
      });
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
  test("managed CLI runs the selected bundle locally and submits its exact identity to cloud", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-managed-run-"));
    const dataDir = join(home, "data");
    mkdirSync(dataDir);
    writeFileSync(
      join(dataDir, "agent-policy.json"),
      JSON.stringify({ loading: "cli" }),
    );
    const source = join(home, "source");
    mkdirSync(source);
    writeFileSync(
      join(source, "SKILL.md"),
      "---\nname: pdf-generate\ndescription: Exact selected proof\nkind: executable\n---\nRun the selected proof.\n",
    );
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({ name: "pdf-generate", version: "9.8.7", bin: "run.ts" }),
    );
    writeFileSync(
      join(source, "run.ts"),
      'console.log(JSON.stringify({marker:"selected-bundle-proof",input:JSON.parse(process.env.SKILLS_INPUT_JSON!),hasCredential:Boolean(process.env.HASNA_SKILLS_API_KEY)}))',
    );
    const bundle = packSkillBundle(source);
    const submissions: Record<string, unknown>[] = [];
    const reads: string[] = [];
    let deny = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request): Promise<Response> {
        const path = new URL(request.url).pathname;
        reads.push(path);
        if (deny) return new Response(null, { status: 401 });
        const selection = {
          authority: server.url.origin + "/api/v1",
          workspaceId: "workspace-test",
          profileRevision: "revision-test",
          slug: "pdf-generate",
          version: "9.8.7",
          bundleDigest: "sha256:" + bundle.sha256,
        };
        if (path === "/api/v1/profiles/default/resolve")
          return Response.json({
            authority: selection.authority,
            workspaceId: selection.workspaceId,
            profileId: "default",
            profileRevision: selection.profileRevision,
            selections: [selection],
          });
        if (path === "/api/v1/skills/pdf-generate/versions/9.8.7/bundle")
          return new Response(bundle.bytes, {
            headers: {
              "X-Skill-Bundle-Sha256": bundle.sha256,
              "X-Skill-Version": "9.8.7",
            },
          });
        if (path === "/api/v1/executions/pdf-generate") {
          submissions.push((await request.json()) as Record<string, unknown>);
          return Response.json({
            ...receipt,
            version: "9.8.7",
            bundleDigest: bundle.sha256,
          });
        }
        return new Response(null, { status: 404 });
      },
    });
    async function run(extra: string[]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          resolve(import.meta.dir, "../cli/index.tsx"),
          "run",
          "pdf-generate",
          ...extra,
          "--input",
          '{"content":"selected input"}',
          "--json",
        ],
        {
          cwd: home,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...withoutDataDirOverrideEnv({ ...process.env }),
            HOME: home,
            HASNA_SKILLS_DIR: dataDir,
            HASNA_SKILLS_API_URL: server.url.origin,
            HASNA_SKILLS_API_KEY: "synthetic-managed-test-key",
            HASNA_SKILLS_SELECTION_PROFILE: "default",
            HASNA_SKILLS_LOCAL: "0",
            SKILLS_LOCAL: "0",
          },
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stderr).toBe("");
      return { value: JSON.parse(stdout), exitCode };
    }
    let runDirectory: string | undefined;
    try {
      const malformed = await run(["--target"]);
      expect(malformed.exitCode).toBe(1);
      expect(malformed.value.error).toContain("--target requires a value");
      expect(reads).toHaveLength(0);
      const local = await run([]);
      expect(local.exitCode, JSON.stringify(local.value)).toBe(0);
      expect(local.value.selection.version).toBe("9.8.7");
      expect(local.value.selection.bundleDigest).toBe(
        "sha256:" + bundle.sha256,
      );
      expect(JSON.parse(local.value.stdout)).toEqual({
        marker: "selected-bundle-proof",
        input: { content: "selected input" },
        hasCredential: false,
      });
      runDirectory = local.value.runDirectory;
      const cloud = await run(["--target", "cloud"]);
      expect(cloud.exitCode, JSON.stringify(cloud.value)).toBe(0);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({
        version: "9.8.7",
        bundleDigest: "sha256:" + bundle.sha256,
        workspaceId: "workspace-test",
      });
      const conflict = await run([
        "--target",
        "cloud",
        "--skill-version",
        "1.0.0",
      ]);
      expect(conflict.exitCode).toBe(1);
      expect(submissions).toHaveLength(1);
      deny = true;
      const denied = await run([]);
      expect(denied.exitCode).toBe(1);
      expect(denied.value.error).toContain("401");
      expect(reads).not.toContain("/api/v1/runs");
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      if (runDirectory) rmSync(runDirectory, { recursive: true, force: true });
    }
  });
  test("selected authority and returned bundle identity are enforced by the cloud client", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return Response.json(receipt);
      },
    });
    try {
      const client = new CloudExecutionClient(
        server.url.origin,
        "synthetic-key",
      );
      await expect(
        client.submit("pdf-generate", "1.0.0", {}, "key", {
          authority: "https://other.example.com/api/v1",
          bundleDigest: "a".repeat(64),
        }),
      ).rejects.toThrow("another Skills authority");
      expect(requests).toBe(0);
      await expect(
        client.submit("pdf-generate", "1.0.0", {}, "key", {
          bundleDigest: "b".repeat(64),
        }),
      ).rejects.toThrow("does not match");
    } finally {
      server.stop(true);
    }
  });
  test("invalid versions are refused before any remote request", async () => {
    const client = new CloudExecutionClient(
      "http://127.0.0.1:1",
      "synthetic-test-transport",
    );
    await expect(
      client.submit("pdf-generate", "latest", { content: "x" }, "test-key"),
    ).rejects.toThrow("exact-version");
    await expect(
      client.submit("../escape", "1.0.0", { content: "x" }, "test-key"),
    ).rejects.toThrow("exact-version");
  });
  test("redirects cannot forward the API credential to another origin", async () => {
    let received = 0;
    const destination = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        received++;
        return Response.json(receipt);
      },
    });
    const redirect = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.redirect(destination.url, 307);
      },
    });
    try {
      const client = new CloudExecutionClient(
        redirect.url.origin,
        "synthetic-test-transport",
      );
      await expect(client.get(receipt.id)).rejects.toThrow();
      expect(received).toBe(0);
    } finally {
      redirect.stop(true);
      destination.stop(true);
    }
  });
});
