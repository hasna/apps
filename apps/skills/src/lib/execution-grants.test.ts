import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import {
  grantDirectoryContains,
  grantWorkspace,
  validateExecutionGrants,
} from "./execution-grants.js";

useDefaultTestTimeout();

test("consumer directory bounds use canonical paths with component boundaries on POSIX and Windows", () => {
  for (const path of [
    "/",
    "/workspace/reviewed",
    "C:\\reviewed",
    "\\\\server\\share\\reviewed",
  ])
    expect(grantWorkspace(path)).toBe(true);
  for (const path of [
    "relative",
    "C:reviewed",
    "\\reviewed",
    "/work/../outside",
    "/work//nested",
    "/work/./nested",
    "/work\0space",
  ])
    expect(grantWorkspace(path)).toBe(false);
  for (const [root, child, allowed] of [
    ["/work", "/work/project", true],
    ["/work", "/work-other", false],
    ["/work", "/outside", false],
    ["C:\\work", "C:\\work\\project", true],
    ["C:\\work", "C:\\work-other", false],
    ["C:\\work", "D:\\work", false],
    ["\\\\server\\share\\work", "\\\\other\\share\\work", false],
  ] as const) {
    expect(grantDirectoryContains(root, child, true)).toBe(allowed);
    expect(grantDirectoryContains(root, child)).toBe(false);
    expect(grantDirectoryContains(root, root)).toBe(true);
  }
});
test("grant validation refuses wildcard actors, runtime control variables and malformed references", () => {
  const grant = {
    id: "reviewed",
    target: "local" as const,
    selection: {
      slug: "example",
      version: "1.0.0",
      bundleDigest: `sha256:${"a".repeat(64)}`,
    },
    actors: ["reviewer"],
    consumers: [{ stationId: "station", workspaceDirectory: "/workspace" }],
    secretsAuthority: "https://vault.example.test/v1",
    bindings: { PROVIDER_TOKEN: "demo/provider/key" },
  };
  expect(validateExecutionGrants([grant])).toEqual([grant]);
  for (const delta of [
    { actors: ["*"] },
    { actors: ["reviewer", "reviewer"] },
    { bindings: { NODE_OPTIONS: "demo/key" } },
    { bindings: { PROVIDER_TOKEN: "../outside" } },
    { bindings: { PROVIDER_TOKEN: "demo//key" } },
    { bindings: { PROVIDER_TOKEN: "demo/key\nvalue" } },
    { secretsAuthority: "https://vault.example.test/v1?other=1" },
    { target: "cloud" },
    { expiresAt: "invalid" },
    { expiresAt: "2000-01-01" },
    { value: "not-a-reference-field" },
  ])
    expect(() => validateExecutionGrants([{ ...grant, ...delta }])).toThrow();
  expect(() => validateExecutionGrants([grant, grant])).toThrow();
});
