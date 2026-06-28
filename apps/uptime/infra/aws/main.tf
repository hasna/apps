terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  prefix                             = "${var.service_name}-${var.stage}"
  container_port                     = 3899
  evidence_bucket                    = "hasna-${var.stage}-${var.service_name}-evidence"
  efs_uid                            = 10001
  efs_gid                            = 10001
  hosted_sqlite_db_path              = "/data/uptime/uptime.db"
  efs_enabled_services               = toset(["web"])
  expected_runtime_package_integrity = coalesce(var.runtime_package_integrity, "")
  use_alb_https                      = var.protected_access_mode == "alb_https_cert"
  use_cloudfront                     = var.protected_access_mode == "cloudfront_default_domain"
  cloudfront_https_origin = (
    local.use_cloudfront && var.cloudfront_origin_protocol_policy == "https-only"
  )
  alb_https_listener_enabled = local.use_alb_https || local.cloudfront_https_origin
  use_origin_verify          = local.use_cloudfront && var.enable_cloudfront_origin_verify_header
  services = {
    web = {
      desired_count = lookup(var.desired_counts, "web", 0)
      command       = ["bun", "dist/cli/index.js", "serve", "--mode", "hosted", "--host", "0.0.0.0", "--port", tostring(local.container_port)]
      secrets       = { APP_ENV = var.app_env_secret_arn, HASNA_UPTIME_HOSTED_TOKEN = var.hosted_token_secret_arn }
    }
    scheduler = {
      desired_count = lookup(var.desired_counts, "scheduler", 0)
      command       = ["bun", "dist/cli/index.js", "cloud", "workers", "run", "--role", "scheduler"]
      secrets       = { APP_ENV = var.app_env_secret_arn }
    }
    "public-probe" = {
      desired_count = lookup(var.desired_counts, "public-probe", 0)
      command       = ["bun", "dist/cli/index.js", "cloud", "workers", "run", "--role", "public-probe"]
      secrets       = { PROBE_CONFIG = var.public_probe_secret_arn }
    }
    reporter = {
      desired_count = lookup(var.desired_counts, "reporter", 0)
      command       = ["bun", "dist/cli/index.js", "cloud", "workers", "run", "--role", "reporter"]
      secrets       = { REPORTING_CONFIG = var.reporting_secret_arn }
    }
    migration = {
      desired_count = lookup(var.desired_counts, "migration", 0)
      command       = ["bun", "dist/cli/index.js", "cloud", "workers", "run", "--role", "migration"]
      secrets       = { APP_ENV = var.app_env_secret_arn }
    }
  }
  tags = {
    ManagedBy   = "terraform"
    Service     = var.service_name
    Project     = var.project_name
    Stage       = var.stage
    Environment = var.environment
    Account     = var.account_name
    Owner       = var.owner
    AppType     = var.app_type
    CostCenter  = var.cost_center
  }
  s3_gateway_endpoint_enabled = var.enable_private_vpc_endpoints && contains(var.gateway_vpc_endpoint_services, "s3") && length(var.private_route_table_ids) > 0
  endpoint_secret_refs        = distinct(flatten([for service in values(local.services) : values(service.secrets)]))
  secretsmanager_secret_refs  = [for ref in local.endpoint_secret_refs : ref if can(regex(":secretsmanager:", ref))]
  ssm_parameter_refs          = [for ref in local.endpoint_secret_refs : ref if can(regex(":ssm:", ref))]
  secretsmanager_policy_refs = (
    length(local.secretsmanager_secret_refs) > 0
    ? local.secretsmanager_secret_refs
    : ["arn:${data.aws_partition.current.partition}:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${local.prefix}/no-secretsmanager-refs-configured-*"]
  )
  ssm_policy_refs = (
    length(local.ssm_parameter_refs) > 0
    ? local.ssm_parameter_refs
    : ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/no-ssm-refs-configured"]
  )
  service_log_group_arns = [for group in aws_cloudwatch_log_group.service : "${group.arn}:*"]
  service_health_checks = {
    web = {
      command     = ["CMD-SHELL", "bun -e \"const r = await fetch('http://127.0.0.1:${local.container_port}/health'); process.exit(r.ok ? 0 : 1)\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    scheduler = {
      command     = ["CMD-SHELL", "bun dist/cli/index.js cloud workers preflight --role scheduler --healthcheck --json >/tmp/open-uptime-worker-preflight.json"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    "public-probe" = {
      command     = ["CMD-SHELL", "bun dist/cli/index.js cloud workers preflight --role public-probe --healthcheck --json >/tmp/open-uptime-worker-preflight.json"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    reporter = {
      command     = ["CMD-SHELL", "bun dist/cli/index.js cloud workers preflight --role reporter --healthcheck --json >/tmp/open-uptime-worker-preflight.json"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    migration = {
      command     = ["CMD-SHELL", "bun dist/cli/index.js cloud workers preflight --role migration --healthcheck --json >/tmp/open-uptime-worker-preflight.json"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }
}

data "aws_vpc" "target" {
  id = var.vpc_id
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  count = local.use_cloudfront ? 1 : 0
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_ecr_repository" "open_uptime" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "image_builder" {
  name              = "/aws/codebuild/${local.prefix}-image-builder"
  retention_in_days = 14
  kms_key_id        = var.kms_key_arn
  tags              = local.tags
}

data "aws_iam_policy_document" "codebuild_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "image_builder" {
  name               = "${local.prefix}-image-builder-role"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "image_builder" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.open_uptime.arn]
  }

  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.image_builder.arn}:*"]
  }
}

resource "aws_iam_role_policy" "image_builder" {
  name   = "${local.prefix}-image-builder-policy"
  role   = aws_iam_role.image_builder.id
  policy = data.aws_iam_policy_document.image_builder.json
}

resource "aws_codebuild_project" "image_builder" {
  name         = "${local.prefix}-image-builder"
  description  = "Build published @hasna/uptime package into the Open Uptime ECR image"
  service_role = aws_iam_role.image_builder.arn
  tags         = local.tags

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.image_builder.name
      status     = "ENABLED"
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = <<-YAML
      version: 0.2
      phases:
        pre_build:
          commands:
            - aws --version
            - aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com
        build:
          commands:
            - EXPECTED_RUNTIME_PACKAGE_INTEGRITY='${local.expected_runtime_package_integrity}'
            - PACKAGE_TARBALL=$(npm pack @hasna/uptime@${var.runtime_package_version} --silent)
            - PACKAGE_INTEGRITY=$(npm view @hasna/uptime@${var.runtime_package_version} dist.integrity --json | tr -d '"')
            - test -n "$PACKAGE_INTEGRITY"
            - |
              if [ -n "$EXPECTED_RUNTIME_PACKAGE_INTEGRITY" ] && [ "$PACKAGE_INTEGRITY" != "$EXPECTED_RUNTIME_PACKAGE_INTEGRITY" ]; then
                echo "runtime package integrity mismatch" >&2
                exit 1
              fi
            - printf 'runtime package integrity %s\n' "$PACKAGE_INTEGRITY"
            - mkdir package
            - tar -xzf "$PACKAGE_TARBALL" -C package --strip-components=1
            - cd package
            - docker build -f Dockerfile.package -t ${aws_ecr_repository.open_uptime.repository_url}:${var.runtime_package_version} .
            - docker push ${aws_ecr_repository.open_uptime.repository_url}:${var.runtime_package_version}
            - IMAGE_DIGEST=$(aws ecr describe-images --region ${var.region} --repository-name ${aws_ecr_repository.open_uptime.name} --image-ids imageTag=${var.runtime_package_version} --query 'imageDetails[0].imageDigest' --output text)
            - printf '%s@%s\n' '${aws_ecr_repository.open_uptime.repository_url}' "$IMAGE_DIGEST"
      YAML
  }

  depends_on = [aws_iam_role_policy.image_builder]
}

resource "aws_s3_bucket" "evidence" {
  bucket = local.evidence_bucket
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    id     = "evidence-retention"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    expiration {
      days = 365
    }
  }
}

data "aws_iam_policy_document" "evidence_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.evidence.arn,
      "${aws_s3_bucket.evidence.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = data.aws_iam_policy_document.evidence_bucket.json
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.services
  name              = "/ecs/${local.prefix}-${each.key}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = local.tags
}

