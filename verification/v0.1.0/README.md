# ChangeSafe v0.1.0 verification snapshot

This directory freezes a fictional incident input, a captured model proposal,
the deterministic gate result, and an Ed25519 signature. Verification proves
that these files agree and that the receipt was signed by the key whose
fingerprint is shown below. A public key stored beside a signature is not, by
itself, external proof of the publisher's identity; compare this fingerprint
with the v0.1.0 release notes or presentation material.

Fingerprint: `3b6039b0aa32f0c8b61d4b9d36ff2724`

Run from the repository root:

```bash
npm ci
npm run verify:v0.1.0
```

The private key is intentionally absent. Public users reproduce the gate
payload and verify the frozen signature; they do not re-sign the snapshot.
