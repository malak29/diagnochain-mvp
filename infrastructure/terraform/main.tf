# DiagnoChain Infrastructure as Code
terraform {
  required_version = ">= 1.5"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket = "diagnochain-terraform-state"
    key    = "infrastructure/terraform.tfstate"
    region = "us-east-1"
    encrypt = true
    dynamodb_table = "diagnochain-terraform-locks"
  }
}

# Variables
variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "staging"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Domain name for DiagnoChain"
  type        = string
  default     = "diagnochain.com"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "diagnochain-cluster"
}

variable "node_instance_types" {
  description = "EC2 instance types for EKS nodes"
  type        = list(string)
  default     = ["t3.medium", "t3.large"]
}

variable "min_nodes" {
  description = "Minimum number of nodes"
  type        = number
  default     = 2
}

variable "max_nodes" {
  description = "Maximum number of nodes"
  type        = number
  default     = 10
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "enable_bitcoin_node" {
  description = "Deploy Bitcoin full node"
  type        = bool
  default     = false
}

variable "enable_lightning_node" {
  description = "Deploy Lightning Network node"
  type        = bool
  default     = true
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Local values
locals {
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 3)
  
  common_tags = {
    Project     = "DiagnoChain"
    Environment = var.environment
    ManagedBy   = "Terraform"
    CreatedBy   = "diagnochain-infrastructure"
  }

  cluster_name = "${var.cluster_name}-${var.environment}"
}

# Provider configuration
provider "aws" {
  region = var.region
  
  default_tags {
    tags = local.common_tags
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

# ================================
# Networking
# ================================

# VPC
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${local.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k)]
  public_subnets  = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k + 100)]
  database_subnets = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k + 200)]

  enable_nat_gateway   = true
  enable_vpn_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags for EKS
  public_subnet_tags = {
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
    "kubernetes.io/role/elb"                      = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
    "kubernetes.io/role/internal-elb"             = "1"
  }

  tags = local.common_tags
}

# Security Groups
resource "aws_security_group" "database" {
  name_prefix = "${local.cluster_name}-database-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "PostgreSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-database-sg"
  })
}

resource "aws_security_group" "redis" {
  name_prefix = "${local.cluster_name}-redis-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "Redis"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-redis-sg"
  })
}

resource "aws_security_group" "lightning" {
  count       = var.enable_lightning_node ? 1 : 0
  name_prefix = "${local.cluster_name}-lightning-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "Lightning P2P"
    from_port   = 9735
    to_port     = 9735
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Lightning REST API"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-lightning-sg"
  })
}

# ================================
# EKS Cluster
# ================================

module "eks" {
  source = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = local.cluster_name
  cluster_version = "1.28"

  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  cluster_endpoint_public_access = true
  cluster_endpoint_private_access = true

  # Cluster encryption
  cluster_encryption_config = {
    provider_key_arn = aws_kms_key.eks.arn
    resources        = ["secrets"]
  }