resource "aws_ecs_cluster" "open_uptime" {
  name = local.prefix
  tags = local.tags
}

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb-sg"
  description = "Open Uptime ALB ingress"
  vpc_id      = data.aws_vpc.target.id
  tags        = local.tags
}

resource "aws_security_group_rule" "alb_https_ingress" {
  count             = local.use_alb_https && length(var.alb_ingress_cidr_blocks) > 0 ? 1 : 0
  type              = "ingress"
  description       = "HTTPS"
  security_group_id = aws_security_group.alb.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.alb_ingress_cidr_blocks
}

resource "aws_security_group_rule" "alb_https_from_cloudfront" {
  count             = local.cloudfront_https_origin ? 1 : 0
  type              = "ingress"
  description       = "HTTPS from CloudFront origin-facing ranges"
  security_group_id = aws_security_group.alb.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  prefix_list_ids   = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing[0].id]
}

resource "aws_security_group_rule" "alb_http_from_cloudfront" {
  count             = local.use_cloudfront && !local.cloudfront_https_origin ? 1 : 0
  type              = "ingress"
  description       = "HTTP from CloudFront origin-facing ranges"
  security_group_id = aws_security_group.alb.id
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  prefix_list_ids   = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing[0].id]
}

resource "aws_security_group_rule" "alb_to_web" {
  type                     = "egress"
  description              = "To Open Uptime web"
  security_group_id        = aws_security_group.alb.id
  from_port                = local.container_port
  to_port                  = local.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.web.id
}

