import { describe, expect, it } from "bun:test";
import { buildSymbolsDirCommand } from "./files.js";

describe("buildSymbolsDirCommand", () => {
  it("keeps shell metacharacters inside the directory argument", () => {
    const command = buildSymbolsDirCommand(`/tmp/src"; rm -rf /; echo "`, 10);

    expect(command).toBe(
      `find '/tmp/src"; rm -rf /; echo "' -maxdepth 3 -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" -o -name "*.php" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.test.*" -not -name "*.spec.*" | head -10`,
    );
  });

  it("escapes single quotes in the directory argument", () => {
    const command = buildSymbolsDirCommand("/tmp/source's files", 5);

    expect(command).toContain(`find '/tmp/source'\\''s files' -maxdepth 3`);
    expect(command).toContain("| head -5");
  });

  it("prefixes option-like directories before passing them to find", () => {
    const command = buildSymbolsDirCommand("-delete", 5);

    expect(command).toContain("find './-delete' -maxdepth 3");
  });

  it("prefixes find expression-token directories before passing them to find", () => {
    expect(buildSymbolsDirCommand("(", 5)).toContain("find './(' -maxdepth 3");
    expect(buildSymbolsDirCommand("!", 5)).toContain("find './!' -maxdepth 3");
  });
});
