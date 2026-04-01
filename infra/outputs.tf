output "ecr_repository_url" {
  description = "ECR repository URL for pushing API images."
  value       = aws_ecr_repository.api.repository_url
}

output "alb_dns_name" {
  description = "DNS name of the ALB."
  value       = aws_lb.benstack.dns_name
}

output "acm_validation_records" {
  description = "DNS records to add in Cloudflare to validate the ACM certificate."
  value       = aws_acm_certificate.api.domain_validation_options
}

output "frontend_bucket" {
  description = "S3 bucket name for frontend assets."
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain — add as CNAME in Cloudflare."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidations."
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_acm_validation_records" {
  description = "DNS records to add in Cloudflare to validate the frontend ACM certificate."
  value       = aws_acm_certificate.frontend.domain_validation_options
}