resource "aws_security_group" "web" {
  name        = "${local.prefix}-web-sg"
  description = "Open Uptime web tasks"
  vpc_id      = data.aws_vpc.target.id
  tags        = local.tags
}

resource "aws_security_group_rule" "web_from_alb" {
  type                     = "ingress"
  description              = "From ALB"
  security_group_id        = aws_security_group.web.id
  from_port                = local.container_port
  to_port                  = local.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "web_egress" {
  type              = "egress"
  description       = "Controlled egress to AWS endpoints and EFS"
  security_group_id = aws_security_group.web.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = [data.aws_vpc.target.cidr_block]
}

resource "aws_security_group" "worker" {
  for_each = {
    for key, value in local.services : key => value if key != "web"
  }

  name        = "${local.prefix}-${each.key}-sg"
  description = "Open Uptime ${each.key} tasks"
  vpc_id      = data.aws_vpc.target.id
  tags        = local.tags
}

resource "aws_security_group_rule" "worker_egress" {
  for_each = aws_security_group.worker

  type              = "egress"
  description       = each.key == "public-probe" ? "Public probe egress for approved public targets" : "Controlled egress to AWS endpoints"
  security_group_id = each.value.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = each.key == "public-probe" ? ["0.0.0.0/0"] : [data.aws_vpc.target.cidr_block]
}

resource "aws_security_group_rule" "web_nat_https_egress" {
  count = var.enable_nat_task_egress ? 1 : 0

  type              = "egress"
  description       = "HTTPS egress through approved NAT path"
  security_group_id = aws_security_group.web.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.nat_task_egress_cidr_blocks
}

resource "aws_security_group_rule" "worker_nat_https_egress" {
  for_each = var.enable_nat_task_egress ? {
    for key, value in aws_security_group.worker : key => value if key != "public-probe"
  } : {}

  type              = "egress"
  description       = "HTTPS egress through approved NAT path"
  security_group_id = each.value.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.nat_task_egress_cidr_blocks
}

resource "aws_security_group_rule" "web_s3_gateway_egress" {
  count = local.s3_gateway_endpoint_enabled ? 1 : 0

  type              = "egress"
  description       = "HTTPS to S3 gateway endpoint prefix list"
  security_group_id = aws_security_group.web.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  prefix_list_ids   = [aws_vpc_endpoint.gateway["s3"].prefix_list_id]
}

resource "aws_security_group_rule" "worker_s3_gateway_egress" {
  for_each = local.s3_gateway_endpoint_enabled ? {
    for key, value in aws_security_group.worker : key => value if key != "public-probe"
  } : {}

  type              = "egress"
  description       = "HTTPS to S3 gateway endpoint prefix list"
  security_group_id = each.value.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  prefix_list_ids   = [aws_vpc_endpoint.gateway["s3"].prefix_list_id]
}

resource "aws_security_group" "vpc_endpoints" {
  count       = var.enable_private_vpc_endpoints ? 1 : 0
  name        = "${local.prefix}-vpc-endpoints-sg"
  description = "Open Uptime interface VPC endpoints"
  vpc_id      = data.aws_vpc.target.id
  tags        = merge(local.tags, { Component = "vpc-endpoints" })
}

resource "aws_security_group_rule" "vpc_endpoints_from_web" {
  count                    = var.enable_private_vpc_endpoints ? 1 : 0
  type                     = "ingress"
  description              = "HTTPS from Open Uptime web tasks"
  security_group_id        = aws_security_group.vpc_endpoints[0].id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.web.id
}

resource "aws_security_group_rule" "vpc_endpoints_from_worker" {
  for_each = var.enable_private_vpc_endpoints ? aws_security_group.worker : {}

  type                     = "ingress"
  description              = "HTTPS from Open Uptime ${each.key} tasks"
  security_group_id        = aws_security_group.vpc_endpoints[0].id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = each.value.id
}

resource "aws_security_group_rule" "vpc_endpoints_from_additional_sources" {
  for_each = var.enable_private_vpc_endpoints ? toset(var.additional_vpc_endpoint_source_security_group_ids) : toset([])

  type                     = "ingress"
  description              = "HTTPS from additional approved source security group"
  security_group_id        = aws_security_group.vpc_endpoints[0].id
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = each.value
}

data "aws_iam_policy_document" "vpc_endpoint_ecr_api" {
  statement {
    sid       = "AllowEcrAuthorization"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid = "AllowOpenUptimeRepositoryRead"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.open_uptime.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_ecr_dkr" {
  statement {
    sid = "AllowOpenUptimeRegistryRead"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.open_uptime.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_logs" {
  statement {
    sid = "AllowOpenUptimeLogDelivery"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = local.service_log_group_arns

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_secretsmanager" {
  statement {
    sid = "AllowOpenUptimeSecretReads"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = local.secretsmanager_policy_refs

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_ssm" {
  statement {
    sid = "AllowOpenUptimeParameterReads"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = local.ssm_policy_refs

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_sts" {
  statement {
    sid       = "AllowCallerIdentity"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_kms" {
  statement {
    sid = "AllowOpenUptimeKeyUse"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:GenerateDataKey*",
    ]
    resources = [var.kms_key_arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

data "aws_iam_policy_document" "vpc_endpoint_s3" {
  statement {
    sid = "AllowOpenUptimeEvidenceBucket"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]
    resources = [
      aws_s3_bucket.evidence.arn,
      "${aws_s3_bucket.evidence.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid       = "AllowEcrLayerBucket"
    actions   = ["s3:GetObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::prod-${var.region}-starport-layer-bucket/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = var.enable_private_vpc_endpoints ? toset(var.interface_vpc_endpoint_services) : toset([])

  vpc_id              = data.aws_vpc.target.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true
  policy = {
    "ecr.api"      = data.aws_iam_policy_document.vpc_endpoint_ecr_api.json
    "ecr.dkr"      = data.aws_iam_policy_document.vpc_endpoint_ecr_dkr.json
    logs           = data.aws_iam_policy_document.vpc_endpoint_logs.json
    secretsmanager = data.aws_iam_policy_document.vpc_endpoint_secretsmanager.json
    ssm            = data.aws_iam_policy_document.vpc_endpoint_ssm.json
    sts            = data.aws_iam_policy_document.vpc_endpoint_sts.json
    kms            = data.aws_iam_policy_document.vpc_endpoint_kms.json
  }[each.key]

  tags = merge(local.tags, {
    Name      = "${local.prefix}-${replace(each.key, ".", "-")}-endpoint"
    Component = "vpc-endpoint"
    Endpoint  = each.key
  })
}

resource "aws_vpc_endpoint" "gateway" {
  for_each = var.enable_private_vpc_endpoints && length(var.private_route_table_ids) > 0 ? toset(var.gateway_vpc_endpoint_services) : toset([])

  vpc_id            = data.aws_vpc.target.id
  service_name      = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.private_route_table_ids
  policy = {
    s3 = data.aws_iam_policy_document.vpc_endpoint_s3.json
  }[each.key]

  tags = merge(local.tags, {
    Name      = "${local.prefix}-${each.key}-endpoint"
    Component = "vpc-endpoint"
    Endpoint  = each.key
  })
}

resource "aws_security_group" "efs" {
  name        = "${local.prefix}-efs-sg"
  description = "Open Uptime EFS data store"
  vpc_id      = data.aws_vpc.target.id
  tags        = local.tags
}

resource "aws_security_group_rule" "efs_from_web" {
  type                     = "ingress"
  description              = "Open Uptime web to EFS"
  security_group_id        = aws_security_group.efs.id
  from_port                = 2049
  to_port                  = 2049
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.web.id
}

resource "aws_efs_file_system" "data" {
  creation_token = "${local.prefix}-data"
  encrypted      = true
  kms_key_id     = var.kms_key_arn
  tags           = merge(local.tags, { Name = "${local.prefix}-data" })

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }
}

resource "aws_efs_backup_policy" "data" {
  file_system_id = aws_efs_file_system.data.id

  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_efs_access_point" "uptime" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = local.efs_uid
    gid = local.efs_gid
  }

  root_directory {
    path = "/uptime"

    creation_info {
      owner_uid   = local.efs_uid
      owner_gid   = local.efs_gid
      permissions = "0750"
    }
  }

  tags = merge(local.tags, { Name = "${local.prefix}-uptime" })
}

resource "aws_efs_mount_target" "data" {
  for_each        = { for index, subnet_id in var.private_subnet_ids : tostring(index) => subnet_id }
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_backup_vault" "data" {
  name        = "${local.prefix}-data"
  kms_key_arn = var.kms_key_arn
  tags        = local.tags
}

resource "aws_backup_plan" "data" {
  name = "${local.prefix}-data"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.data.name
    schedule          = "cron(0 5 * * ? *)"

    lifecycle {
      delete_after = 35
    }
  }

  tags = local.tags
}

data "aws_iam_policy_document" "backup_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.prefix}-backup-role"
  assume_role_policy = data.aws_iam_policy_document.backup_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "backup_restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "data" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${local.prefix}-data"
  plan_id      = aws_backup_plan.data.id
  resources    = [aws_efs_file_system.data.arn]
}

resource "aws_lb" "open_uptime" {
  name               = "${local.prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  tags               = local.tags
}

resource "aws_lb_target_group" "web" {
  name        = "${local.prefix}-web-tg"
  port        = local.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.target.id
  tags        = local.tags

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener" "https" {
  count             = local.alb_https_listener_enabled ? 1 : 0
  load_balancer_arn = aws_lb.open_uptime.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  tags              = local.tags

  dynamic "default_action" {
    for_each = local.cloudfront_https_origin && local.use_origin_verify ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }

  dynamic "default_action" {
    for_each = local.cloudfront_https_origin && local.use_origin_verify ? [1] : []
    content {
      type = "fixed-response"

      fixed_response {
        content_type = "text/plain"
        message_body = "forbidden"
        status_code  = "403"
      }
    }
  }
}

resource "aws_lb_listener" "http_cloudfront" {
  count             = local.use_cloudfront && !local.cloudfront_https_origin ? 1 : 0
  load_balancer_arn = aws_lb.open_uptime.arn
  port              = 80
  protocol          = "HTTP"
  tags              = local.tags

  dynamic "default_action" {
    for_each = local.use_origin_verify ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }

  dynamic "default_action" {
    for_each = local.use_origin_verify ? [1] : []
    content {
      type = "fixed-response"

      fixed_response {
        content_type = "text/plain"
        message_body = "forbidden"
        status_code  = "403"
      }
    }
  }
}

resource "aws_lb_listener_rule" "http_cloudfront_origin_verify" {
  count        = local.use_origin_verify && !local.cloudfront_https_origin ? 1 : 0
  listener_arn = aws_lb_listener.http_cloudfront[0].arn
  priority     = var.cloudfront_origin_verify_listener_rule_priority
  tags         = local.tags

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    http_header {
      http_header_name = var.cloudfront_origin_verify_header_name
      values           = [var.cloudfront_origin_verify_header_value]
    }
  }
}

resource "aws_lb_listener_rule" "https_cloudfront_origin_verify" {
  count        = local.use_origin_verify && local.cloudfront_https_origin ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = var.cloudfront_origin_verify_listener_rule_priority
  tags         = local.tags

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    http_header {
      http_header_name = var.cloudfront_origin_verify_header_name
      values           = [var.cloudfront_origin_verify_header_value]
    }
  }
}

resource "aws_cloudfront_distribution" "open_uptime" {
  count           = local.use_cloudfront ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Open Uptime ${local.prefix} protected HTTPS edge"
  price_class     = "PriceClass_100"
  tags            = local.tags

  origin {
    domain_name = local.cloudfront_https_origin ? var.cloudfront_origin_domain_name : aws_lb.open_uptime.dns_name
    origin_id   = "${local.prefix}-alb"

    dynamic "custom_header" {
      for_each = local.use_origin_verify ? [1] : []
      content {
        name  = var.cloudfront_origin_verify_header_name
        value = var.cloudfront_origin_verify_header_value
      }
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = var.cloudfront_origin_protocol_policy
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "${local.prefix}-alb"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    default_ttl            = 0
    max_ttl                = 0
    min_ttl                = 0

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "Origin", "X-Uptime-Hosted-Token"]

      cookies {
        forward = "all"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [
    aws_lb_listener.http_cloudfront,
    aws_lb_listener.https,
    aws_lb_listener_rule.http_cloudfront_origin_verify,
    aws_lb_listener_rule.https_cloudfront_origin_verify,
  ]
}

resource "aws_route53_record" "open_uptime" {
  count   = var.hosted_zone_id == null || !local.use_alb_https ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.hostname
  type    = "A"

  alias {
    name                   = aws_lb.open_uptime.dns_name
    zone_id                = aws_lb.open_uptime.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "cloudfront_origin" {
  count   = local.cloudfront_https_origin && var.hosted_zone_id != null ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.cloudfront_origin_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.open_uptime.dns_name
    zone_id                = aws_lb.open_uptime.zone_id
    evaluate_target_health = true
  }
}

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.prefix}-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = distinct(flatten([
      for service in values(local.services) : values(service.secrets)
    ]))
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${local.prefix}-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  for_each           = local.services
  name               = "${local.prefix}-${each.key}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task" {
  for_each = local.services

  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/${each.key}/*"]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }

  dynamic "statement" {
    for_each = contains(local.efs_enabled_services, each.key) ? [1] : []

    content {
      actions = [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
      ]
      resources = [aws_efs_file_system.data.arn]

      condition {
        test     = "StringEquals"
        variable = "elasticfilesystem:AccessPointArn"
        values   = [aws_efs_access_point.uptime.arn]
      }
    }
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = local.services
  name     = "${local.prefix}-${each.key}-task-policy"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.task[each.key].json
}

resource "aws_ecs_task_definition" "service" {
  for_each                 = local.services
  family                   = "${local.prefix}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  dynamic "volume" {
    for_each = contains(local.efs_enabled_services, each.key) ? [1] : []

    content {
      name = "uptime-data"

      efs_volume_configuration {
        file_system_id     = aws_efs_file_system.data.id
        transit_encryption = "ENABLED"

        authorization_config {
          access_point_id = aws_efs_access_point.uptime.id
          iam             = "ENABLED"
        }
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = var.container_image
      essential = true
      command   = each.value.command
      portMappings = each.key == "web" ? [{
        containerPort = local.container_port
        hostPort      = local.container_port
        protocol      = "tcp"
      }] : []
      environment = concat([
        { name = "HASNA_UPTIME_MODE", value = "hosted" },
        { name = "HASNA_UPTIME_HOSTED_AUTH_MODE", value = "production" },
        { name = "HASNA_UPTIME_WORKSPACE_ID", value = var.workspace_id },
        { name = "HASNA_UPTIME_COMPONENT", value = each.key },
        { name = "HASNA_UPTIME_HOSTNAME", value = var.hostname },
        ], each.key == "web" ? [
        {
          name  = "HASNA_UPTIME_ALLOWED_ORIGINS"
          value = local.use_cloudfront ? "https://${aws_cloudfront_distribution.open_uptime[0].domain_name}" : "https://${var.hostname}"
        },
        ] : [], contains(local.efs_enabled_services, each.key) ? [
        { name = "HASNA_UPTIME_HOSTED_SQLITE_DB", value = local.hosted_sqlite_db_path },
      ] : [])
      mountPoints = contains(local.efs_enabled_services, each.key) ? [
        {
          sourceVolume  = "uptime-data"
          containerPath = "/data/uptime"
          readOnly      = false
        }
      ] : []
      healthCheck = local.service_health_checks[each.key]
      secrets = [
        for name, value_from in each.value.secrets : {
          name      = name
          valueFrom = value_from
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_service" "web" {
  name                    = "${local.prefix}-web"
  cluster                 = aws_ecs_cluster.open_uptime.id
  task_definition         = aws_ecs_task_definition.service["web"].arn
  desired_count           = local.services.web.desired_count
  launch_type             = "FARGATE"
  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"
  tags                    = local.tags

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = local.container_port
  }

  depends_on = [aws_lb_listener.https, aws_lb_listener.http_cloudfront, aws_lb_listener_rule.http_cloudfront_origin_verify, aws_efs_mount_target.data]
}

resource "aws_ecs_service" "worker" {
  for_each = {
    for key, value in local.services : key => value if key != "web" && key != "migration"
  }

  name                    = "${local.prefix}-${each.key}"
  cluster                 = aws_ecs_cluster.open_uptime.id
  task_definition         = aws_ecs_task_definition.service[each.key].arn
  desired_count           = each.value.desired_count
  launch_type             = "FARGATE"
  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"
  tags                    = local.tags

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.worker[each.key].id]
    assign_public_ip = false
  }
}

resource "aws_cloudwatch_metric_alarm" "web_5xx" {
  alarm_name          = "${local.prefix}-web-5xx"
  alarm_description   = "Open Uptime web target group 5xx responses"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags

  dimensions = {
    LoadBalancer = aws_lb.open_uptime.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "web_unhealthy" {
  alarm_name          = "${local.prefix}-web-unhealthy"
  alarm_description   = "Open Uptime unhealthy web targets"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags

  dimensions = {
    LoadBalancer = aws_lb.open_uptime.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
}

resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_limit_usd > 0 && length(var.budget_alert_email_addresses) > 0 ? 1 : 0
  name         = "${local.prefix}-monthly-budget"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Service$%s", var.service_name)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.budget_alert_email_addresses
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = var.budget_alert_email_addresses
  }

  tags = local.tags
}
