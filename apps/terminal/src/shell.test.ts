import { describe, it, expect } from "bun:test";
import { getShell } from "./shell.js";

describe("getShell", () => {
  it("returns a shell path", () => {
    expect(getShell()).toMatch(/^\//);
  });
});
