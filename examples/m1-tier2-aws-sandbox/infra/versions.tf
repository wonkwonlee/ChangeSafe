# M1 Tier 2 sandbox estate. This configuration is operated by the sandbox
# owner with their own credentials. ChangeSafe never runs Terraform: it reads
# the captured `terraform show -json` artifact the owner produces from a
# saved plan, and its exit code decides whether the owner's pipeline proceeds.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project = "changesafe-m1-tier2"
    }
  }
}
