// Native now invokes the bundled resolver rather than duplicating its tiers.
// This matrix exercises that resolver with real saved-credential files; native
// process/HTTP tests separately prove its unchanged environment reaches the seam.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStore, cloudApiUrl } from "./index.js";

interface Arm {
  name: string;
  savedCredentials: Record<string, string> | null;
  environment: Record<string, string>;
  shell: "cloud" | "unresolved";
  announcedUrl?: string;
  reasonContains?: string;
}
const matrix = JSON.parse(readFileSync(join(import.meta.dir, "../../../test-fixtures/store-resolution-matrix.json"), "utf8")) as { arms: Arm[] };

function withArm(arm: Arm, fn: (env: Record<string, string>, home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "conversations-matrix-"));
  try {
    if (arm.savedCredentials) {
      const dir = join(home, ".hasna/conversations/config");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, "credentials");
      writeFileSync(file, Object.entries(arm.savedCredentials).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
      chmodSync(file, 0o600);
    }
    fn({ HOME: home, HASNA_STATION: `matrix-${crypto.randomUUID()}`, ...arm.environment }, home);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

describe("API-only store resolution matrix", () => {
  test("all historical selector arms remain represented", () => {
    expect(matrix.arms).toHaveLength(16);
    expect(new Set(matrix.arms.map(arm => arm.name)).size).toBe(16);
    expect(matrix.arms.filter(arm => arm.shell === "cloud").length).toBeGreaterThan(0);
    expect(matrix.arms.filter(arm => arm.shell === "unresolved").length).toBeGreaterThan(0);
  });
  for (const arm of matrix.arms) {
    test(`${arm.name}: selection`, () => withArm(arm, (env, home) => {
      if (arm.shell === "cloud") {
        expect(getStore(env).transport).toBe("cloud-http");
        expect(cloudApiUrl(env)).toBe(arm.announcedUrl!);
      } else {
        expect(() => getStore(env)).toThrow(arm.reasonContains!);
        expect(() => cloudApiUrl(env)).toThrow(arm.reasonContains!);
      }
      expect(existsSync(join(home, ".hasna/conversations/messages.db"))).toBe(false);
    }));
  }
  test("both selector aliases refuse even beside a valid API pair", () => {
    for (const key of ["HASNA_CONVERSATIONS_DB_PATH", "CONVERSATIONS_DB_PATH"]) {
      expect(() => getStore({ [key]: "/tmp/fixture-conversations.db", HASNA_CONVERSATIONS_API_URL: "http://127.0.0.1:9", HASNA_CONVERSATIONS_API_KEY: crypto.randomUUID() })).toThrow(/no longer supported/);
    }
  });
});
