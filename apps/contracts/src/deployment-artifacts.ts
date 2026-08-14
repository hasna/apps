import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DeploymentSchemaRegistry,
} from "./schemas";
import {
  createDeploymentFixtureSet,
  deploymentFixtureSetToContractSet,
  deploymentFixturesBySchemaId,
} from "./deployment-fixtures";
import {
  DEPLOYMENT_CONTRACT_VERSION,
  DEPLOYMENT_SCHEMA_IDS,
  canonicalizeDeploymentValue,
  sha256DeploymentText,
  sha256DeploymentValue,
  stableDeploymentJson,
  type DeploymentSchemaId,
} from "./deployment";

export const DEPLOYMENT_SCHEMA_BUNDLE_ID =
  "hasna.deployment.schema_bundle.v1" as const;
export const DEPLOYMENT_FIXTURE_BUNDLE_ID =
  "hasna.deployment.fixture_bundle.v1" as const;

export interface DeploymentSchemaBundle {
  schema: typeof DEPLOYMENT_SCHEMA_BUNDLE_ID;
  contractVersion: typeof DEPLOYMENT_CONTRACT_VERSION;
  schemaDigest: string;
  runtimeValidationRequired: true;
  crossRecordValidationRequired: true;
  schemas: Readonly<Record<DeploymentSchemaId, Record<string, unknown>>>;
}

export interface DeploymentFixtureBundle {
  schema: typeof DEPLOYMENT_FIXTURE_BUNDLE_ID;
  contractVersion: typeof DEPLOYMENT_CONTRACT_VERSION;
  fixtureDigest: string;
  fixtures: ReturnType<typeof deploymentFixtureSetToContractSet>;
}

function prettyDeploymentJson(value: unknown): string {
  return `${JSON.stringify(canonicalizeDeploymentValue(value), null, 2)}\n`;
}

function fixtureName(schemaId: DeploymentSchemaId): string {
  return schemaId
    .replace(/^hasna\./, "")
    .replace(/\.v[0-9]+$/, "")
    .replaceAll("_", "-");
}

export function buildDeploymentJsonSchemas():
  Readonly<Record<DeploymentSchemaId, Record<string, unknown>>> {
  const schemas = Object.fromEntries(
    Object.entries(DeploymentSchemaRegistry)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([schemaId, schema]) => {
        const jsonSchema = zodToJsonSchema(schema, {
          target: "jsonSchema7",
          $refStrategy: "root",
          effectStrategy: "input",
        }) as Record<string, unknown>;
        return [
          schemaId,
          {
            ...jsonSchema,
            $id: schemaId,
            "x-hasna-runtime-validation-required": true,
            "x-hasna-cross-record-validation-required": true,
          },
        ];
      }),
  ) as unknown as Record<DeploymentSchemaId, Record<string, unknown>>;
  return Object.freeze(schemas);
}

export function buildDeploymentSchemaBundle(): DeploymentSchemaBundle {
  const schemas = buildDeploymentJsonSchemas();
  return {
    schema: DEPLOYMENT_SCHEMA_BUNDLE_ID,
    contractVersion: DEPLOYMENT_CONTRACT_VERSION,
    schemaDigest: sha256DeploymentValue(schemas),
    runtimeValidationRequired: true,
    crossRecordValidationRequired: true,
    schemas,
  };
}

export function buildDeploymentFixtureBundle(): DeploymentFixtureBundle {
  const fixtureSet = createDeploymentFixtureSet();
  const fixtures = deploymentFixtureSetToContractSet(fixtureSet);
  return {
    schema: DEPLOYMENT_FIXTURE_BUNDLE_ID,
    contractVersion: DEPLOYMENT_CONTRACT_VERSION,
    fixtureDigest: sha256DeploymentValue(fixtures),
    fixtures,
  };
}

export function renderDeploymentArtifacts(): Readonly<Record<string, string>> {
  const fixtureSet = createDeploymentFixtureSet();
  const fixturesBySchemaId = deploymentFixturesBySchemaId(fixtureSet);
  const schemaBundle = buildDeploymentSchemaBundle();
  const fixtureBundle = buildDeploymentFixtureBundle();
  const artifacts: Record<string, string> = {
    "schema-bundle.json": prettyDeploymentJson(schemaBundle),
    "fixture-bundle.json": prettyDeploymentJson(fixtureBundle),
  };

  for (const schemaId of Object.values(DEPLOYMENT_SCHEMA_IDS)) {
    artifacts[`fixtures/${fixtureName(schemaId)}.valid.json`] =
      prettyDeploymentJson(fixturesBySchemaId[schemaId]);
  }

  const checksums = Object.fromEntries(
    Object.entries(artifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, content]) => [path, sha256DeploymentText(content)]),
  );
  artifacts["checksums.json"] = prettyDeploymentJson({
    schema: "hasna.deployment.artifact_checksums.v1",
    contractVersion: DEPLOYMENT_CONTRACT_VERSION,
    files: checksums,
    manifestDigest: sha256DeploymentValue(checksums),
  });

  return Object.freeze(
    Object.fromEntries(
      Object.entries(artifacts)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function deploymentArtifactsDigest(): string {
  return sha256DeploymentText(stableDeploymentJson(renderDeploymentArtifacts()));
}