  # EKS Managed Node Groups
  eks_managed_node_groups = {
    general = {
      name = "${local.cluster_name}-general"
      
      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"
      
      min_size     = var.min_nodes
      max_size     = var.max_nodes
      desired_size = var.min_nodes + 1

      # Launch template configuration
      create_launch_template = true
      launch_template_name   = "${local.cluster_name}-general-lt"

      disk_size = 50
      disk_type = "gp3"

      labels = {
        Environment = var.environment
        NodeGroup   = "general"
      }

      taints = []

      update_config = {
        max_unavailable_percentage = 25
      }

      # Security
      metadata_options = {
        http_endpoint = "enabled"
        http_tokens   = "required"
        http_put_response_hop_limit = 2
      }
    }

    bitcoin = {
      name = "${local.cluster_name}-bitcoin"
      
      instance_types = ["t3.large", "m5.large"]
      capacity_type  = "SPOT"
      
      min_size     = var.enable_bitcoin_node ? 1 : 0
      max_size     = var.enable_bitcoin_node ? 3 : 0
      desired_size = var.enable_bitcoin_node ? 1 : 0

      disk_size = 100  # Larger disk for Bitcoin blockchain data
      disk_type = "gp3"

      labels = {
        Environment = var.environment
        NodeGroup   = "bitcoin"
        WorkloadType = "bitcoin"
      }

      taints = [
        {
          key    = "bitcoin-node"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      ]
    }
  }

  # aws-auth configmap
  manage_aws_auth_configmap = true

  aws_auth_roles = [
    {
      rolearn  = aws_iam_role.diagnochain_admin.arn
      username = "diagnochain-admin"
      groups   = ["system:masters"]
    }
  ]

  tags = local.common_tags
}

# ================================
# Database (RDS PostgreSQL)
# ================================

resource "aws_db_subnet_group" "database" {
  name       = "${local.cluster_name}-db-subnet-group"
  subnet_ids = module.vpc.database_subnets

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-db-subnet-group"
  })
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.cluster_name}-postgres"

  # Engine configuration
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.db_instance_class

  # Storage configuration
  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id           = aws_kms_key.rds.arn

  # Database configuration
  db_name  = "diagnochain"
  username = "postgres"
  password = random_password.db_password.result

  # Network configuration
  db_subnet_group_name   = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  # Backup configuration
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  
  # Performance monitoring
  performance_insights_enabled = true
  monitoring_interval         = 60
  monitoring_role_arn        = aws_iam_role.rds_monitoring.arn

  # Security
  deletion_protection = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"
  
  final_snapshot_identifier = var.environment == "prod" ? "${local.cluster_name}-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}" : null

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-postgres"
  })
}

# ================================
# Redis (ElastiCache)
# ================================

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.cluster_name}-redis-subnet-group"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id         = "${local.cluster_name}-redis"
  description                  = "Redis cluster for DiagnoChain"

  node_type            = var.redis_node_type
  port                 = 6379
  parameter_group_name = "default.redis7"

  num_cache_clusters = 2
  
  # Multi-AZ configuration
  automatic_failover_enabled = true
  multi_az_enabled          = true

  # Network configuration
  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Security
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_password.result

  # Backup
  snapshot_retention_limit = 7
  snapshot_window         = "03:00-05:00"

  # Maintenance
  maintenance_window = "sun:05:00-sun:07:00"

  tags = local.common_tags
}

# ================================
# Load Balancer and CDN
# ================================

# Application Load Balancer
resource "aws_lb" "diagnochain" {
  name               = "${local.cluster_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = module.vpc.public_subnets

  enable_deletion_protection = var.environment == "prod"

  # Access logs
  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb-access-logs"
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-alb"
  })
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.cluster_name}-alb-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-alb-sg"
  })
}

# CloudFront CDN
resource "aws_cloudfront_distribution" "diagnochain" {
  origin {
    domain_name = aws_lb.diagnochain.dns_name
    origin_id   = "ALB-${aws_lb.diagnochain.name}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  aliases = [var.domain_name, "www.${var.domain_name}"]

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "ALB-${aws_lb.diagnochain.name}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
      
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # API caching behavior
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-${aws_lb.diagnochain.name}"
    
    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "https-only"
    min_ttl               = 0
    default_ttl           = 0
    max_ttl               = 0
  }

  # Static asset caching
  ordered_cache_behavior {
    path_pattern     = "/static/*"
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-${aws_lb.diagnochain.name}"
    
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl               = 31536000  # 1 year
    default_ttl           = 31536000
    max_ttl               = 31536000
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.diagnochain.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

# ================================
# Storage
# ================================

# S3 Buckets
resource "aws_s3_bucket" "app_storage" {
  bucket = "${local.cluster_name}-app-storage"
  
  tags = local.common_tags
}

resource "aws_s3_bucket" "logs" {
  bucket = "${local.cluster_name}-logs"
  
  tags = local.common_tags
}

resource "aws_s3_bucket" "backups" {
  bucket = "${local.cluster_name}-backups"
  
  tags = local.common_tags
}

# S3 Bucket configurations
resource "aws_s3_bucket_versioning" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_encryption" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        kms_master_key_id = aws_kms_key.s3.arn
        sse_algorithm     = "aws:kms"
      }
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "log_retention"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}

