/**
 * Test gap coverage for src/server/request.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The HTTP body/field validation helpers had no direct sibling test (the
 * server suite exercises them through routes, incidentally). These tests pin
 * each validator's contract directly: content-type/limit/parse failures with
 * their exact status codes, allowed-key rejection, and the per-field
 * validators' boundary behavior.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  optionalEnum,
  optionalNumber,
  optionalObject,
  optionalString,
  optionalStringArray,
  readJsonObject,
  readPositiveInt,
  requiredEnum,
  requiredString,
  type ValidationResult,
} from "./request.ts";

/** Minimal Hono harness that runs readJsonObject and echoes the verdict. */
function jsonReader(opts: Parameters<typeof readJsonObject>[1] = {}) {
  const app = new Hono();
  app.post("/read", async (c) => c.json(await readJsonObject(c, opts)));
  return app;
}

const ENV_KEYS = ["HASNA_LOGS_MAX_PAYLOAD_BYTES", "LOGS_MAX_PAYLOAD_BYTES"];
const ORIGINAL = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("readJsonObject", () => {
  it("rejects a non-JSON content type with 415", async () => {
    const res = await jsonReader().request("/read", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const verdict = (await res.json()) as ValidationResult<unknown>;
    expect(verdict).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects a content-length above the limit with 413 before reading", async () => {
    const res = await jsonReader().request("/read", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "999999999" },
      body: "{}",
    });
    const verdict = (await res.json()) as ValidationResult<unknown>;
    expect(verdict).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects an actual payload above the limit with 413", async () => {
    const res = await jsonReader().request("/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ big: "x".repeat(1_200_000) }),
    });
    const verdict = (await res.json()) as ValidationResult<unknown>;
    expect(verdict).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await jsonReader().request("/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const verdict = (await res.json()) as ValidationResult<unknown>;
    expect(verdict).toMatchObject({ ok: false, status: 400, message: "Invalid JSON body" });
  });

  it("rejects a non-object JSON body with 422", async () => {
    for (const body of ["[]", '"string"', "42", "null"]) {
      const res = await jsonReader().request("/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const verdict = (await res.json()) as ValidationResult<unknown>;
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.status).toBe(422);
    }
  });

  it("rejects unknown keys against an allowlist with 422, naming the key", async () => {
    const res = await jsonReader({ allowedKeys: ["level", "message"] }).request(
      "/read",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "info", message: "ok", extra: 1 }),
      },
    );
    const verdict = (await res.json()) as ValidationResult<unknown>;
    expect(verdict).toMatchObject({
      ok: false,
      status: 422,
      message: "body.extra is not a supported field",
    });
  });

  it("accepts a conforming object", async () => {
    const res = await jsonReader({ allowedKeys: ["level"] }).request("/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "info" }),
    });
    const verdict = (await res.json()) as ValidationResult<{ level: string }>;
    expect(verdict).toEqual({ ok: true, value: { level: "info" } });
  });
});

describe("field validators", () => {
  it("requiredString requires a non-empty string", () => {
    expect(requiredString({}, "msg").ok).toBe(false);
    expect(requiredString({ msg: "" }, "msg").ok).toBe(false);
    expect(requiredString({ msg: 5 }, "msg").ok).toBe(false);
    expect(requiredString({ msg: "x" }, "msg")).toEqual({
      ok: true,
      value: "x",
    });
  });

  it("optionalString accepts only undefined or strings", () => {
    expect(optionalString({}, "k").ok).toBe(true);
    expect(optionalString({ k: "v" }, "k")).toEqual({ ok: true, value: "v" });
    const bad = optionalString({ k: 7 }, "k");
    expect(bad).toMatchObject({ ok: false, status: 422 });
  });

  it("optionalStringArray enforces arrays, max items, and non-empty strings", () => {
    expect(optionalStringArray({}, "k").ok).toBe(true);
    expect(optionalStringArray({ k: "nope" }, "k").ok).toBe(false);
    expect(
      optionalStringArray({ k: ["a", "b"] }, "k", { maxItems: 1 }).ok,
    ).toBe(false);
    expect(optionalStringArray({ k: ["a", ""] }, "k").ok).toBe(false);
    expect(optionalStringArray({ k: ["a", "b"] }, "k")).toEqual({
      ok: true,
      value: ["a", "b"],
    });
  });

  it("optionalNumber enforces finite numbers, integers, and bounds", () => {
    expect(optionalNumber({}, "k").ok).toBe(true);
    expect(optionalNumber({ k: "5" }, "k").ok).toBe(false);
    expect(optionalNumber({ k: Number.NaN }, "k").ok).toBe(false);
    expect(optionalNumber({ k: 5.5 }, "k", { integer: true }).ok).toBe(false);
    expect(optionalNumber({ k: 2 }, "k", { min: 3 }).ok).toBe(false);
    expect(optionalNumber({ k: 2 }, "k", { max: 1 }).ok).toBe(false);
    expect(optionalNumber({ k: 2 }, "k", { min: 2, max: 2 })).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("optionalEnum and requiredEnum accept only listed values", () => {
    const levels = ["debug", "info", "error"] as const;
    expect(optionalEnum({}, "k", levels)).toEqual({ ok: true, value: undefined });
    expect(optionalEnum({ k: "trace" }, "k", levels).ok).toBe(false);
    expect(optionalEnum({ k: "info" }, "k", levels)).toEqual({
      ok: true,
      value: "info",
    });
    expect(requiredEnum({}, "k", levels).ok).toBe(false);
    expect(requiredEnum({ k: "debug" }, "k", levels)).toEqual({
      ok: true,
      value: "debug",
    });
  });

  it("optionalObject accepts only plain objects", () => {
    expect(optionalObject({}, "k").ok).toBe(true);
    expect(optionalObject({ k: [] }, "k").ok).toBe(false);
    expect(optionalObject({ k: "x" }, "k").ok).toBe(false);
    expect(optionalObject({ k: null }, "k").ok).toBe(false);
    expect(optionalObject({ k: { a: 1 } }, "k")).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("readPositiveInt falls back on missing, invalid, or non-positive env values", () => {
    expect(readPositiveInt("HASNA_LOGS_MAX_PAYLOAD_BYTES", 1024)).toBe(1024);
    process.env.HASNA_LOGS_MAX_PAYLOAD_BYTES = "512";
    expect(readPositiveInt("HASNA_LOGS_MAX_PAYLOAD_BYTES", 1024)).toBe(512);
    process.env.HASNA_LOGS_MAX_PAYLOAD_BYTES = "0";
    expect(readPositiveInt("HASNA_LOGS_MAX_PAYLOAD_BYTES", 1024)).toBe(1024);
    process.env.HASNA_LOGS_MAX_PAYLOAD_BYTES = "-3";
    expect(readPositiveInt("HASNA_LOGS_MAX_PAYLOAD_BYTES", 1024)).toBe(1024);
    process.env.HASNA_LOGS_MAX_PAYLOAD_BYTES = "abc";
    expect(readPositiveInt("HASNA_LOGS_MAX_PAYLOAD_BYTES", 1024)).toBe(1024);
    delete process.env.HASNA_LOGS_MAX_PAYLOAD_BYTES;
  });
});
