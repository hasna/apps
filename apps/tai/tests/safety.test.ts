import { expect, test } from "bun:test";
import { classifyCommand } from "../src/safety";

test("allows clear read-only commands", () => {
  expect(classifyCommand("ls -la").risk).toBe("allow");
  expect(classifyCommand("git status --short").risk).toBe("allow");
  expect(classifyCommand("git log --oneline -5").risk).toBe("allow");
});

test("allows the complete read-only git boundary", () => {
  expect(classifyCommand("git remote -v").risk).toBe("allow");
  expect(classifyCommand("git branch --show-current").risk).toBe("allow");
  expect(classifyCommand("git ls-tree HEAD").risk).toBe("allow");
  expect(classifyCommand("git blame README.md").risk).toBe("allow");
});

test("recognizes environment-prefixed and absolute read-only commands", () => {
  expect(classifyCommand("FOO=bar rg needle src").risk).toBe("allow");
  expect(classifyCommand("/usr/bin/wc -l README.md").risk).toBe("allow");
});

test("requires confirmation for writes and network operations", () => {
  expect(classifyCommand("mkdir tmp").risk).toBe("confirm");
  expect(classifyCommand("curl https://example.com").risk).toBe("confirm");
  expect(classifyCommand("git commit -am test").risk).toBe("confirm");
  expect(classifyCommand("git push origin main").risk).toBe("confirm");
});

test("defaults unknown and composed commands to confirmation", () => {
  expect(classifyCommand("printf hello").risk).toBe("confirm");
  expect(classifyCommand("").risk).toBe("confirm");
  expect(classifyCommand("git status; touch changed").risk).toBe("confirm");
  expect(classifyCommand("ls | tee listing.txt").risk).toBe("confirm");
});

test("blocks destructive and credential-sensitive operations", () => {
  expect(classifyCommand("rm -rf /tmp/example").risk).toBe("block");
  expect(classifyCommand("git push --force origin main").risk).toBe("block");
  expect(classifyCommand("git reset --hard HEAD~1").risk).toBe("block");
  expect(classifyCommand("cat .env").risk).toBe("block");
  expect(classifyCommand("git show HEAD:.env").risk).toBe("block");
  expect(classifyCommand("git diff --no-index .env /dev/null").risk).toBe("block");
  expect(classifyCommand("ls $(touch /tmp/tai-pwn)").risk).toBe("block");
  expect(classifyCommand("cat `touch /tmp/tai-pwn`").risk).toBe("block");
  expect(classifyCommand("awk 'BEGIN { system(\"touch /tmp/tai-pwn\") }'").risk).toBe("block");
  expect(classifyCommand("find . -delete").risk).toBe("block");
  expect(classifyCommand("find . -exec touch x {} +").risk).toBe("block");
});

test("blocks privilege, publication, and bounded credential paths", () => {
  expect(classifyCommand("sudo -n true").risk).toBe("block");
  expect(classifyCommand("npm publish --dry-run").risk).toBe("block");
  expect(classifyCommand("curl https://example.com/.env.backup").risk).toBe("block");
  expect(classifyCommand("cat ~/.config/gh/hosts.yml").risk).toBe("block");
  expect(classifyCommand("cat secrets.json").risk).toBe("block");
  expect(classifyCommand("curl https://example.com/token.txt").risk).toBe("block");
  expect(classifyCommand("curl https://example.test/?token=fixture").risk).toBe("block");
  expect(classifyCommand("curl https://example.test/?access_token=fixture").risk).toBe("block");
  expect(classifyCommand("wget https://example.test/?client_secret=fixture").risk).toBe("block");
});

test("does not confuse harmless source names with credential paths", () => {
  expect(classifyCommand("cat src/tokenizer.ts").risk).toBe("allow");
  expect(classifyCommand("rg tokenizer src/tokenizer.ts").risk).toBe("allow");
  expect(classifyCommand("sed -n 1,20p src/keychain-view.ts").risk).toBe("allow");
});

test("reports stable override semantics and reasons for every risk class", () => {
  const allowed = classifyCommand("git diff --stat");
  expect(allowed).toEqual({
    risk: "allow",
    reasons: ["read-only git inspection command"],
    requiresOverride: false,
  });

  const confirmed = classifyCommand("touch output.txt");
  expect(confirmed.risk).toBe("confirm");
  expect(confirmed.requiresOverride).toBeFalse();
  expect(confirmed.reasons).toContain("filesystem write or metadata change");

  const blocked = classifyCommand("rm --recursive --force output");
  expect(blocked.risk).toBe("block");
  expect(blocked.requiresOverride).toBeTrue();
  expect(blocked.reasons).toContain("destructive recursive or forced remove");
});