# ================================
# EFS for shared storage
# ================================

resource "aws_efs_file_system" "app_storage" {
  creation_token = "${local.cluster_name}-efs"
  
  performance_mode = "generalPurpose"
  throughput_mode  = "provisioned"
  provisioned_throughput_in_mibps = 100

  encrypted  = true
  kms_key_id = aws_kms_key.efs.arn

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-efs"
  })
}

resource "aws_efs_mount_target" "app_storage" {
  count = length(module.vpc.private_subnets)
  
  file_system_id  = aws_efs_file_system.app_storage.id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_security_group" "efs" {
  name_prefix = "${local.cluster_name}-efs-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "NFS"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-efs-sg"
  })
}

# ================================
# IAM Roles and Policies
# ================================

resource "aws_iam_role" "diagnochain_admin" {
  name = "${local.cluster_name}-admin-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${local.account_id}:root"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "diagnochain_admin" {
  role       = aws_iam_role.diagnochain_admin.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.cluster_name}-rds-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ================================
# KMS Keys for encryption
# ================================

resource "aws_kms_key" "eks" {
  description             = "EKS Secret Encryption Key"
  deletion_window_in_days = 7
  
  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-eks-key"
  })
}

resource "aws_kms_key" "rds" {
  description             = "RDS Encryption Key"
  deletion_window_in_days = 7
  
  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-rds-key"
  })
}

resource "aws_kms_key" "s3" {
  description             = "S3 Encryption Key"
  deletion_window_in_days = 7
  
  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-s3-key"
  })
}

resource "aws_kms_key" "efs" {
  description             = "EFS Encryption Key"
  deletion_window_in_days = 7
  
  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-efs-key"
  })
}

# ================================
# SSL/TLS Certificates
# ================================

