import { expect, test } from "bun:test";
import { checkKit, getKitVersion } from "@hasna/contracts/vendor-kit";

test("vendored storage kit matches the installed Contracts generator", () => {
  const result = checkKit({ targetRepo: process.cwd() });

  expect(result.version).toBe(getKitVersion());
  expect(result.staleVersion).toBeNull();
  expect(result.files.every((file) => file.status === "ok")).toBe(true);
  expect(result.extras).toEqual([]);
  expect(result.ok).toBe(true);
});
