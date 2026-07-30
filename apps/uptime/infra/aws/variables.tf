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
  description = "Protected web access mode. cloudfront_default_domain uses the CloudFront HTTPS default domain and restricts the ALB origin to CloudFront origin-facing ranges. alb_https_cert uses an ALB HTTPS listener with certificate_arn."
  type        = string
  default     = "cloudfront_default_domain"

  validation {
    condition     = contains(["cloudfront_default_domain", "alb_https_cert"], var.protected_access_mode)
    error_message = "protected_access_mode must be cloudfront_default_domain or alb_https_cert."
  }
}

variable "cloudfront_origin_protocol_policy" {
  description = "CloudFront-to-ALB origin protocol policy. Keep http-only until an origin hostname and matching ACM certificate are approved; set https-only with cloudfront_origin_domain_name and certificate_arn before token-bearing live traffic."
  type        = string
  default     = "http-only"

  validation {
    condition     = contains(["http-only", "https-only"], var.cloudfront_origin_protocol_policy)
    error_message = "cloudfront_origin_protocol_policy must be http-only or https-only."
  }
}

variable "allow_cloudfront_http_origin_live_traffic" {
  description = "Explicit risk acceptance for setting web desired count above 0 while CloudFront-to-ALB origin transport is http-only. Keep false unless a named operator accepts the temporary HTTP-origin bridge risk for a bounded smoke."
  type        = bool
  default     = false
}

variable "cloudfront_origin_domain_name" {
  description = "DNS hostname CloudFront uses for the ALB custom origin when cloudfront_origin_protocol_policy is https-only. The hostname must resolve to the ALB and match certificate_arn. Leave null for the default HTTP-origin bridge."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.cloudfront_origin_domain_name == null
      || can(regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$", var.cloudfront_origin_domain_name))
    )
    error_message = "cloudfront_origin_domain_name must be null or a valid DNS hostname."
  }

  validation {
    condition = (
      !(var.protected_access_mode == "cloudfront_default_domain" && var.cloudfront_origin_protocol_policy == "https-only")
      || var.cloudfront_origin_domain_name != null
    )
    error_message = "cloudfront_origin_domain_name is required when CloudFront HTTPS origin is enabled."
  }
}

variable "enable_cloudfront_origin_verify_header" {
  description = "When true in cloudfront_default_domain mode, CloudFront sends a private origin header and the ALB listener rejects requests missing the matching value."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_cloudfront_origin_verify_header || var.protected_access_mode == "cloudfront_default_domain"
    error_message = "enable_cloudfront_origin_verify_header can only be true when protected_access_mode is cloudfront_default_domain."
  }

  validation {
    condition = (
      !var.enable_cloudfront_origin_verify_header
      || var.live_ops_backend_state_hardened
      || var.allow_origin_verify_header_before_backend_state_hardened
    )
    error_message = "enable_cloudfront_origin_verify_header requires live_ops_backend_state_hardened=true, or allow_origin_verify_header_before_backend_state_hardened=true for an explicit zero-count rotation exception."
  }
}

variable "allow_origin_verify_header_before_backend_state_hardened" {
  description = "Explicit zero-count exception for creating or rotating the secret-bearing CloudFront origin verification header before live_ops_backend_state_hardened is true. Keep false for live traffic."
  type        = bool
  default     = false
}

variable "cloudfront_origin_verify_header_name" {
  description = "CloudFront-only origin verification header name used when enable_cloudfront_origin_verify_header is true."
  type        = string
  default     = "X-Open-Uptime-Origin-Verify"

  validation {
    condition = (
      can(regex("^[A-Za-z0-9-]+$", var.cloudfront_origin_verify_header_name))
      && !startswith(lower(var.cloudfront_origin_verify_header_name), "x-amz-")
      && !startswith(lower(var.cloudfront_origin_verify_header_name), "x-edge-")
      && !contains([
        "authorization",
        "cache-control",
        "connection",
        "content-length",
        "content-type",
        "cookie",
        "host",
        "idempotency-key",
        "if-match",
        "if-modified-since",
        "if-none-match",
        "if-range",
        "if-unmodified-since",
        "max-forwards",
        "origin",
        "pragma",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "range",
        "request-range",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "via",
        "x-real-ip",
        "x-uptime-hosted-token",
        "x-uptime-workspace",
      ], lower(var.cloudfront_origin_verify_header_name))
    )
    error_message = "cloudfront_origin_verify_header_name must be a safe CloudFront custom origin header name and must not use reserved, app-forwarded, or viewer-controlled header names."
  }
}

