import { afterEach, describe, expect, mock, test } from "bun:test";

import { AccountsError } from "../../src/errors";
import { newEligibilityEvidenceId } from "../../src/domain/ids";
import { canonicalJson } from "../../src/serialization/json";
import { createSelfHostedAccountsCapacity } from "../../src/sdk/remote";
import type { AccountsAuthProvider, AccountsCapacity } from "../../src/sdk/types";
import { C0, digest, makeFixtureGraph, NOW } from "../fixtures";

const originalFetch = globalThis.fetch;
const graph = makeFixtureGraph();

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

function authProvider(
  authorize: AccountsAuthProvider["authorize"] = async (headers) => {
    headers.set("authorization", "Bearer capacity-test-credential");
  },
): AccountsAuthProvider {
  return { authorize };
}

function createClient(provider: AccountsAuthProvider = authProvider()): AccountsCapacity {
  return createSelfHostedAccountsCapacity("https://accounts.internal", provider);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerAccountView() {
  const {
    providerSubjectRef: _providerSubjectRef,
    providerSubjectCandidateRef: _providerSubjectCandidateRef,
    ...account
  } = graph.activeAccount;
  return { ...account, providerSubjectRefRedacted: true as const };
}

function mutationEnvelope(kind: string, data: unknown) {
  return {
    schemaVersion: "accounts.mutation-result.v1",
    kind,
    data,
    eventId: "018f0f00-0000-7000-8000-000000000099",
    replayed: false,
  };
}

function negativeEligibility() {
  return {
    schemaVersion: "accounts.slot-eligibility.v1",
    evidenceId: newEligibilityEvidenceId(NOW.getTime() + 500),
    evidenceClass: "local_diagnostic",
    authority: "none",
    reservation: "none",
    accessMethodId: graph.method.id,
    accessTarget: { kind: "unresolved" },
    recordRevisionSet: {},
    eligibilityRequestDigest: digest("f"),
    eligible: false,
    reasonCodes: ["CURRENT_DENY"],
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 1_000).toISOString(),
  } as const;
}

