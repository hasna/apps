import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createSandbox } from "./testing/sandbox.js";
import { createTrash } from "./sdk.js";
import { HostedTrash } from "./hosted.js";

test("SDK defaults to hosted operations and never creates a local store without credentials", () => {
  const sandbox = createSandbox();
  try {
    expect(() => createTrash({ env: { HOME: sandbox.root, HASNA_HOME: sandbox.path("hasna") } })).toThrow();
    expect(existsSync(sandbox.path("hasna"))).toBe(false);
  } finally { sandbox.cleanup(); }
});
test("SDK uses the authenticated hosted transport when configured", () => {
  const client = createTrash({ env: { HASNA_TRASH_API_URL: "https://trash.example.test", HASNA_TRASH_API_KEY: "test-fixture" } });
  expect(client).toBeInstanceOf(HostedTrash);
});
