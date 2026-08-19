/**
 * Test gap coverage for src/server/cors.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The CORS module's env parsing and resolution edges had no direct unit
 * coverage (the server suite exercises the policy through the app). These
 * tests pin env precedence, comma-list parsing, wildcard and local-origin
 * resolution, and rejection of unconfigured remote origins.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { isLocalOrigin, readCorsOrigins, resolveCorsOrigin } from "./cors.ts";

const ENV_KEYS = ["HASNA_LOGS_CORS_ORIGINS", "LOGS_CORS_ORIGINS"];
const ORIGINAL = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("readCorsOrigins", () => {
  it("returns an empty list without configuration", () => {
    expect(readCorsOrigins()).toEqual([]);
  });

  it("prefers HASNA_LOGS_CORS_ORIGINS over LOGS_CORS_ORIGINS", () => {
    process.env.HASNA_LOGS_CORS_ORIGINS = "https://a.example, https://b.example";
    process.env.LOGS_CORS_ORIGINS = "https://legacy.example";
    expect(readCorsOrigins()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("falls back to LOGS_CORS_ORIGINS and drops empty segments", () => {
    delete process.env.HASNA_LOGS_CORS_ORIGINS;
    process.env.LOGS_CORS_ORIGINS = "https://a.example, , https://b.example ";
    expect(readCorsOrigins()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("resolveCorsOrigin", () => {
  it("returns an empty string for a missing origin", () => {
    expect(resolveCorsOrigin("")).toBe("");
    expect(resolveCorsOrigin(undefined as unknown as string)).toBe("");
  });

  it("allows local origins without configuration", () => {
    expect(resolveCorsOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
    expect(resolveCorsOrigin("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("rejects unconfigured remote origins", () => {
    expect(resolveCorsOrigin("https://logs.example.com")).toBe("");
  });

  it("allows configured origins exactly and wildcard configuration", () => {
    process.env.HASNA_LOGS_CORS_ORIGINS = "https://app.example.com";
    expect(resolveCorsOrigin("https://app.example.com")).toBe(
      "https://app.example.com",
    );
    expect(resolveCorsOrigin("https://app.example.com.evil.com")).toBe("");
    expect(resolveCorsOrigin("https://other.example.com")).toBe("");

    process.env.HASNA_LOGS_CORS_ORIGINS = "*";
    expect(resolveCorsOrigin("https://anything.example")).toBe(
      "https://anything.example",
    );
  });

  it("rejects unparseable origins", () => {
    expect(isLocalOrigin("not a url")).toBe(false);
    expect(resolveCorsOrigin("not a url")).toBe("");
  });
});
