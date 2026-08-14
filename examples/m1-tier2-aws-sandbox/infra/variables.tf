variable "aws_region" {
  description = "Sandbox region. Any region works; the estate is tiny."
  type        = string
  default     = "us-west-2"
}

variable "name_suffix" {
  description = <<-EOT
    Globally-unique suffix for the S3 bucket name. Pick something private to
    your sandbox (bucket names are global). Set it once in terraform.tfvars
    and never change it during the exercise.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,30}$", var.name_suffix))
    error_message = "Use 3-31 lowercase letters, digits, or hyphens."
  }
}

variable "demo_value" {
  description = <<-EOT
    Value of the demo SSM parameter. The benign case changes only this,
    producing an update-in-place plan that the gate PASSes.
  EOT
  type        = string
  default     = "tier2-baseline"
}

variable "protected_bucket_generation" {
  description = <<-EOT
    Generation counter baked into the protected bucket's name. The hostile
    case bumps this, which forces a delete-and-create of a bucket tagged
    changesafe_protected — the plan the gate must BLOCK. The baseline and
    benign phases leave it at 1.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = var.protected_bucket_generation >= 1
    error_message = "The generation counter starts at 1."
  }
}