describe("self-hosted Accounts SDK transport", () => {
  test.each([
    "not a URL",
    "http://accounts.internal",
    "https://user:password@accounts.internal",
    "https://accounts.internal/v1",
    "https://accounts.internal?tenant=a",
    "https://accounts.internal#fragment",
  ])("rejects a non-origin base URL: %s", (baseUrl) => {
    expect(() => createSelfHostedAccountsCapacity(baseUrl, authProvider())).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED", details: { field: "baseUrl" } }),
    );
  });

  test("normalizes an HTTPS origin and applies closed fetch options", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return jsonResponse({
        schemaVersion: "accounts.list.v1",
        kind: "entitlement",
        records: [graph.entitlement],
        nextCursor: "page-2",
        route: "entitlements",
      });
    }) as unknown as typeof fetch;

    const page = await createSelfHostedAccountsCapacity(
      "https://accounts.internal/",
      authProvider(),
    ).entitlements.list({ cursor: "next page", limit: 100 });

    expect(page).toEqual({ records: [graph.entitlement], nextCursor: "page-2" });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.records)).toBe(true);
    expect(requestedUrl).toBe(
      "https://accounts.internal/v1/entitlements?cursor=next+page&limit=100",
    );
    expect(requestedInit).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    const headers = requestedInit?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer capacity-test-credential");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has("content-type")).toBe(false);
  });

  test.each([
    ["provider-accounts", "account", providerAccountView(), (sdk: AccountsCapacity) => sdk.providerAccounts.list()],
    ["capacity-pools", "capacity_pool", graph.pool, (sdk: AccountsCapacity) => sdk.capacityPools.list()],
    ["account-lanes", "access_method", graph.method, (sdk: AccountsCapacity) => sdk.lanes.list()],
    ["auth-capsules", "auth_capsule", graph.capsule!, (sdk: AccountsCapacity) => sdk.capsules.list()],
    [
      "credential-bindings",
      "credential_binding",
      graph.binding,
      (sdk: AccountsCapacity) => sdk.credentialBindings.list(),
    ],
  ] as const)("decodes the %s collection", async (route, kind, record, list) => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        schemaVersion: "accounts.list.v1",
        kind,
        records: [record],
        nextCursor: null,
        route,
      }),
    ) as unknown as typeof fetch;

    const page = await list(createClient());

    expect(page.records as unknown).toEqual([record]);
    expect(page.nextCursor).toBeNull();
  });

  test("gets a redacted account and percent-encodes the identifier", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return jsonResponse({
        schemaVersion: "accounts.record.v1",
        kind: "account",
        data: providerAccountView(),
      });
    }) as unknown as typeof fetch;

    const account = await createClient().providerAccounts.get(
      `${graph.account.id}/child` as typeof graph.account.id,
    );

    expect(account.providerSubjectRefRedacted).toBe(true);
    expect("providerSubjectRef" in account).toBe(false);
    expect(requestedUrl).toEndWith(`${graph.account.id}%2Fchild`);
  });

  test.each([
    [
      "entitlements",
      "entitlement",
      graph.entitlement,
      (sdk: AccountsCapacity) => sdk.entitlements.get(graph.entitlement.id),
    ],
    [
      "capacity-pools",
      "capacity_pool",
      graph.pool,
      (sdk: AccountsCapacity) => sdk.capacityPools.get(graph.pool.id),
    ],
    [
      "account-lanes",
      "access_method",
      graph.method,
      (sdk: AccountsCapacity) => sdk.lanes.get(graph.method.id),
    ],
    [
      "auth-capsules",
      "auth_capsule",
      graph.capsule!,
      (sdk: AccountsCapacity) => sdk.capsules.get(graph.capsule!.id),
    ],
    [
      "credential-bindings",
      "credential_binding",
      graph.binding,
      (sdk: AccountsCapacity) => sdk.credentialBindings.get(graph.binding.id),
    ],
  ] as const)("gets and decodes a $kind record", async (route, kind, record, get) => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return jsonResponse({
        schemaVersion: "accounts.record.v1",
        kind,
        data: record,
      });
    }) as unknown as typeof fetch;

    expect((await get(createClient())) as unknown).toEqual(record);
    expect(requestedUrl).toBe(`https://accounts.internal/v1/${route}/${record.id}`);
  });

  test.each([
    {
      route: "provider-accounts",
      kind: "account",
      data: providerAccountView(),
      expectedBody: {
        schemaVersion: "accounts.provider-account.create.v1",
        providerKey: graph.account.providerKey,
        ownerRef: graph.account.ownerRef,
        displayLabel: graph.account.displayLabel,
        providerSubjectCandidateRef: "subject-candidate",
      },
      create: (sdk: AccountsCapacity) =>
        sdk.providerAccounts.create(
          {
            providerKey: graph.account.providerKey,
            ownerRef: graph.account.ownerRef,
            displayLabel: graph.account.displayLabel,
            providerSubjectCandidateRef: "subject-candidate",
          },
          { idempotencyKey: "provider-create:1" },
        ),
    },
    {
      route: "entitlements",
      kind: "entitlement",
      data: graph.entitlement,
      expectedBody: {
        schemaVersion: "accounts.entitlement.create.v1",
        providerAccountId: graph.account.id,
        fundingKind: "subscription",
      },
      create: (sdk: AccountsCapacity) =>
        sdk.entitlements.create(
          { providerAccountId: graph.account.id, fundingKind: "subscription" },
          { idempotencyKey: "entitlement-create:1" },
        ),
    },
    {
      route: "account-lanes",
      kind: "access_method",
      data: graph.method,
      expectedBody: {
        schemaVersion: "accounts.account-lane.create.v1",
        entitlementId: graph.entitlement.id,
        capacityPoolId: graph.pool.id,
        adapterKey: graph.method.adapterKey,
        adapterVersion: graph.method.adapterVersion,
        accessTransport: graph.method.accessTransport,
      },
      create: (sdk: AccountsCapacity) =>
        sdk.lanes.create(
          {
            entitlementId: graph.entitlement.id,
            capacityPoolId: graph.pool.id,
            adapterKey: graph.method.adapterKey,
            adapterVersion: graph.method.adapterVersion,
            accessTransport: graph.method.accessTransport,
          },
          { idempotencyKey: "lane-create:1" },
        ),
    },
  ])("creates a $kind with the versioned wire body", async ({ route, kind, data, expectedBody, create }) => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return jsonResponse(mutationEnvelope(kind, data));
    }) as unknown as typeof fetch;

    expect(await create(createClient())).toEqual(data);
    expect(requestedUrl).toBe(`https://accounts.internal/v1/${route}`);
    expect(requestedInit?.method).toBe("POST");
    expect(requestedInit?.body).toBe(canonicalJson(expectedBody));
    const headers = requestedInit?.headers as Headers;
    expect(headers.get("idempotency-key")).toEndWith("create:1");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("creates and retrieves bootstrap intents with revision fencing", async () => {
    const intent = {
      schemaVersion: "accounts.bootstrap-intent.v1",
      id: "018f0f00-0000-7000-8000-000000000098",
      authCapsuleId: graph.capsule!.id,
      ownerRef: graph.capsule!.ownerRef,
      canonicalNodeId: graph.capsule!.placementRef,
      nodeGeneration: C0,
      placementGeneration: C0,
      authGeneration: C0,
      capsuleRevision: C0,
      status: "pending",
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    } as const;
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });
      return jsonResponse(intent);
    }) as unknown as typeof fetch;
    const sdk = createClient();

    expect(
      await sdk.capsules.createBootstrapIntent(
        graph.capsule!.id,
        { reasonCode: "OWNER_REAUTHENTICATION" },
        { idempotencyKey: "bootstrap:1", expectedRevision: C0 },
      ),
    ).toEqual(intent);
    expect(await sdk.capsules.getBootstrapIntent(graph.capsule!.id, intent.id)).toEqual(intent);

    expect(requests[0]!.url).toEndWith(`/auth-capsules/${graph.capsule!.id}/bootstrap-intents`);
    expect((requests[0]!.init?.headers as Headers).get("if-match")).toBe('"0"');
    expect(requests[0]!.init?.body).toBe(
      canonicalJson({
        schemaVersion: "accounts.bootstrap-intent.create.v1",
        reasonCode: "OWNER_REAUTHENTICATION",
      }),
    );
    expect(requests[1]!.url).toEndWith(
      `/auth-capsules/${graph.capsule!.id}/bootstrap-intents/${intent.id}`,
    );
  });

  test("queries capacity without introducing a reservation", async () => {
    const eligibility = negativeEligibility();
    let requestedBody: BodyInit | null | undefined;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestedBody = init?.body;
      return jsonResponse({
        schemaVersion: "accounts.capacity-query.v1",
        reservation: "none",
        data: eligibility,
      });
    }) as unknown as typeof fetch;
    const request = {
      accessMethodId: graph.method.id,
      operation: "responses.create",
      model: "model.example",
      dataClassification: "internal",
      destinationPolicyClass: "default",
    };

    expect(await createClient().capacity.query(request)).toEqual(eligibility);
    expect(requestedBody).toBe(canonicalJson(request));
  });

  test.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid pagination limit before authentication: %s",
    async (limit) => {
      let authorized = false;
      let fetched = false;
      globalThis.fetch = mock(async () => {
        fetched = true;
        throw new Error("unexpected fetch");
      }) as unknown as typeof fetch;
      const sdk = createClient(
        authProvider(async () => {
          authorized = true;
        }),
      );

      await expect(sdk.entitlements.list({ limit })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { field: "limit" },
      });
      expect(authorized).toBe(false);
      expect(fetched).toBe(false);
    },
  );

  test.each(["", ".starts-with-punctuation", "a".repeat(129)])(
    "rejects an invalid idempotency key before authentication: %s",
    async (idempotencyKey) => {
      let authorized = false;
      const sdk = createClient(
        authProvider(async () => {
          authorized = true;
        }),
      );

      await expect(
        sdk.entitlements.create(
          { providerAccountId: graph.account.id, fundingKind: "subscription" },
          { idempotencyKey },
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { field: "idempotencyKey" },
      });
      expect(authorized).toBe(false);
    },
  );

  test("rejects a malformed bootstrap intent identifier before fetching", async () => {
    let fetched = false;
    globalThis.fetch = mock(async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;

    await expect(
      createClient().capsules.getBootstrapIntent(graph.capsule!.id, "not-an-intent-id"),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "intentId" },
    });
    expect(fetched).toBe(false);
  });

  test("maps authentication failures without exposing their error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    const sdk = createClient(
      authProvider(async () => {
        throw new Error("secret authentication detail");
      }),
    );

    await expect(sdk.capacityPools.list()).rejects.toEqual(
      expect.objectContaining({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required dependency is unavailable",
        retryable: false,
      }),
    );
  });

  test.each([
    ["missing", async (_headers: Headers): Promise<void> => {}, "FORBIDDEN", undefined],
    [
      "non-Bearer",
      async (headers: Headers) => {
        headers.set("authorization", "Basic dXNlcjpwYXNz");
      },
      "FORBIDDEN",
      undefined,
    ],
    [
      "legacy",
      async (headers: Headers) => {
        headers.set("authorization", "Bearer capacity-test-credential");
        headers.set("x-api-key", "legacy-credential");
      },
      "VALIDATION_FAILED",
      "x_api_key",
    ],
  ] as const)(
    "rejects %s authorization headers before fetching",
    async (_case, authorize, code, field) => {
      let fetched = false;
      globalThis.fetch = mock(async () => {
        fetched = true;
        throw new Error("unexpected fetch");
      }) as unknown as typeof fetch;

      try {
        await createClient(authProvider(authorize)).capacityPools.list();
        throw new Error("expected authorization validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AccountsError);
        expect(error).toMatchObject({
          code,
          ...(field === undefined ? {} : { details: { field } }),
        });
      }
      expect(fetched).toBe(false);
    },
  );

  test("maps fetch failures as retryable dependency failures", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("connection refused at secret host");
    }) as unknown as typeof fetch;

    await expect(createClient().capacityPools.list()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true,
    });
  });

  test("preserves abort reasons from fetch and close", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    globalThis.fetch = mock(async () => {
      controller.abort(reason);
      throw reason;
    }) as unknown as typeof fetch;
    const sdk = createClient();

    await expect(sdk.capacityPools.list({ signal: controller.signal })).rejects.toBe(reason);
    await expect(sdk.close({ signal: controller.signal })).rejects.toBe(reason);
    await expect(createClient().close()).resolves.toBeUndefined();
  });

  test.each(["", "not-json", '{"schemaVersion":"accounts.list.v1"']) (
    "rejects an invalid JSON response: %s",
    async (source) => {
      globalThis.fetch = mock(async () => new Response(source, { status: 200 })) as unknown as typeof fetch;

      await expect(createClient().capacityPools.list()).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        retryable: false,
      });
    },
  );

  test("preserves closed remote errors and discards remote messages", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(
        {
          schemaVersion: "accounts.error.v1",
          error: {
            code: "NOT_FOUND",
            message: "sensitive upstream diagnostic",
            requestId: "request-1",
            retryable: true,
            details: { aggregateKind: "account", field: "providerKey", unsafe: "discarded" },
          },
        },
        404,
      ),
    ) as unknown as typeof fetch;

    await expect(createClient().providerAccounts.get(graph.account.id)).rejects.toEqual(
      expect.objectContaining({
        code: "NOT_FOUND",
        message: "The requested record was not found",
        retryable: true,
        details: { aggregateKind: "account", field: "providerKey" },
      }),
    );
  });

  test.each([
    null,
    { schemaVersion: "accounts.error.v2", error: {} },
    {
      schemaVersion: "accounts.error.v1",
      error: {
        code: "UNKNOWN_CODE",
        message: "unknown",
        requestId: "request-1",
        retryable: false,
        details: {},
      },
    },
  ])("fails closed on a malformed HTTP error envelope", async (body) => {
    globalThis.fetch = mock(async () => jsonResponse(body, 500)) as unknown as typeof fetch;

    await expect(createClient().capacityPools.list()).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: false,
    });
  });

  test.each([
    ["schemaVersion", { schemaVersion: "accounts.list.v2" }],
    ["kind", { kind: "account" }],
    ["records", { records: null }],
    ["nextCursor", { nextCursor: 1 }],
    ["extra", { extra: true }],
  ])("rejects a malformed list envelope field: %s", async (_case, change) => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        schemaVersion: "accounts.list.v1",
        kind: "capacity_pool",
        records: [graph.pool],
        nextCursor: null,
        route: "capacity-pools",
        ...change,
      }),
    ) as unknown as typeof fetch;

    await expect(createClient().capacityPools.list()).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  test("rejects raw provider subject material in an otherwise valid response", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        schemaVersion: "accounts.record.v1",
        kind: "account",
        data: graph.activeAccount,
      }),
    ) as unknown as typeof fetch;

    await expect(createClient().providerAccounts.get(graph.account.id)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "providerSubjectRef" },
    });
  });

  test("rejects malformed bootstrap intents and capacity envelopes", async () => {
    const sdk = createClient();
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (input.toString().includes("bootstrap-intents")) {
        return jsonResponse({
          schemaVersion: "accounts.bootstrap-intent.v1",
          id: "018f0f00-0000-7000-8000-000000000098",
          authCapsuleId: graph.capsule!.id,
          ownerRef: graph.capsule!.ownerRef,
          canonicalNodeId: graph.capsule!.placementRef,
          nodeGeneration: 0,
          placementGeneration: C0,
          authGeneration: C0,
          capsuleRevision: C0,
          status: "accepted",
          createdAt: NOW.toISOString(),
          expiresAt: NOW.toISOString(),
        });
      }
      return jsonResponse({
        schemaVersion: "accounts.capacity-query.v1",
        reservation: "created",
        data: negativeEligibility(),
      });
    }) as unknown as typeof fetch;

    await expect(
      sdk.capsules.getBootstrapIntent(
        graph.capsule!.id,
        "018f0f00-0000-7000-8000-000000000098",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      sdk.capacity.query({
        accessMethodId: graph.method.id,
        operation: "responses.create",
        model: "model.example",
        dataClassification: "internal",
        destinationPolicyClass: "default",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "reservation" },
    });
  });
});
