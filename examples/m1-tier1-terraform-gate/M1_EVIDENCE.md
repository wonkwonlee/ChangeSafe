# M1 Tier 1 Evidence Checklist

Fill this file during an independent reproduction. Keep receipts and command
output as CI artifacts or local run outputs; do not commit credentials, state
payloads, or provider logs.

## Fixed Inputs

| Field | Value |
| --- | --- |
| Package | `changesafe@0.5.0` |
| npm integrity | `sha512-/0Fc69/BrZphQ4VbWk+1utkSLTdqD8AtAMop2xVCUCEu52lTAr32mUYM407w63TaTCVvGKgqMCYgZChbKgl6/Q==` |
| npm git head | `c1ae07e9c6de14c0204f4a667eaec69e2cca59a9` |
| Expected policy version | `core-v0.2.0+terraform-v0.2.0` |
| Benign fixture SHA-256 | `1723ad6b13697101ecc04f7b2285a52aa7a21b50a8f3698eefce1740ae98ce56` |
| Hostile fixture SHA-256 | `f1590b0f77fb3d3102944de8353277b2a0682c533d1f62ce34a6fd4cdb5193ca` |
| Hostile PR body SHA-256 | `0aaad1bae1c281c057c6b8f64d6d27399a907d473f7ef3ea2bedfa4424f19580` |

## Reproduction Record

| Field | Value |
| --- | --- |
| Template repository URL | `https://github.com/wonkwonlee/changesafe-m1-tier1-repro` |
| Template commit | `7919865fe735cbb5de049b7dcce6aaa3b35396f3` |
| Workflow run URL | `https://github.com/wonkwonlee/changesafe-m1-tier1-repro/actions/runs/31332578100` |
| Benign command exit code | 0 |
| Benign receipt path | `evidence/benign.receipt.json` |
| Benign receipt SHA-256 | `4c626f70081fd69052986be762ce3bdb29208aad288366394195ba958c991feb` |
| Benign receipt decision | `gate_only` |
| Benign receipt policy version | `core-v0.2.0+terraform-v0.2.0` |
| Hostile command exit code | 1 |
| Hostile receipt path | `evidence/hostile.receipt.json` |
| Hostile receipt SHA-256 | `201c13ee65343f1dfb40b212ca794e30c7240e3958f9c286336f98d6406d6fc1` |
| Hostile receipt decision | `blocked` |
| Hostile receipt policy version | `core-v0.2.0+terraform-v0.2.0` |
| Hostile signer public key id | `919aa9a9159a6a16c9408316b7ebd6b6` |
| Hostile public key path | `evidence/hostile-signing-key.pub.pem` |
| Hostile signature verification verdict | `valid` |

## Boundary Notes

- The benign reproduction is keyless. Its receipt proves canonical integrity,
  not signer identity.
- The hostile reproduction signs the BLOCK receipt with an ephemeral or
  owner-supplied local key. Commit or upload only the public key needed for
  verification; never commit or upload the private key.
- The PR body is untrusted text. The gate scans it as data and never follows
  instructions inside it.
- No infrastructure effect is recorded here. Any owner-observed post-change
  evidence belongs outside this Tier 1 record and must be labeled separately.
