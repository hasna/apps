import { describe, expect, test } from "bun:test";
import { hello } from "./index.js";

describe("@hasna/trash scaffold", () => {
  test("sdk hello works", () => {
    expect(hello("scaffold")).toBe("hello from @hasna/scaffold");
  });
});
