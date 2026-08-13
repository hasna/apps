import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKeyToken, type MintedApiKey } from "../src/auth/keys";
import { runIssueKey } from "../src/cli/issue-key";

const TODO_SIGNING = "test-todos-signing-secret-not-a-real-credential-000";
const FLEET_SIGNING = "test-fleet-signing-secret-not-a-real-credential-000";
const DB_URL = "postgres://unused.example/todos";
const AGENT = "agent-chief-engineering";
const REF_TEMPLATE = "todos/agents/{agent}/{kid}";
const SECRETS_BASE_URL = "https://secrets.example.test";
const SECRETS_TRANSPORT_KEY = "test-secrets-transport-key-not-a-real-credential";

function collectReports() {
  const reports: Array<{ error: string; details?: Record<string, unknown> }> = [];
  return {
    reports,
    report: (_options: { json?: boolean }, error: string, details?: Record<string, unknown>) => {
      reports.push({ error, ...(details ? { details } : {}) });
    },
  };
}

async function captureStreams(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => void stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void stderr.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function baseOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: "todos",
    agent: AGENT,
    scopes: "todos:read,todos:write",
    secretsRef: REF_TEMPLATE,
    json: true,
    ...overrides,
  };
}

function baseEnv(signingSecret = TODO_SIGNING): NodeJS.ProcessEnv {
  return {
    HASNA_TODOS_API_SIGNING_KEY: signingSecret,
    HASNA_TODOS_DATABASE_URL: DB_URL,
    HASNA_SECRETS_API_URL: SECRETS_BASE_URL,
    HASNA_SECRETS_API_KEY: SECRETS_TRANSPORT_KEY,
  };
}

