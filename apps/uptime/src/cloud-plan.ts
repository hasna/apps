import { packageVersion } from "./version.js";

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
  runtimePackageIntegrity?: string;
  protectedAccessMode?: "cloudfront_default_domain" | "alb_https_cert";
  cloudfrontOriginProtocolPolicy?: "http-only" | "https-only";
  cloudfrontOriginDomainName?: string;
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
  version: 5;
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
    cloudfrontOrigin?: {
      protocolPolicy: "http-only" | "https-only";
      domainName: string;
      requiresMatchingCertificate: boolean;
      liveTrafficApproved: boolean;
      risk?: string;
    };
    originVerification: {
      mode: "cloudfront_origin_header" | "alb_tls";
      requiredBeforeScaleUp: boolean;
      headerName?: string;
      valueStoredInTerraformState: boolean;
      stateAccessWarning?: string;
    };
    targetGroups: string[];
    securityGroups: string[];
    secrets: Record<string, string>;
    logGroups: string[];
    alarms: string[];
    workerRuntimeAlarms: {
      enabledByDefault: false;
      namespace: string;
      metricProducersReady: false;
      alarms: string[];
    };
  };
  image: {
    repository: string;
    uri: string;
    dockerfile: string;
    expectedIntegrity?: string;
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
const DEFAULT_CLOUDFRONT_ORIGIN_PROTOCOL_POLICY = "http-only" as const;
const DEFAULT_WORKER_RUNTIME_ALARM_NAMESPACE = "OpenUptime/Worker";

const WORKER_RUNTIME_ALARM_KEYS = [
  "scheduler-backlog",
  "scheduler-stale-leases",
  "scheduler-heartbeat-age",
  "public-probe-backlog",
  "public-probe-submission-failures",
  "public-probe-heartbeat-age",
  "reporter-lag",
  "reporter-failed-deliveries",
  "reporter-retry-exhausted",
  "reporter-heartbeat-age",
] as const;

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
  const runtimePackageVersion = clean(options.runtimePackageVersion, packageVersion());
  const runtimePackageIntegrity = options.runtimePackageIntegrity?.trim() || undefined;
  const protectedAccessMode = options.protectedAccessMode ?? DEFAULT_PROTECTED_ACCESS_MODE;
  const cloudfrontOriginProtocolPolicy = options.cloudfrontOriginProtocolPolicy ?? DEFAULT_CLOUDFRONT_ORIGIN_PROTOCOL_POLICY;
  const cloudfrontOriginDomainName = clean(options.cloudfrontOriginDomainName, "<alb-dns-name>");
  const protectedAccessUrl = protectedAccessMode === "cloudfront_default_domain" ? "https://<cloudfront-domain>" : `https://${hostname}`;
  const cluster = `${prefix}-${stage}`;
  const secrets = {
    appEnv: secretRefClass(options.appEnvSecretName, "<app-env-secret-ref>"),
    hostedToken: secretRefClass(options.hostedTokenSecretName, "<hosted-token-secret-ref>"),
    publicProbe: secretRefClass(options.publicProbeSecretName, "<public-probe-secret-ref>"),
    privateProbe: secretRefClass(options.privateProbeSecretName, "<private-probe-secret-ref>"),
    reporting: secretRefClass(options.reportingSecretName, "<reporting-channel-catalog-secret-ref>"),
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
    version: 5,
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
      cloudfrontOrigin: protectedAccessMode === "cloudfront_default_domain"
        ? {
          protocolPolicy: cloudfrontOriginProtocolPolicy,
          domainName: cloudfrontOriginProtocolPolicy === "https-only" ? cloudfrontOriginDomainName : "<alb-dns-name>",
          requiresMatchingCertificate: cloudfrontOriginProtocolPolicy === "https-only",
          liveTrafficApproved: false,
          risk: cloudfrontOriginProtocolPolicy === "http-only"
            ? "Temporary HTTP-origin bridge: web scale-up requires allow_cloudfront_http_origin_live_traffic=true for bounded smokes, or switch to https-only with cloudfront_origin_domain_name plus certificate_arn."
            : "CloudFront HTTPS-origin mode requires the origin hostname to resolve to the ALB and match certificate_arn.",
        }
        : undefined,
      originVerification: protectedAccessMode === "cloudfront_default_domain"
        ? {
          mode: "cloudfront_origin_header",
          requiredBeforeScaleUp: true,
          headerName: "X-Open-Uptime-Origin-Verify",
          valueStoredInTerraformState: true,
          stateAccessWarning: "The origin verification header value is sensitive but is stored in encrypted Terraform state and CloudFront/ALB configuration; restrict state, plan, CloudFront distribution-read, and ELB rule-read access.",
        }
        : {
          mode: "alb_tls",
          requiredBeforeScaleUp: false,
          valueStoredInTerraformState: false,
        },
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
      workerRuntimeAlarms: {
        enabledByDefault: false,
        namespace: DEFAULT_WORKER_RUNTIME_ALARM_NAMESPACE,
        metricProducersReady: false,
        alarms: WORKER_RUNTIME_ALARM_KEYS.map((key) => `${prefix}-${stage}-${key}`),
      },
    },
    image: {
      repository: ecrRepository,
      uri: image,
      dockerfile: "Dockerfile.package",
      expectedIntegrity: runtimePackageIntegrity,
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
          ? "Infra PR must declare CloudFront default-domain HTTPS edge, ALB origin listener restricted to CloudFront origin-facing ranges, CloudFront-only origin verification header binding, ECS/Fargate cluster, target groups, security groups, IAM roles, CloudWatch log groups, and Secrets Manager refs. Token-bearing live traffic must use cloudfront_origin_protocol_policy=https-only with a matching origin hostname/certificate, or carry explicit allow_cloudfront_http_origin_live_traffic=true bounded-smoke risk acceptance."
          : `Infra PR must declare ECS/Fargate cluster ${cluster}, ALB HTTPS listener, target groups, security groups, IAM roles, CloudWatch log groups, and Secrets Manager refs.`,
        "Only apply the infra plan from the approved infrastructure repository after review evidence is attached.",
      ],
      deploy: [
        "Build and publish the image only after the Dockerfile/container target is reviewed.",
        runtimePackageIntegrity
          ? `Start the AWS image builder for @hasna/uptime@${runtimePackageVersion}; it must verify npm dist.integrity ${runtimePackageIntegrity} before extracting the package, then record the pushed image digest.`
          : `Start the AWS image builder for @hasna/uptime@${runtimePackageVersion}; set runtime_package_integrity from npm dist.integrity before live use, then record the pushed image digest.`,
        "For the EFS SQLite bridge, do not run migration, scheduler, public-probe, or reporter tasks; keep them at desired count 0 until Postgres and cloud leases exist.",
        `Register task definitions for ${services.map((service) => service.name).join(", ")} using valueFrom secrets.`,
        `Update ECS services in cluster ${cluster} one component at a time through the approved deploy pipeline.`,
        protectedAccessMode === "cloudfront_default_domain"
          ? "Use the CloudFront default HTTPS domain with origin verification header binding for first protected access; before token-bearing live traffic, switch the origin to https-only with a matching origin hostname/certificate or set allow_cloudfront_http_origin_live_traffic=true only for a bounded approved smoke."
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
        "Run the private probe only after the hosted service injects the audited probe runtime and the remaining private-probe gates pass.",
      ],
    },
    blockers: [
      "The infrastructure owner repository was not found in this workspace.",
      protectedAccessMode === "cloudfront_default_domain"
        ? "CloudFront origin verification header binding must be enabled and direct-origin denial must be proven before web desired count is raised above 0."
        : "ALB HTTPS ingress policy and auth-denial smokes must be proven before web desired count is raised above 0.",
      ...(protectedAccessMode === "cloudfront_default_domain" && cloudfrontOriginProtocolPolicy === "http-only"
        ? ["CloudFront-to-ALB origin transport is still http-only; web scale-up now requires explicit allow_cloudfront_http_origin_live_traffic=true risk acceptance, and token-bearing live traffic should use https-only origin mode."]
        : []),
      ...(protectedAccessMode === "cloudfront_default_domain" && cloudfrontOriginProtocolPolicy === "https-only" && cloudfrontOriginDomainName === "<alb-dns-name>"
        ? ["CloudFront https-only origin mode needs cloudfront_origin_domain_name that resolves to the ALB and matches certificate_arn."]
        : []),
      "The EFS SQLite bridge is single-writer only: web target desired count is 1 and scheduler/public-probe/reporter targets remain 0 until Postgres and cloud leases exist.",
      "Hosted production auth/RBAC must replace broad static hosted-token operation before exposure.",
      "Public probe execution still needs cloud check-job leases wired to runHostedHttpCheck and live policy-decision log evidence.",
      "Private probe live startup still needs service wiring for the audited probe runtime, probe-id-bound tokens, heartbeat, revocation, rotation, private target refs, alarms, deploy drain, and liveness evidence.",
    ],
    requiredEvidence: [
      "Infrastructure PR/synth/plan from the approved infra repository.",
      "CodeBuild image-builder run, container smoke, and immutable image digest.",
      "Published package dist.integrity pinned in the private infra root or an explicit not-live exception.",
      "ECS task definitions using secrets.valueFrom only.",
      "CloudFront-default-domain origin-header config, origin transport decision, direct-origin denial evidence, auth-denial smokes, and web alarm checks.",
      "Single-writer ECS evidence: one web task maximum and no scheduler/public-probe/reporter EFS mounts.",
      "EFS encryption, access point, mount-target, AWS Backup, and restore-drill evidence.",
      "S3 bucket KMS, versioning, lifecycle, and public-access-block evidence.",
      "Worker runtime alarm metric producers, alarm-state readback, and approved human/on-call delivery smoke before enabling scheduler/public-probe/reporter alarms.",
      "Private-probe registration, key-file mode, heartbeat, and revocation evidence.",
    ],
    safety: {
      liveAwsMutation: false,
      plaintextSecrets: false,
      hostedLocalSqliteAllowed: false,
      notes: [
        "This plan generator does not call AWS.",
        "Blocked plan output intentionally avoids copy-pastable AWS mutation commands.",
        "Default protected access uses CloudFront's HTTPS default domain so first zero-count deploy is not blocked on custom DNS or ACM.",
        "CloudFront default-domain mode still requires origin verification header binding before live scale-up; the header value is sensitive state/config material, not public documentation.",
        "CloudFront HTTPS-origin mode requires a dedicated origin DNS hostname and matching ACM certificate; do not assume the ALB DNS name can satisfy TLS verification.",
        "Hosted runtime uses explicit EFS-backed SQLite at HASNA_UPTIME_HOSTED_SQLITE_DB until the async Postgres adapter exists.",
        "Do not set HASNA_UPTIME_DATABASE_URL for hosted tasks until the Postgres adapter is implemented.",
        "Secrets are represented as secret names/refs and must be injected with valueFrom.",
        "Set runtime_package_integrity in the approved infra root after publish so the AWS image builder verifies the npm tarball before ECR build.",
        "Actual deploy belongs in the approved deployment workflow after infra review.",
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
      "Generate the private probe key locally and register only its public key with the hosted control plane once audited runtime wiring is approved.",
      "Write ~/.hasna/uptime/cloud.env from this plan, then source it for the private probe service.",
      "Start the private probe worker only after hosted /api/v1 probe claim/submit routes are wired with probe-id-bound tokens and all heartbeat/revocation/rotation/private-target/alarm gates pass.",
    ],
    blockers,
    safety: {
      privateKeyInline: false,
      tokenInline: false,
      notes: [
        "This config is hosted-targeted preflight: the private probe must not start until cloud probe routes are backed by hosted state and live private-probe gates pass.",
        "The private key file path is referenced, not embedded.",
        "Hosted token or probe auth material must come from the machine secret store, not this generated config.",
      ],
    },
  };
}

export function renderPrivateProbeEnv(config: PrivateProbeCloudConfig, options: { allowBlocked?: boolean } = {}): string {
  if (!options.allowBlocked && (!config.canStart || config.blockers.length > 0)) {
    throw new Error("private probe env output is blocked until hosted probe routes and cloud jobs are implemented");
  }
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
    healthCommand: role === "web" ? "GET /health" : "hosted environment sanity check",
    environment: {
      HASNA_UPTIME_IMAGE: image,
      ...environment,
    },
    secrets: role === "web"
      ? { APP_ENV: secrets.appEnv, HASNA_UPTIME_HOSTED_TOKEN: secrets.hostedToken }
      : role === "public-probe"
      ? { PROBE_CONFIG: secrets.publicProbe }
      : role === "reporter"
        ? { HASNA_UPTIME_REPORT_CHANNEL_REFS_JSON: secrets.reporting }
        : { APP_ENV: secrets.appEnv },
  };
}

function clean(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function secretRefClass(value: string | undefined, fallback: string): string {
  return value?.trim() ? "<custom-secret-ref>" : fallback;
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:@~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
