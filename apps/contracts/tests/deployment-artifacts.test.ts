import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildDeploymentFixtureBundle,
  buildDeploymentJsonSchemas,
  buildDeploymentSchemaBundle,
  renderDeploymentArtifacts,
} from "../src/deployment-artifacts";
import {
  DEPLOYMENT_GENERATED_ARTIFACT_ROOT,
  DEPLOYMENT_SCHEMA_IDS,
  sha256DeploymentText,
  sha256DeploymentValue,
} from "../src/deployment";

const repositoryRoot = join(import.meta.dir, "..");
const generatedRoot = join(
  repositoryRoot,
  DEPLOYMENT_GENERATED_ARTIFACT_ROOT,
);

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path));
      }
    }
  };
  walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

describe("deployment generated artifacts", () => {
  test("schema and fixture bundles are deterministic", () => {
    expect(buildDeploymentSchemaBundle()).toEqual(
      buildDeploymentSchemaBundle(),
    );
    expect(buildDeploymentFixtureBundle()).toEqual(
      buildDeploymentFixtureBundle(),
    );
    expect(renderDeploymentArtifacts()).toEqual(renderDeploymentArtifacts());
  });

  test("the schema bundle registers every exact deployment schema id", () => {
    const schemas = buildDeploymentJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual(
      Object.values(DEPLOYMENT_SCHEMA_IDS).sort(),
    );
    for (const [schemaId, schema] of Object.entries(schemas)) {
      expect(schema.$id).toBe(schemaId);
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(schema["x-hasna-runtime-validation-required"]).toBe(true);
      expect(schema["x-hasna-cross-record-validation-required"]).toBe(true);
    }

    const bundle = buildDeploymentSchemaBundle();
    expect(bundle.schemaDigest).toBe(sha256DeploymentValue(bundle.schemas));
  });

  test("checked-in artifacts match the renderer byte for byte", () => {
    const rendered = renderDeploymentArtifacts();
    expect(listFiles(generatedRoot)).toEqual(Object.keys(rendered));
    for (const [path, expected] of Object.entries(rendered)) {
      expect(readFileSync(join(generatedRoot, path), "utf8")).toBe(expected);
    }
  });

  test("the checksum manifest authenticates every other generated artifact", () => {
    const rendered = renderDeploymentArtifacts();
    const manifest = JSON.parse(rendered["checksums.json"]!) as {
      files: Record<string, string>;
      manifestDigest: string;
    };
    const expectedPaths = Object.keys(rendered)
      .filter((path) => path !== "checksums.json")
      .sort((left, right) => left.localeCompare(right));
    expect(Object.keys(manifest.files)).toEqual(expectedPaths);
    for (const path of expectedPaths) {
      expect(manifest.files[path]).toBe(sha256DeploymentText(rendered[path]!));
    }
    expect(manifest.manifestDigest).toBe(
      sha256DeploymentValue(manifest.files),
    );
  });
});
