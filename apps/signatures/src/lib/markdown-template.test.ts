import { describe, expect, test } from "bun:test";
import { parseCliVariables, parseSignatureAnchors, parseVariables, renderTemplateVariables } from "./markdown-template.js";

describe("markdown-template", () => {
  test("extracts variables but not signature anchors", () => {
    const vars = parseVariables("# Agreement\n\nHello {{ signer.name }}\n\n{{signature:client}}");
    expect(vars.map((v) => v.name)).toEqual(["signer.name"]);
  });

  test("renders nested variables", () => {
    const rendered = renderTemplateVariables("Signed by {{ signer.name }}", {
      signer: { name: "Ada Lovelace" },
    });
    expect(rendered).toContain("Ada Lovelace");
  });

  test("parses CLI dotted variables as nested values", () => {
    const vars = parseCliVariables(["client.name=Ada Lovelace", "client.company=Hasna", "title=Agreement"]);
    expect(vars).toEqual({
      client: { name: "Ada Lovelace", company: "Hasna" },
      title: "Agreement",
    });
    expect(renderTemplateVariables("Client: {{ client.name }}", vars)).toBe("Client: Ada Lovelace");
  });

  test("keeps missing variables visible", () => {
    const rendered = renderTemplateVariables("Hello {{ missing.value }}", {});
    expect(rendered).toContain("{{ missing.value }}");
  });

  test("converts signature variables to anchors", () => {
    const rendered = renderTemplateVariables("Sign: {{signature:client}}", {});
    expect(rendered).toContain('data-signature-anchor="client"');
    expect(parseSignatureAnchors("{{signature}}\n{{ signature:witness }}").map((a) => a.anchor)).toEqual(["signature", "witness"]);
  });
});
