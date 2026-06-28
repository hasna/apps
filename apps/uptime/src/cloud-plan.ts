export interface AwsDeploymentPlanOptions {
  accountName?: string;
  region?: string;
  stage?: string;
  servicePrefix?: string;
  hostname?: string;
  workspaceId?: string;
  vpcId?: string;
  ecrRepository?: string;
  image?: string;
  evidenceBucket?: string;
  hostedSqliteDbPath?: string;
  runtimePackageVersion?: string;
  protectedAccessMode?: "cloudfront_default_domain" | "alb_https_cert";
  /** @deprecated Postgres is target-state only until the async adapter is implemented. */
  rdsInstanceId?: string;
  /** @deprecated Postgres is target-state only until the async adapter is implemented. */
  databaseSecretName?: string;
  hostedTokenSecretName?: string;
  appEnvSecretName?: string;
  publicProbeSecretName?: string;
  privateProbeSecretName?: string;
  reportingSecretName?: string;
}

export interface AwsDeploymentPlan {
  kind: "open-uptime.aws-deployment-plan";
  version: 3;
  generatedAt: string;
  status: "blocked";
  canApply: false;
  accountName: string;
  region: string;
  stage: string;
  servicePrefix: string;
  hostname: string;
  workspaceId: string;
  mode: "hosted";
  resources: {
    ecrRepository: string;
    imageBuilder: string;
    ecsCluster: string;
    services: AwsServicePlan[];
    vpcId: string;
    efsFileSystem: string;
    efsAccessPoint: string;
    hostedSqliteDbPath: string;
    evidenceBucket: string;
    loadBalancer: string;
    protectedAccessMode: "cloudfront_default_domain" | "alb_https_cert";
    edgeDistribution?: string;
    protectedAccessUrl: string;
    targetGroups: string[];
    securityGroups: string[];
    secrets: Record<string, string>;
    logGroups: string[];
    alarms: string[];
  };
  image: {
    repository: string;
    uri: string;
    dockerfile: string;
    buildCommand: string;
    pushCommands: string[];
  };
  infra: {
    path: string;
    fmtCommand: string;
    initCommand: string;
    validateCommand: string;
    planCommand: string;
    applyAllowed: false;
  };
  runbook: {
    preflight: string[];
    provision: string[];
    deploy: string[];
    rollback: string[];
    privateProbe: string[];
  };
  blockers: string[];
  requiredEvidence: string[];
  safety: {
    liveAwsMutation: false;
    plaintextSecrets: false;
    hostedLocalSqliteAllowed: false;
    notes: string[];
  };
}

export interface AwsServicePlan {
  name: string;
  role: "web" | "scheduler" | "public-probe" | "reporter" | "migration";
  desiredCount: number;
  targetDesiredCount: number;
  taskRole: string;
  executionRole: string;
  logGroup: string;
  healthCommand?: string;
  environment: Record<string, string>;
  secrets: Record<string, string>;
}

export interface PrivateProbeCloudConfigOptions {
  apiUrl?: string;
  workspaceId?: string;
  probeId?: string;
  probePrivateKeyFile?: string;
  machineId?: string;
  logLevel?: string;
}

export interface PrivateProbeCloudConfig {
  kind: "open-uptime.private-probe-cloud-config";
  version: 1;
  generatedAt: string;
  status: "blocked";
  canStart: false;
  machineId: string;
  mode: "private-probe";
  env: Record<string, string>;
  files: Array<{ path: string; mode: string; purpose: string }>;
  commands: string[];
  blockers: string[];
  safety: {
    privateKeyInline: false;
    tokenInline: false;
    notes: string[];
  };
}

const DEFAULT_ACCOUNT = "aws-profile";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_STAGE = "prod";
const DEFAULT_PREFIX = "open-uptime";
const DEFAULT_HOSTNAME = "uptime.example.com";
const DEFAULT_WORKSPACE_ID = "workspace-id";
const DEFAULT_VPC_ID = "vpc-xxxxxxxx";
const DEFAULT_HOSTED_SQLITE_DB = "/data/uptime/uptime.db";
const DEFAULT_PROTECTED_ACCESS_MODE = "cloudfront_default_domain" as const;

