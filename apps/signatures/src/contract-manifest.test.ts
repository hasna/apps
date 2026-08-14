// The repo self-description and the release gate it declares are both checked
// here, because neither is reachable from any other test: a manifest that fails
// the v1 schema and a `prepack` that always exits 1 are invisible to a suite
// that only exercises `src/`.
//
// The validator is the kit's own, not a copy of the schema — a hand-written
// duplicate would drift and then pass for the wrong reason.
import { describe, expect, it } from "bun:test";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServiceContractManifest } from "@hasna/contracts/service-contract";

const repoRoot = join(import.meta.dir, "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as T;
}

interface PackageJson {
  private?: boolean;
  files?: string[];
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ContractManifest {
  kitVersion?: string;
  metadata?: { release?: { artifactScan?: { script?: string } } };
}

const KIT_PACKAGE = "@hasna/contracts";

// One open nonconformance, tracked rather than hidden: signatures ships
// `signatures-serve`, and the contract requires a service-capable
// `cli-with-store` to support PostgreSQL as well as SQLite (a storage waiver is
// explicitly ineligible for such a repo). This repo is SQLite-only, so the
// manifest cannot claim `engines: ["sqlite", "postgres"]` without asserting a
// capability that does not exist.
//
// The set is pinned exactly, in both directions: a NEW manifest defect fails
// this test, and so does closing the gap without updating this list. It is a
// recorded baseline, never a suppression.
const KNOWN_MANIFEST_ISSUES = [
  'storage.engines cli-with-store storage.engines must declare both sqlite and postgres unless the engine carries a metadata.conformance.waivedStorageEngines waiver; missing: postgres',
];

// `bun run <name>` inside a script body means the gate reaches that script too;
// the contract resolves the real script graph rather than grepping prepack for a
// blessed command name.
function resolveScriptGraph(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop()!;
    const body = scripts[name];
    if (body === undefined) continue;
    for (const match of body.matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      const next = match[1]!;
      if (reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return reached;
}

// An unpinned `bunx`/`npx` resolves to whatever is newest at publish time, so
// the gate's own behaviour stops being reproducible and a resolution failure
// becomes a silent non-run.
function unpinnedPackageRunners(body: string): string[] {
  const unpinned: string[] = [];
  for (const segment of body.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (const [index, token] of tokens.entries()) {
      if (token !== "bunx" && token !== "npx") continue;
      const spec = tokens.slice(index + 1).find((candidate) => !candidate.startsWith("-"));
      if (spec === undefined) continue;
      if (spec.indexOf("@", spec.startsWith("@") ? 1 : 0) === -1) unpinned.push(`${token} ${spec}`);
      break;
    }
  }
  return unpinned;
}

// Everything above this line reads package.json and the manifest as text, and a
// gate can be gutted with every one of those assertions still green: replacing
// scripts/scan-artifact.ts with `process.exit(0)` leaves the declaration, the
// prepack binding and the file-exists check untouched. The controls below run
// the real script instead, so its verdict is what is under test.
//
// Over the kit's default domain threshold (20), and distinct *registrable*
// domains: forty subdomains of one domain count as one entry and do not trip it.
const CONTROL_INVENTORY = Array.from({ length: 40 }, (_, index) => `gate-control-${index + 1}.com`).join("\n");

// A file name no `files` entry can match, so it is present in the tree the gate
// runs in and absent from the artifact the gate scans.
const UNSHIPPED_CONTROL_FILE = "gate-control-unshipped.txt";

// The members that actually ship as files. `dist` is a directory and is skipped:
// it holds 11 MB of built bundles, it does not exist when CI runs `bun test`
// (build comes after), and the controls are about the gate's verdict on a
// shipped member, not about bundle contents.
function shippedFileMembers(): string[] {
  return (readJson<PackageJson>("package.json").files ?? []).filter((member) => {
    const path = join(repoRoot, member);
    return existsSync(path) && statSync(path).isFile();
  });
}

// The shipped members an inventory can be appended to. The manifest is excluded
// because the gate parses it for waivers, so appending to it fails the scan for
// the wrong reason — a JSON parse error rather than a bulk inventory.
function shippedTextMembers(): string[] {
  return shippedFileMembers().filter((member) => !member.endsWith(".json"));
}

// A minimal package that packs the way this repo packs, carrying the real
// scan script verbatim — `import.meta.dir` makes it treat the fixture as its
// repo root, so the fixture is what gets packed and scanned. Copying rather
// than re-implementing is the point: a no-op script body is a no-op control.
function packableFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "signatures-gate-control-"));
  // Without a resolvable local kit bin the script falls back to a networked
  // `bunx`, which would make these controls depend on the registry.
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "scripts"));
  cpSync(join(repoRoot, "scripts/scan-artifact.ts"), join(root, "scripts/scan-artifact.ts"));
  cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
  for (const member of shippedFileMembers()) cpSync(join(repoRoot, member), join(root, member));
  return root;
}

