import { expect, test } from "bun:test";
import { redactAuthStatus } from "../src/auth.js";

test("redacts secret references from auth status", () => {
  expect(redactAuthStatus({
    provider: "huggingface",
    available: true,
    source: "secrets",
    secretKey: "hasna/takumi/live/hf_token",
  })).toEqual({
    provider: "huggingface",
    available: true,
    source: "secrets",
  });
});
