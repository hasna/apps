output "ecr_repository_url" {
  value = aws_ecr_repository.open_uptime.repository_url
}

output "image_builder_project_name" {
  value = aws_codebuild_project.image_builder.name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.open_uptime.name
}

output "alb_dns_name" {
  value = aws_lb.open_uptime.dns_name
}

output "cloudfront_domain_name" {
  value = try(aws_cloudfront_distribution.open_uptime[0].domain_name, null)
}

output "protected_access_url" {
  value = var.protected_access_mode == "cloudfront_default_domain" ? "https://${aws_cloudfront_distribution.open_uptime[0].domain_name}" : "https://${var.hostname}"
}

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
}

output "kms_key_arn" {
  value = var.kms_key_arn
}

output "log_group_names" {
  value = merge(
    { image_builder = aws_cloudwatch_log_group.image_builder.name },
    { for role, group in aws_cloudwatch_log_group.service : role => group.name },
  )
}

output "alarm_names" {
  value = {
    web_5xx       = aws_cloudwatch_metric_alarm.web_5xx.alarm_name
    web_unhealthy = aws_cloudwatch_metric_alarm.web_unhealthy.alarm_name
  }
}

output "backup_vault_name" {
  value = aws_backup_vault.data.name
}

output "backup_plan_id" {
  value = aws_backup_plan.data.id
}

output "efs_file_system_id" {
  value = aws_efs_file_system.data.id
}

output "efs_access_point_id" {
  value = aws_efs_access_point.uptime.id
}

output "service_names" {
  value = concat(
    [aws_ecs_service.web.name],
    [for service in aws_ecs_service.worker : service.name],
  )
}
