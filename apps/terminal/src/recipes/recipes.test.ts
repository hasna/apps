import { describe, it, expect } from "bun:test";
import { genId, substituteVariables, extractVariables } from "./model.js";

describe("genId", () => {
  it("generates unique ids", () => {
    const a = genId();
    const b = genId();
    expect(a).not.toBe(b);
    expect(a.length).toBe(8);
  });
});

describe("substituteVariables", () => {
  it("replaces {var} placeholders", () => {
    expect(substituteVariables("kill -9 {pid}", { pid: "1234" })).toBe("kill -9 1234");
  });

  it("replaces multiple variables", () => {
    expect(substituteVariables("curl {host}:{port}", { host: "localhost", port: "3000" }))
      .toBe("curl localhost:3000");
  });

  it("replaces all occurrences of same variable", () => {
    expect(substituteVariables("{x} and {x}", { x: "y" })).toBe("y and y");
  });

  it("leaves unmatched vars alone", () => {
    expect(substituteVariables("{a} {b}", { a: "1" })).toBe("1 {b}");
  });
});

describe("extractVariables", () => {
  it("extracts variable names from command", () => {
    expect(extractVariables("lsof -i :{port} -t | xargs kill")).toEqual(["port"]);
  });

  it("deduplicates", () => {
    expect(extractVariables("{x} {x} {y}")).toEqual(["x", "y"]);
  });

  it("returns empty for no variables", () => {
    expect(extractVariables("ls -la")).toEqual([]);
  });
});