variable "cloudfront_origin_verify_header_value" {
  description = "Sensitive CloudFront-only origin verification header value. Required when enable_cloudfront_origin_verify_header is true."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true

  validation {
    condition = (
      !(var.enable_cloudfront_origin_verify_header && var.protected_access_mode == "cloudfront_default_domain")
      || (
        var.cloudfront_origin_verify_header_value != null
        && can(regex("^[A-Za-z0-9_-]{32,256}$", var.cloudfront_origin_verify_header_value))
      )
    )
    error_message = "cloudfront_origin_verify_header_value is required when origin verification is enabled and must be 32-256 URL-safe characters."
  }
}

variable "cloudfront_origin_verify_listener_rule_priority" {
  description = "ALB listener rule priority for the CloudFront origin verification header rule."
  type        = number
  default     = 100

  validation {
    condition     = var.cloudfront_origin_verify_listener_rule_priority >= 1 && var.cloudfront_origin_verify_listener_rule_priority <= 50000
    error_message = "cloudfront_origin_verify_listener_rule_priority must be between 1 and 50000."
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
  default     = "0.1.70"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$", var.runtime_package_version))
    error_message = "runtime_package_version must be a semver version without the package name."
  }
}

variable "runtime_package_integrity" {
  description = "Expected npm dist.integrity value for @hasna/uptime@runtime_package_version. CodeBuild refuses to build without this unless allow_unpinned_runtime_package_integrity is explicitly true."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.runtime_package_integrity == null || can(regex("^sha512-[A-Za-z0-9+/=]+$", var.runtime_package_integrity))
    error_message = "runtime_package_integrity must be null or an npm sha512 integrity string."
  }

  validation {
    condition = (
      var.runtime_package_integrity != null
      || var.allow_unpinned_runtime_package_integrity
      || alltrue([for desired_count in values(var.desired_counts) : desired_count == 0])
    )
    error_message = "runtime_package_integrity is required before scaling any service above zero unless allow_unpinned_runtime_package_integrity is explicitly true."
  }
}

