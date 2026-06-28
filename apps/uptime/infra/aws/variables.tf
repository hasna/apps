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

variable "project_name" {
  description = "Project tag value for cost allocation."
  type        = string
  default     = "open-uptime"
}

variable "owner" {
  description = "Owner tag value for cost allocation and operations."
  type        = string
  default     = "hasna"
}

variable "app_type" {
  description = "AppType tag value."
  type        = string
  default     = "opensource"
}

variable "environment" {
  description = "Environment tag value."
  type        = string
  default     = "prod"
}

variable "cost_center" {
  description = "CostCenter tag value."
  type        = string
  default     = "opensource"
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
  default     = "0.1.14"

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

variable "monthly_budget_limit_usd" {
  description = "Optional monthly AWS Budgets limit in USD. Set with budget_alert_email_addresses to create a budget alert."
  type        = number
  default     = 0

  validation {
    condition     = var.monthly_budget_limit_usd >= 0
    error_message = "monthly_budget_limit_usd must be non-negative."
  }
}

variable "budget_alert_email_addresses" {
  description = "Email recipients for AWS Budgets forecasted and actual alerts. Leave empty to skip budget creation."
  type        = list(string)
  default     = []
}

variable "enable_nat_task_egress" {
  description = "Allow web and non-public worker tasks to reach AWS public APIs through NAT on TCP/443. Keep false when private VPC endpoints are the approved egress path."
  type        = bool
  default     = false
}

variable "nat_task_egress_cidr_blocks" {
  description = "CIDR blocks allowed for NAT-backed HTTPS egress when enable_nat_task_egress is true."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.nat_task_egress_cidr_blocks) > 0
    error_message = "nat_task_egress_cidr_blocks must not be empty when NAT task egress is enabled."
  }
}

variable "enable_private_vpc_endpoints" {
  description = "Create private VPC endpoints for ECS access to AWS APIs. Requires private subnet ids; S3 gateway endpoint also requires private_route_table_ids."
  type        = bool
  default     = false
}

variable "interface_vpc_endpoint_services" {
  description = "Regional interface endpoint service short names to create when enable_private_vpc_endpoints is true."
  type        = list(string)
  default     = ["ecr.api", "ecr.dkr", "logs", "secretsmanager"]

  validation {
    condition = alltrue([
      for service in var.interface_vpc_endpoint_services : contains(["ecr.api", "ecr.dkr", "logs", "secretsmanager", "sts", "ssm", "kms"], service)
    ])
    error_message = "interface_vpc_endpoint_services must contain only approved AWS service short names."
  }
}

variable "additional_vpc_endpoint_source_security_group_ids" {
  description = "Additional source security groups allowed to use Open Uptime interface VPC endpoints in a shared VPC. Keep empty for dedicated Open Uptime subnets."
  type        = list(string)
  default     = []
}

variable "gateway_vpc_endpoint_services" {
  description = "Regional gateway endpoint service short names to create when enable_private_vpc_endpoints is true."
  type        = list(string)
  default     = ["s3"]

  validation {
    condition     = alltrue([for service in var.gateway_vpc_endpoint_services : contains(["s3"], service)])
    error_message = "gateway_vpc_endpoint_services currently supports only s3."
  }
}

variable "private_route_table_ids" {
  description = "Private route table ids for gateway VPC endpoints such as S3. Leave empty to skip gateway endpoint creation."
  type        = list(string)
  default     = []
}
