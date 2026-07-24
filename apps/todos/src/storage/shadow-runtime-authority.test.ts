import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  __resetRuntimeShadowForTests,
  assertRuntimeShadowRemoteAccessDisabled,
  getRuntimeShadowOutbox,
  maybeInstallShadowCapture,
  startRuntimeShadowDrain,
} from "./shadow-runtime.js";

afterEach(() => {
  __resetRuntimeShadowForTests();
});

function hasOutboxTable(db: Database): boolean {
  return Boolean(db.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shadow_outbox'",
  ).get());
}

describe("Stage-A automatic shadow containment", () => {
  test("the remote-access floor is unconditional and reads no shadow configuration", () => {
    let reads = 0;
    const environment = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_SHADOW_CONFIG_GETTER_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_SHADOW_CONFIG_OWN_KEYS_MARKER");
      },
    });

    expect(() => assertRuntimeShadowRemoteAccessDisabled(environment))
      .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(reads).toBe(0);
  });

  test("explicit local shadow keeps durable SQLite capture but constructs no cloud client", () => {
    const db = new Database(":memory:");
    let cloudClientConstructions = 0;
    const env = {
      HASNA_TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_SHADOW: "1",
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
    };
    try {
      expect(maybeInstallShadowCapture(db, env)).toBe(true);
      expect(hasOutboxTable(db)).toBe(true);
      startRuntimeShadowDrain(db, env, {
        createCloudClient: () => {
          cloudClientConstructions += 1;
          throw new Error("cloud client construction must remain unreachable");
        },
      });
      expect(cloudClientConstructions).toBe(0);
      expect(() => getRuntimeShadowOutbox(db, env, {
        createCloudClient: () => {
          cloudClientConstructions += 1;
          throw new Error("cloud client construction must remain unreachable");
        },
      })).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(cloudClientConstructions).toBe(0);
    } finally {
      db.close();
    }
  });

  test.each(["remote", "self_hosted", "cloud", "hybrid"])(
    "%s intent installs no local capture and constructs no cloud client",
    (mode) => {
      const db = new Database(":memory:");
      let cloudClientConstructions = 0;
      const env = {
        HASNA_TODOS_STORAGE_MODE: mode,
        HASNA_TODOS_SHADOW: "1",
        HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
      };
      try {
        expect(maybeInstallShadowCapture(db, env)).toBe(false);
        startRuntimeShadowDrain(db, env, {
          createCloudClient: () => {
            cloudClientConstructions += 1;
            throw new Error("cloud client construction must remain unreachable");
          },
        });
        expect(hasOutboxTable(db)).toBe(false);
        expect(cloudClientConstructions).toBe(0);
      } finally {
        db.close();
      }
    },
  );
});