export function buildAwsDeploymentPlan(options: AwsDeploymentPlanOptions = {}): AwsDeploymentPlan {
  const region = clean(options.region, DEFAULT_REGION);
  const stage = clean(options.stage, DEFAULT_STAGE);
  const prefix = clean(options.servicePrefix, DEFAULT_PREFIX);
  const accountName = clean(options.accountName, DEFAULT_ACCOUNT);
  const hostname = clean(options.hostname, DEFAULT_HOSTNAME);
  const workspaceId = clean(options.workspaceId, DEFAULT_WORKSPACE_ID);
  const ecrRepository = clean(options.ecrRepository, prefix);
  const imageRepositoryUri = `<account-id>.dkr.ecr.${region}.amazonaws.com/${ecrRepository}`;
  const image = clean(options.image, `${imageRepositoryUri}@sha256:<image-digest>`);
  const evidenceBucket = clean(options.evidenceBucket, `hasna-${stage}-${prefix}-evidence`);
  const hostedSqliteDbPath = clean(options.hostedSqliteDbPath, DEFAULT_HOSTED_SQLITE_DB);
  const runtimePackageVersion = clean(options.runtimePackageVersion, "0.1.15");
  const protectedAccessMode = options.protectedAccessMode ?? DEFAULT_PROTECTED_ACCESS_MODE;
  const protectedAccessUrl = protectedAccessMode === "cloudfront_default_domain" ? "https://<cloudfront-domain>" : `https://${hostname}`;
  const cluster = `${prefix}-${stage}`;
  const secrets = {
    appEnv: clean(options.appEnvSecretName, `open-uptime/${stage}/app/env`),
    hostedToken: clean(options.hostedTokenSecretName, `open-uptime/${stage}/hosted-token`),
    publicProbe: clean(options.publicProbeSecretName, `open-uptime/${stage}/probe/public`),
    privateProbe: clean(options.privateProbeSecretName, `open-uptime/${stage}/probe/private`),
    reporting: clean(options.reportingSecretName, `open-uptime/${stage}/reporting`),
  };
  const services: AwsServicePlan[] = [
    servicePlan(prefix, stage, "web", 1, image, workspaceId, secrets, {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_HOSTED_SQLITE_DB: hostedSqliteDbPath,
      HASNA_UPTIME_WORKSPACE_ID: workspaceId,
      HASNA_UPTIME_HOSTNAME: hostname,
      HASNA_UPTIME_ALLOWED_ORIGINS: protectedAccessUrl,
    }),
    servicePlan(prefix, stage, "scheduler", 0, image, workspaceId, secrets, {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_WORKSPACE_ID: workspaceId,
      HASNA_UPTIME_COMPONENT: "scheduler",
    }),
    servicePlan(prefix, stage, "public-probe", 0, image, workspaceId, secrets, {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_WORKSPACE_ID: workspaceId,
      HASNA_UPTIME_COMPONENT: "public-probe",
      HASNA_UPTIME_PROBE_LOCATION: region,
    }),
    servicePlan(prefix, stage, "reporter", 0, image, workspaceId, secrets, {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_WORKSPACE_ID: workspaceId,
      HASNA_UPTIME_COMPONENT: "reporter",
    }),
    servicePlan(prefix, stage, "migration", 0, image, workspaceId, secrets, {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_WORKSPACE_ID: workspaceId,
      HASNA_UPTIME_COMPONENT: "migration",
    }),
  ];

  return {
    kind: "open-uptime.aws-deployment-plan",
    version: 3,
    generatedAt: new Date().toISOString(),
    status: "blocked",
    canApply: false,
    accountName,
    region,
    stage,
    servicePrefix: prefix,
    hostname,
    workspaceId,
    mode: "hosted",
    resources: {
      ecrRepository,
      imageBuilder: `${prefix}-${stage}-image-builder`,
      ecsCluster: cluster,
      services,
      vpcId: clean(options.vpcId, DEFAULT_VPC_ID),
      efsFileSystem: `${prefix}-${stage}-data`,
      efsAccessPoint: `${prefix}-${stage}-uptime`,
      hostedSqliteDbPath,
      evidenceBucket,
      loadBalancer: `${prefix}-${stage}-alb`,
      protectedAccessMode,
      edgeDistribution: protectedAccessMode === "cloudfront_default_domain" ? `${prefix}-${stage}-edge` : undefined,
      protectedAccessUrl,
      targetGroups: [`${prefix}-${stage}-web-tg`],
      securityGroups: [
        `${prefix}-${stage}-alb-sg`,
        `${prefix}-${stage}-web-sg`,
        `${prefix}-${stage}-scheduler-sg`,
        `${prefix}-${stage}-public-probe-sg`,
        `${prefix}-${stage}-reporter-sg`,
        `${prefix}-${stage}-migration-sg`,
        `${prefix}-${stage}-efs-sg`,
      ],
      secrets,
      logGroups: services.map((service) => service.logGroup),
      alarms: [
        `${prefix}-${stage}-web-5xx`,
        `${prefix}-${stage}-web-unhealthy`,
      ],
    },
    image: {
      repository: ecrRepository,
      uri: image,
      dockerfile: "Dockerfile.package",
      buildCommand: `BLOCKED: after infra approval, AWS CodeBuild builds Dockerfile.package from @hasna/uptime@${runtimePackageVersion} into ${imageRepositoryUri}`,
      pushCommands: [
        `BLOCKED: start ${prefix}-${stage}-image-builder only through the approved deploy pipeline after @hasna/uptime@${runtimePackageVersion} is published`,
        "BLOCKED: deploy services by immutable image digest, not by mutable tags",
      ],
    },
    infra: {
      path: "infra/aws",
      fmtCommand: "terraform -chdir=infra/aws fmt -check",
      initCommand: "terraform -chdir=infra/aws init -backend=false",
      validateCommand: "terraform -chdir=infra/aws validate",
      planCommand: "terraform -chdir=infra/aws plan -out open-uptime.tfplan",
      applyAllowed: false,
    },
    runbook: {
      preflight: [
        `aws sts get-caller-identity --profile ${accountName}`,
        `aws ec2 describe-vpcs --vpc-ids ${clean(options.vpcId, DEFAULT_VPC_ID)} --region ${region}`,
        `aws efs describe-file-systems --region ${region}`,
        "Confirm the infra repository and Terraform/CloudFormation owner before live mutation.",
      ],
      provision: [
        `Infra PR must declare or update ECR repository ${ecrRepository}.`,
        `Infra PR must declare CodeBuild image builder ${prefix}-${stage}-image-builder for @hasna/uptime@${runtimePackageVersion}.`,
        `Infra PR must declare hardened S3 evidence bucket ${evidenceBucket} with KMS, versioning, lifecycle, and public access block.`,
        `Infra PR must declare encrypted EFS ${prefix}-${stage}-data with access point, mount targets, and AWS Backup plan.`,
        protectedAccessMode === "cloudfront_default_domain"
          ? "Infra PR must declare CloudFront default-domain HTTPS edge, ALB HTTP listener restricted to CloudFront origin-facing ranges, ECS/Fargate cluster, target groups, security groups, IAM roles, CloudWatch log groups, and Secrets Manager refs."
          : `Infra PR must declare ECS/Fargate cluster ${cluster}, ALB HTTPS listener, target groups, security groups, IAM roles, CloudWatch log groups, and Secrets Manager refs.`,
        "Only apply the infra plan from the approved infrastructure repository after review evidence is attached.",
      ],
      deploy: [
        "Build and publish the image only after the Dockerfile/container target is reviewed.",
        `Start the AWS image builder for @hasna/uptime@${runtimePackageVersion} and record the pushed image digest.`,
        "For the EFS SQLite bridge, do not run migration, scheduler, public-probe, or reporter tasks; keep them at desired count 0 until Postgres and cloud leases exist.",
        `Register task definitions for ${services.map((service) => service.name).join(", ")} using valueFrom secrets.`,
        `Update ECS services in cluster ${cluster} one component at a time through the approved deploy pipeline.`,
        protectedAccessMode === "cloudfront_default_domain"
          ? "Use the CloudFront default HTTPS domain for first protected access; add custom DNS/certificate only after edge ownership is approved."
          : `Create Route53/edge record for ${hostname} only after ALB health checks pass and auth denial smokes succeed.`,
      ],
      rollback: [
        "Keep previous task definition ARNs before each service update.",
        "Rollback through the approved deploy pipeline to the previously recorded task definition ARNs.",
        "Disable scheduler/reporter services before data rollback.",
        "Restore EFS backup recovery point only after explicit operator approval and audit record.",
      ],
      privateProbe: [
        "Create a private probe identity with a caller-managed public key.",
        "Install @hasna/uptime on the private probe operator machine and write the generated env file with mode 0600.",
        "Run the private probe against the hosted /api/v1 probe endpoint once it exists.",
      ],
    },
    blockers: [
      "The infrastructure owner repository was not found in this workspace.",
      "The EFS SQLite bridge is single-writer only: web target desired count is 1 and scheduler/public-probe/reporter targets remain 0 until Postgres and cloud leases exist.",
      "Hosted production auth/RBAC must replace broad static hosted-token operation before exposure.",
      "Public probe execution still needs cloud check-job leases wired to runHostedHttpCheck and live policy-decision log evidence.",
      "Private probe enrollment, claim, submit, heartbeat, revocation, and rotation are not cloud-backed yet.",
    ],
    requiredEvidence: [
      "Infrastructure PR/synth/plan from the approved infra repository.",
      "CodeBuild image-builder run, container smoke, and immutable image digest.",
      "ECS task definitions using secrets.valueFrom only.",
      "CloudFront-default-domain or ALB TLS auth-denial smokes, direct-origin denial evidence, and web alarm checks.",
      "Single-writer ECS evidence: one web task maximum and no scheduler/public-probe/reporter EFS mounts.",
      "EFS encryption, access point, mount-target, AWS Backup, and restore-drill evidence.",
      "S3 bucket KMS, versioning, lifecycle, and public-access-block evidence.",
      "Private-probe registration, key-file mode, heartbeat, and revocation evidence.",
    ],
    safety: {
      liveAwsMutation: false,
      plaintextSecrets: false,
      hostedLocalSqliteAllowed: false,
      notes: [
        "This plan generator does not call AWS.",
        "Blocked plan output intentionally avoids copy-pastable AWS mutation commands.",
        "Default protected access uses CloudFront's HTTPS default domain so first deploy is not blocked on custom DNS or ACM.",
        "Hosted runtime uses explicit EFS-backed SQLite at HASNA_UPTIME_HOSTED_SQLITE_DB until the async Postgres adapter exists.",
        "Do not set HASNA_UPTIME_DATABASE_URL for hosted tasks until the Postgres adapter is implemented.",
        "Secrets are represented as secret names/refs and must be injected with valueFrom.",
        "Actual deploy belongs in the deploy_release_operate_final goal node after infra review.",
      ],
    },
  };
}

