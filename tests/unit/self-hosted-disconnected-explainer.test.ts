import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EXAMPLE_RECEIPT_PROOF,
  SelfHostedDisconnectedExplainer,
} from "../../components/SelfHostedDisconnectedExplainer";
import { ReceiptProofSchema } from "../../features/reviews/durable-review-contract";

describe("SelfHostedDisconnectedExplainer", () => {
  it("uses an example receipt proof that satisfies the production schema", () => {
    expect(() => ReceiptProofSchema.parse(EXAMPLE_RECEIPT_PROOF)).not.toThrow();
  });

  it("permanently labels the illustrative receipt as an example, never as a real review", () => {
    const markup = renderToStaticMarkup(createElement(SelfHostedDisconnectedExplainer));
    expect(markup).toContain(">Example<");
    expect(markup).toContain("Fictional claims for illustration only");
    expect(markup).toContain("not a real review");
    expect(markup).toContain("Sequence 42");
  });

  it("names all four self-hosting value props", () => {
    const markup = renderToStaticMarkup(createElement(SelfHostedDisconnectedExplainer));
    for (const term of [
      "OIDC approver identity",
      "Server-recomputed findings",
      "Signed receipts",
      "Ledger inclusion",
    ]) {
      expect(markup).toContain(term);
    }
  });
});
