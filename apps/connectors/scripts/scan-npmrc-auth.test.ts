import { describe, expect, test } from "bun:test";
import { isAllowedNpmTokenValue, scanNpmrcText } from "./scan-npmrc-auth.mjs";

const authTokenKey = "_auth" + "Token";
const authKey = "_auth";
const passwordKey = "_pass" + "word";
const safeTokenRef = "$" + "{NPM_TOKEN}";
const exampleLiteral = "npm_" + "example_literal";

describe("scan-npmrc-auth", () => {
  test("allows the NPM_TOKEN environment reference", () => {
    expect(isAllowedNpmTokenValue(safeTokenRef)).toBe(true);
    expect(scanNpmrcText(`//registry.npmjs.org/:${authTokenKey}=${safeTokenRef}\n`, "safe.npmrc")).toEqual([]);
  });

  test("flags literal npm auth token values without returning the value", () => {
    const findings = scanNpmrcText(`//registry.npmjs.org/:${authTokenKey}=${exampleLiteral}\n`, "unsafe.npmrc");

    expect(findings).toEqual([{ filePath: "unsafe.npmrc", line: 1, key: authTokenKey }]);
    expect(JSON.stringify(findings)).not.toContain(exampleLiteral);
  });

  test("flags other npm credential keys", () => {
    expect(scanNpmrcText(`//registry.npmjs.org/:${authKey}=${exampleLiteral}\n`, "auth.npmrc")).toEqual([
      { filePath: "auth.npmrc", line: 1, key: authKey },
    ]);
    expect(scanNpmrcText(`//registry.npmjs.org/:${passwordKey}=${exampleLiteral}\n`, "password.npmrc")).toEqual([
      { filePath: "password.npmrc", line: 1, key: passwordKey },
    ]);
  });

  test("flags commented literal npm credentials", () => {
    expect(scanNpmrcText(`# //registry.npmjs.org/:${authTokenKey}=${exampleLiteral}\n`, "comment.npmrc")).toEqual([
      { filePath: "comment.npmrc", line: 1, key: authTokenKey },
    ]);
  });

  test("allows commented safe npm token placeholders", () => {
    expect(scanNpmrcText(`# //registry.npmjs.org/:${authTokenKey}=${safeTokenRef}\n`, "comment.npmrc")).toEqual([]);
  });

  test("flags credential keys with whitespace or casing variations", () => {
    expect(scanNpmrcText(`//registry.npmjs.org/: ${authTokenKey}=${exampleLiteral}\n`, "space.npmrc")).toEqual([
      { filePath: "space.npmrc", line: 1, key: authTokenKey },
    ]);
    expect(scanNpmrcText(`//registry.npmjs.org/:${authTokenKey.toUpperCase()}=${exampleLiteral}\n`, "case.npmrc")).toEqual([
      { filePath: "case.npmrc", line: 1, key: authTokenKey },
    ]);
  });
});
