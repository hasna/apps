import { type ArtifactAttestation, type BuildArtifact, type DeploymentApprovalDecision, type DeploymentAttempt, type DeploymentPlan, type DeploymentReceipt, type DeploymentRequest, type EnvironmentBinding, type IntentSnapshot, type LaunchEvidence, type ProductProjection, type ProviderReceipt, type VerifiedSourceCandidate } from "./schemas";
import { type DeploymentContractSet, type DeploymentSchemaId } from "./deployment";
export interface DeploymentFixtureSet {
    productProjection: ProductProjection;
    intentSnapshot: IntentSnapshot;
    verifiedSourceCandidate: VerifiedSourceCandidate;
    buildArtifact: BuildArtifact;
    artifactAttestation: ArtifactAttestation;
    environmentBinding: EnvironmentBinding;
    deploymentRequest: DeploymentRequest;
    deploymentPlan: DeploymentPlan;
    deploymentApprovalDecision: DeploymentApprovalDecision;
    deploymentAttempt: DeploymentAttempt;
    providerReceipt: ProviderReceipt;
    deploymentReceipt: DeploymentReceipt;
    launchEvidence: LaunchEvidence;
}
export declare function createDeploymentFixtureSet(): DeploymentFixtureSet;
export declare function deploymentFixtureSetToContractSet(fixtures: DeploymentFixtureSet): DeploymentContractSet;
export declare function deploymentFixturesBySchemaId(fixtures: DeploymentFixtureSet): Readonly<Record<DeploymentSchemaId, unknown>>;
