import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export async function startPortfolioFixture(dbPath: string) {
  const home = join(dirname(dbPath), "client-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "portfolio-server.test-support.ts")], {
    env: { PATH:process.env.PATH ?? "", HOME:home, HASNA_STATION:"domains-fixture-only", DOMAINS_DB_PATH:dbPath },
    stdout:"pipe", stderr:"pipe", stdin:"ignore",
  });
  const timer = setTimeout(() => child.kill(), 15000);
  let port: number;
  try {
    const reader = child.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    port = JSON.parse(new TextDecoder().decode(first.value)).port;
    if (!Number.isInteger(port) || port < 1) throw new Error("Fixture did not start");
  } catch (error) { child.kill(); throw error; }
  finally { clearTimeout(timer); }
  const dir = join(home, ".hasna/domains/config");
  mkdirSync(dir, {recursive:true});
  writeFileSync(join(dir,"credentials"), `HASNA_DOMAINS_API_URL=http://127.0.0.1:${port}\nHASNA_DOMAINS_API_KEY=domains-fixture-key\n`, {mode:0o600});
  return {
    env: { PATH:process.env.PATH ?? "", HOME:home, HASNA_STATION:"domains-fixture-only", NO_COLOR:"1", FORCE_COLOR:"0" },
    stop: () => child.kill(),
  };
}
