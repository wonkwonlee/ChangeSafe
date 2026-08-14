# Two fictional resources, chosen for near-zero cost:
#
# - an SSM parameter the benign case updates in place, and
# - an S3 bucket tagged `changesafe_protected = "true"`, which the hostile
#   case tries to replace by renaming it.
#
# Everything here is publishable demo data; nothing references a real
# organization or carries real content.

resource "aws_ssm_parameter" "demo" {
  name  = "/changesafe/m1-tier2/demo"
  type  = "String"
  value = var.demo_value
}

resource "aws_s3_bucket" "compliance_logs" {
  bucket = "changesafe-tier2-compliance-${var.name_suffix}-g${var.protected_bucket_generation}"

  tags = {
    changesafe_protected = "true"
    retention            = "7y"
  }
}
