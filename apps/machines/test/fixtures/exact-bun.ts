import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

export const exactBunFixtureSource = Buffer.from("export const exactAppsFixture = true;\n");

export const exactBunTargetFixtures = [
  {
    id: "station01",
    platform: "linux" as const,
    bunPath: "/home/hasna/.bun/bin/bun",
    machinesVersion: "0.2.18",
    targetExactBunCommands: false,
    outdatedFactoryVersion: "0.6.8",
  },
  {
    id: "station03",
    platform: "macos" as const,
    bunPath: "/Users/hasna/.bun/bin/bun",
    machinesVersion: "0.2.17",
    targetExactBunCommands: false,
    outdatedFactoryVersion: "0.6.3",
  },
] as const;

export interface ExactBunCandidateOptions {
  platform?: "linux" | "macos";
  bunPath?: string;
}

export function exactBunCandidate(machineId = "station-exact", options: ExactBunCandidateOptions = {}): Record<string, unknown> {
  const source = {
    provider: "files",
    ref: "asset_exact_apps_fixture",
    sha256: createHash("sha256").update(exactBunFixtureSource).digest("hex"),
    sizeBytes: exactBunFixtureSource.byteLength,
  };
  const common = {
    schema: "machines.exact_bun_registry.v1",
    mode: "live-global",
    source,
    secretRefs: ["hasna/npm/live/publish-token", "hasnaxyz/npm/live/publish-token"],
    quarantine: {
      minimumReleaseAge: 604800,
      exactExclusions: ["@hasnaxyz/infinity", "@hasnaxyz/factory", "@hasna/secrets", "@hasna/events"],
    },
    rollback: "byte-preimage",
  };
  return {
    version: 1,
    machines: [{
      id: machineId,
      friendlyName: "private name",
      sshAddress: "private-user@private-host",
      platform: options.platform ?? "linux",
      workspacePath: "/private/workspace",
      bunPath: options.bunPath ?? "/private/home/.bun/bin/bun",
      metadata: { private: "must-not-escape" },
      packages: [
        {
          name: "@hasnaxyz/infinity",
          manager: "bun",
          version: "1.0.12",
          bin: "infinity",
          exactBunRegistry: {
            ...common,
            order: 10,
            archiveSha256: "09601425f753a053b3a55303448acd55da2acf1625916587f3e4f46c25af16d8",
            registryIntegrity: "sha512-Q0qujfbzuEpAaW3gManHgMnp9przdIxcqY2hzDrX1ZN9ssBbQS2Dx3lLhse7pUSLyZU0nxODZAdFKwWNAkRVVA==",
            probe: { sdkImport: "@hasnaxyz/infinity", cli: { bin: "infinity", args: ["--help"] } },
          },
        },
        {
          name: "@hasnaxyz/factory",
          manager: "bun",
          version: "0.6.9",
          bin: "factory",
          exactBunRegistry: {
            ...common,
            order: 20,
            archiveSha256: "d7452f2903738761b33450bfdaeadda9631d140ed29eafee4cc3a482380a3d70",
            registryIntegrity: "sha512-Up6mD2fYBFPlrOkqpEngaDk3ANKiM4wMr8ikCd/widCXNZpOu8SNwbIvzP7QP2lqymdFzhLrUY1Izh1Qo24fFA==",
            probe: { sdkImport: "@hasnaxyz/factory", cli: { bin: "factory", args: ["--help"] } },
          },
        },
      ],
    }],
  };
}

export function writeExactBunCandidate(path: string, machineId = "station-exact", options: ExactBunCandidateOptions = {}): void {
  writeFileSync(path, `${JSON.stringify(exactBunCandidate(machineId, options), null, 2)}\n`);
}
