import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelectedSecretBindings, redactExecutionSecrets } from "./execution-secrets.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
test("binding files reject symlinks, directories, invalid UTF8/JSON and over-limit input without echoing it", () => {
  const root = mkdtempSync(join(tmpdir(), "secret-binding-read-")); roots.push(root);
  const file = join(root, "binding.json"), link = join(root, "symlink.json");
  writeFileSync(file, "{}"); symlinkSync(file, link);
  expect(JSON.stringify(readSelectedSecretBindings(file))).toBe("{}");
  for (const path of [root, link, join(root, "absent")]) expect(() => readSelectedSecretBindings(path)).toThrow("regular JSON file");
  const privateText = crypto.randomUUID();
  for (const bytes of [Buffer.from(privateText), Buffer.from([0xff]), Buffer.from(" ".repeat(65_537))]) {
    writeFileSync(file, bytes);
    let error: any; try { readSelectedSecretBindings(file); } catch (e) { error = e; }
    expect(error.code).toBe("INVALID_SECRET_BINDINGS"); expect(error.message).not.toContain(privateText);
  }
});
test("redaction handles encoding, chunk-joined output and unusual Unicode without exposing values", () => {
  const value = crypto.randomUUID() + '\n"🧭';
  const env = { PROVIDER_TOKEN: value };
  for (const encoded of [value, JSON.stringify(value).slice(1, -1), Buffer.from(value).toString("base64"), encodeURIComponent(value)]) {
    expect(redactExecutionSecrets(`before:${encoded}:after`, env)).toBe("before:[REDACTED]:after");
  }
  expect(redactExecutionSecrets("\ud800", { PROVIDER_TOKEN: "\ud800" })).toBe("[REDACTED]");
});
