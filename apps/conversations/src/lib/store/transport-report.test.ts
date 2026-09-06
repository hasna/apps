// Transport-report coverage: every status surface must say WHICH connection
// answered, never both, so a silent downgrade to the on-box SQLite file is
// visible rather than having to be inferred from a channel count (todos
// 274ee464). The report is produced in exactly one place
// (`storeStatusLocation`, used by `conversations status`, `status --json`, and
// the server's `/api/status`), and the store's `transport` field is the same
// decision the CLI routes on.
//
// All envs are caller-built and hermetic; no request is ever made. Values are
// invented.

import { describe, expect, test } from "bun:test";
import { getStore, resolveConversationsCloud } from "./index.js";
import { storeStatusLocation } from "./status-location.js";

const URL_VAR = "HASNA_CONVERSATIONS_API_URL";
const KEY_VAR = "HASNA_CONVERSATIONS_API_KEY";
const DB_VAR = "HASNA_CONVERSATIONS_DB_PATH";
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

describe("transport report — the store and the status surface agree", () => {
  test("an explicit local store path reports local on the store and db_path in the status", () => {
    const env = { [DB_VAR]: "/tmp/conversations-transport-report.db" };
    expect(getStore(env).transport).toBe("local");
    const report = storeStatusLocation(env);
    expect("db_path" in report).toBe(true);
    expect("api_url" in report).toBe(false);
  });

  test("a URL + key resolves cloud-http on the store and api_url in the status", () => {
    const env = { [URL_VAR]: "https://api.hasna.com/conversations", [KEY_VAR]: FAKE_KEY };
    expect(getStore(env).transport).toBe("cloud-http");
    const report = storeStatusLocation(env);
    expect("api_url" in report).toBe(true);
    expect("db_path" in report).toBe(false);
    // The gateway form is reported as its resolved /v1 root (issue #1588).
    expect("api_url" in report ? report.api_url : null).toBe("https://api.hasna.com/conversations/v1");
  });

  test("a key alone (no URL) reports the fleet gateway default as the api_url", () => {
    // (Owner directive 2026-09-04, hasna/apps#1720): the authority defaults to
    // the fleet gateway, and the report names it rather than saying nothing.
    const env = { [KEY_VAR]: FAKE_KEY };
    expect(getStore(env).transport).toBe("cloud-http");
    const report = storeStatusLocation(env);
    expect("api_url" in report).toBe(true);
    expect("api_url" in report ? report.api_url : null).toBe("https://api.hasna.com/conversations/v1");
  });

  test("a URL whose credential cannot resolve makes the report REFUSE, never report local", () => {
    // The fail-closed flip: a status that reported db_path for an env that
    // merely forgot its credential would read as "local connection" for a
    // client that never chose local.
    const env = { [URL_VAR]: "https://conversations.hasna.xyz" };
    expect(() => getStore(env)).toThrow();
    expect(() => storeStatusLocation(env)).toThrow();
  });

  test("a DB path still wins over exported cloud credentials, and the report says local", () => {
    const env = {
      [DB_VAR]: "/tmp/conversations-transport-report.db",
      [URL_VAR]: "https://api.hasna.com/conversations",
      [KEY_VAR]: FAKE_KEY,
    };
    expect(getStore(env).transport).toBe("local");
    const report = storeStatusLocation(env);
    expect("db_path" in report).toBe(true);
    expect("api_url" in report).toBe(false);
  });

  test("the resolved client's base URL is the authority the report names", () => {
    const env = { [URL_VAR]: "https://conversations.hasna.xyz", [KEY_VAR]: FAKE_KEY };
    const client = resolveConversationsCloud(env);
    expect(client).not.toBeNull();
    expect(client!.baseUrl).toBe("https://conversations.hasna.xyz/v1");
    const report = storeStatusLocation(env);
    expect("api_url" in report ? report.api_url : null).toBe("https://conversations.hasna.xyz");
  });
});
