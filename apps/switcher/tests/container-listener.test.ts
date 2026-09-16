import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = fileURLToPath(new URL("../src/serve.ts", import.meta.url));
const dockerfile = new URL("../Dockerfile", import.meta.url);
const token = "switcher-container-listener-fixture-token";

function nonLoopbackAddress() {
  const address = Object.values(networkInterfaces()).flat().find(
    entry => entry?.family === "IPv4" && !entry.internal,
  )?.address;
  if (!address) throw new Error("The container listener regression needs a non-loopback IPv4 interface.");
  return address;
}

async function listening(stdout: ReadableStream<Uint8Array>) {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        while (!text.includes("\n")) {
          const item = await reader.read();
          if (item.done) throw new Error("Server exited before listening.");
          text += decoder.decode(item.value, { stream: true });
          if (text.length > 4096) throw new Error("Unexpected server startup output.");
        }
        const event = JSON.parse(text.slice(0, text.indexOf("\n")));
        expect(event.event).toBe("listening");
        return new URL(event.url);
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Server startup timed out.")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

async function withServer(args: string[], check: (url: URL) => Promise<void>) {
  const base = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "container-listener-"));
  const child = Bun.spawn([process.execPath, serverEntry, ...args, "--port", "0", "--sqlite", join(root, "switcher.db")], {
    env: { PATH: process.env.PATH, HOME: root, HASNA_SWITCHER_API_KEY: token },
    stdout: "pipe", stderr: "pipe",
  });
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  try {
    await check(await listening(child.stdout));
  } finally {
    child.kill("SIGTERM");
    forceStop = setTimeout(() => child.kill("SIGKILL"), 1000);
    await child.exited;
    clearTimeout(forceStop);
    await rm(root, { recursive: true, force: true });
  }
}

test("Docker default command serves authenticated requests through a non-loopback interface", async () => {
  const source = await readFile(dockerfile, "utf8");
  const commands = [...source.matchAll(/^CMD\s+(\[[^\n]+\])\s*$/gm)];
  expect(commands).toHaveLength(1);
  const command = JSON.parse(commands[0]![1]!) as string[];
  expect(command[0]).toBe("switcher-serve");
  const address = nonLoopbackAddress();
  await withServer(command.slice(1), async url => {
    expect(url.hostname).toBe("0.0.0.0");
    const origin = `http://${address}:${url.port}`;
    const ready = await fetch(origin + "/ready", { signal: AbortSignal.timeout(2000) });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ready", backend: "sqlite" });
    const path = origin + "/v1/providers?limit=1";
    expect((await fetch(path, { signal: AbortSignal.timeout(2000) })).status).toBe(401);
    expect((await fetch(path, {
      headers: { "x-api-key": token }, signal: AbortSignal.timeout(2000),
    })).status).toBe(200);
  });
}, 10000);

test("serve CLI keeps its loopback default without container arguments", async () => {
  const address = nonLoopbackAddress();
  await withServer([], async url => {
    expect(url.hostname).toBe("127.0.0.1");
    expect((await fetch(new URL("/ready", url), { signal: AbortSignal.timeout(2000) })).status).toBe(200);
    await expect(fetch(`http://${address}:${url.port}/ready`, {
      signal: AbortSignal.timeout(1000),
    })).rejects.toThrow();
  });
}, 10000);
