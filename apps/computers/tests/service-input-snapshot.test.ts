import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  ComputersError,
  type AuthorizationContext,
  type CreateComputerGrantInput,
  type CreateComputerInput,
  type CreateComputerProfileInput,
  type ExecRequest,
  type PackageSpec,
} from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage, sha256 } from "../src/storage";

const admin: AuthorizationContext = {
  tenantId: "tenant_service_snapshot",
  principalId: "principal_service_snapshot_admin",
  scopes: ["computers:admin"],
  authMethod: "loopback_dev",
};

function captureFailure(callback: () => unknown): ComputersError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ComputersError);
    return error as ComputersError;
  }
  throw new Error("Expected ComputersError");
}

function validPackageSpec(): PackageSpec {
  return {
    manager: "bun",
    name: "snapshot-package",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    registry: "https://registry.example.invalid/",
    dependencyClosure: [{ name: "snapshot-dependency", version: "1.0.0", digest: `sha256:${"b".repeat(64)}` }],
    allowLifecycleScripts: false,
  };
}

describe("service request input snapshots", () => {
  let storage: SQLiteStorage;
  let service: ComputersService;

  beforeEach(() => {
    storage = new SQLiteStorage(":memory:");
    storage.migrate();
    service = new ComputersService(storage, {
      ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)),
    });
  });

  afterEach(() => storage.close());

  test("create rejects accessors without execution and hashes the same accepted plain snapshot it persists", () => {
    let reads = 0;
    const hostile = {
      slug: "snapshot-accessor",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_owner",
      idempotencyKey: "snapshot-accessor-create",
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "storageGiB", {
      enumerable: true,
      get() {
        reads += 1;
        return reads < 3 ? 32 : 999;
      },
    });

    const failure = captureFailure(() => service.createComputer(admin, hostile as unknown as CreateComputerInput));
    expect({ code: failure.code, status: failure.status, reason: failure.details?.reason }).toEqual({
      code: "invalid_request",
      status: 400,
      reason: "accessors are not allowed",
    });
    expect(reads).toBe(0);
    expect(storage.listComputers(admin.tenantId)).toEqual([]);
    expect(storage.listOperations(admin.tenantId)).toEqual([]);

    const accepted: CreateComputerInput = {
      slug: "snapshot-plain",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_owner",
      storageGiB: 32,
      idempotencyKey: "snapshot-plain-create",
    };
    const created = service.createComputer(admin, accepted);
    const replay = service.createComputer(admin, { ...accepted });
    expect(replay.id).toBe(created.id);
    const operation = storage.listOperations(admin.tenantId, created.id)[0];
    expect(operation?.request.storageGiB).toBe(32);
    const row = storage.database.query(
      "SELECT request_hash FROM idempotency_keys WHERE tenant_id = ? AND namespace = 'computer:create' AND idempotency_key = ?",
    ).get(admin.tenantId, accepted.idempotencyKey) as { request_hash: string };
    expect(row.request_hash).toBe(sha256({ ...accepted, id: null }));
  });

  test("adoption and profile inputs reject root proxies and nested document accessors without execution", () => {
    let proxyTraps = 0;
    const adoption = new Proxy({
      slug: "snapshot-adoption",
      ownerPrincipalId: "principal_snapshot_adoption",
      adoptionId: "adoption_snapshot_host",
      idempotencyKey: "snapshot-adoption-create",
    }, {
      ownKeys(target) {
        proxyTraps += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        proxyTraps += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(captureFailure(() => service.adoptComputer(admin, adoption)).details?.reason).toBe("proxies are not allowed");
    expect(proxyTraps).toBe(0);

    let documentReads = 0;
    const document = {
      provider: "local_vm",
      memoryGiB: 4,
      rootDiskGiB: 16,
      homeDiskGiB: 32,
      imageLocation: "https://images.example.invalid/snapshot.qcow2",
      imageDigest: `sha256:${"c".repeat(64)}`,
    } as Record<string, unknown>;
    Object.defineProperty(document, "cpus", {
      enumerable: true,
      get() {
        documentReads += 1;
        return 2;
      },
    });
    const profileInput = { id: "profile_snapshot_hostile", name: "Snapshot hostile", document };
    expect(captureFailure(() => service.createProfile(admin, profileInput as unknown as CreateComputerProfileInput)).details?.reason)
      .toBe("accessors are not allowed");
    expect(documentReads).toBe(0);
    expect(storage.listProfiles(admin.tenantId)).toEqual([]);
  });

  test("grant and exec inputs reject nested executable values before authorization, persistence, or audit", () => {
    const parent = service.createComputer(admin, {
      slug: "snapshot-parent",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_parent",
      idempotencyKey: "snapshot-parent-create",
    });
    let grantTraps = 0;
    const allowedProviders = new Proxy(["local_machine"], {
      get(target, property, receiver) {
        grantTraps += 1;
        return Reflect.get(target, property, receiver);
      },
      ownKeys(target) {
        grantTraps += 1;
        return Reflect.ownKeys(target);
      },
    });
    const grantInput = {
      principalId: parent.ownerPrincipalId,
      ownerPrincipalId: parent.ownerPrincipalId,
      parentComputerId: parent.id,
      allowedProviders,
      allowedChildOwnerPrincipalIds: ["principal_snapshot_child"],
      allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"],
      maxStorageGiB: 32,
      maxUptimeSeconds: 3600,
      maxBudgetMicros: 0,
      limit: 1,
    };
    expect(captureFailure(() => service.createComputerGrant(admin, grantInput as unknown as CreateComputerGrantInput)).details?.reason)
      .toBe("proxies are not allowed");
    expect(grantTraps).toBe(0);
    expect(storage.listComputerGrants(admin.tenantId)).toEqual([]);

    let argvReads = 0;
    const argv = ["id"];
    Object.defineProperty(argv, "0", {
      enumerable: true,
      configurable: true,
      get() {
        argvReads += 1;
        return "id";
      },
    });
    const operationCount = storage.listOperations(admin.tenantId).length;
    expect(captureFailure(() => service.requestExec(admin, parent.id, {
      argv,
      idempotencyKey: "snapshot-exec-accessor",
    })).details?.reason).toBe("accessors are not allowed");
    expect(argvReads).toBe(0);
    expect(storage.listOperations(admin.tenantId)).toHaveLength(operationCount);
  });

  test("package and policy inputs reject nested proxies without trap execution", () => {
    const computer = service.createComputer(admin, {
      slug: "snapshot-policy",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_policy",
      idempotencyKey: "snapshot-policy-create",
    });
    let packageTraps = 0;
    const spec = validPackageSpec();
    spec.dependencyClosure[0] = new Proxy(spec.dependencyClosure[0]!, {
      ownKeys(target) {
        packageTraps += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        packageTraps += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(captureFailure(() => service.installPlan(admin, computer.id, spec)).details?.reason).toBe("proxies are not allowed");
    expect(packageTraps).toBe(0);

    let policyTraps = 0;
    const rule = new Proxy({ effect: "deny" as const }, {
      ownKeys(target) {
        policyTraps += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        policyTraps += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(captureFailure(() => service.createInstallPolicy(admin, computer.id, [rule])).details?.reason).toBe("proxies are not allowed");
    expect(policyTraps).toBe(0);
    expect(storage.getInstallPolicy(admin.tenantId, computer.id, 2)).toBeUndefined();
  });

  test("canonical prototype pollution is rejected without invoking inherited getters", () => {
    const computer = service.createComputer(admin, {
      slug: "snapshot-prototype",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_prototype",
      idempotencyKey: "snapshot-prototype-create",
    });
    let objectGetterReads = 0;
    let objectFailure: ComputersError;
    Object.defineProperty(Object.prototype, "snapshotInheritedObject", {
      configurable: true,
      enumerable: true,
      get() {
        objectGetterReads += 1;
        return "poisoned";
      },
    });
    try {
      objectFailure = captureFailure(() => service.requestExec(admin, computer.id, {
        argv: ["id"], idempotencyKey: "snapshot-prototype-object",
      }));
    } finally {
      delete (Object.prototype as Record<string, unknown>).snapshotInheritedObject;
    }
    expect(objectFailure.details?.reason).toBe("inherited enumerable properties are not allowed");
    expect(objectGetterReads).toBe(0);

    let arrayGetterReads = 0;
    let arrayFailure: ComputersError;
    Object.defineProperty(Array.prototype, "snapshotInheritedArray", {
      configurable: true,
      enumerable: true,
      get() {
        arrayGetterReads += 1;
        return "poisoned";
      },
    });
    try {
      const nullPrototypeInput = Object.assign(Object.create(null) as Record<string, unknown>, {
        argv: ["id"], idempotencyKey: "snapshot-prototype-array",
      });
      arrayFailure = captureFailure(() => service.requestExec(admin, computer.id, nullPrototypeInput as unknown as ExecRequest));
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>).snapshotInheritedArray;
    }
    expect(arrayFailure.details?.reason).toBe("inherited enumerable properties are not allowed");
    expect(arrayGetterReads).toBe(0);

    let inheritedIndexSetterCalls = 0;
    let acceptedWithInheritedIndexSetter = false;
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: false,
      set() {
        inheritedIndexSetterCalls += 1;
      },
    });
    try {
      const nullPrototypeInput = Object.assign(Object.create(null) as Record<string, unknown>, {
        argv: ["id"], idempotencyKey: "snapshot-prototype-array-index",
      });
      service.requestExec(admin, computer.id, nullPrototypeInput as unknown as ExecRequest);
      acceptedWithInheritedIndexSetter = true;
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    }
    expect(acceptedWithInheritedIndexSetter).toBe(true);
    expect(inheritedIndexSetterCalls).toBe(0);

    let inheritedDescriptorValueReads = 0;
    let inputAccessorReads = 0;
    let accessorFailure: ComputersError;
    const accessorInput = {
      argv: ["id"], idempotencyKey: "snapshot-prototype-descriptor-value",
    } as Record<string, unknown>;
    Object.defineProperty(accessorInput, "cwd", {
      configurable: true,
      enumerable: true,
      get() {
        inputAccessorReads += 1;
        return "/home/agent";
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      enumerable: false,
      get() {
        inheritedDescriptorValueReads += 1;
        return "/poisoned";
      },
    });
    try {
      accessorFailure = captureFailure(() => service.requestExec(admin, computer.id, accessorInput as unknown as ExecRequest));
    } finally {
      delete (Object.prototype as Record<string, unknown>).value;
    }
    expect(accessorFailure.details?.reason).toBe("accessors are not allowed");
    expect(inputAccessorReads).toBe(0);
    expect(inheritedDescriptorValueReads).toBe(0);

    const disguisedSparseArgv = new Array<string>(1);
    Object.defineProperty(disguisedSparseArgv, "extra", { configurable: true, enumerable: true, value: "ignored" });
    let inheritedNumericDescriptorReads = 0;
    let sparseFailure: ComputersError | undefined;
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      enumerable: false,
      get() {
        inheritedNumericDescriptorReads += 1;
        return { enumerable: true, value: "id" };
      },
    });
    try {
      try {
        service.requestExec(admin, computer.id, {
          argv: disguisedSparseArgv,
          idempotencyKey: "snapshot-prototype-numeric-descriptor",
        });
      } catch (error) {
        sparseFailure = error as ComputersError;
      }
    } finally {
      delete (Object.prototype as Record<string, unknown>)["0"];
    }
    expect(sparseFailure).toBeInstanceOf(ComputersError);
    expect(sparseFailure?.details?.reason).toBe("sparse arrays are not allowed");
    expect(inheritedNumericDescriptorReads).toBe(0);
  });

  test("snapshot boundary rejects non-JSON shapes, cycles, sparse arrays, excessive depth, and excessive size", () => {
    const computer = service.createComputer(admin, {
      slug: "snapshot-shapes",
      provider: "local_machine",
      ownerPrincipalId: "principal_snapshot_shapes",
      idempotencyKey: "snapshot-shapes-create",
    });
    const base = (): Record<string, unknown> => ({ argv: ["id"], idempotencyKey: "snapshot-shape-exec" });
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(inherited, base());
    const symbolKey = base();
    symbolKey[Symbol("hidden") as unknown as string] = true;
    const nonEnumerable = base();
    Object.defineProperty(nonEnumerable, "cwd", { enumerable: false, value: "/home/agent" });
    const cyclicNames: unknown[] = [];
    cyclicNames.push(cyclicNames);
    const sparseArgv = new Array<string>(1);
    const deep: unknown[] = [];
    let cursor = deep;
    for (let index = 0; index < 40; index += 1) {
      const next: unknown[] = [];
      cursor.push(next);
      cursor = next;
    }
    const cases: Array<{ name: string; value: Record<string, unknown>; reason: string; code?: string }> = [
      { name: "custom prototype", value: inherited, reason: "custom prototypes are not allowed" },
      { name: "symbol key", value: symbolKey, reason: "symbol properties are not allowed" },
      { name: "non-enumerable", value: nonEnumerable, reason: "non-enumerable properties are not allowed" },
      { name: "undefined", value: { ...base(), cwd: undefined }, reason: "undefined is not JSON-safe" },
      { name: "function", value: { ...base(), cwd: () => "/home/agent" }, reason: "functions are not JSON-safe" },
      { name: "bigint", value: { ...base(), timeoutSeconds: 1n }, reason: "bigints are not JSON-safe" },
      { name: "nonfinite", value: { ...base(), timeoutSeconds: Number.POSITIVE_INFINITY }, reason: "non-finite numbers are not JSON-safe" },
      { name: "cycle", value: { ...base(), envNames: cyclicNames }, reason: "cycles are not allowed" },
      { name: "sparse array", value: { ...base(), argv: sparseArgv }, reason: "sparse arrays are not allowed" },
      { name: "excessive depth", value: { ...base(), envNames: deep }, reason: "input nesting is too deep" },
      { name: "excessive size", value: { ...base(), cwd: `/${"x".repeat(1024 * 1024 + 1)}` }, reason: "input is too large", code: "request_too_large" },
      { name: "excessive escaped JSON size", value: { ...base(), cwd: `/${"\0".repeat(175_000)}` }, reason: "input is too large", code: "request_too_large" },
    ];
    for (const item of cases) {
      const failure = captureFailure(() => service.requestExec(admin, computer.id, item.value as unknown as ExecRequest));
      expect(failure.details?.reason, item.name).toBe(item.reason);
      expect(failure.code, item.name).toBe(item.code ?? "invalid_request");
    }
  });
});
