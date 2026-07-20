import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function runBoundaryScan(root: string) {
  return spawnSync("bun", ["run", "scripts/no-private-cloud-boundary.mjs", "--root", root], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runOrThrow(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`,
    );
  }
  return result;
}

function withBoundaryFixture(
  files: Record<string, string>,
  verify: (result: ReturnType<typeof runBoundaryScan>) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "loops-boundary-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
    verify(runBoundaryScan(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withBuiltPackedBoundaryFixture(
  source: string,
  verify: (
    result: ReturnType<typeof runBoundaryScan>,
    builtSource: string,
  ) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "loops-packed-boundary-fixture-"));
  const extractRoot = join(root, "extract");
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "loops-boundary-fixture",
        version: "1.0.0",
        type: "module",
        files: ["dist"],
      }),
    );
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), source);
    runOrThrow(
      "bun",
      ["build", "src/index.ts", "--root", "src", "--outdir", "dist", "--target", "bun"],
      root,
    );
    runOrThrow(
      "bun",
      ["pm", "pack", "--destination", root, "--ignore-scripts", "--quiet"],
      root,
    );

    const archiveName = readdirSync(root).find((entry) => entry.endsWith(".tgz"));
    if (!archiveName) throw new Error("bun pack did not create a fixture tarball");

    mkdirSync(extractRoot);
    runOrThrow("tar", ["-xzf", join(root, archiveName), "-C", extractRoot], root);
    const packageRoot = join(extractRoot, "package");
    verify(
      runBoundaryScan(packageRoot),
      readFileSync(join(packageRoot, "dist", "index.js"), "utf8"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function prohibitedHostedSuffix(): string {
  return String.fromCharCode(104, 97, 115, 110, 97, 46, 120, 121, 122);
}

function percentEncodeHostnameLetters(hostname: string, encodeAll: boolean): string {
  const labelEnd = hostname.indexOf(".");
  return [...hostname]
    .map((character, index) => {
      if (
        character === "." ||
        index > labelEnd ||
        (!encodeAll && index !== 1)
      ) {
        return character;
      }
      return `%${character.codePointAt(0)!.toString(16).padStart(2, "0")}`;
    })
    .join("");
}

function toFullwidthHostname(hostname: string): string {
  return [...hostname]
    .map((character) =>
      character === "."
        ? String.fromCodePoint(0xff0e)
        : String.fromCodePoint(character.codePointAt(0)! + 0xfee0),
    )
    .join("");
}

function sourceFilesUnder(relativeDir: string): string[] {
  const root = join(sourceRoot, relativeDir);
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && extname(path) === ".ts" && !path.endsWith(".test.ts")) files.push(path);
    }
  }

  walk(root);
  return files;
}

describe("public package cloud boundary", () => {
  test("does not ship private hosted implementation details or obvious secrets", () => {
    const result = runBoundaryScan(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("boundary scan passed");
  });

  test("rejects the internal hosted suffix in source and built package files", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "src/client.ts": `export const endpoint = "https://api.${hostedSuffix}/v1";`,
        "dist/index.js": `export const endpoint = "HTTPS://LOOPS.${hostedSuffix.toUpperCase()}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("src/client.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/index.js: internal hosted domain suffix");
      },
    );
  });

  test("rejects a fully qualified internal hostname with a trailing dot", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "dist/index.js": `export const endpoint = "https://api.${hostedSuffix}./v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("dist/index.js: internal hosted domain suffix");
      },
    );
  });

  test("rejects normalized dot encodings in source and built package files", () => {
    const unicodeDot = "\u3002";
    const percentEncodedDot = "%2E";
    const javascriptEscapedDot = ["\\", "u002e"].join("");
    const zeroPaddedJavascriptEscapedIdeographicDot = ["\\", "u{003002}"].join("");
    const zeroPaddedJavascriptEscapedFullwidthDot = ["\\", "u{00ff0e}"].join("");
    const zeroPaddedJavascriptEscapedHalfwidthDot = ["\\", "u{00ff61}"].join("");
    const unicodeHostedSuffix = ["hasna", "xyz"].join(unicodeDot);
    const percentEncodedHostedSuffix = ["hasna", "xyz"].join(percentEncodedDot);
    const javascriptEscapedHostedSuffix = ["hasna", "xyz"].join(javascriptEscapedDot);
    const zeroPaddedIdeographicHostedSuffix = ["hasna", "xyz"].join(
      zeroPaddedJavascriptEscapedIdeographicDot,
    );
    const zeroPaddedFullwidthHostedSuffix = ["hasna", "xyz"].join(
      zeroPaddedJavascriptEscapedFullwidthDot,
    );
    const zeroPaddedHalfwidthHostedSuffix = ["hasna", "xyz"].join(
      zeroPaddedJavascriptEscapedHalfwidthDot,
    );

    withBoundaryFixture(
      {
        "src/unicode-dot.ts": `export const endpoint = "https://api.${unicodeHostedSuffix}/v1";`,
        "src/percent-dot.ts": `export const endpoint = "https://api.${percentEncodedHostedSuffix}/v1";`,
        "src/javascript-escape.ts": `export const endpoint = "https://api.${javascriptEscapedHostedSuffix}/v1";`,
        "src/javascript-escape-ideographic.ts":
          `export const endpoint = "https://api.${zeroPaddedIdeographicHostedSuffix}/v1";`,
        "src/javascript-escape-fullwidth.ts":
          `export const endpoint = "https://api.${zeroPaddedFullwidthHostedSuffix}/v1";`,
        "src/javascript-escape-halfwidth.ts":
          `export const endpoint = "https://api.${zeroPaddedHalfwidthHostedSuffix}/v1";`,
        "dist/unicode-dot.js": `export const endpoint = "https://api.${unicodeHostedSuffix}/v1";`,
        "dist/percent-dot.js": `export const endpoint = "https://api.${percentEncodedHostedSuffix}/v1";`,
        "dist/javascript-escape.js": `export const endpoint = "https://api.${javascriptEscapedHostedSuffix}/v1";`,
        "dist/javascript-escape-ideographic.js":
          `export const endpoint = "https://api.${zeroPaddedIdeographicHostedSuffix}/v1";`,
        "dist/javascript-escape-fullwidth.js":
          `export const endpoint = "https://api.${zeroPaddedFullwidthHostedSuffix}/v1";`,
        "dist/javascript-escape-halfwidth.js":
          `export const endpoint = "https://api.${zeroPaddedHalfwidthHostedSuffix}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("src/unicode-dot.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("src/percent-dot.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("src/javascript-escape.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("src/javascript-escape-ideographic.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("src/javascript-escape-fullwidth.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("src/javascript-escape-halfwidth.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/unicode-dot.js: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/percent-dot.js: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/javascript-escape.js: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/javascript-escape-ideographic.js: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/javascript-escape-fullwidth.js: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/javascript-escape-halfwidth.js: internal hosted domain suffix");
      },
    );
  });

  test("encoded fixtures resolve to the prohibited runtime hostname", () => {
    const hostedSuffix = prohibitedHostedSuffix();
    const partiallyEncoded = percentEncodeHostnameLetters(hostedSuffix, false);
    const fullyEncodedLabel = percentEncodeHostnameLetters(hostedSuffix, true);
    const fullwidthHostedSuffix = toFullwidthHostname(hostedSuffix);

    expect(new URL(`https://${partiallyEncoded}`).hostname).toBe(hostedSuffix);
    expect(new URL(`https://${fullyEncodedLabel}`).hostname).toBe(hostedSuffix);
    expect(new URL(`https://${fullwidthHostedSuffix}`).hostname).toBe(hostedSuffix);
  });

  test("rejects percent-encoded hostname letters in source and dist fixtures", () => {
    const hostedSuffix = prohibitedHostedSuffix();
    const partiallyEncoded = percentEncodeHostnameLetters(hostedSuffix, false);
    const fullyEncodedLabel = percentEncodeHostnameLetters(hostedSuffix, true);

    withBoundaryFixture(
      {
        "src/partial-percent-host.ts":
          `export const endpoint = "https://${partiallyEncoded}/v1";`,
        "src/full-percent-host.ts":
          `export const endpoint = "https://${fullyEncodedLabel}/v1";`,
        "dist/partial-percent-host.js":
          `export const endpoint = "https://${partiallyEncoded}/v1";`,
        "dist/full-percent-host.js":
          `export const endpoint = "https://${fullyEncodedLabel}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          "src/partial-percent-host.ts: internal hosted domain suffix",
        );
        expect(result.stderr).toContain(
          "src/full-percent-host.ts: internal hosted domain suffix",
        );
        expect(result.stderr).toContain(
          "dist/partial-percent-host.js: internal hosted domain suffix",
        );
        expect(result.stderr).toContain(
          "dist/full-percent-host.js: internal hosted domain suffix",
        );
      },
    );
  });

  test("rejects fullwidth Unicode hostname equivalents in source and dist fixtures", () => {
    const fullwidthHostedSuffix = toFullwidthHostname(prohibitedHostedSuffix());

    withBoundaryFixture(
      {
        "src/fullwidth-host.ts":
          `export const endpoint = "https://${fullwidthHostedSuffix}/v1";`,
        "dist/fullwidth-host.js":
          `export const endpoint = "https://${fullwidthHostedSuffix}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          "src/fullwidth-host.ts: internal hosted domain suffix",
        );
        expect(result.stderr).toContain(
          "dist/fullwidth-host.js: internal hosted domain suffix",
        );
      },
    );
  });

  test("rejects canonical literal equivalents after Bun build and pack", () => {
    const hostedSuffix = prohibitedHostedSuffix();
    const partiallyEncoded = percentEncodeHostnameLetters(hostedSuffix, false);
    const fullwidthHostedSuffix = toFullwidthHostname(hostedSuffix);
    const source = [
      `export const encodedEndpoint = "https://${partiallyEncoded}/v1";`,
      `export const unicodeEndpoint = "https://${fullwidthHostedSuffix}/v1";`,
    ].join("\n");

    withBuiltPackedBoundaryFixture(source, (result, builtSource) => {
      expect(builtSource).not.toContain(hostedSuffix);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("dist/index.js: internal hosted domain suffix");
    });
  });

  test("keeps canonicalization negative controls in source and packed artifacts", () => {
    const unrelatedAscii = String.fromCharCode(
      101,
      120,
      97,
      109,
      112,
      108,
      101,
      46,
      99,
      111,
      109,
    );
    const encodedUnrelated = percentEncodeHostnameLetters(unrelatedAscii, true);
    const fullwidthUnrelated = toFullwidthHostname(unrelatedAscii);

    withBoundaryFixture(
      {
        "src/encoded-unrelated.ts":
          `export const endpoint = "https://${encodedUnrelated}/v1";`,
        "src/fullwidth-unrelated.ts":
          `export const endpoint = "https://${fullwidthUnrelated}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("boundary scan passed");
      },
    );

    withBuiltPackedBoundaryFixture(
      `export const endpoint = "https://${encodedUnrelated}/v1";`,
      (result, builtSource) => {
        expect(builtSource).toContain(encodedUnrelated);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("boundary scan passed");
      },
    );
  });

  test("allows neutral deployment placeholders and unrelated domains", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "src/client.ts": [
          'export const example = "https://service.example/v1";',
          'export const placeholder = "https://app.<your-deployment-domain>/v1";',
          `export const unrelated = "https://${hostedSuffix}.example/v1";`,
        ].join("\n"),
        "dist/index.js": 'export const endpoint = "https://your-deployment.example/v1";',
      },
      (result) => {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("boundary scan passed");
      },
    );
  });

  test("loops-api does not import local execution authority", () => {
    const combined = sourceFilesUnder("api")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../lib/executor");
    expect(combined).not.toContain("../lib/workflow-runner");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("executeClaimedRun");
    expect(combined).not.toContain("runNow");
  });

  test("loops-runner does not import local storage or scheduler authority", () => {
    const combined = sourceFilesUnder("runner")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("runNow");
  });
});
