import { afterEach, describe, expect, test } from "bun:test";
import { getPackageVersion } from "../lib/package-version.js";

let child: ReturnType<typeof Bun.spawn> | undefined;

afterEach(async () => {
  if (!child) return;
  child.kill();
  await child.exited;
  child = undefined;
});

async function reservePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = server.port;
  server.stop(true);
  if (typeof port !== "number") throw new Error("Bun did not allocate a test port");
  return port;
}

describe("instructions-serve owns exactly one listener", () => {
  test("the executable stays alive and answers health without an auto-served default export", async () => {
    const port = await reservePort();
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    env.HOST = "127.0.0.1";
    env.PORT = String(port);
    delete env.HASNA_INSTRUCTIONS_DATABASE_URL;
    delete env.INSTRUCTIONS_DATABASE_URL;
    delete env.DATABASE_URL;

    child = Bun.spawn([process.execPath, "run", "src/server/index.ts"], {
      cwd: import.meta.dir + "/../..",
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(50).then(() => false),
      ])) break;
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {
        // The listener may still be starting.
      }
    }

    const exit = await Promise.race([child.exited, Promise.resolve(null)]);
    if (!response?.ok) {
      const stdout = child.stdout instanceof ReadableStream ? await new Response(child.stdout).text() : "";
      const stderr = child.stderr instanceof ReadableStream ? await new Response(child.stderr).text() : "";
      throw new Error(`server did not become healthy (exit=${exit ?? "running"})\nstdout=${stdout}\nstderr=${stderr}`);
    }
    expect(await response.json()).toEqual({
      status: "ok",
      version: getPackageVersion(),
      backend: "unconfigured",
      name: "instructions",
    });
    expect(exit).toBeNull();
  });
});
