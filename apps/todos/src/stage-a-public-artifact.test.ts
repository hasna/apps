import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..");

function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeout = 30_000,
) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
}

describe("source-free Stage A public artifact", () => {
  test("every exported subpath executes and shares one SQLite provenance owner", () => {
    const packageRoot = mkdtempSync(join(REPO_ROOT, ".tmp-todos-public-artifact-"));
    const home = mkdtempSync(join(tmpdir(), "todos-public-artifact-home-"));
    try {
      const build = run(process.execPath, ["run", "build:server"], REPO_ROOT, {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: home,
        NODE_ENV: "production",
      }, 120_000);
      expect(build.status, build.stderr || build.stdout).toBe(0);

      cpSync(join(REPO_ROOT, "dist"), join(packageRoot, "dist"), { recursive: true });
      cpSync(join(REPO_ROOT, "package.json"), join(packageRoot, "package.json"));
      expect(existsSync(join(packageRoot, "src"))).toBe(false);

      const probe = join(packageRoot, "probe.mjs");
      writeFileSync(probe, `
        import { Database } from "bun:sqlite";
        const root = await import("./dist/index.js");
        const sdk = await import("./dist/sdk/index.js");
        const mcp = await import("./dist/mcp.js");
        const registry = await import("./dist/registry.js");
        const contracts = await import("./dist/contracts.js");
        const storage = await import("./dist/storage.js");

        const client = new root.TodosClient();
        const sdkClient = new sdk.TodosClient();
        const contractManifest = contracts.createContractsManifest({
          version: "0.0.0",
          generatedAt: "1970-01-01T00:00:00.000Z",
        });
        const registryManifest = registry.createTodosRegistry({
          version: "0.0.0",
          generatedAt: "1970-01-01T00:00:00.000Z",
        });
        const mcpManifest = mcp.createMcpManifest({
          version: "0.0.0",
          generatedAt: "1970-01-01T00:00:00.000Z",
        });
        const objectKey = storage.buildS3ObjectKey({ prefix: "stage-a/" }, "artifact.txt");

        const owned = root.getDatabase();
        const task = root.createTask({ title: "source-free provenance" }, owned);
        const report = contracts.createLocalReport({}, owned);
        const adapter = storage.createLocalSqliteTodosStorageAdapter({ db: owned });
        const storageTask = adapter.tasks.get(task.id);
        let untrustedCode = "";
        const untrusted = new Database(":memory:");
        try {
          contracts.createLocalReport({}, untrusted);
        } catch (error) {
          untrustedCode = error?.code ?? "";
        } finally {
          untrusted.close();
        }

        const errorArguments = (name, ErrorClass) => {
          if (name === "PostgresScopedSlugMigrationConflictError") return [[]];
          if (name === "PostgresScopedSlugIndexBuildError") return ["synthetic", new Error("synthetic")];
          return Array.from({ length: ErrorClass.length }, () => "synthetic");
        };
        const errorNames = Object.entries({ root, storage })
          .flatMap(([surface, namespace]) => Object.entries(namespace)
            .filter(([name, value]) => name.endsWith("Error") && typeof value === "function")
            .map(([name, ErrorClass]) => {
              const instance = Reflect.construct(ErrorClass, errorArguments(name, ErrorClass));
              if (!(instance instanceof Error)) throw new Error(surface + "." + name + " lost Error inheritance");
              if (!(instance instanceof ErrorClass)) throw new Error(surface + "." + name + " lost wrapper instanceof behavior");
              return surface + "." + name;
            }))
          .sort();

        const alternatePrototype = { inheritedMarker: true };
        const lazyPrototypeChecks = [
          ["object", root.AGENT_ADAPTER_DOCS, Object.freeze],
          ["array", root.ACCESS_PROFILES, Object.seal],
          ["set", root.CORE_MCP_TOOLS, Object.preventExtensions],
        ].map(([kind, lazy, integrity]) => {
          const originalPrototype = Object.getPrototypeOf(lazy);
          const prototypeRejectedBeforeIntegrity = Reflect.setPrototypeOf(lazy, alternatePrototype) === false;
          const prototypeUnchangedBeforeIntegrity = Object.getPrototypeOf(lazy) === originalPrototype;
          integrity(lazy);
          const prototypeRejectedAfterIntegrity = Reflect.setPrototypeOf(lazy, alternatePrototype) === false;
          const prototypeUnchangedAfterIntegrity = Object.getPrototypeOf(lazy) === originalPrototype;
          return {
            kind,
            prototypeRejectedBeforeIntegrity,
            prototypeUnchangedBeforeIntegrity,
            prototypeRejectedAfterIntegrity,
            prototypeUnchangedAfterIntegrity,
            inheritedMarkerVisible: "inheritedMarker" in lazy || lazy.inheritedMarker === true,
          };
        });

        const lazySamples = [
          ["root-array", root.ACCESS_PROFILES, Array, "includes", root.ACCESS_PROFILES[0]],
          ["root-set", root.CORE_MCP_TOOLS, Set, "has", root.CORE_MCP_TOOLS.values().next().value],
          ["root-object", root.AGENT_ADAPTER_DOCS, Object, "hasOwnProperty", Object.keys(root.AGENT_ADAPTER_DOCS)[0]],
          ["contracts-array", contracts.LOCAL_REPORT_TYPES, Array, "includes", contracts.LOCAL_REPORT_TYPES[0]],
          ["contracts-object", contracts.TODOS_CONTRACTS, Object, "hasOwnProperty", Object.keys(contracts.TODOS_CONTRACTS)[0]],
          ["storage-array", storage.STORAGE_TABLES, Array, "includes", storage.STORAGE_TABLES[0]],
          ["storage-object", storage.TODOS_STORAGE_ENV, Object, "hasOwnProperty", Object.keys(storage.TODOS_STORAGE_ENV)[0]],
        ].map(([label, value, ExpectedConstructor, methodName, argument]) => {
          const firstMethod = value[methodName];
          const secondMethod = value[methodName];
          return {
            label,
            value,
            methodName,
            argument,
            savedMethod: firstMethod,
            constructorMatches: value.constructor === ExpectedConstructor,
            methodIdentityStable: firstMethod === secondMethod,
            valueOfIdentity: value.valueOf() === value,
          };
        });
        const arrayFluentLeaks = [
          ["root-array", root.ACCESS_PROFILES, root.ACCESS_PROFILES.sort(), root.ACCESS_PROFILES[0]],
          ["contracts-array", contracts.LOCAL_REPORT_TYPES, contracts.LOCAL_REPORT_TYPES.sort(), contracts.LOCAL_REPORT_TYPES[0]],
          ["storage-array", storage.STORAGE_TABLES, storage.STORAGE_TABLES.sort(), storage.STORAGE_TABLES[0]],
        ];
        const firstCoreTool = root.CORE_MCP_TOOLS.values().next().value;
        const setFluentLeak = root.CORE_MCP_TOOLS.add(firstCoreTool);
        const savedIterators = [
          ["root-array", root.ACCESS_PROFILES.values()],
          ["root-set", root.CORE_MCP_TOOLS.values()],
          ["contracts-array", contracts.LOCAL_REPORT_TYPES.entries()],
          ["storage-array", storage.STORAGE_TABLES[Symbol.iterator]()],
        ];
        const callbackReceivers = [];
        root.ACCESS_PROFILES.some((_value, _index, receiver) => {
          callbackReceivers.push(["root-array", receiver, root.ACCESS_PROFILES]);
          return true;
        });
        root.CORE_MCP_TOOLS.forEach((_value, _sameValue, receiver) => {
          if (!callbackReceivers.some(([label]) => label === "root-set")) {
            callbackReceivers.push(["root-set", receiver, root.CORE_MCP_TOOLS]);
          }
        });
        contracts.LOCAL_REPORT_TYPES.some((_value, _index, receiver) => {
          callbackReceivers.push(["contracts-array", receiver, contracts.LOCAL_REPORT_TYPES]);
          return true;
        });
        storage.STORAGE_TABLES.every((_value, _index, receiver) => {
          callbackReceivers.push(["storage-array", receiver, storage.STORAGE_TABLES]);
          return false;
        });
        const objectFluentLeaks = lazySamples
          .filter((sample) => sample.label.endsWith("object"))
          .map((sample) => ({
            label: sample.label,
            argument: sample.argument,
            leakedValue: sample.value.valueOf(),
          }));

        root.closeDatabase();
        process.env.HASNA_TODOS_STORAGE_MODE = "remote";
        process.env.TODOS_STORAGE_MODE = "remote";
        const authorityDenied = (operation) => {
          try {
            operation();
            return false;
          } catch (error) {
            return String(error?.code ?? error?.message ?? error).includes("HOSTED_AUTHORITY_UNAVAILABLE");
          }
        };
        const savedOperationDenials = lazySamples.map((sample) => ({
          label: sample.label,
          denied: authorityDenied(() => Reflect.apply(sample.savedMethod, sample.value, [sample.argument])),
        }));
        const savedIteratorDenials = savedIterators.map(([label, iterator]) => ({
          label,
          denied: authorityDenied(() => iterator.next()),
        }));
        const callbackReceiverDenials = callbackReceivers.map(([label, receiver]) => ({
          label,
          denied: authorityDenied(() => receiver.valueOf()),
        }));
        const leakedOperationDenials = [
          ...arrayFluentLeaks.map(([label, _publicValue, leakedValue, argument]) => ({
            label,
            denied: authorityDenied(() => leakedValue.includes(argument)),
          })),
          {
            label: "root-set",
            denied: authorityDenied(() => setFluentLeak.has(firstCoreTool)),
          },
          ...objectFluentLeaks.map((sample) => ({
            label: sample.label,
            denied: authorityDenied(() => sample.leakedValue.hasOwnProperty(sample.argument)),
          })),
        ];
        console.log(JSON.stringify({
          clients: [client.constructor.name, sdkClient.constructor.name],
          contractVersion: contractManifest.package.version,
          registryVersion: registryManifest.package.version,
          mcpVersion: mcpManifest.package.version,
          objectKey,
          taskTitle: task.title,
          storageTaskTitle: storageTask?.title,
          reportSchemaVersion: report.schema_version,
          untrustedCode,
          errorNames,
          lazyPrototypeChecks,
          lazyReflectionChecks: lazySamples.map((sample) => ({
            label: sample.label,
            constructorMatches: sample.constructorMatches,
            methodIdentityStable: sample.methodIdentityStable,
            valueOfIdentity: sample.valueOfIdentity,
          })),
          lazyFluentIdentity: [
            ...arrayFluentLeaks.map(([label, publicValue, leakedValue]) => ({ label, matches: leakedValue === publicValue })),
            { label: "root-set", matches: setFluentLeak === root.CORE_MCP_TOOLS },
          ],
          savedOperationDenials,
          savedIteratorDenials,
          callbackReceiverIdentity: callbackReceivers.map(([label, receiver, publicValue]) => ({
            label,
            matches: receiver === publicValue,
          })),
          callbackReceiverDenials,
          leakedOperationDenials,
        }));
      `);

      const env = {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: home,
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "local",
        HASNA_TODOS_DB_PATH: join(home, "todos.db"),
        TODOS_DB_PATH: join(home, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
      };
      const result = run(process.execPath, [probe], packageRoot, env);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload).toMatchObject({
        clients: ["TodosClient", "TodosClient"],
        contractVersion: "0.0.0",
        registryVersion: "0.0.0",
        mcpVersion: "0.0.0",
        objectKey: "stage-a/artifact.txt",
        taskTitle: "source-free provenance",
        storageTaskTitle: "source-free provenance",
        untrustedCode: "UNTRUSTED_SQLITE_PROVENANCE",
      });
      expect(payload.reportSchemaVersion).toBeTruthy();
      expect((payload.errorNames as string[]).length).toBeGreaterThanOrEqual(13);
      expect(payload.lazyPrototypeChecks).toEqual([
        {
          kind: "object",
          prototypeRejectedBeforeIntegrity: true,
          prototypeUnchangedBeforeIntegrity: true,
          prototypeRejectedAfterIntegrity: true,
          prototypeUnchangedAfterIntegrity: true,
          inheritedMarkerVisible: false,
        },
        {
          kind: "array",
          prototypeRejectedBeforeIntegrity: true,
          prototypeUnchangedBeforeIntegrity: true,
          prototypeRejectedAfterIntegrity: true,
          prototypeUnchangedAfterIntegrity: true,
          inheritedMarkerVisible: false,
        },
        {
          kind: "set",
          prototypeRejectedBeforeIntegrity: true,
          prototypeUnchangedBeforeIntegrity: true,
          prototypeRejectedAfterIntegrity: true,
          prototypeUnchangedAfterIntegrity: true,
          inheritedMarkerVisible: false,
        },
      ]);
      expect(payload.lazyReflectionChecks).toEqual([
        "root-array",
        "root-set",
        "root-object",
        "contracts-array",
        "contracts-object",
        "storage-array",
        "storage-object",
      ].map((label) => ({
        label,
        constructorMatches: true,
        methodIdentityStable: true,
        valueOfIdentity: true,
      })));
      expect(payload.lazyFluentIdentity).toEqual([
        { label: "root-array", matches: true },
        { label: "contracts-array", matches: true },
        { label: "storage-array", matches: true },
        { label: "root-set", matches: true },
      ]);
      expect(payload.savedOperationDenials).toEqual([
        "root-array",
        "root-set",
        "root-object",
        "contracts-array",
        "contracts-object",
        "storage-array",
        "storage-object",
      ].map((label) => ({ label, denied: true })));
      expect(payload.savedIteratorDenials).toEqual([
        "root-array",
        "root-set",
        "contracts-array",
        "storage-array",
      ].map((label) => ({ label, denied: true })));
      expect(payload.callbackReceiverIdentity).toEqual([
        "root-array",
        "root-set",
        "contracts-array",
        "storage-array",
      ].map((label) => ({ label, matches: true })));
      expect(payload.callbackReceiverDenials).toEqual([
        "root-array",
        "root-set",
        "contracts-array",
        "storage-array",
      ].map((label) => ({ label, denied: true })));
      expect(payload.leakedOperationDenials).toEqual([
        "root-array",
        "contracts-array",
        "storage-array",
        "root-set",
        "root-object",
        "contracts-object",
        "storage-object",
      ].map((label) => ({ label, denied: true })));

      const cliMcp = run(process.execPath, [join(packageRoot, "dist/cli/index.js"), "mcp"], packageRoot, env, 5_000);
      expect(cliMcp.signal, cliMcp.stderr || cliMcp.stdout).toBeNull();
      expect(cliMcp.status, cliMcp.stderr || cliMcp.stdout).toBe(0);
      expect(cliMcp.stderr).not.toContain("Cannot find module");

      const directMcp = run(process.execPath, ["-e", `
        const entry = await import(${JSON.stringify(`file://${packageRoot}/dist/mcp/index.js`)});
        const server = entry.buildServer();
        if (!server) throw new Error("missing MCP server");
      `], packageRoot, env, 5_000);
      expect(directMcp.signal, directMcp.stderr || directMcp.stdout).toBeNull();
      expect(directMcp.status, directMcp.stderr || directMcp.stdout).toBe(0);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);
});
