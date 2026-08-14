import { describe, test, expect } from "bun:test";
import { parseTemplateVars, extractTemplateVars, renderTemplate, isTemplate } from "./template";

describe("template", () => {
  test("parseTemplateVars returns unique var names", () => {
    const vars = parseTemplateVars("Hello {{NAME}}, your email is {{EMAIL}}. Again {{NAME}}.");
    expect(vars).toEqual(["NAME", "EMAIL"]);
  });

  test("parseTemplateVars returns empty for no vars", () => {
    expect(parseTemplateVars("no vars here")).toEqual([]);
  });

  test("extractTemplateVars includes description", () => {
    const vars = extractTemplateVars("{{NAME:Your full name}} and {{EMAIL}}");
    expect(vars.find((v) => v.name === "NAME")?.description).toBe("Your full name");
    expect(vars.find((v) => v.name === "EMAIL")?.description).toBeNull();
  });

  test("renderTemplate substitutes all vars", () => {
    const result = renderTemplate("Hello {{NAME}}!", { NAME: "Andrei" });
    expect(result).toBe("Hello Andrei!");
  });

  test("renderTemplate throws on missing vars", () => {
    expect(() => renderTemplate("{{A}} {{B}}", { A: "x" })).toThrow("Missing required template variables: B");
  });

  test("isTemplate returns true when vars present", () => {
    expect(isTemplate("Hello {{NAME}}")).toBe(true);
  });

  test("isTemplate returns false when no vars", () => {
    expect(isTemplate("plain text")).toBe(false);
  });
});
