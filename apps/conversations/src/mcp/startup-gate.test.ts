// In-process coverage for the MCP startup gate (hasna/apps#1720 acceptance
// (c), round-2 review of #1864). The spawned end-to-end cases live in
// src/lib/store/fail-closed.test.ts; this file pins the DECISION the gate
// makes, on caller-built envs the station Keychain cannot answer for.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetConversationsLocalNotice } from "../lib/contracts-env.js";
import { ConversationsStoreConfigError } from "../lib/store/index.js";
import { HERMETIC_STATION } from "../test/hermetic.js";
import { assertMcpStoreConfigured } from "./index.js";

const tempRoots: string[] = [];

afterEach(() => {
  __resetConversationsLocalNotice();
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** A caller-built env: the Keychain tier is off (not the live process env), the disk tier is rooted in a sandbox. */
function hermeticEnv(extra: Record<string, string> = {}): Record<string, string> {
  const tempRoot = mkdtempSync(join(tmpdir(), "conversations-mcp-gate-"));
  tempRoots.push(tempRoot);
  return { HOME: tempRoot, HASNA_HOME: join(tempRoot, ".hasna"), HASNA_STATION: HERMETIC_STATION, ...extra };
}

describe("assertMcpStoreConfigured — the store is decided before any transport connects", () => {
  test("hosted with no credential anywhere throws the app's config error naming the tiers and the opt-in", () => {
    const env = hermeticEnv();

    let thrown: unknown;
    try {
      assertMcpStoreConfigured(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConversationsStoreConfigError);
    const message = (thrown as Error).message;
    expect(message).toContain("HASNA_CONVERSATIONS_API_KEY");
    expect(message).toContain("HASNA_CONVERSATIONS_DB_PATH");
    // Deciding opened nothing.
    expect(existsSync(join(env["HASNA_HOME"]!, "conversations"))).toBe(false);
  });

  test("a hosted credential passes the gate silently (no LOCAL notice)", () => {
    const env = hermeticEnv({ HASNA_CONVERSATIONS_API_KEY: ["fixture", "not", "a", "credential"].join("-") });
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(() => assertMcpStoreConfigured(env)).not.toThrow();
    } finally {
      process.stderr.write = write;
    }
    expect(lines.join("")).not.toContain("LOCAL mode");
  });

  test("the explicit local opt-in passes the gate and announces LOCAL mode once, without opening the store", () => {
    const env = hermeticEnv();
    const dbPath = join(env["HOME"]!, "store.db");
    env["HASNA_CONVERSATIONS_DB_PATH"] = dbPath;
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(() => assertMcpStoreConfigured(env)).not.toThrow();
      // Once per process: a second decision does not repeat the notice.
      expect(() => assertMcpStoreConfigured(env)).not.toThrow();
    } finally {
      process.stderr.write = write;
    }
    const notice = lines.join("");
    expect(notice).toContain("LOCAL mode");
    expect(notice).toContain(dbPath);
    expect(notice.match(/LOCAL mode/g)).toHaveLength(1);
    // The gate only decides; the first SQLite open belongs to the store.
    expect(existsSync(dbPath)).toBe(false);
  });
});
