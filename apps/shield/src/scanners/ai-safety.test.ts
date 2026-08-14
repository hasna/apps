import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { aiSafetyScanner } from "./ai-safety.js";

describe("AI safety scanner", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ai-safety-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not suppress findings when security-ignore appears inside a string", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      `const marker = "${marker}"; const prompt = req.body.prompt;\n`,
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFinding = findings.find((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFinding).toBeDefined();
  });

  test("suppresses findings when security-ignore appears in a comment", async () => {
    writeFileSync(
      join(tempDir, "prompt.ts"),
      "const prompt = req.body.prompt; // security-ignore\n",
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFindings = findings.filter((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFindings).toHaveLength(0);
  });

  test("suppresses findings after multi-line block comments with apostrophes", async () => {
    writeFileSync(
      join(tempDir, "prompt.ts"),
      ["/*", " * John's deployment note", " */", "const prompt = req.body.prompt; // security-ignore"].join("\n"),
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFindings = findings.filter((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFindings).toHaveLength(0);
  });

  test("suppresses findings with adjacent js comment delimiters", async () => {
    writeFileSync(
      join(tempDir, "prompt.ts"),
      [
        "const prompt = req.body.prompt;// security-ignore",
        "const system = req.body.system;/* security-ignore */",
      ].join("\n"),
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFindings = findings.filter((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFindings).toHaveLength(0);
  });

  test("does not treat security-ignore inside a regex literal as a comment", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      `const re = /[//] ${marker}/; const prompt = req.body.prompt;\n`,
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFinding = findings.find((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFinding).toBeDefined();
  });

  test("does not treat security-ignore inside an exported regex literal as a comment", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      `export default /[//] ${marker}/; const prompt = req.body.prompt;\n`,
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFinding = findings.find((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFinding).toBeDefined();
  });

  test("does not treat security-ignore inside a control-flow regex literal as a comment", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      `if (ok) /[//] ${marker}/.test(input); const prompt = req.body.prompt;\n`,
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFinding = findings.find((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFinding).toBeDefined();
  });

  test("suppresses findings later inside multiline block comments that carry security-ignore", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      ["/* " + marker, "const prompt = req.body.prompt;", "*/"].join("\n"),
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFindings = findings.filter((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFindings).toHaveLength(0);
  });

  test("suppresses earlier lines in multiline block comments that carry security-ignore", async () => {
    const marker = "security" + "-ignore";
    writeFileSync(
      join(tempDir, "prompt.ts"),
      ["/* const prompt = req.body.prompt;", marker + " */"].join("\n"),
    );

    const findings = await aiSafetyScanner.scan(tempDir);

    const promptFindings = findings.filter((f) => f.rule_id === "ai-prompt-injection-concat");
    expect(promptFindings).toHaveLength(0);
  });
});
