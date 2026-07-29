import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AccountsError } from "../../src/errors";
import { POSTGRES_ADAPTER_STATUS } from "../../src/index";
import { createAccountsCapacity } from "../../src/sdk";
import { createAccountsHttpHandler } from "../../src/http/handler";

const SRC_ROOT = join(import.meta.dir, "..", "..", "src");

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

function authProvider() {
  return {
    authorize: async (headers: Headers) => {
      headers.set("authorization", "Bearer test-capacity-credential-value");
    },
  };
}

/**
 * Asserts the *specific* rejection rather than merely "it threw". Measured trap:
 * `{ mode: "local" }` already threw DATABASE_PATH_UNSAFE from the SQLite path
 * guard before this change, so a bare `toThrow` passes for the wrong reason and
 * proves nothing about mode handling.
 */
function expectConfigRejection(build: () => unknown, field: string): void {
  let caught: unknown;
  try {
    build();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AccountsError);
  const error = caught as AccountsError;
  expect(error.code).toBe("VALIDATION_FAILED");
  expect(error.details.field).toBe(field);
}

describe("retired deployment modes are rejected, not normalized", () => {
  test("the SDK refuses every retired mode value instead of falling back to SQLite", () => {
    for (const retired of ["local", "self_hosted", "self-hosted", "cloud", "remote", "hybrid"]) {
      expectConfigRejection(
        () =>
          createAccountsCapacity({
            mode: retired,
            actorRef: "principal:human:hasna:owner",
          } as never),
        "mode",
      );
      expectConfigRejection(
        () =>
          createAccountsCapacity({
            store: retired,
            actorRef: "principal:human:hasna:owner",
          } as never),
        "store",
      );
    }
  });

  test("the retired `mode` key is rejected even when it carries a live store value", () => {
    // The dangerous case: `mode: "sqlite"` must not be silently accepted as if it
    // were `store: "sqlite"`, or the retired key stays alive forever.
    expectConfigRejection(
      () =>
        createAccountsCapacity({
          mode: "sqlite",
          actorRef: "principal:human:hasna:owner",
        } as never),
      "mode",
    );
  });

  test("the SQLite client store is selected by the new discriminant", async () => {
    const directory = mkdtempSync(join(tmpdir(), "capacity-store-"));
    try {
      const client = createAccountsCapacity({
        store: "sqlite",
        actorRef: "principal:human:hasna:owner",
        sqlitePath: join(directory, "accounts.db"),
      });
      expect(typeof client.close).toBe("function");
      await client.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the HTTP client store requires an HTTPS origin, as the retired mode did", () => {
    expect(() =>
      createAccountsCapacity({
        store: "http",
        baseUrl: "http://accounts.internal",
        authProvider: authProvider(),
      }),
    ).toThrow(AccountsError);
    const client = createAccountsCapacity({
      store: "http",
      baseUrl: "https://accounts.internal",
      authProvider: authProvider(),
    });
    expect(typeof client.close).toBe("function");
  });

  test("the HTTP server rejects a retired deployment mode and demands a data backend", () => {
    const base = {
      identityRealm: "hasna",
      organizationRef: "organization:hasna",
      publicAudience: "accounts-capacity-public",
      internalAudience: "accounts-capacity-internal",
      allowedIssuers: new Set(["authority:identities"]),
    };
    const options = {
      authenticator: { authenticate: async () => ({}) },
      catalog: {},
      packageVersion: "0.0.0",
      contractSha256: "0".repeat(64),
      openApiDocument: {},
    };
    for (const retired of ["self_hosted", "self-hosted", "cloud", "local", "hybrid", "remote"]) {
      expect(() =>
        createAccountsHttpHandler({
          deployment: { ...base, mode: retired },
          ...options,
        } as never),
      ).toThrow(AccountsError);
    }
    expect(() =>
      createAccountsHttpHandler({
        deployment: { ...base, dataBackend: "sqlite" },
        ...options,
      } as never),
    ).toThrow(AccountsError);
  });

  test("the Postgres adapter advertises a data backend, not a deployment mode", () => {
    expect(POSTGRES_ADAPTER_STATUS.target).toBe("postgresql");
    expect(JSON.stringify(POSTGRES_ADAPTER_STATUS)).not.toContain("self_hosted");
  });
});

describe("no live deployment-mode vocabulary survives in src/", () => {
  // Positive control for the absence claim: the scanner must be able to see a
  // deliberately planted occurrence, otherwise a clean result proves nothing.
  test("the scanner detects a planted occurrence", () => {
    const planted = 'const deployment = "self_hosted";\nHASNA_ACCOUNTS_DEPLOYMENT=local\n';
    expect(liveModeHits("planted.ts", planted).length).toBeGreaterThan(0);
  });

  test("src/ carries no live three-way deployment-mode branching", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const hits = liveModeHits(file, readFileSync(file, "utf8"));
      offenders.push(...hits);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Flags live deployment-mode vocabulary while preserving the surfaces that
 * provably cannot move (checksum-bound migration DDL, signed audience values)
 * and the legitimate English/technical uses of the same words.
 */
function liveModeHits(file: string, contents: string): readonly string[] {
  const hits: string[] = [];
  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (isRetirementExempt(lines, index)) continue;
    const patterns = [
      /HASNA_ACCOUNTS_DEPLOYMENT/,
      /\bdeploymentMode\b/,
      /\bDEPLOYMENT_MODE\b/,
      /["']hybrid["']/,
      /\bmode\s*:\s*["'](?:local|self_hosted|self-hosted|cloud|remote|hybrid)["']/,
    ];
    if (patterns.some((pattern) => pattern.test(line))) {
      hits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
  return hits;
}

/**
 * A RETIREMENT-EXEMPT marker applies when it sits on the offending line itself or
 * anywhere in the contiguous comment block directly above it. The marker must be
 * accompanied by a reason; the surviving sites are the rejection list, which has
 * to name what it rejects, and frozen digest preimages.
 */
function isRetirementExempt(lines: readonly string[], index: number): boolean {
  if (lines[index]!.includes("RETIREMENT-EXEMPT")) return true;
  for (let back = index - 1; back >= 0; back -= 1) {
    const previous = lines[back]!.trim();
    const isComment =
      previous.startsWith("//") ||
      previous.startsWith("*") ||
      previous.startsWith("/*") ||
      previous.endsWith("*/");
    if (!isComment) return false;
    if (previous.includes("RETIREMENT-EXEMPT")) return true;
  }
  return false;
}
