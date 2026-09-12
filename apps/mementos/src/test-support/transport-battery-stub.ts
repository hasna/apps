// Process harness for the transport-battery stub server (separate-process,
// because the CLI's cloud calls are synchronous curl children that would
// deadlock an in-process server — see memories-page-stub.ts).
import { apiModeTestEnv as _apiModeTestEnv } from "./memories-page-stub.js";
import type { MemoriesPageStubProcess } from "./memories-page-stub.js";

export interface TransportBatteryStubProcess extends MemoriesPageStubProcess {}

export function apiModeTestEnv(baseUrl: string): Record<string, string> {
  return _apiModeTestEnv(baseUrl);
}

export function startTransportBatteryStubProcess(): TransportBatteryStubProcess {
  const port = 39000 + Math.floor(Math.random() * 2000);
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      new URL("./transport-battery-stub-server.ts", import.meta.url).pathname,
    ],
    {
      env: { ...process.env, STUB_PORT: String(port) },
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      proc.kill();
    },
  };
}

/** Poll the stub until it serves a memories page, or throw after ~5s. */
export async function waitForTransportBatteryStub(baseUrl: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${baseUrl}/v1/memories?limit=1`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`transport-battery stub server at ${baseUrl} did not become ready`);
}