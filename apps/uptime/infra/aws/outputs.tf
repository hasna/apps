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

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
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
