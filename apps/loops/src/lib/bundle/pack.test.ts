import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleIntegrityError, MODE_DATA, MODE_SCRIPT } from "./manifest.js";
import { collectBundle, collectBundleEntries, packBundle, writeTar } from "./pack.js";
import { unpackBundle } from "./unpack.js";

const roots: string[] = [];

function fixture(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "loops-pack-"));
  roots.push(root);
  const all = { "loop.json": `{"schema":"hasna.loop.bundle.v1","id":"lp_1","name":"demo"}`, ...files };
  for (const [path, content] of Object.entries(all)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("collectBundleEntries", () => {
  test("normalises modes to the two contract values regardless of what is on disk", () => {
    const root = fixture({ "scripts/run.sh": "#!/bin/sh\n", "README.md": "hi\n" });
    // Deliberately wrong on disk: a world-readable script and an executable doc.
    chmodSync(join(root, "scripts/run.sh"), 0o644);
    chmodSync(join(root, "README.md"), 0o755);
    const entries = collectBundleEntries(root);
    expect(entries.find((entry) => entry.path === "scripts/run.sh")?.mode).toBe(MODE_SCRIPT);
    expect(entries.find((entry) => entry.path === "README.md")?.mode).toBe(MODE_DATA);
    expect(entries.find((entry) => entry.path === "loop.json")?.mode).toBe(MODE_DATA);
  });

  test("excludes VCS, dependency and credential files at any depth", () => {
    const root = fixture({
      "scripts/run.sh": "#!/bin/sh\n",
      ".git/config": "[core]\n",
      "node_modules/pkg/index.js": "module.exports={}\n",
      ".env": "TOKEN=abc\n",
      ".env.production": "TOKEN=abc\n",
      "nested/.npmrc": "//registry:_authToken=x\n",
      "nested/key.pem": "-----BEGIN PRIVATE KEY-----\n",
      ".DS_Store": "junk",
      ".loops-bundle.json": "{}",
    });
    const paths = collectBundleEntries(root).map((entry) => entry.path);
    expect(paths).toEqual(["loop.json", "scripts/run.sh"]);
  });

  test("recurses into a directory whose NAME looks credential-ish", () => {
    // The exclusion runs on regular files only, after the directory branch: a
    // subtree called credentials/ is content, not a secret.
    const root = fixture({ "credentials/README.md": "how to get a key\n" });
    expect(collectBundleEntries(root).map((entry) => entry.path)).toContain("credentials/README.md");
  });

  test("skips symlinks rather than following or recording them", () => {
    const root = fixture({ "scripts/run.sh": "#!/bin/sh\n" });
    Bun.spawnSync(["ln", "-s", "/etc/passwd", join(root, "scripts", "leak")]);
    expect(collectBundleEntries(root).map((entry) => entry.path)).toEqual(["loop.json", "scripts/run.sh"]);
  });
});

describe("collectBundle caps and scanning", () => {
  test("refuses an oversized file", () => {
    const root = fixture({ "big.txt": "x".repeat(2 * 1024 * 1024 + 1) });
    expect(() => collectBundle(root)).toThrow(/per-file cap/);
  });

  test("refuses a tree with credential material and names the path without echoing the value", () => {
    const secret = ["sk", "-ant-", "A".repeat(40)].join("");
    const root = fixture({ "scripts/run.sh": `#!/bin/sh\nexport ANTHROPIC_API_KEY=${secret}\n` });
    let thrown: unknown;
    try {
      collectBundle(root);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BundleIntegrityError);
    const message = (thrown as Error).message;
    expect(message).toContain("scripts/run.sh");
    expect(message).toContain("byte offset");
    expect(message).not.toContain(secret);
  });

  test("refuses an empty directory", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-pack-empty-"));
    roots.push(root);
    expect(() => collectBundle(root)).toThrow(/no files/);
  });
});

describe("packBundle", () => {
  test("is byte-identical across two packs of the same tree", () => {
    const root = fixture({ "scripts/run.sh": "#!/bin/sh\necho hi\n", "README.md": "notes\n" });
    const first = packBundle(root);
    const second = packBundle(root);
    expect(second.bundleDigest).toBe(first.bundleDigest);
    expect(Buffer.compare(first.archive, second.archive)).toBe(0);
    expect(second.archiveSha256).toBe(first.archiveSha256);
  });

  test("round-trips through unpack with modes and content intact", () => {
    const root = fixture({ "scripts/run.sh": "#!/bin/sh\necho hi\n" });
    const packed = packBundle(root);
    const entries = unpackBundle(packed.archive);
    expect(entries.map((entry) => entry.path)).toEqual(["loop.json", "scripts/run.sh"]);
    expect(entries.find((entry) => entry.path === "scripts/run.sh")?.mode).toBe(MODE_SCRIPT);
    expect(new TextDecoder().decode(entries.find((entry) => entry.path === "scripts/run.sh")!.bytes)).toBe("#!/bin/sh\necho hi\n");
  });

  test("refuses a path longer than a ustar header can hold, rather than splitting it", () => {
    // A split path is a second spelling for the same content, and therefore a
    // second possible digest for it.
    const long = `scripts/${"d".repeat(120)}.sh`;
    const root = fixture({ [long]: "#!/bin/sh\n" });
    expect(() => packBundle(root)).toThrow(/longer than the 100 bytes/);
  });

  test("writes a tar whose mtime and ownership fields are pinned", () => {
    const root = fixture({ "scripts/run.sh": "#!/bin/sh\n" });
    const tar = writeTar(collectBundleEntries(root));
    const header = new TextDecoder().decode(tar.subarray(0, 512));
    expect(header.slice(108, 116)).toBe("0000000\0"); // uid
    expect(header.slice(116, 124)).toBe("0000000\0"); // gid
    expect(header.slice(136, 148)).toBe("00000000000\0"); // mtime
  });
});
