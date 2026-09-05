import * as realFs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";
const scratch = mkdtempSync(join(tmpdir(), "skills-review-race-"));
const credentialFile = join(scratch, "skills/config/credentials");
mkdirSync(join(scratch, "skills/config"), { recursive: true, mode: 0o700 });
const oldKey = "fake-review-old-instance-key", newKey = "fake-review-new-instance-key";
const text = (key: string, origin: string) => `HASNA_SKILLS_API_KEY=${key}\nHASNA_SKILLS_API_URL=${origin}\nHASNA_SKILLS_BOUND_API_URL=${origin}\n`;
writeFileSync(credentialFile, text(oldKey, "https://old.example.test"), { mode: 0o600 });
let rotated = false; let capturedFd: number | undefined;
const originalRead = realFs.readFileSync; const originalStat = realFs.fstatSync;
mock.module("node:fs", () => ({ ...realFs, readFileSync: (...args: any[]) => {
  const value = (originalRead as any)(...args);
  if (!rotated && typeof args[0] === "number" && Buffer.isBuffer(value) && value.includes(oldKey)) capturedFd = args[0];
  return value;
}, fstatSync: (...args: any[]) => {
  const value = (originalStat as any)(...args);
  if (!rotated && args[0] === capturedFd) {
    writeFileSync(`${credentialFile}.next`, text(newKey, "https://new.example.test"), { mode: 0o600 });
    renameSync(`${credentialFile}.next`, credentialFile); rotated = true;
  }
  return value;
} }));
try {
  const { resolveSkillsConnection } = await import("./fleet-credentials.js");
  const result = await resolveSkillsConnection({ HASNA_HOME: scratch, HASNA_SKILLS_API_URL: "https://new.example.test" }, { credentials: { keychain: { enabled: false } } });
  console.log(JSON.stringify({ rotated, wrongInstanceCredentialPair: result?.apiKey === oldKey && result.apiOrigin === "https://new.example.test" }));
} catch (error: any) { console.log(JSON.stringify({ rotated, refused: true, name: error?.name, code: error?.code })); }
finally { rmSync(scratch, { recursive: true, force: true }); }
