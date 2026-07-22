import { describe, expect, test } from "bun:test";

const bareRuntimeImport =
  /(?:from\s+|require\()\s*["'](?:pg|@hasna\/contracts(?:\/[^"']*)?)["']/;

describe("standalone server bundle", () => {
  test("contains every remote runtime dependency", async () => {
    const build = Bun.spawn(
      ["bun", "run", "scripts/build-bundles.ts", "--standalone-server"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [exitCode, stderr] = await Promise.all([
      build.exited,
      new Response(build.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const bundle = await Bun.file("dist/server/index.js").text();
    expect(bundle).not.toMatch(bareRuntimeImport);
  });
});
