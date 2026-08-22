import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database";
import { upsertRepo, setRepoLookupPathStateForTests } from "../db/repos";
import { findFile, fuzzyFindRepo, importFromOrg } from "./utils";
import { setClonesRootForTests } from "./worktrees";

let testDir = "";

function createTrackedRepo(name: string): string {
  const repoPath = join(testDir, name);
  mkdirSync(repoPath, { recursive: true });

  execFileSync("git", ["init"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath, stdio: "pipe" });

  writeFileSync(join(repoPath, "needle.txt"), "content");
  execFileSync("git", ["add", "needle.txt"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath, stdio: "pipe" });

  return repoPath;
}

beforeEach(() => {
  closeDb();
  testDir = join(tmpdir(), `repos-utils-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  getDb(":memory:");
});

afterEach(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  rmSync(testDir, { recursive: true, force: true });
});

describe("utils", () => {
  describe("findFile", () => {
    it("handles repo paths containing shell metacharacters without executing them", () => {
      const markerName = `utils-path-injection-marker-${process.pid}`;
      const markerPath = join(process.cwd(), markerName);
      const repoPath = createTrackedRepo(`quoted"; touch ${markerName}; #`);
      upsertRepo({ path: repoPath, name: "quoted-repo" });

      try {
        const results = findFile("needle");
        expect(results).toEqual([
          {
            repo_name: "quoted-repo",
            repo_path: repoPath,
            matches: ["needle.txt"],
          },
        ]);
        expect(existsSync(markerPath)).toBe(false);
      } finally {
        rmSync(markerPath, { force: true });
      }
    });

    it("handles filenames containing shell metacharacters without executing them", () => {
      const markerName = `utils-filename-injection-marker-${process.pid}`;
      const markerPath = join(process.cwd(), markerName);
      const repoPath = createTrackedRepo("plain-repo");
      upsertRepo({ path: repoPath, name: "plain-repo" });

      try {
        const results = findFile(`needle"; touch ${markerName}; #`);
        expect(results).toEqual([]);
        expect(existsSync(markerPath)).toBe(false);
      } finally {
        rmSync(markerPath, { force: true });
      }
    });
  });

  // Regression for todos c357a1f3: getRepo() now refuses to resolve a bare
  // name to a factory scratch clone (see db/repos.test.ts), which routes the
  // CLI through requireRepo()'s "not found" + fuzzy-suggestion path. Without
  // this exclusion, fuzzyFindRepo's own "exact match" query re-finds the very
  // row getRepo just refused and suggests it right back.
  describe("fuzzyFindRepo", () => {
    beforeEach(() => {
      // The seeded checkouts live at synthetic /home/u/ paths that do not
      // exist on the test runner. Declare them present so the dead-path
      // exclusion (todos 0251863c) does not silence the suggestions these
      // tests assert.
      setRepoLookupPathStateForTests((path) =>
        path.startsWith("/home/u/") ? "present" : "missing",
      );
    });

    afterEach(() => setRepoLookupPathStateForTests(null));

    it("does not suggest a factory scratch clone when a canonical checkout exists under a different name", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-loops",
        name: "open-loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/_factory_src/loops",
        name: "loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });

      const match = fuzzyFindRepo("loops");
      expect(match).toBeTruthy();
      expect(match!.name).toBe("open-loops");
      expect(match!.path).not.toContain("_factory_src");
    });

    it("still finds a real checkout by substring even when a same-substring scratch clone is shorter", () => {
      // Substring match orders by LENGTH(name) ASC, so the (excluded) mirror
      // being the shortest name containing "loops" must not win by default.
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-loops",
        name: "open-loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/_factory_src/loops",
        name: "loops",
        org: "hasna",
        remote_url: "github.com/hasna/loops",
      });

      const match = fuzzyFindRepo("loop");
      expect(match).toBeTruthy();
      expect(match!.name).toBe("open-loops");
    });

    // ── importFromOrg — regression for todos ffda4d33 ──────────────────────
    // The verb previously issued one `gh repo list <org> --limit 500` call, so
    // an org with more than 500 visible repos silently imported only the first
    // 500 while the progress line reported the truncated count as the full
    // population. These tests drive the verb against a fake `gh` on PATH.
    describe("importFromOrg", () => {
      const org = "big-org";
      let savedPath = "";

      function repoObject(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return { name, ssh_url: `git@github.com:big-org/${name}.git`, archived: false, fork: false, ...overrides };
      }

      function createFakeGh(binDir: string): void {
        mkdirSync(binDir, { recursive: true });
        // Emulates `gh api --paginate <endpoint> --jq <expr>`: runs the jq
        // expression the code passes over a JSON payload file, or fails /
        // emits garbage when the matching env switch is set. Records argv.
        writeFileSync(join(binDir, "gh"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_GH_LOG:-/dev/null}"
if [ "\${FAKE_GH_FAIL:-0}" = "1" ]; then
  echo "gh: not authenticated" >&2
  exit 1
fi
if [ "\${FAKE_GH_MALFORMED:-0}" = "1" ]; then
  printf 'this is not tsv output\\n'
  exit 0
fi
if [ -n "\${FAKE_GH_PAYLOAD:-}" ] && [ -f "\${FAKE_GH_PAYLOAD}" ]; then
  jq_expr=""
  prev=""
  for a in "$@"; do
    if [ "\${prev}" = "--jq" ]; then jq_expr="\${a}"; fi
    prev="\${a}"
  done
  if [ -z "\${jq_expr}" ]; then
    echo "gh: no --jq expression" >&2
    exit 2
  fi
  exec jq -r "\${jq_expr}" "\${FAKE_GH_PAYLOAD}"
fi
exit 1
`);
        chmodSync(join(binDir, "gh"), 0o755);
      }

      function armFakeGh(opts: { payloadPath?: string; fail?: boolean; malformed?: boolean }): string {
        const binDir = join(testDir, "fake-bin");
        const logPath = join(testDir, "gh-argv.log");
        createFakeGh(binDir);
        savedPath = process.env.PATH ?? "";
        process.env.PATH = `${binDir}:${savedPath}`;
        process.env.FAKE_GH_LOG = logPath;
        delete process.env.FAKE_GH_PAYLOAD;
        delete process.env.FAKE_GH_FAIL;
        delete process.env.FAKE_GH_MALFORMED;
        if (opts.payloadPath) process.env.FAKE_GH_PAYLOAD = opts.payloadPath;
        if (opts.fail) process.env.FAKE_GH_FAIL = "1";
        if (opts.malformed) process.env.FAKE_GH_MALFORMED = "1";
        return logPath;
      }

      function disarmFakeGh(): void {
        if (savedPath) process.env.PATH = savedPath;
        delete process.env.FAKE_GH_LOG;
        delete process.env.FAKE_GH_PAYLOAD;
        delete process.env.FAKE_GH_FAIL;
        delete process.env.FAKE_GH_MALFORMED;
        setClonesRootForTests(null);
      }

      it("imports every repo of an org with more than 500 visible repos (no 500 cap)", () => {
        const clonesRoot = join(testDir, "clones");
        setClonesRootForTests(clonesRoot);
        const total = 558;
        const payload = Array.from({ length: total }, (_, i) => repoObject(`repo-${String(i).padStart(3, "0")}`));
        const payloadPath = join(testDir, "payload.json");
        writeFileSync(payloadPath, JSON.stringify(payload));
        // Pre-create every destination so the verb counts them as skips and
        // never shells out to git — a skipped count of `total` proves every
        // listed repo was seen and its name parsed, and zero errors proves no
        // clone was attempted for a mistyped name.
        for (const repo of payload) {
          mkdirSync(join(clonesRoot, org, repo.name as string), { recursive: true });
        }
        const logPath = armFakeGh({ payloadPath });

        const progress: string[] = [];
        const result = importFromOrg(org, { onProgress: (msg: string) => progress.push(msg) });
        disarmFakeGh();

        expect(result).toEqual({ cloned: 0, skipped: total, errors: [] });
        expect(progress).toContain(`Found ${total} repos in ${org}`);
        const argv = readFileSync(logPath, "utf-8");
        expect(argv).toContain("--paginate");
        expect(argv).toContain("/orgs/big-org/repos?per_page=100");
        expect(argv).not.toContain("--limit");
      });

      it("excludes archived repos (keeps the old --no-archived semantics)", () => {
        const clonesRoot = join(testDir, "clones");
        setClonesRootForTests(clonesRoot);
        const payload = [
          repoObject("live-one"),
          repoObject("archived-one", { archived: true }),
          repoObject("live-two"),
        ];
        const payloadPath = join(testDir, "payload.json");
        writeFileSync(payloadPath, JSON.stringify(payload));
        for (const name of ["live-one", "live-two"]) {
          mkdirSync(join(clonesRoot, org, name), { recursive: true });
        }
        const logPath = armFakeGh({ payloadPath });

        const result = importFromOrg(org, { onProgress: () => {} });
        disarmFakeGh();

        // The archived repo's destination was not pre-created, so had it been
        // listed the verb would have attempted a clone and recorded an error.
        expect(result).toEqual({ cloned: 0, skipped: 2, errors: [] });
        expect(readFileSync(logPath, "utf-8")).toContain("select(.archived == false)");
      });

      it("returns the typed errors array instead of throwing on malformed gh output", () => {
        armFakeGh({ malformed: true });
        try {
          const result = importFromOrg(org, { onProgress: () => {} });
          expect(result).toEqual({ cloned: 0, skipped: 0, errors: ["Failed to list repos from GitHub"] });
        } finally {
          disarmFakeGh();
        }
      });

      it("returns the typed errors array instead of throwing when gh fails", () => {
        armFakeGh({ fail: true });
        try {
          const result = importFromOrg(org, { onProgress: () => {} });
          expect(result).toEqual({ cloned: 0, skipped: 0, errors: ["Failed to list repos from GitHub"] });
        } finally {
          disarmFakeGh();
        }
      });

      it("records a typed error for repos whose names are unusable as directory segments instead of aborting the import", () => {
        const clonesRoot = join(testDir, "clones");
        setClonesRootForTests(clonesRoot);
        // A dot-name repo (real orgs carry `.github`) and a unicode-name repo
        // both fail the destination segment guard; one misnamed repo must not
        // abort the whole import.
        const payload = [repoObject(".github"), repoObject("café"), repoObject("live-one")];
        const payloadPath = join(testDir, "payload.json");
        writeFileSync(payloadPath, JSON.stringify(payload));
        mkdirSync(join(clonesRoot, org, "live-one"), { recursive: true });
        armFakeGh({ payloadPath });

        let result: ReturnType<typeof importFromOrg>;
        try {
          result = importFromOrg(org, { onProgress: () => {} });
        } finally {
          disarmFakeGh();
        }

        expect(result.skipped).toBe(1);
        expect(result.cloned).toBe(0);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.some((e) => e.startsWith(".github:"))).toBe(true);
        expect(result.errors.some((e) => e.startsWith("café:"))).toBe(true);
      });
    });

    it("returns null rather than a scratch clone when nothing else matches", () => {
      // No canonical sibling exists here — confirms the exclusion degrades to
      // "no suggestion" instead of falling back to the excluded row.
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/_factory_src/onlymirror",
        name: "onlymirror",
        org: "hasna",
      });
      expect(fuzzyFindRepo("onlymirror")).toBeNull();
    });

    // Regression for todos 0251863c: the CLI suggested the dead pre-migration
    // path (`open-bench`) for a bare name that failed exact resolution. A
    // suggestion whose path no longer exists sends the caller to nowhere, so
    // fuzzy matching must never surface a missing-path row.
    it("never suggests a registry row whose path is gone (stale pre-migration rows)", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });
      setRepoLookupPathStateForTests(() => "missing");

      expect(fuzzyFindRepo("bench")).toBeNull();
      expect(fuzzyFindRepo("open")).toBeNull();
    });

    it("still suggests a present pre-migration-named row when nothing better exists", () => {
      upsertRepo({
        path: "/home/u/workspace/hasna/opensource/open-bench",
        name: "open-bench",
        org: "hasna",
        remote_url: "github.com/hasna/bench",
      });
      setRepoLookupPathStateForTests(() => "present");

      const match = fuzzyFindRepo("bench");
      expect(match).toBeTruthy();
      expect(match!.name).toBe("open-bench");
    });
  });
});
