terraform {
  required_version = ">= 1.6.0"

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

locals {
  prefix          = "${var.service_name}-${var.stage}"
  container_port  = 3899
  evidence_bucket = "hasna-${var.stage}-${var.service_name}-evidence"
  services = {
    web = {
      desired_count = lookup(var.desired_counts, "web", 0)
      db_access     = true
      command       = ["bun", "dist/cli/index.js", "serve", "--mode", "hosted", "--host", "0.0.0.0", "--port", tostring(local.container_port)]
      secrets       = { HASNA_UPTIME_DATABASE_URL = var.database_secret_arn, APP_ENV = var.app_env_secret_arn, HASNA_UPTIME_HOSTED_TOKEN = var.hosted_token_secret_arn }
    }
    scheduler = {
      desired_count = lookup(var.desired_counts, "scheduler", 0)
      db_access     = true
      command       = ["bun", "dist/cli/index.js", "cloud", "plan"]
      secrets       = { HASNA_UPTIME_DATABASE_URL = var.database_secret_arn, APP_ENV = var.app_env_secret_arn }
    }
    "public-probe" = {
      desired_count = lookup(var.desired_counts, "public-probe", 0)
      db_access     = false
      command       = ["bun", "dist/cli/index.js", "cloud", "plan"]
      secrets       = { PROBE_CONFIG = var.public_probe_secret_arn }
    }
    reporter = {
      desired_count = lookup(var.desired_counts, "reporter", 0)
      db_access     = true
      command       = ["bun", "dist/cli/index.js", "cloud", "plan"]
      secrets       = { HASNA_UPTIME_DATABASE_URL = var.database_secret_arn, REPORTING_CONFIG = var.reporting_secret_arn }
    }
    migration = {
      desired_count = lookup(var.desired_counts, "migration", 0)
      db_access     = true
      command       = ["bun", "dist/cli/index.js", "cloud", "plan"]
      secrets       = { HASNA_UPTIME_DATABASE_URL = var.database_secret_arn, APP_ENV = var.app_env_secret_arn }
    }
  }
  tags = {
    ManagedBy = "terraform"
    Service   = var.service_name
    Stage     = var.stage
    Account   = var.account_name
  }
}

data "aws_vpc" "target" {
  id = var.vpc_id
}

resource "aws_ecr_repository" "open_uptime" {
  name                 = "hasna/opensource/${var.service_name}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
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
  count             = length(var.alb_ingress_cidr_blocks) > 0 ? 1 : 0
  type              = "ingress"
  description       = "HTTPS"
  security_group_id = aws_security_group.alb.id
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.alb_ingress_cidr_blocks
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
  description       = "Controlled egress to AWS endpoints and database"
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
  description       = each.key == "public-probe" ? "Public probe egress for approved public targets" : "Controlled egress to AWS endpoints and database"
  security_group_id = each.value.id
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = each.key == "public-probe" ? ["0.0.0.0/0"] : [data.aws_vpc.target.cidr_block]
}

resource "aws_security_group_rule" "rds_from_web" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = var.rds_security_group_id
  source_security_group_id = aws_security_group.web.id
  description              = "Open Uptime web to RDS"
}

resource "aws_security_group_rule" "rds_from_workers" {
  for_each = {
    for key, value in local.services : key => value if key != "web" && value.db_access
  }

  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = var.rds_security_group_id
  source_security_group_id = aws_security_group.worker[each.key].id
  description              = "Open Uptime ${each.key} to RDS"
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
  load_balancer_arn = aws_lb.open_uptime.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_route53_record" "open_uptime" {
  count   = var.hosted_zone_id == null ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.hostname
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
      environment = [
        { name = "HASNA_UPTIME_MODE", value = "hosted" },
        { name = "HASNA_UPTIME_WORKSPACE_ID", value = var.workspace_id },
        { name = "HASNA_UPTIME_COMPONENT", value = each.key },
        { name = "HASNA_UPTIME_HOSTNAME", value = var.hostname },
      ]
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
  name            = "${local.prefix}-web"
  cluster         = aws_ecs_cluster.open_uptime.id
  task_definition = aws_ecs_task_definition.service["web"].arn
  desired_count   = local.services.web.desired_count
  launch_type     = "FARGATE"
  tags            = local.tags

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

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  for_each = {
    for key, value in local.services : key => value if key != "web" && key != "migration"
  }

  name            = "${local.prefix}-${each.key}"
  cluster         = aws_ecs_cluster.open_uptime.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"
  tags            = local.tags

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
