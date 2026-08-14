import { describe, expect, it } from "bun:test";
import { shellPathArg } from "./shell-quote.js";

describe("shellPathArg", () => {
  it("quotes absolute paths", () => {
    expect(shellPathArg("/tmp/project files")).toBe("'/tmp/project files'");
  });

  it("prefixes plain relative paths so option-like names stay operands", () => {
    expect(shellPathArg("-delete")).toBe("'./-delete'");
  });

  it("expands home-relative paths before quoting them", () => {
    const previousHome = process.env.HOME;
    process.env.HOME = "/tmp/test home";

    try {
      expect(shellPathArg("~")).toBe("'/tmp/test home'");
      expect(shellPathArg("~/project's files")).toBe("'/tmp/test home/project'\\''s files'");
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
