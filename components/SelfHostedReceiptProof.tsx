import type { ReceiptProof } from "@/features/reviews/durable-review-contract";

function Claim({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="border-t border-edge py-3 first:border-t-0 first:pt-0">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{status}</dd>
      <dd className="mt-1 break-all text-xs text-ink-dim">{detail}</dd>
    </div>
  );
}
export function SelfHostedReceiptProof({ proof }: { proof: ReceiptProof }) {
  return (
    <dl aria-label="Independent receipt proof claims" className="mt-3">
      <Claim
        label="Content integrity"
        status={proof.contentIntegrity.status}
        detail={proof.receiptSha256}
      />
      <Claim
        label="Signature presence"
        status={proof.signature.present === true ? "present" : proof.signature.present === false ? "absent" : "not checked"}
        detail={proof.signature.publicKeyId ?? "No signing key identity available"}
      />
      <Claim
        label="Out-of-band verification"
        status={proof.outOfBandVerification.status}
        detail={proof.outOfBandVerification.trustedPublicKeyId ?? "No trusted OOB key matched"}
      />
      <Claim
        label="Ledger inclusion"
        status={proof.ledgerInclusion.status}
        detail={
          proof.ledgerInclusion.sequence === null
            ? "No verified ledger sequence"
            : `Sequence ${proof.ledgerInclusion.sequence}`
        }
      />
      <Claim
        label="Ledger chain"
        status={proof.ledgerChain.status}
        detail={proof.ledgerChain.headChainSha256 ?? "No verified chain head"}
      />
    </dl>
  );
}
