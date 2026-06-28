variable "account_name" {
  description = "Human-readable AWS account/profile label."
  type        = string
  default     = "hasna-xyz-infra"
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
  default     = "uptime.hasna.xyz"
}

variable "workspace_id" {
  description = "Hosted Open Uptime workspace id."
  type        = string
  default     = "wks_2tyysw05cwap"
}

variable "vpc_id" {
  description = "Existing VPC id."
  type        = string
  default     = "vpc-04c7f7abc1d3c3f56"
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB."
  type        = list(string)
}

variable "alb_ingress_cidr_blocks" {
  description = "Approved HTTPS source CIDR blocks for the ALB. Keep empty until edge/source policy is approved."
  type        = list(string)
  default     = []
}

variable "private_subnet_ids" {
  description = "Private application subnets for ECS tasks."
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Existing RDS security group id that should allow Open Uptime client access."
  type        = string
}

variable "container_image" {
  description = "Immutable Open Uptime image URI, preferably with digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
    error_message = "container_image must be an immutable image digest ending in @sha256:<64 hex chars>."
  }
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone id. Leave null to skip DNS record creation."
  type        = string
  default     = null
}

variable "database_secret_arn" {
  description = "Secrets Manager/SSM ARN containing DATABASE_URL."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:(secretsmanager|ssm):", var.database_secret_arn))
    error_message = "database_secret_arn must be a Secrets Manager or SSM ARN, not a plaintext database URL."
  }
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
    condition     = alltrue([for count in values(var.desired_counts) : count >= 0])
    error_message = "desired_counts values must be non-negative."
  }
}

variable "alarm_actions" {
  description = "Optional SNS topic ARNs or other CloudWatch alarm action ARNs."
  type        = list(string)
  default     = []
}