describe("issue-key credential-safe Secrets delivery", () => {
  test("creates one signed DB record and one exact vault row while every output stays token-free", async () => {
    const { reports, report } = collectReports();
    const inserted: MintedApiKey[] = [];
    const activated: string[] = [];
    const revoked: string[] = [];
    const delivered: Array<{ key: string; value: string; type?: string; label?: string }> = [];
    const deleted: string[] = [];

    const streams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report,
        env: baseEnv(),
        now: () => 1_700_000_000_000,
        connectStore: async () => ({
          store: {
            ensureSchema: async () => {},
            insertMinted: async () => {
              throw new Error("active insert must not run");
            },
            insertMintedPending: async (minted) => void inserted.push(minted),
            activatePending: async (kid) => {
              activated.push(kid);
              return true;
            },
            revoke: async (kid) => {
              revoked.push(kid);
              return true;
            },
          },
          close: async () => {},
        }),
        connectSecrets: async (config) => {
          expect(config).toEqual({ baseUrl: SECRETS_BASE_URL, apiKey: SECRETS_TRANSPORT_KEY });
          return {
            putSecret: async (input) => {
              delivered.push(input);
              return {
                key: input.key,
                type: "api_key",
                created_at: "2026-08-13T00:00:00.000Z",
                updated_at: "2026-08-13T00:00:00.000Z",
              };
            },
            deleteSecret: async (query) => {
              if (!query) throw new Error("missing key");
              deleted.push(query.key);
              return { deleted: true };
            },
          };
        },
      });
    });

    expect(reports).toEqual([]);
    expect(streams.stderr).toBe("");
    expect(inserted).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(activated).toEqual([inserted[0]!.kid]);
    expect(revoked).toEqual([]);
    expect(deleted).toEqual([]);

    const minted = inserted[0]!;
    const vault = delivered[0]!;
    expect(vault.key).toBe(`todos/agents/${AGENT}/${minted.kid}`);
    expect(vault.value).toBe(minted.token);
    expect(vault.type).toBe("api_key");

    const receipt = JSON.parse(streams.stdout) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      ok: true,
      app: "todos",
      kid: minted.kid,
      agent: AGENT,
      secretsRef: vault.key,
      stored: true,
      vaultStored: true,
    });
    expect(Object.hasOwn(receipt, "token")).toBe(false);
    expect(Object.hasOwn(receipt, "value")).toBe(false);

    const observable = [streams.stdout, streams.stderr, JSON.stringify(reports), JSON.stringify(process.argv)].join("\n");
    expect(observable).not.toContain(minted.token);
    expect(observable).not.toContain(minted.tokenHash);

    const verified = verifyApiKeyToken(minted.token, {
      signingSecret: TODO_SIGNING,
      expectedApp: "todos",
      nowMs: 1_700_000_001_000,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.agent).toBe(AGENT);
    expect(
      verifyApiKeyToken(minted.token, {
        signingSecret: FLEET_SIGNING,
        expectedApp: "todos",
        nowMs: 1_700_000_001_000,
      }).ok,
    ).toBe(false);
  });

  test("conflicting canonical and legacy Secrets aliases fail before mint or any remote write", async () => {
    const { reports, report } = collectReports();
    const env = {
      ...baseEnv(),
      SECRETS_API_URL: "https://legacy-secrets.example.test",
      SECRETS_API_KEY: "test-legacy-secrets-key-not-a-real-credential",
    };
    let mintClockReads = 0;
    let dbCalls = 0;
    let vaultCalls = 0;

    const streams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report,
        env,
        now: () => {
          mintClockReads += 1;
          return 1_700_000_000_000;
        },
        connectStore: async () => {
          dbCalls += 1;
          throw new Error("must not connect");
        },
        connectSecrets: async () => {
          vaultCalls += 1;
          throw new Error("must not connect");
        },
      });
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.details).toEqual({ code: "conflicting_secrets_config" });
    expect(mintClockReads).toBe(0);
    expect(dbCalls).toBe(0);
    expect(vaultCalls).toBe(0);
    const observable = [streams.stdout, streams.stderr, JSON.stringify(reports)].join("\n");
    expect(observable).not.toContain(SECRETS_BASE_URL);
    expect(observable).not.toContain(env.SECRETS_API_URL);
    expect(observable).not.toContain(SECRETS_TRANSPORT_KEY);
    expect(observable).not.toContain(env.SECRETS_API_KEY);
  });

  test("a fleet-signed token with --agent remains invalid to the Todos signing authority", () => {
    const forged = mintApiKey({
      app: "todos",
      agent: AGENT,
      scopes: ["todos:write"],
      signingSecret: FLEET_SIGNING,
      nowMs: 1_700_000_000_000,
    });
    const decision = verifyApiKeyToken(forged.token, {
      signingSecret: TODO_SIGNING,
      expectedApp: "todos",
      nowMs: 1_700_000_001_000,
    });
    expect(decision).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  test("human output is metadata-only too", async () => {
    const { reports, report } = collectReports();
    let minted: MintedApiKey | undefined;
    const streams = await captureStreams(async () => {
      await runIssueKey(baseOptions({ json: false }), {
        report,
        env: baseEnv(),
        connectStore: async () => ({
          store: {
            ensureSchema: async () => {},
            insertMinted: async () => {
              throw new Error("active insert must not run");
            },
            insertMintedPending: async (value) => {
              minted = value;
            },
            activatePending: async () => true,
            revoke: async () => true,
          },
          close: async () => {},
        }),
        connectSecrets: async () => ({
          putSecret: async (input) => ({
            key: input.key,
            type: "api_key",
            created_at: "2026-08-13T00:00:00.000Z",
            updated_at: "2026-08-13T00:00:00.000Z",
          }),
          deleteSecret: async () => ({ deleted: true }),
        }),
      });
    });

    expect(reports).toEqual([]);
    expect(minted).toBeDefined();
    expect(streams.stderr).toBe("");
    expect(streams.stdout).toContain(`todos/agents/${AGENT}/${minted!.kid}`);
    expect(streams.stdout).not.toContain(minted!.token);
    expect(streams.stdout).not.toContain(minted!.tokenHash);
    expect(streams.stdout).not.toContain("shown once");
  });

  test("a correctly signed wrong-agent key stays bound to the wrong agent", () => {
    const wrong = mintApiKey({
      app: "todos",
      agent: "another-agent",
      scopes: ["todos:write"],
      signingSecret: TODO_SIGNING,
      nowMs: 1_700_000_000_000,
    });
    const decision = verifyApiKeyToken(wrong.token, {
      signingSecret: TODO_SIGNING,
      expectedApp: "todos",
      nowMs: 1_700_000_001_000,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.agent).toBe("another-agent");
    if (decision.ok) expect(decision.agent).not.toBe(AGENT);
  });

  test("an ambiguous DB failure revokes by kid and never forwards a token-bearing error", async () => {
    const { reports, report } = collectReports();
    let minted: MintedApiKey | undefined;
    const revoked: string[] = [];
    let vaultCalls = 0;

    const streams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report,
        env: baseEnv(),
        connectStore: async () => ({
          store: {
            ensureSchema: async () => {},
            insertMinted: async () => {
              throw new Error("active insert must not run");
            },
            insertMintedPending: async (value) => {
              minted = value;
              throw new Error(`ambiguous database response ${value.token}`);
            },
            activatePending: async () => false,
            revoke: async (kid) => {
              revoked.push(kid);
              return true;
            },
          },
          close: async () => {},
        }),
        connectSecrets: async () => ({
          putSecret: async () => {
            vaultCalls += 1;
            throw new Error("must not run");
          },
          deleteSecret: async () => ({ deleted: false }),
        }),
      });
    });

    expect(minted).toBeDefined();
    expect(vaultCalls).toBe(0);
    expect(revoked).toEqual([minted!.kid]);
    expect(reports[0]?.details).toMatchObject({ code: "store_failed", compensated: true });
    const observable = [streams.stdout, streams.stderr, JSON.stringify(reports)].join("\n");
    expect(observable).not.toContain(minted!.token);
    expect(observable).not.toContain(minted!.tokenHash);
    expect(observable).not.toContain("ambiguous database response");
  });

  test("an ambiguous Secrets failure revokes the DB row, deletes the exact ref, and emits metadata only", async () => {
    const { reports, report } = collectReports();
    let minted: MintedApiKey | undefined;
    const revoked: string[] = [];
    const deleted: string[] = [];

    const streams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report,
        env: baseEnv(),
        connectStore: async () => ({
          store: {
            ensureSchema: async () => {},
            insertMinted: async () => {
              throw new Error("active insert must not run");
            },
            insertMintedPending: async (value) => {
              minted = value;
            },
            activatePending: async () => true,
            revoke: async (kid) => {
              revoked.push(kid);
              return true;
            },
          },
          close: async () => {},
        }),
        connectSecrets: async () => ({
          putSecret: async (input) => {
            throw new Error(`ambiguous vault response ${input.value}`);
          },
          deleteSecret: async (query) => {
            if (!query) throw new Error("missing key");
            deleted.push(query.key);
            return { deleted: true };
          },
        }),
      });
    });

    expect(minted).toBeDefined();
    const expectedRef = `todos/agents/${AGENT}/${minted!.kid}`;
    expect(revoked).toEqual([minted!.kid]);
    expect(deleted).toEqual([expectedRef]);
    expect(reports[0]?.details).toMatchObject({
      code: "secrets_store_failed",
      compensated: true,
      kid: minted!.kid,
      secretsRef: expectedRef,
    });
    const observable = [streams.stdout, streams.stderr, JSON.stringify(reports)].join("\n");
    expect(observable).not.toContain(minted!.token);
    expect(observable).not.toContain(minted!.tokenHash);
    expect(observable).not.toContain("ambiguous vault response");
  });

  test("a committed vault write with a lost response stays unusable when both cleanups fail and retry yields exactly one usable key", async () => {
    const issued: MintedApiKey[] = [];
    const states = new Map<string, "pending" | "active" | "revoked">();
    const vault = new Map<string, string>();
    let vaultWrites = 0;

    const connectStore = async () => ({
      store: {
        ensureSchema: async () => {},
        insertMinted: async (minted: MintedApiKey) => {
          issued.push(minted);
          states.set(minted.kid, "active");
        },
        insertMintedPending: async (minted: MintedApiKey) => {
          issued.push(minted);
          states.set(minted.kid, "pending");
        },
        activatePending: async (kid: string) => {
          if (states.get(kid) !== "pending") return false;
          states.set(kid, "active");
          return true;
        },
        revoke: async (kid: string) => {
          if (vaultWrites === 1) throw new Error("record cleanup unavailable");
          states.set(kid, "revoked");
          return true;
        },
      },
      close: async () => {},
    });
    const connectSecrets = async () => ({
      putSecret: async (input: { key: string; value: string }) => {
        vaultWrites += 1;
        vault.set(input.key, input.value);
        if (vaultWrites === 1) throw new Error(`committed response lost ${input.value}`);
        return {
          key: input.key,
          type: "api_key" as const,
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
        };
      },
      deleteSecret: async () => {
        throw new Error("vault cleanup unavailable");
      },
    });
    const isUsable = (minted: MintedApiKey): boolean => {
      const ref = `todos/agents/${AGENT}/${minted.kid}`;
      return (
        verifyApiKeyToken(minted.token, {
          signingSecret: TODO_SIGNING,
          expectedApp: "todos",
          nowMs: 1_700_000_001_000,
        }).ok &&
        states.get(minted.kid) === "active" &&
        vault.get(ref) === minted.token
      );
    };

    const first = collectReports();
    const firstStreams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report: first.report,
        env: baseEnv(),
        now: () => 1_700_000_000_000,
        connectStore,
        connectSecrets,
      });
    });

    expect(first.reports[0]?.details).toMatchObject({
      code: "secrets_store_failed",
      compensated: false,
      recordCompensated: false,
      vaultCompensated: false,
    });
    expect(issued).toHaveLength(1);
    expect(isUsable(issued[0]!)).toBe(false);

    const retry = collectReports();
    const retryStreams = await captureStreams(async () => {
      await runIssueKey(baseOptions(), {
        report: retry.report,
        env: baseEnv(),
        now: () => 1_700_000_000_000,
        connectStore,
        connectSecrets,
      });
    });

    expect(retry.reports).toEqual([]);
    expect(issued).toHaveLength(2);
    expect(issued.filter(isUsable)).toHaveLength(1);
    expect(states.get(issued[0]!.kid)).toBe("pending");
    expect(states.get(issued[1]!.kid)).toBe("active");
    for (const minted of issued) {
      const observable = [
        firstStreams.stdout,
        firstStreams.stderr,
        retryStreams.stdout,
        retryStreams.stderr,
        JSON.stringify(first.reports),
        JSON.stringify(retry.reports),
      ].join("\n");
      expect(observable).not.toContain(minted.token);
      expect(observable).not.toContain(minted.tokenHash);
    }
  });

  test("an activation commit with a lost response is reconciled by stable issuance id and retry keeps one authoritative credential", async () => {
    const issuanceId = "task-d5a381b5-activation";
    const records = new Map<string, { minted: MintedApiKey; state: "pending" | "active" }>();
    const vault = new Map<string, { value: string; type: string }>();
    let activationCalls = 0;
    let vaultWrites = 0;
    let cleanupCalls = 0;

    const connectStore = async () => ({
      store: {
        ensureSchema: async () => {},
        insertMinted: async () => {
          throw new Error("active insert must not run");
        },
        insertMintedPending: async (minted: MintedApiKey) => {
          if (records.has(minted.kid)) throw new Error("duplicate kid");
          records.set(minted.kid, { minted, state: "pending" });
        },
        activatePending: async (kid: string, tokenHash: string) => {
          activationCalls += 1;
          const record = records.get(kid);
          if (!record || record.minted.tokenHash !== tokenHash) return false;
          if (record.state === "pending") {
            record.state = "active";
            throw new Error("activation response lost after commit");
          }
          return record.state === "active";
        },
        findByKid: async (kid: string) => {
          const record = records.get(kid);
          if (!record) return null;
          return {
            kid,
            app: record.minted.claims.app,
            agent: record.minted.claims.agent ?? null,
            tid: record.minted.claims.tid ?? null,
            scopes: record.minted.claims.scopes,
            tokenHash: record.minted.tokenHash,
            issuedAt: new Date(record.minted.claims.iat * 1000).toISOString(),
            expiresAt:
              record.minted.claims.exp === null ? null : new Date(record.minted.claims.exp * 1000).toISOString(),
            revokedAt: record.state === "pending" ? "2026-08-13T00:00:00.000Z" : null,
            revokedReason: record.state === "pending" ? "credential_delivery_pending" : null,
            lastUsedAt: null,
            createdBy: AGENT,
          };
        },
        revoke: async () => {
          cleanupCalls += 1;
          throw new Error("record cleanup unavailable");
        },
      },
      close: async () => {},
    });
    const connectSecrets = async () => ({
      putSecret: async (input: { key: string; value: string; type?: string }) => {
        vaultWrites += 1;
        vault.set(input.key, { value: input.value, type: input.type ?? "" });
        return {
          key: input.key,
          type: "api_key" as const,
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
        };
      },
      listSecrets: async ({ namespace }: { namespace?: string } = {}) => ({
        secrets: [...vault.entries()]
          .filter(([key]) => namespace === undefined || key === namespace)
          .map(([key, metadata]) => ({
            key,
            type: metadata.type === "api_key" ? ("api_key" as const) : ("other" as const),
            created_at: "2026-08-13T00:00:00.000Z",
            updated_at: "2026-08-13T00:00:00.000Z",
          })),
      }),
      deleteSecret: async () => {
        cleanupCalls += 1;
        throw new Error("vault cleanup unavailable");
      },
    });
    const options = baseOptions({ issuanceId });

    const first = collectReports();
    const firstStreams = await captureStreams(async () => {
      await runIssueKey(options, {
        report: first.report,
        env: baseEnv(),
        now: () => 1_700_000_000_000,
        connectStore,
        connectSecrets,
      });
    });

    expect(first.reports).toEqual([]);
    expect(JSON.parse(firstStreams.stdout)).toMatchObject({ ok: true, kid: issuanceId, issuanceId });
    expect(records).toHaveLength(1);
    expect(records.get(issuanceId)?.state).toBe("active");
    expect(vault).toHaveLength(1);
    expect(vaultWrites).toBe(1);
    expect(cleanupCalls).toBe(0);

    const retry = collectReports();
    const retryStreams = await captureStreams(async () => {
      await runIssueKey(options, {
        report: retry.report,
        env: baseEnv(),
        now: () => 1_700_000_100_000,
        connectStore,
        connectSecrets,
      });
    });

    expect(retry.reports).toEqual([]);
    expect(JSON.parse(retryStreams.stdout)).toMatchObject({ ok: true, kid: issuanceId, issuanceId });
    expect(records).toHaveLength(1);
    expect([...records.values()].filter((record) => record.state === "active")).toHaveLength(1);
    expect(vault).toHaveLength(1);
    expect(vaultWrites).toBe(1);
    expect(activationCalls).toBe(2);
    for (const { minted } of records.values()) {
      const observable = [
        firstStreams.stdout,
        firstStreams.stderr,
        retryStreams.stdout,
        retryStreams.stderr,
        JSON.stringify(first.reports),
        JSON.stringify(retry.reports),
      ].join("\n");
      expect(observable).not.toContain(minted.token);
      expect(observable).not.toContain(minted.tokenHash);
    }
  });

  test("silent delivery refuses overwrite-prone or unbound references before any persistence", async () => {
    for (const options of [
      baseOptions({ secretsRef: "todos/agents/fixed-key" }),
      baseOptions({ secretsRef: "todos/agents/{agent}/fixed-key" }),
      baseOptions({ secretsRef: "todos/agents/{kid}" }),
      baseOptions({ issuanceId: "unsafe/id" }),
      baseOptions({ secretsRef: undefined, issuanceId: "stable-id" }),
      baseOptions({ agent: undefined }),
      baseOptions({ store: false }),
    ]) {
      const { reports, report } = collectReports();
      let dbCalls = 0;
      let vaultCalls = 0;
      const streams = await captureStreams(async () => {
        await runIssueKey(options, {
          report,
          env: baseEnv(),
          connectStore: async () => {
            dbCalls += 1;
            throw new Error("must not connect");
          },
          connectSecrets: async () => {
            vaultCalls += 1;
            throw new Error("must not connect");
          },
        });
      });
      expect(reports).toHaveLength(1);
      expect(String(reports[0]?.details?.code)).toMatch(/^bad_secrets_|^bad_issuance_id$|^missing_agent$/);
      expect(dbCalls).toBe(0);
      expect(vaultCalls).toBe(0);
      expect(streams.stdout).not.toContain("hasna_todos_");
      expect(streams.stderr).not.toContain("hasna_todos_");
    }
  });
});
