import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const dockerfile = readFileSync(dockerfilePath, "utf8");
const runnerStage = dockerfile.slice(dockerfile.indexOf(" AS runner\n") + " AS runner\n".length);

function position(fragment: string): number {
  const index = runnerStage.indexOf(fragment);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("runner Dockerfile security contract", () => {
  test("runs as the built-in non-root bun user", () => {
    const users = [...runnerStage.matchAll(/^USER\s+(\S+)\s*$/gm)].map((match) => match[1]);

    expect(users).toEqual(["bun"]);
    expect(runnerStage).not.toMatch(/^USER\s+(?:root|0(?::0)?)\s*$/m);
  });

  test("drops privileges after root-required package and file setup", () => {
    const user = position("USER bun");

    expect(user).toBeGreaterThan(position("RUN apk upgrade"));
    expect(user).toBeGreaterThan(position("COPY docker/rds-global-bundle.pem"));
    expect(user).toBeGreaterThan(position("COPY --from=prod-deps /app/node_modules"));
    expect(user).toBeGreaterThan(position("COPY --from=build /app/dist"));
    expect(user).toBeGreaterThan(position("COPY --from=build /app/src/lib/storage/fixtures/empty-tenant-backfill.json"));
    expect(user).toBeLessThan(position('CMD ["bun", "dist/serve/index.js"]'));
  });

  test("constrains postgresql client and libpq to the CVE-fixed Alpine versions", () => {
    // I38-00535: 36 HIGH libpq/postgresql16-client CVEs shipped in the runner
    // stage because `apk add postgresql16-client` silently installed whatever
    // the index held. Alpine published the fixes as postgresql16 16.15-r0 and
    // libpq 17.11-r0; the stage must constrain both so a vulnerable version
    // fails the build instead of shipping.
    const apkUpgradeStart = position("RUN apk upgrade");
    const copyStart = position("COPY docker/rds-global-bundle.pem");
    expect(copyStart).toBeGreaterThan(apkUpgradeStart);

    const apkBlock = runnerStage.slice(apkUpgradeStart, copyStart);
    expect(apkBlock).toMatch(/postgresql16-client>=16\.15-r0/);
    expect(apkBlock).toMatch(/libpq>=17\.11-r0/);
  });
});