export function buildPrivateProbeCloudConfig(options: PrivateProbeCloudConfigOptions = {}): PrivateProbeCloudConfig {
  const apiUrl = clean(options.apiUrl, `https://${DEFAULT_HOSTNAME}/api/v1`);
  const workspaceId = clean(options.workspaceId, DEFAULT_WORKSPACE_ID);
  const machineId = clean(options.machineId, "private-probe-01");
  const privateKeyFile = clean(options.probePrivateKeyFile, "~/.hasna/uptime/probes/private-probe-01.key.pem");
  const probeId = options.probeId?.trim();
  const blockers = [
    ...(probeId ? [] : ["Cloud-registered private probe id is required before writing a sourceable env file."]),
    "Hosted probe claim and submit routes still fail closed until cloud check_jobs and workspace stores are implemented.",
    "Private probe enrollment, heartbeat, revocation, rotation, and bounded offline lease handling are not implemented yet.",
  ];
  const env: Record<string, string> = {
    HASNA_UPTIME_MODE: "hosted",
    HASNA_UPTIME_API_URL: apiUrl,
    HASNA_UPTIME_WORKSPACE_ID: workspaceId,
    HASNA_UPTIME_MACHINE_ID: machineId,
    HASNA_UPTIME_PRIVATE_PROBE_KEY_FILE: privateKeyFile,
    HASNA_UPTIME_PROBE_CLASS: "private",
    HASNA_UPTIME_LOG_LEVEL: clean(options.logLevel, "info"),
  };
  if (probeId) env.HASNA_UPTIME_PRIVATE_PROBE_ID = probeId;
  return {
    kind: "open-uptime.private-probe-cloud-config",
    version: 1,
    generatedAt: new Date().toISOString(),
    status: "blocked",
    canStart: false,
    machineId,
    mode: "private-probe",
    env,
    files: [
      {
        path: privateKeyFile,
        mode: "0600",
        purpose: "Ed25519 private key generated on the private probe machine; never paste into cloud config.",
      },
      {
        path: "~/.hasna/uptime/cloud.env",
        mode: "0600",
        purpose: "Non-secret cloud/probe runtime environment; token values stay in the machine secret store.",
      },
    ],
    commands: [
      "bun install -g @hasna/uptime@latest",
      "Generate the private probe key locally and register only its public key with the hosted control plane once registration exists.",
      "Write ~/.hasna/uptime/cloud.env from this plan, then source it for the private probe service.",
      "Start the private probe worker only after hosted /api/v1 probe claim/submit routes are backed by cloud jobs.",
    ],
    blockers,
    safety: {
      privateKeyInline: false,
      tokenInline: false,
      notes: [
        "This config is hosted-targeted preflight: the private probe must not start until cloud probe routes are backed by hosted state.",
        "The private key file path is referenced, not embedded.",
        "Hosted token or probe auth material must come from the machine secret store, not this generated config.",
      ],
    },
  };
}

