import { expect, test } from "bun:test";
import { normalizeBunCacheComments } from "./normalize-bun-cache-comments.js";

test("normalizes workspace and filtered Bun source comments to identical stable bytes", () => {
  const workspace = "// ../../../../clones/hasna/apps/apps/contracts/dist/client/transport.js\nconst value = '@hasna+contracts@1.1.0+e8014c875821e0be';\n";
  const filtered = "// /home/runner/work/apps/apps/node_modules/.bun/@hasna+contracts@1.1.0+420d361875e87a2d/node_modules/@hasna/contracts/dist/client/transport.js\nconst value = '@hasna+contracts@1.1.0+420d361875e87a2d';\n";
  const normalizedWorkspace = normalizeBunCacheComments(workspace, "1.1.0");
  const normalizedFiltered = normalizeBunCacheComments(filtered, "1.1.0");
  const expected = "// node_modules/.bun/@hasna+contracts@1.1.0/node_modules/@hasna/contracts/dist/client/transport.js";
  expect(normalizedWorkspace.split("\n")[0]).toBe(expected);
  expect(normalizedFiltered.split("\n")[0]).toBe(expected);
  expect(normalizedWorkspace.split("\n")[1]).toContain("+e8014c875821e0be");
  expect(normalizedFiltered.split("\n")[1]).toContain("+420d361875e87a2d");
});
