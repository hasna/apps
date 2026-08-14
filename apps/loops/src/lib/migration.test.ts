import { describe, expect, test } from "bun:test";
import type { AgentTarget } from "../types.js";
import { ValidationError } from "./errors.js";
import {
  buildImportMigrationPlan,
  buildSelfHostedMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  validateLoopsMigrationBundle,
} from "./migration.js";
import { Store } from "./store.js";

describe("migration agent target validation", () => {
  test("rejects a rehashed legacy bundle with unmanaged agent extraArgs", () => {
    const store = new Store(":memory:");
    try {
      store.createLoop({
        name: "migration-agent",
        schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
        target: { type: "agent", provider: "codewith", prompt: "do not execute" },
      });
      const bundle = exportLoopsMigrationBundle(store, { includeRuns: false });
      const target = bundle.data.loops[0]!.target as AgentTarget;
      target.extraArgs = ["--durable", "true"];
      const { hash: _hash, ...body } = bundle;
      bundle.hash = migrationHash(body);

      expect(() => validateLoopsMigrationBundle(bundle)).toThrow(ValidationError);
      const destination = new Store(":memory:");
      try {
        expect(() => buildImportMigrationPlan(destination, bundle)).toThrow(ValidationError);
      } finally {
        destination.close();
      }
    } finally {
      store.close();
    }
  });
});

describe("self-hosted control-plane request bounds", () => {
  test("preview fails fast with a timeout instead of hanging when the control plane never responds", async () => {
    const store = new Store(":memory:");
    try {
      // Mimics a real fetch against an unreachable/slow host: never resolves on
      // its own, only rejects once its (combined) abort signal fires.
      const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })) as typeof fetch;

      const start = Date.now();
      await expect(
        buildSelfHostedMigrationPlan(store, {
          operation: "self-hosted-migrate",
          apiUrl: "https://loops.example.test",
          apiKey: "test-token",
          timeoutMs: 100,
          fetchImpl: hangingFetch,
        }),
      ).rejects.toThrow(/timed out/i);
      // Without the bounded timeout this promise never settles; the assertion
      // that it settles quickly is the regression guard.
      expect(Date.now() - start).toBeLessThan(4000);
    } finally {
      store.close();
    }
  });

  test("preview compares runs by count and never enumerates run bodies", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "run-heavy-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
        target: { type: "command", command: "true" },
      });
      for (let i = 0; i < 5; i += 1) {
        store.createSkippedRun(loop, `2026-01-0${i + 1}T00:00:00.000Z`, "skip");
      }
      expect(store.countRuns()).toBe(5);

      const requestedPaths: string[] = [];
      const fetchImpl = ((input: RequestInfo | URL) => {
        const url = String(input);
        requestedPaths.push(url);
        // Full run enumeration (`/v1/runs` without `/count`) must never be
        // requested by a preview — that eager fetch is the original hang.
        if (/\/v1\/runs(?!\/count)/.test(url)) {
          throw new Error(`preview must not enumerate run bodies: ${url}`);
        }
        if (url.includes("/count")) return Promise.resolve(Response.json({ ok: true, count: 3 }));
        return Promise.resolve(Response.json({ ok: true, workflows: [], loops: [] }));
      }) as typeof fetch;

      const plan = await buildSelfHostedMigrationPlan(store, {
        operation: "self-hosted-migrate",
        apiUrl: "https://loops.example.test",
        apiKey: "test-token",
        fetchImpl,
      });

      // No per-run rows in the preview; run history is a count-based warning.
      expect(plan.rows.some((row) => row.resource === "run")).toBe(false);
      expect(plan.warnings.join(" ")).toContain("run history is compared by count");
      expect(plan.warnings.join(" ")).toContain("local=5");
      expect(plan.warnings.join(" ")).toContain("remote=3");
      expect(requestedPaths.some((url) => url.includes("/v1/runs/count"))).toBe(true);
    } finally {
      store.close();
    }
  });
});
