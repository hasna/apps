variable "account_name" {
  description = "Human-readable AWS account/profile label."
  type        = string
  default     = "aws-profile"
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "stage" {
  description = "Deployment stage."
  type        = string
  default     = "prod"
}

variable "service_name" {
  description = "Service name prefix."
  type        = string
  default     = "open-uptime"
}

variable "hostname" {
  description = "Public/internal hostname for Open Uptime."
  type        = string
  default     = "uptime.example.com"
}

variable "workspace_id" {
  description = "Hosted Open Uptime workspace id."
  type        = string
  default     = "workspace-id"
}

variable "vpc_id" {
  description = "Existing VPC id."
  type        = string
  default     = "vpc-xxxxxxxx"
}

variable "ecr_repository_name" {
  description = "ECR repository name for the Open Uptime image."
  type        = string
  default     = "open-uptime"
}

variable "protected_access_mode" {
  description = "Protected web access mode. cloudfront_default_domain uses the CloudFront HTTPS default domain and restricts ALB HTTP to CloudFront origin-facing ranges. alb_https_cert uses an ALB HTTPS listener with certificate_arn."
  type        = string
  default     = "cloudfront_default_domain"

  validation {
    condition     = contains(["cloudfront_default_domain", "alb_https_cert"], var.protected_access_mode)
    error_message = "protected_access_mode must be cloudfront_default_domain or alb_https_cert."
  }
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB."
  type        = list(string)
}

variable "alb_ingress_cidr_blocks" {
  description = "Approved HTTPS source CIDR blocks for ALB HTTPS mode. Keep empty until edge/source policy is approved."
  type        = list(string)
  default     = []
}

variable "private_subnet_ids" {
  description = "Private application subnets for ECS tasks."
  type        = list(string)
}

variable "container_image" {
  description = "Immutable Open Uptime image URI, preferably with digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
    error_message = "container_image must be an immutable image digest ending in @sha256:<64 hex chars>."
  }
}

variable "runtime_package_version" {
  description = "Published @hasna/uptime package version that CodeBuild should build into the ECR image."
  type        = string
  default     = "0.1.8"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$", var.runtime_package_version))
    error_message = "runtime_package_version must be a semver version without the package name."
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN for ALB HTTPS mode. Leave null when protected_access_mode is cloudfront_default_domain."
  type        = string
  default     = null

  validation {
    condition     = var.certificate_arn == null || can(regex("^arn:aws:acm:", var.certificate_arn))
    error_message = "certificate_arn must be null or an ACM certificate ARN."
  }

  validation {
    condition     = var.protected_access_mode != "alb_https_cert" || var.certificate_arn != null
    error_message = "certificate_arn is required when protected_access_mode is alb_https_cert."
  }
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone id. Leave null to skip DNS record creation."
  type        = string
  default     = null
}

variable "app_env_secret_arn" {
  description = "Secrets Manager/SSM ARN containing hosted app environment refs."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:(secretsmanager|ssm):", var.app_env_secret_arn))
    error_message = "app_env_secret_arn must be a Secrets Manager or SSM ARN."
  }
}

variable "hosted_token_secret_arn" {
  description = "Secrets Manager/SSM ARN containing HASNA_UPTIME_HOSTED_TOKEN for hosted web auth bootstrap."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:(secretsmanager|ssm):", var.hosted_token_secret_arn))
    error_message = "hosted_token_secret_arn must be a Secrets Manager or SSM ARN."
  }
}

variable "public_probe_secret_arn" {
  description = "Secrets Manager/SSM ARN containing public probe config refs."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:(secretsmanager|ssm):", var.public_probe_secret_arn))
    error_message = "public_probe_secret_arn must be a Secrets Manager or SSM ARN."
  }
}

variable "reporting_secret_arn" {
  description = "Secrets Manager/SSM ARN containing Mailery/Telephony/Open Logs channel refs."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:(secretsmanager|ssm):", var.reporting_secret_arn))
    error_message = "reporting_secret_arn must be a Secrets Manager or SSM ARN."
  }
}

variable "kms_key_arn" {
  description = "KMS key ARN for S3, logs, and secret-decrypt permissions."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:kms:", var.kms_key_arn))
    error_message = "kms_key_arn must be a KMS key ARN."
  }
}

variable "desired_counts" {
  description = "Desired ECS service counts. Keep all at 0 until app/runtime blockers are closed."
  type        = map(number)
  default = {
    web            = 0
    scheduler      = 0
    "public-probe" = 0
    reporter       = 0
    migration      = 0
  }

  validation {
    condition = alltrue([for count in values(var.desired_counts) : count >= 0]) && lookup(var.desired_counts, "web", 0) <= 1 && alltrue([
      for key in ["scheduler", "public-probe", "reporter", "migration"] : lookup(var.desired_counts, key, 0) == 0
    ])
    error_message = "EFS SQLite bridge requires web desired count 0 or 1 and scheduler/public-probe/reporter/migration desired counts 0."
  }
}

variable "alarm_actions" {
  description = "Optional SNS topic ARNs or other CloudWatch alarm action ARNs."
  type        = list(string)
  default     = []
}
