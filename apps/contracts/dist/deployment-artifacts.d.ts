import { deploymentFixtureSetToContractSet } from "./deployment-fixtures";
import { DEPLOYMENT_CONTRACT_VERSION, type DeploymentSchemaId } from "./deployment";
export declare const DEPLOYMENT_SCHEMA_BUNDLE_ID: "hasna.deployment.schema_bundle.v1";
export declare const DEPLOYMENT_FIXTURE_BUNDLE_ID: "hasna.deployment.fixture_bundle.v1";
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
export declare function buildDeploymentJsonSchemas(): Readonly<Record<DeploymentSchemaId, Record<string, unknown>>>;
export declare function buildDeploymentSchemaBundle(): DeploymentSchemaBundle;
export declare function buildDeploymentFixtureBundle(): DeploymentFixtureBundle;
export declare function renderDeploymentArtifacts(): Readonly<Record<string, string>>;
export declare function deploymentArtifactsDigest(): string;
