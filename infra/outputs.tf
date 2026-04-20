output "route53_nameservers" {
  description = "Update these NS records in Cloudflare for the hosted zone"
  value       = aws_route53_zone.aws.name_servers
}
