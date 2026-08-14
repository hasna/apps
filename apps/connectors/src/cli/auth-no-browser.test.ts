import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getCurrentOAuthProfile,
  getOAuthTokenPathsForProfile,
  hasOAuthTokenFileUpdatedSince,
} from "./commands/auth.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempConnectorsHome(): string {
  const dir = join(tmpdir(), `connectors-auth-no-browser-${randomUUID()}`);
  tempDirs.push(dir);
  return dir;
}

describe("no-browser OAuth helpers", () => {
  test("uses the connector current_profile for token polling", () => {
    const connectorsHome = tempConnectorsHome();
    const configDir = join(connectorsHome, "connect-googledrive");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "current_profile"), "andreihasnacom\n");

    expect(getCurrentOAuthProfile("googledrive", connectorsHome)).toBe("andreihasnacom");
    const tokenPaths = getOAuthTokenPathsForProfile("googledrive", connectorsHome);
    expect(tokenPaths).toContain(join(configDir, "profiles", "andreihasnacom", "tokens.json"));
    expect(tokenPaths.every((path) => path.includes("/profiles/andreihasnacom/tokens.json"))).toBe(true);
  });

  test("does not treat stale token files as completed OAuth callbacks", () => {
    const connectorsHome = tempConnectorsHome();
    const profileDir = join(connectorsHome, "connect-googledrive", "profiles", "andreihasnacom");
    mkdirSync(profileDir, { recursive: true });
    const tokensPath = join(profileDir, "tokens.json");
    writeFileSync(tokensPath, JSON.stringify({ accessToken: "old" }));

    const startedAt = Date.now() + 10_000;
    expect(hasOAuthTokenFileUpdatedSince([tokensPath], startedAt)).toBe(false);
  });

  test("detects token files written after the OAuth server starts", () => {
    const connectorsHome = tempConnectorsHome();
    const profileDir = join(connectorsHome, "connect-googledrive", "profiles", "andreihasnacom");
    mkdirSync(profileDir, { recursive: true });
    const tokensPath = join(profileDir, "tokens.json");
    const startedAt = Date.now() - 10_000;

    writeFileSync(tokensPath, JSON.stringify({ accessToken: "new" }));

    expect(hasOAuthTokenFileUpdatedSince([tokensPath], startedAt)).toBe(true);
  });
});