resource "aws_acm_certificate" "diagnochain" {
  domain_name       = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

# ================================
# Secrets and Random Passwords
# ================================

resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "random_password" "redis_password" {
  length  = 32
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# Store secrets in AWS Secrets Manager
resource "aws_secretsmanager_secret" "database_credentials" {
  name        = "${local.cluster_name}/database/credentials"
  description = "Database credentials for DiagnoChain"
  
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database_credentials" {
  secret_id = aws_secretsmanager_secret.database_credentials.id
  secret_string = jsonencode({
    username = "postgres"
    password = random_password.db_password.result
    endpoint = aws_db_instance.postgres.endpoint
    port     = aws_db_instance.postgres.port
    dbname   = aws_db_instance.postgres.db_name
  })
}

resource "aws_secretsmanager_secret" "redis_credentials" {
  name        = "${local.cluster_name}/redis/credentials"
  description = "Redis credentials for DiagnoChain"
  
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_credentials" {
  secret_id = aws_secretsmanager_secret.redis_credentials.id
  secret_string = jsonencode({
    endpoint = aws_elasticache_replication_group.redis.primary_endpoint_address
    port     = aws_elasticache_replication_group.redis.port
    password = random_password.redis_password.result
  })
}

# ================================
# Monitoring and Logging
# ================================

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/diagnochain/${var.environment}/application"
  retention_in_days = 30
  
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "nginx" {
  name              = "/aws/diagnochain/${var.environment}/nginx"
  retention_in_days = 14
  
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "bitcoin" {
  name              = "/aws/diagnochain/${var.environment}/bitcoin"
  retention_in_days = 30
  
  tags = local.common_tags
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${local.cluster_name}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EKS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors EKS cluster CPU utilization"
  
  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.eks.cluster_name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "${local.cluster_name}-db-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors RDS connection count"
  
  alarm_actions = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }

  tags = local.common_tags
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.cluster_name}-alerts"
  
  tags = local.common_tags
}

# ================================
# WAF (Web Application Firewall)
# ================================

resource "aws_wafv2_web_acl" "diagnochain" {
  name  = "${local.cluster_name}-waf"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Rate limiting rule
  rule {
    name     = "RateLimitRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # AWS Managed Rules
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  tags = local.common_tags
}

# ================================
# Backup and Disaster Recovery
# ================================

# Automated Database Backups
resource "aws_backup_vault" "diagnochain" {
  name        = "${local.cluster_name}-backup-vault"
  kms_key_arn = aws_kms_key.backup.arn
  
  tags = local.common_tags
}

resource "aws_kms_key" "backup" {
  description             = "KMS key for backup encryption"
  deletion_window_in_days = 7
  
  tags = local.common_tags
}

resource "aws_backup_plan" "diagnochain" {
  name = "${local.cluster_name}-backup-plan"

  rule {
    rule_name         = "daily_backup"
    target_vault_name = aws_backup_vault.diagnochain.name
    schedule          = "cron(0 2 ? * * *)"  # 2 AM daily

    recovery_point_tags = local.common_tags

    lifecycle {
      cold_storage_after = 30
      delete_after       = 365
    }

    copy_action {
      destination_vault_arn = aws_backup_vault.diagnochain.arn
      
      lifecycle {
        cold_storage_after = 30
        delete_after       = 365
      }
    }
  }

  tags = local.common_tags
}

# ================================
# Bitcoin Infrastructure (Optional)
# ================================

resource "aws_instance" "bitcoin_node" {
  count = var.enable_bitcoin_node ? 1 : 0
  
  ami           = "ami-0c02fb55956c7d316"  # Amazon Linux 2
  instance_type = "m5.xlarge"
  
  subnet_id                   = module.vpc.private_subnets[0]
  vpc_security_group_ids      = [aws_security_group.bitcoin_node[0].id]
  associate_public_ip_address = false

  # Storage for Bitcoin blockchain
  root_block_device {
    volume_type = "gp3"
    volume_size = 500  # 500GB for Bitcoin blockchain
    encrypted   = true
    kms_key_id  = aws_kms_key.ebs.arn
  }

  user_data = base64encode(templatefile("${path.module}/scripts/bitcoin-node-setup.sh", {
    network = var.environment == "prod" ? "mainnet" : "testnet"
  }))

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-bitcoin-node"
    Type = "BitcoinFullNode"
  })
}

resource "aws_security_group" "bitcoin_node" {
  count = var.enable_bitcoin_node ? 1 : 0
  
  name_prefix = "${local.cluster_name}-bitcoin-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "Bitcoin P2P"
    from_port   = 8333
    to_port     = 8333
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Bitcoin RPC"
    from_port   = 8332
    to_port     = 8332
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-bitcoin-sg"
  })
}

resource "aws_kms_key" "ebs" {
  description             = "EBS Encryption Key"
  deletion_window_in_days = 7
  
  tags = local.common_tags
}

# ================================
# Outputs
# ================================

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "database_endpoint" {
  description = "RDS database endpoint"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}

output "load_balancer_dns" {
  description = "Load balancer DNS name"
  value       = aws_lb.diagnochain.dns_name
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain"
  value       = aws_cloudfront_distribution.diagnochain.domain_name
}

output "s3_buckets" {
  description = "S3 bucket names"
  value = {
    app_storage = aws_s3_bucket.app_storage.bucket
    logs        = aws_s3_bucket.logs.bucket
    backups     = aws_s3_bucket.backups.bucket
  }
}

output "bitcoin_node_ip" {
  description = "Bitcoin node private IP"
  value       = var.enable_bitcoin_node ? aws_instance.bitcoin_node[0].private_ip : null
}

output "secrets_manager_arns" {
  description = "AWS Secrets Manager ARNs"
  value = {
    database = aws_secretsmanager_secret.database_credentials.arn
    redis    = aws_secretsmanager_secret.redis_credentials.arn
  }
  sensitive = true
}

# ================================
# DNS and Domain Configuration
# ================================

# Assume DNS is managed externally (Cloudflare, Route53, etc.)
# Add DNS records as needed for your domain provider