function removeFixture(root: string): void {
  // Unlink the borrowed node_modules explicitly before the recursive delete, so
  // no future refactor of this helper can reach the repo's own dependencies.
  rmSync(join(root, "node_modules"), { force: true });
  rmSync(root, { recursive: true, force: true });
}

function runGate(root: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync(["bun", "scripts/scan-artifact.ts"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode ?? 1,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

const GATE_TIMEOUT_MS = 120_000;

describe("hasna.contract.json", () => {
  it("is a hasna.service_contract.v1 manifest with no defect beyond the tracked storage gap", () => {
    // Loaded the way `contracts repo-conformance` loads it, so this test and the
    // manifest_valid check cannot disagree about what the manifest says.
    const result = loadServiceContractManifest(repoRoot);
    const issues = result.ok
      ? []
      : (result.issues ?? []).map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`);

    expect(issues).toEqual(KNOWN_MANIFEST_ISSUES);
  });

  it("declares the identity fields the v1 schema requires", () => {
    const manifest = readJson<Record<string, unknown>>("hasna.contract.json");

    expect(manifest["schema"]).toBe("hasna.service_contract.v1");
    expect(manifest["name"]).toBe("signatures");
    expect(manifest["class"]).toBe("cli-with-store");
    expect(manifest["contractVersion"]).toBe("v1");
    expect(manifest["kitVersion"]).toBeTruthy();
    // The pre-v1 keys this manifest replaced; the schema rejects all three.
    expect(manifest["version"]).toBeUndefined();
    expect(manifest["package"]).toBeUndefined();
    expect((manifest["storage"] as Record<string, unknown> | undefined)?.["waiver"]).toBeUndefined();
  });

  it("describes the SQLite store the code actually opens", () => {
    const storage = readJson<{ storage?: Record<string, unknown> }>("hasna.contract.json").storage;
    const database = readFileSync(join(repoRoot, "src/db/database.ts"), "utf8");

    expect(storage?.["mode"]).toBe("sqlite");
    expect(storage?.["engines"]).toEqual(["sqlite"]);
    expect(database).toContain(String(storage?.["envPrefix"]) + "DB_PATH");
    expect(database).toContain('join(home, ".hasna", "signatures", "signatures.db")');
    expect(storage?.["sqlitePath"]).toBe("~/.hasna/signatures/signatures.db");
  });

  it("tracks the kit version the release gate actually resolves", () => {
    const manifest = readJson<ContractManifest>("hasna.contract.json");
    const pkg = readJson<PackageJson>("package.json");

    expect(pkg.devDependencies?.[KIT_PACKAGE]).toBe(manifest.kitVersion);
  });
});

describe("packed-artifact release gate", () => {
  const pkg = readJson<PackageJson>("package.json");
  const manifest = readJson<ContractManifest>("hasna.contract.json");
  const scripts = pkg.scripts ?? {};
  const declared = manifest.metadata?.release?.artifactScan?.script;

  it("declares the scan script in the manifest", () => {
    // Required for every package that publishes; a private package has no
    // artifact to gate.
    expect(pkg.private).not.toBe(true);
    expect(declared).toBeTruthy();
    expect(declared !== undefined && declared in scripts).toBe(true);
  });

  it("binds the declared scan to prepack", () => {
    // prepack is the one lifecycle script both `npm pack` and `npm publish`
    // always run, so it is the only binding a publisher cannot step around.
    expect(scripts["prepack"]).toBeTruthy();
    expect([...resolveScriptGraph(scripts, "prepack")]).toContain(declared ?? "<undeclared>");
  });

  it("runs a real command rather than a no-op", () => {
    const body = declared === undefined ? "" : (scripts[declared] ?? "");
    expect(body.trim()).not.toBe("");
    expect(/^(?:true|exit(?: 0)?|echo\b)/.test(body.trim())).toBe(false);
  });

  it("scans a script that exists in the repo", () => {
    const body = declared === undefined ? "" : (scripts[declared] ?? "");
    const file = body.match(/\b(scripts\/[A-Za-z0-9._/-]+)/)?.[1];

    expect(file).toBeTruthy();
    expect(existsSync(join(repoRoot, file ?? ""))).toBe(true);
  });

  it("pins every package-runner invocation in the contract scripts", () => {
    const offenders = Object.entries(scripts)
      .filter(([name]) => name === "prepack" || name === declared || name.startsWith("contracts:"))
      .flatMap(([name, body]) => unpinnedPackageRunners(body).map((invocation) => `${name}: ${invocation}`));

    expect(offenders).toEqual([]);
  });

  // Positive control for the harness itself: if this fails, a later red control
  // proves nothing, because the gate would be failing on the fixture rather
  // than on what the fixture ships.
  it(
    "passes a clean packed artifact",
    () => {
      const fixture = packableFixture();
      try {
        const { exitCode, output } = runGate(fixture);

        expect(output).toContain("artifact-scan");
        expect(output).toContain("packed_artifact");
        expect(exitCode).toBe(0);
      } finally {
        removeFixture(fixture);
      }
    },
    GATE_TIMEOUT_MS
  );

  it(
    "fails when a shipped member carries a bulk asset inventory",
    () => {
      const [member] = shippedTextMembers();
      expect(member).toBeTruthy();

      const fixture = packableFixture();
      try {
        appendFileSync(join(fixture, member!), `\n${CONTROL_INVENTORY}\n`);
        const { exitCode, output } = runGate(fixture);

        // The reason is asserted, not just the exit code: a script that always
        // exits non-zero is as broken as one that always exits zero.
        expect(output).toContain(`FAIL ${member}`);
        expect(output).toContain("distinct domain entries");
        expect(exitCode).not.toBe(0);
      } finally {
        removeFixture(fixture);
      }
    },
    GATE_TIMEOUT_MS
  );

  it(
    "scans the packed artifact rather than the working tree",
    () => {
      const fixture = packableFixture();
      try {
        // The same inventory that fails above, in a file `files` does not carry.
        // A gate that walked the tree instead of the tarball would fail here.
        writeFileSync(join(fixture, UNSHIPPED_CONTROL_FILE), `${CONTROL_INVENTORY}\n`);
        const { exitCode, output } = runGate(fixture);

        expect(output).not.toContain(UNSHIPPED_CONTROL_FILE);
        expect(exitCode).toBe(0);
      } finally {
        removeFixture(fixture);
      }
    },
    GATE_TIMEOUT_MS
  );

  it("invokes only subcommands the pinned kit exposes", () => {
    const pinned = pkg.devDependencies?.[KIT_PACKAGE];
    expect(pinned).toBeTruthy();

    const help = Bun.spawnSync([join(repoRoot, "node_modules", ".bin", "contracts"), "--help"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(help.exitCode).toBe(0);
    const available = new Set(
      new TextDecoder()
        .decode(help.stdout)
        .split("\n")
        .map((line) => line.match(/^ {2}([a-z][a-z0-9-]*)/)?.[1])
        .filter((name): name is string => Boolean(name))
    );

    const invoked = Object.entries(scripts)
      .filter(([name]) => name.startsWith("contracts:"))
      .map(([name, body]) => {
        const tokens = body.trim().split(/\s+/);
        const runnerIndex = tokens.findIndex((token) => token === "bunx" || token === "npx");
        return { name, subcommand: tokens[runnerIndex + 2] };
      });

    expect(invoked.length).toBeGreaterThan(0);
    const unknown = invoked.filter(({ subcommand }) => !subcommand || !available.has(subcommand));
    expect(unknown.map(({ name, subcommand }) => `${name}: ${subcommand}`)).toEqual([]);
  });
});
