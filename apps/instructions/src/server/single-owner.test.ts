import { describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPackageVersion } from "../lib/package-version.js";

const SERVER_ROOT = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

function takeFreePort(): number {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  reservation.stop(true);
  if (port === undefined) throw new Error("Bun did not allocate a test port");
  return port;
}

describe("instructions-serve owns exactly one listener", () => {
  test("the built artifact stays alive and answers health when production PORT is set", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "instructions-server-entrypoint-"));
    let server: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;

    try {
      const outputDirectory = join(workspace, "dist/server");
      await copyFile(join(SERVER_ROOT, "package.json"), join(workspace, "package.json"));
      const build = Bun.spawn([
        process.execPath,
        "build",
        "src/server/index.ts",
        "--outdir",
        outputDirectory,
        "--target",
        "bun",
        "--external",
        "pg",
      ], {
        cwd: SERVER_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const buildStdout = readStream(build.stdout);
      const buildStderr = readStream(build.stderr);
      const buildExitCode = await build.exited;
      expect(
        { exitCode: buildExitCode, stdout: await buildStdout, stderr: await buildStderr },
      ).toMatchObject({ exitCode: 0 });

      const port = takeFreePort();
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
      };
      delete env.HASNA_INSTRUCTIONS_DATABASE_URL;
      delete env.INSTRUCTIONS_DATABASE_URL;
      delete env.DATABASE_URL;
      server = Bun.spawn([process.execPath, join(outputDirectory, "index.js")], {
        cwd: SERVER_ROOT,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = readStream(server.stdout);
      const stderr = readStream(server.stderr);

      let health: Response | undefined;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && server.exitCode === null) {
        try {
          health = await fetch(`http://127.0.0.1:${port}/health`);
          break;
        } catch {
          await Bun.sleep(25);
        }
      }

      expect(health?.status).toBe(200);
      expect(await health?.json()).toEqual({
        status: "ok",
        version: getPackageVersion(),
        backend: "unconfigured",
        name: "instructions",
      });
      expect(server.exitCode).toBeNull();

      server.kill();
      await server.exited;
      const output = await stdout;
      const errors = await stderr;
      expect(output).toContain(`listening on http://127.0.0.1:${port}`);
      expect(output.match(/instructions-serve listening on/g)).toHaveLength(1);
      expect(errors).not.toContain("EADDRINUSE");
    } finally {
      if (server?.exitCode === null) {
        server.kill();
        await server.exited;
      }
      await rm(workspace, { recursive: true, force: true });
    }
  }, 15_000);
});