variable "allow_unpinned_runtime_package_integrity" {
  description = "Explicit escape hatch for zero-count review builds without a pinned npm dist.integrity. Keep false for deployable/live paths."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate ARN for ALB HTTPS mode or CloudFront HTTPS-origin mode. Leave null only when the ALB is not serving HTTPS."
  type        = string
  default     = null

  validation {
    condition     = var.certificate_arn == null || can(regex("^arn:(aws|aws-us-gov|aws-cn):acm:${var.region}:[0-9]{12}:certificate/[0-9A-Fa-f-]{36}$", var.certificate_arn))
    error_message = "certificate_arn must be null or an ACM certificate ARN in the deployment region."
  }

  validation {
    condition = (
      !(var.protected_access_mode == "alb_https_cert" || (var.protected_access_mode == "cloudfront_default_domain" && var.cloudfront_origin_protocol_policy == "https-only"))
      || var.certificate_arn != null
    )
    error_message = "certificate_arn is required when protected_access_mode is alb_https_cert or CloudFront HTTPS origin is enabled."
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
  description = "Secrets Manager/SSM ARN injected as HASNA_UPTIME_HOSTED_TOKEN. Hosted deployments should store scoped hosted-token JSON descriptors here, not a single broad raw token."
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

  validation {
    condition = (
      lookup(var.desired_counts, "web", 0) == 0
      || var.protected_access_mode != "cloudfront_default_domain"
      || var.enable_cloudfront_origin_verify_header
    )
    error_message = "web desired count above 0 in cloudfront_default_domain mode requires enable_cloudfront_origin_verify_header=true."
  }

  validation {
    condition = (
      lookup(var.desired_counts, "web", 0) == 0
      || var.protected_access_mode != "cloudfront_default_domain"
      || var.cloudfront_origin_protocol_policy == "https-only"
      || var.allow_cloudfront_http_origin_live_traffic
    )
    error_message = "web desired count above 0 requires CloudFront HTTPS-origin mode, or explicit allow_cloudfront_http_origin_live_traffic=true risk acceptance for a bounded smoke."
  }

  validation {
    condition = (
      lookup(var.desired_counts, "web", 0) == 0
      || (
        var.live_ops_backend_state_hardened
        && var.live_ops_human_alert_delivery_ready
        && var.live_ops_backup_restore_ready
        && var.live_ops_evidence_retention_ready
      )
    )
    error_message = "web desired count above 0 requires live_ops_backend_state_hardened, live_ops_human_alert_delivery_ready, live_ops_backup_restore_ready, and live_ops_evidence_retention_ready."
  }
}

variable "alarm_actions" {
  description = "Optional SNS topic ARNs or other CloudWatch alarm action ARNs."
  type        = list(string)
  default     = []
}

variable "enable_worker_runtime_alarms" {
  description = "Create default-off CloudWatch alarm contracts for scheduler, public-probe, and reporter worker runtime metrics. Keep false until workers emit the documented metrics and alert delivery is approved."
  type        = bool
  default     = false

  validation {
    condition = (
      !var.enable_worker_runtime_alarms
      || (
        var.worker_runtime_metric_producers_ready
        && var.live_ops_human_alert_delivery_ready
        && length(var.alarm_actions) > 0
      )
    )
    error_message = "enable_worker_runtime_alarms requires worker_runtime_metric_producers_ready=true, live_ops_human_alert_delivery_ready=true, and at least one alarm action."
  }
}

variable "worker_runtime_metric_producers_ready" {
  description = "Set true only after scheduler, public-probe, and reporter workers emit the documented custom CloudWatch metrics with Service/Stage/Role dimensions."
  type        = bool
  default     = false
}

variable "worker_runtime_alarm_namespace" {
  description = "CloudWatch custom metric namespace for Open Uptime worker runtime alarms."
  type        = string
  default     = "OpenUptime/Worker"

  validation {
    condition     = length(trimspace(var.worker_runtime_alarm_namespace)) > 0 && length(var.worker_runtime_alarm_namespace) <= 255
    error_message = "worker_runtime_alarm_namespace must be a non-empty CloudWatch namespace of at most 255 characters."
  }
}

variable "backup_retention_days" {
  description = "Retention period for the Open Uptime EFS AWS Backup rule. Keep aligned with any backup vault lock retention window."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 36500
    error_message = "backup_retention_days must be between 1 and 36500."
  }
}

variable "backup_vault_lock_mode" {
  description = "AWS Backup Vault Lock mode. Use disabled until retention is approved; governance omits changeable_for_days and remains removable by privileged IAM users; compliance sets changeable_for_days and becomes immutable after the grace period."
  type        = string
  default     = "disabled"

  validation {
    condition     = contains(["disabled", "governance", "compliance"], var.backup_vault_lock_mode)
    error_message = "backup_vault_lock_mode must be disabled, governance, or compliance."
  }
}

variable "backup_vault_lock_min_retention_days" {
  description = "Minimum retention enforced by AWS Backup Vault Lock when backup_vault_lock_mode is governance or compliance."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_vault_lock_min_retention_days >= 1 && var.backup_vault_lock_min_retention_days <= 36500
    error_message = "backup_vault_lock_min_retention_days must be between 1 and 36500."
  }

  validation {
    condition = (
      var.backup_vault_lock_mode == "disabled"
      || var.backup_vault_lock_min_retention_days <= var.backup_retention_days
    )
    error_message = "backup_vault_lock_min_retention_days must be less than or equal to backup_retention_days when backup_vault_lock_mode is governance or compliance."
  }
}