export function renderPrivateProbeEnv(config: PrivateProbeCloudConfig): string {
  const required = ["HASNA_UPTIME_PRIVATE_PROBE_ID"];
  const missing = required.filter((key) => !config.env[key]);
  if (missing.length > 0) {
    throw new Error(`private probe env output requires ${missing.join(", ")}`);
  }
  return Object.entries(config.env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join("\n");
}

function servicePlan(
  prefix: string,
  stage: string,
  role: AwsServicePlan["role"],
  desiredCount: number,
  image: string,
  workspaceId: string,
  secrets: Record<string, string>,
  environment: Record<string, string>,
): AwsServicePlan {
  const name = `${prefix}-${stage}-${role}`;
  return {
    name,
    role,
    desiredCount: 0,
    targetDesiredCount: desiredCount,
    taskRole: `${name}-task-role`,
    executionRole: `${prefix}-${stage}-execution-role`,
    logGroup: `/ecs/${name}`,
    healthCommand: role === "web" ? "GET /health" : undefined,
    environment: {
      HASNA_UPTIME_IMAGE: image,
      ...environment,
    },
    secrets: role === "web"
      ? { APP_ENV: secrets.appEnv, HASNA_UPTIME_HOSTED_TOKEN: secrets.hostedToken }
      : role === "public-probe"
      ? { PROBE_CONFIG: secrets.publicProbe }
      : role === "reporter"
        ? { REPORTING_CONFIG: secrets.reporting }
        : { APP_ENV: secrets.appEnv },
  };
}

function clean(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:@~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
