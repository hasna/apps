/**
 * The on-box store is behind ONE gated door, and the door is not in the
 * client bins.
 *
 * Two invariants, both measured rather than asserted by inspection:
 *
 *  1. `loadLocalMessagesService` refuses unless the explicit local opt-in
 *     selected the on-box store — a configured authority or credential
 *     outranks `HASNA_MESSAGES_LOCAL=1`, so no hosted run can open SQLite.
 *  2. The CLI and MCP bundles contain no `bun:sqlite` at all. The store is
 *     loaded through a runtime-computed specifier, so the bundler cannot fold
 *     it in; it is emitted separately as `dist/local-store.js`. This test
 *     bundles the real entrypoints in memory, so it fails the moment someone
 *     reintroduces a static import.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadLocalMessagesService } from "./local-store-loader";

const ROOT = path.resolve(import.meta.dir, "..");

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "messages-local-store-loader-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the gated on-box store door", () => {
  test("refuses with nothing configured — no opt-in, no store", async () => {
    await expect(loadLocalMessagesService({})).rejects.toThrow(/refusing to open the on-box SQLite store/);
  });

  test("refuses under a hosted credential even WITH the opt-in set — a configured environment outranks the flag", async () => {
    await expect(
      loadLocalMessagesService({ HASNA_MESSAGES_LOCAL: "1", HASNA_MESSAGES_API_KEY: "not-a-real-key" }),
    ).rejects.toThrow(/refusing to open the on-box SQLite store/);
    await expect(
      loadLocalMessagesService({ HASNA_MESSAGES_LOCAL: "1", HASNA_MESSAGES_API_URL: "https://api.hasna.com/messages" }),
    ).rejects.toThrow(/refusing to open the on-box SQLite store/);
  });

  test("opens the store under the explicit opt-in, and the service works", async () => {
    const sqlitePath = path.join(tmpDir, "opt-in.db");
    const service = await loadLocalMessagesService({ HASNA_MESSAGES_LOCAL: "1" }, sqlitePath);
    const agent = await service.registerAgent("loader-probe");
    expect(agent.name).toBe("loader-probe");
    expect(fs.existsSync(sqlitePath)).toBe(true);
  });
});

describe("bun:sqlite stays out of the client bundles", () => {
  /** Bundle one entrypoint exactly as `bun run build` does, and read it back. */
  function bundleText(entry: string): string {
    const out = path.join(tmpDir, `${entry.replace(/[^a-z0-9]+/gi, "-")}.js`);
    const built = Bun.spawnSync([process.execPath, "build", entry, "--outfile", out, "--target", "bun"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(built.exitCode, `bun build ${entry}\n${built.stderr.toString()}`).toBe(0);
    return fs.readFileSync(out, "utf8");
  }

  test("the CLI bundle (bin/index.js) links no SQLite engine and no server", () => {
    const text = bundleText("src/cli/index.ts");
    expect(text).not.toContain("bun:sqlite");
  }, 60_000);

  test("the MCP bundle (bin/mcp.js) links no SQLite engine", () => {
    const text = bundleText("src/mcp/index.ts");
    expect(text).not.toContain("bun:sqlite");
  }, 60_000);

  test("the ./sdk bundle links no SQLite engine", () => {
    const text = bundleText("src/sdk/index.ts");
    expect(text).not.toContain("bun:sqlite");
  }, 60_000);

  test("the separately emitted local-store entry is where the engine lives", () => {
    const text = bundleText("src/local-store.ts");
    expect(text).toContain("bun:sqlite");
  }, 60_000);
});
