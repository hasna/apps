import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TodosClient as RootTodosClient } from "../index.js";
import { TodosClient } from "./client.js";

const TODOS_CLIENT_BASELINE_METHOD_LENGTHS = {
  _fetchRaw: 2,
  _buildHeaders: 1,
  _fetchWithRetry: 2,
  _fetch: 2,
  _get: 1,
  _post: 2,
  _patch: 2,
  _delete: 1,
  _sleep: 1,
  getHealth: 0,
  isAlive: 0,
  getStats: 0,
  getReport: 1,
  doctor: 0,
  activity: 1,
  listTasks: 0,
  getTask: 2,
  createTask: 1,
  updateTask: 2,
  deleteTask: 1,
  startTask: 2,
  completeTask: 2,
  failTask: 1,
  logProgress: 4,
  getStatus: 2,
  getActiveWork: 1,
  getTasksChangedSince: 2,
  getStaleTasks: 2,
  getContext: 0,
  exportTasks: 0,
  claimNextTask: 2,
  getTaskHistory: 2,
  getTaskAttachments: 1,
  getTaskProgress: 2,
  subscribeToStream: 0,
  getProjects: 0,
} as const;

describe("public SDK reflection compatibility", () => {
  test("TodosClient keeps the pinned-base prototype names, method names, and arities", () => {
    expect(TodosClient.name).toBe("TodosClient");
    expect(TodosClient.length).toBe(0);
    expect(Object.getOwnPropertyNames(TodosClient.prototype).sort()).toEqual(
      ["constructor", ...Object.keys(TODOS_CLIENT_BASELINE_METHOD_LENGTHS)].sort(),
    );
    for (const [name, length] of Object.entries(TODOS_CLIENT_BASELINE_METHOD_LENGTHS)) {
      const method = Object.getOwnPropertyDescriptor(TodosClient.prototype, name)?.value as Function;
      expect(typeof method).toBe("function");
      expect(method.name).toBe(name);
      expect(method.length).toBe(length);
    }
  });

  test("the root lazy wrapper preserves the class prototype and static factory reflection", () => {
    expect(RootTodosClient.name).toBe(TodosClient.name);
    expect(RootTodosClient.length).toBe(TodosClient.length);
    expect(Object.getOwnPropertyNames(RootTodosClient.prototype).sort()).toEqual(
      Object.getOwnPropertyNames(TodosClient.prototype).sort(),
    );
    const rootFactory = Object.getOwnPropertyDescriptor(RootTodosClient, "fromEnv")?.value as Function;
    const baseFactory = Object.getOwnPropertyDescriptor(TodosClient, "fromEnv")?.value as Function;
    expect(rootFactory.name).toBe(baseFactory.name);
    expect(rootFactory.length).toBe(baseFactory.length);
  });

  test("root wrapper construction preserves prototype, instanceof, subclass, and warm behavior", () => {
    const first = new RootTodosClient();
    const second = new RootTodosClient();
    class DerivedTodosClient extends RootTodosClient {}
    const derived = new DerivedTodosClient();
    const directRuntimeInstance = new TodosClient();

    expect(Object.getPrototypeOf(first)).toBe(RootTodosClient.prototype);
    expect(first.constructor).toBe(RootTodosClient);
    expect(RootTodosClient.prototype.isPrototypeOf(first)).toBe(true);
    expect(first instanceof RootTodosClient).toBe(true);
    expect(second instanceof RootTodosClient).toBe(true);
    expect(first instanceof TodosClient).toBe(true);
    expect(second instanceof TodosClient).toBe(true);
    expect(derived instanceof DerivedTodosClient).toBe(true);
    expect(derived instanceof RootTodosClient).toBe(true);
    expect(derived instanceof TodosClient).toBe(true);
    expect(directRuntimeInstance instanceof RootTodosClient).toBe(true);
    expect(directRuntimeInstance instanceof DerivedTodosClient).toBe(false);
    expect(Object.getPrototypeOf(derived)).toBe(DerivedTodosClient.prototype);
    expect(Object.getOwnPropertyNames(RootTodosClient.prototype).sort()).toEqual(
      Object.getOwnPropertyNames(TodosClient.prototype).sort(),
    );
  });

  test("a cold root-only process bridges canonical SDK instanceof before warm reuse", () => {
    const home = mkdtempSync(join(tmpdir(), "todos-wrapper-cold-"));
    const rootUrl = pathToFileURL(join(import.meta.dir, "../index.ts")).href;
    const sdkUrl = pathToFileURL(join(import.meta.dir, "client.ts")).href;
    const program = `
      const root = await import(${JSON.stringify(rootUrl)});
      if (Object.getPrototypeOf(root.TodosClient.prototype) !== Object.prototype) throw new Error("wrapper was not cold");
      const first = new root.TodosClient();
      const sdk = await import(${JSON.stringify(sdkUrl)});
      const second = new root.TodosClient();
      if (!(first instanceof root.TodosClient) || !(second instanceof root.TodosClient)) throw new Error("wrapper instanceof failed");
      if (!(first instanceof sdk.TodosClient) || !(second instanceof sdk.TodosClient)) throw new Error("SDK instanceof failed");
      if (Object.getPrototypeOf(first) !== root.TodosClient.prototype) throw new Error("wrapper prototype failed");
      if (Object.getOwnPropertyNames(root.TodosClient.prototype).sort().join("\\0") !== Object.getOwnPropertyNames(sdk.TodosClient.prototype).sort().join("\\0")) throw new Error("reflection drift");
      console.log("COLD_WARM_WRAPPER_OK");
    `;
    try {
      const result = Bun.spawnSync([process.execPath, "-e", program], {
        cwd: join(import.meta.dir, "../.."),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          USERPROFILE: home,
          TMPDIR: home,
          HASNA_TODOS_STORAGE_MODE: "local",
          TODOS_STORAGE_MODE: "local",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.exitCode, output).toBe(0);
      expect(output).toContain("COLD_WARM_WRAPPER_OK");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("cold public function and class reflection matches runtime before and after freeze", () => {
    const home = mkdtempSync(join(tmpdir(), "todos-wrapper-frozen-"));
    const rootUrl = pathToFileURL(join(import.meta.dir, "../index.ts")).href;
    const runtimeUrl = pathToFileURL(join(import.meta.dir, "../index.runtime.ts")).href;
    const program = `
      const root = await import(${JSON.stringify(rootUrl)});
      const runtime = await import(${JSON.stringify(runtimeUrl)});
      const expected = Object.keys(runtime).sort();
      const actual = Object.keys(root).sort();
      if (actual.join("\\0") !== expected.join("\\0")) {
        throw new Error("root export drift: " + JSON.stringify({
          missing: expected.filter((name) => !actual.includes(name)),
          extra: actual.filter((name) => !expected.includes(name)),
        }));
      }
      const compareReflection = () => {
        for (const name of expected) {
          if (typeof runtime[name] !== "function") continue;
          if (typeof root[name] !== "function") throw new Error(name + " is not a function");
          if (root[name].name !== runtime[name].name) {
            throw new Error(name + " function name drift: " + root[name].name + " != " + runtime[name].name);
          }
          if (root[name].length !== runtime[name].length) {
            throw new Error(name + " function length drift");
          }
        }
      };
      compareReflection();
      for (const name of expected) {
        const value = root[name];
        if (typeof value !== "function") continue;
        if (value.prototype && typeof value.prototype === "object") Object.freeze(value.prototype);
        Object.freeze(value);
      }
      compareReflection();
      const client = new root.TodosClient();
      if (!(client instanceof root.TodosClient)) throw new Error("frozen cold constructor lost instanceof");
      console.log("FROZEN_REFLECTION_OK");
    `;
    try {
      const result = Bun.spawnSync([process.execPath, "-e", program], {
        cwd: join(import.meta.dir, "../.."),
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          USERPROFILE: home,
          TMPDIR: home,
          HASNA_TODOS_STORAGE_MODE: "local",
          TODOS_STORAGE_MODE: "local",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.exitCode, output).toBe(0);
      expect(output).toContain("FROZEN_REFLECTION_OK");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.each(["preventExtensions", "seal", "freeze"] as const)(
    "cold Object.%s on a public class prototype remains compatible with first construction",
    (operation) => {
      const home = mkdtempSync(join(tmpdir(), `todos-wrapper-${operation}-`));
      const rootUrl = pathToFileURL(join(import.meta.dir, "../index.ts")).href;
      const program = `
        const root = await import(${JSON.stringify(rootUrl)});
        Object[${JSON.stringify(operation)}](root.TodosClient.prototype);
        const client = new root.TodosClient();
        if (!(client instanceof root.TodosClient)) throw new Error("wrapper instanceof failed");
        console.log("COLD_PROTOTYPE_OK");
      `;
      try {
        const result = Bun.spawnSync([process.execPath, "-e", program], {
          cwd: join(import.meta.dir, "../.."),
          env: {
            PATH: process.env.PATH ?? "",
            HOME: home,
            USERPROFILE: home,
            TMPDIR: home,
            HASNA_TODOS_STORAGE_MODE: "local",
            TODOS_STORAGE_MODE: "local",
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("COLD_PROTOTYPE_OK");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
