import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function startLoopbackApiFixture() {
  const root = mkdtempSync(join(tmpdir(), "conversations-http-fixture-"));
  const home = join(root, "client");
  const backendHome = join(root, "backend");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(backendHome, { mode: 0o700 });
  const ready = join(root, "ready.json");
  // Whitelist process plumbing: never inherit a real authority, credential,
  // profile, keychain station selector, or SQLite path from the invoking seat.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(), FORCE_COLOR: "0", NO_COLOR: "1",
    HASNA_STATION: `fixture-${randomUUID()}`,
  };
  const pending = new Map<string, (message: {ok:boolean; data?: unknown}) => void>();
  const child = Bun.spawn([process.execPath, "--no-env-file", join(dirname(fileURLToPath(import.meta.url)), "loopback-api-server.ts"), home, ready], {
    env: { ...env, HOME: backendHome, USERPROFILE: backendHome }, stdout: "ignore", stderr: "ignore",
    ipc(message: { id: string; ok: boolean; data?: unknown }) { pending.get(message.id)?.(message); },
  });
  const stop = async () => {
    child.kill();
    await child.exited;
    try {
      assertNoClientDatabase(home);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  try {
    const deadline = Date.now() + 15_000;
    while (!existsSync(ready)) {
      if (child.exitCode !== null) throw new Error("Loopback API fixture exited before readiness");
      if (Date.now() > deadline) throw new Error("Loopback API fixture readiness timed out");
      await Bun.sleep(20);
    }
    const { url } = JSON.parse(readFileSync(ready, "utf8")) as { url: string };
    const unauthorized = await fetch(`${url}/v1/channels`);
    if (unauthorized.status !== 401) throw new Error("Loopback fixture failed authentication control");
    const control = async (data: Record<string, unknown>) => {
      const id = randomUUID();
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Fixture control timed out")); }, 5000);
        pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.ok ? resolve(message.data) : reject(new Error("Fixture control failed")); });
        child.send({ id, ...data });
      });
    };
    const seed = async (data: { patchMessages?: Array<{id:number;pinned_at:string|null}>; authorized?: boolean; messages?: Array<Record<string, unknown>>; channel?: {row:Record<string,unknown>;members:string[]}; channels?: Array<Record<string,unknown>>; presence?: Array<Record<string,unknown>>; removeChannels?:string[] }) => { await control(data); };
    const inspect = async () => await control({inspect:true}) as {messages:Array<Record<string,any>>;channels:Array<Record<string,any>>;presence:Array<Record<string,any>>;presenceArchive:Array<Record<string,any>>};

    return { root, home, backendHome, env, url, stop, seed, inspect };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Recursively verify clients did not create any database, journal, or WAL. */
export function assertNoClientDatabase(home: string): void {
  if (!existsSync(home)) return;
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    const path = join(home, entry.name);
    if (entry.isDirectory()) assertNoClientDatabase(path);
    else if (/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|-(?:wal|shm)$/i.test(entry.name)) {
      throw new Error("Shared API client unexpectedly created a database artifact");
    }
  }
}