variable "backup_vault_lock_max_retention_days" {
  description = "Maximum retention enforced by AWS Backup Vault Lock when backup_vault_lock_mode is governance or compliance."
  type        = number
  default     = 3650

  validation {
    condition     = var.backup_vault_lock_max_retention_days >= 1 && var.backup_vault_lock_max_retention_days <= 36500
    error_message = "backup_vault_lock_max_retention_days must be between 1 and 36500."
  }

  validation {
    condition = (
      var.backup_vault_lock_mode == "disabled"
      || var.backup_vault_lock_max_retention_days >= var.backup_retention_days
    )
    error_message = "backup_vault_lock_max_retention_days must be greater than or equal to backup_retention_days when backup_vault_lock_mode is governance or compliance."
  }
}

variable "backup_vault_lock_changeable_for_days" {
  description = "Compliance-mode grace period before AWS Backup Vault Lock becomes immutable. Must be null unless backup_vault_lock_mode is compliance; governance mode omits this value."
  type        = number
  default     = null
  nullable    = true

  validation {
    condition = (
      var.backup_vault_lock_changeable_for_days == null
      || (var.backup_vault_lock_changeable_for_days >= 3 && var.backup_vault_lock_changeable_for_days <= 36500)
    )
    error_message = "backup_vault_lock_changeable_for_days must be null or between 3 and 36500."
  }

  validation {
    condition = (
      (var.backup_vault_lock_mode == "compliance" && var.backup_vault_lock_changeable_for_days != null)
      || (var.backup_vault_lock_mode != "compliance" && var.backup_vault_lock_changeable_for_days == null)
    )
    error_message = "backup_vault_lock_changeable_for_days must be set only when backup_vault_lock_mode is compliance, and must be null for disabled or governance."
  }
}

variable "live_ops_backend_state_hardened" {
  description = "Set true only after the Terraform backend state path for this workload is hardened for secret-bearing state, including reviewed KMS, principal, retention/Object Lock or accepted equivalent, and operator access evidence."
  type        = bool
  default     = false
}

variable "live_ops_human_alert_delivery_ready" {
  description = "Set true only after approved human/on-call alarm and budget recipients are configured and a non-secret delivery smoke is recorded."
  type        = bool
  default     = false
}

variable "live_ops_backup_restore_ready" {
  description = "Set true only after backup readiness, retention, and restore evidence for the currently pinned runtime path are recorded."
  type        = bool
  default     = false
}

variable "live_ops_evidence_retention_ready" {
  description = "Set true only after evidence/artifact retention, KMS policy, deletion controls, and rollback/break-glass expectations are reviewed for live traffic."
  type        = bool
  default     = false
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

variable "additional_vpc_endpoint_principal_arns" {
  description = "Additional IAM principal ARNs allowed by private VPC endpoint policies in shared-VPC deployments, keyed by endpoint purpose. Keep every list empty unless a reviewed non-Open-Uptime principal must use that exact endpoint policy path."
  type = object({
    ecr         = optional(list(string), [])
    logs        = optional(list(string), [])
    secret_read = optional(list(string), [])
    sts         = optional(list(string), [])
    kms         = optional(list(string), [])
    s3_evidence = optional(list(string), [])
  })
  default = {}

  validation {
    condition = alltrue(flatten([
      for arns in values(var.additional_vpc_endpoint_principal_arns) : [
        for arn in arns : can(regex("^arn:(aws|aws-us-gov|aws-cn):iam::[0-9]{12}:(role|user)/[A-Za-z0-9+=,.@_/-]+$", arn))
      ]
    ]))
    error_message = "additional_vpc_endpoint_principal_arns values must contain IAM role or user ARNs."
  }
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
