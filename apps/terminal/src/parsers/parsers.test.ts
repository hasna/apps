import { describe, it, expect } from "bun:test";
import { parseOutput, tokenSavings, estimateTokens } from "./index.js";

describe("parseOutput", () => {
  it("parses ls -la output", () => {
    const output = `total 32
drwxr-xr-x  5 user staff  160 Mar 10 09:00 src
-rw-r--r--  1 user staff  450 Mar 10 09:00 package.json
lrwxr-xr-x  1 user staff   20 Mar 10 09:00 link -> target`;

    const result = parseOutput("ls -la", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("ls");
    const data = result!.data as any[];
    expect(data.length).toBe(3);
    expect(data[0].name).toBe("src");
    expect(data[0].type).toBe("dir");
    expect(data[1].name).toBe("package.json");
    expect(data[1].type).toBe("file");
    expect(data[2].type).toBe("symlink");
  });

  it("parses find output and filters node_modules", () => {
    const output = `./src/lib/webhooks.ts
./node_modules/@types/node/async_hooks.d.ts
./node_modules/@types/node/perf_hooks.d.ts
./dist/lib/webhooks.d.ts
./src/routes/api.ts`;

    const result = parseOutput("find . -name '*hooks*' -type f", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("find");
    const data = result!.data as any;
    expect(data.source.length).toBe(2); // webhooks.ts and api.ts
    expect(data.filtered.length).toBeGreaterThan(0);
    expect(data.filtered.find((f: any) => f.reason === "node_modules")?.count).toBe(2);
  });

  it("parses test output (jest style)", () => {
    const output = `PASS src/auth.test.ts
FAIL src/db.test.ts
  ✗ should connect to database
    Error: Connection refused
Tests: 5 passed, 1 failed, 1 skipped, 7 total
Time: 3.2s`;

    const result = parseOutput("npm test", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("test");
    const data = result!.data as any;
    expect(data.passed).toBe(5);
    expect(data.failed).toBe(1);
    expect(data.skipped).toBe(1);
    expect(data.total).toBe(7);
  });

  it("parses git status", () => {
    const output = `On branch main
Changes to be committed:
  new file:   src/mcp/server.ts
  modified:   src/ai.ts

Changes not staged for commit:
  modified:   package.json

Untracked files:
  src/tree.ts`;

    const result = parseOutput("git status", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("git-status");
    const data = result!.data as any;
    expect(data.branch).toBe("main");
    expect(data.staged.length).toBe(2);
    expect(data.unstaged.length).toBe(1);
    expect(data.untracked.length).toBe(1);
  });

  it("parses git log", () => {
    const output = `commit af19ce3456789
Author: Andrei Hasna <andrei@hasna.com>
Date:   Sat Mar 15 10:00:00 2026

    feat: add MCP server

commit 3963db5123456
Author: Andrei Hasna <andrei@hasna.com>
Date:   Fri Mar 14 09:00:00 2026

    feat: tabs and browse mode`;

    const result = parseOutput("git log", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("git-log");
    const data = result!.data as any[];
    expect(data.length).toBe(2);
    expect(data[0].hash).toBe("af19ce34");
    expect(data[0].message).toBe("feat: add MCP server");
  });

  it("parses npm install output", () => {
    const output = `added 47 packages in 3.2s
2 vulnerabilities found`;

    const result = parseOutput("npm install", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("npm-install");
    const data = result!.data as any;
    expect(data.installed).toBe(47);
    expect(data.duration).toBe("3.2s");
    expect(data.vulnerabilities).toBe(2);
  });

  it("parses build output", () => {
    const output = `Compiling...
1 warning
Found 0 errors
Done in 2.5s`;

    const result = parseOutput("npm run build", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("build");
    const data = result!.data as any;
    expect(data.status).toBe("success");
    expect(data.warnings).toBe(1);
  });

  it("detects errors", () => {
    const output = `Error: EADDRINUSE: address already in use :3000`;
    const result = parseOutput("node server.js", output);
    expect(result).not.toBeNull();
    expect(result!.parser).toBe("error");
    const data = result!.data as any;
    expect(data.type).toBe("port_in_use");
  });
});

describe("estimateTokens", () => {
  it("estimates roughly 4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
  });
});

describe("tokenSavings", () => {
  it("calculates savings correctly", () => {
    const raw = "a".repeat(400); // 100 tokens
    const parsed = { status: "ok" };
    const result = tokenSavings(raw, parsed);
    expect(result.rawTokens).toBe(100);
    expect(result.saved).toBeGreaterThan(0);
    expect(result.percent).toBeGreaterThan(0);
  });
});
