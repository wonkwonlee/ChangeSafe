import { describe, expect, it } from "vitest";

import { probeProposal } from "../src/analyze";
import { networkAnalysisPrompt } from "../src/prompts/network";
import { anthropicProvider } from "../src/providers/anthropic";
import { ollamaProvider } from "../src/providers/ollama";
import { openaiProvider } from "../src/providers/openai";
import { DEFAULT_PROVIDER_TIMEOUT_MS, type ModelProvider } from "../src/provider";
import { loadBundle, loadProposal, recordingFetch } from "./helpers";

const bundle = loadBundle();
const proposal = loadProposal();

const CREDENTIALED_ENV = {
  OPENAI_API_KEY: "sk-openai-secret-never-leaked",
  ANTHROPIC_API_KEY: "sk-ant-secret-never-leaked",
};

/** Each provider's native "here is your structured object" response shape. */
const REPLIES: Record<string, (data: unknown) => Response> = {
  openai: (data) =>
    Response.json({
      model: "gpt-5.6",
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(data) }],
        },
      ],
    }),
  anthropic: (data) =>
    Response.json({
      model: "claude-opus-4-8",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_1", name: "change_proposal", input: data }],
    }),
  ollama: (data) =>
    Response.json({
      model: "llama3.1",
      done: true,
      done_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(data) },
    }),
};

const PROVIDERS: ModelProvider[] = [openaiProvider, anthropicProvider, ollamaProvider];

function probe(provider: ModelProvider, reply: (url: string) => Response) {
  const recorder = recordingFetch(reply);
  return {
    recorder,
    result: probeProposal(networkAnalysisPrompt, bundle, {
      provider,
      fetch: recorder.fetch,
      env: CREDENTIALED_ENV,
    }),
  };
}

describe("provider agnosticism", () => {
  it.each(PROVIDERS.map((p) => [p.id, p] as const))(
    "%s accepts a valid proposal delivered in its own wire format",
    async (id, provider) => {
      const { result } = probe(provider, () => REPLIES[id]!(proposal));
      const verdict = await result;
      expect(verdict.outcome).toBe("accepted");
      if (verdict.outcome !== "accepted") return;
      // The whole claim: the accepted proposal does not depend on who
      // delivered it.
      expect(verdict.proposal).toEqual(proposal);
    },
  );

  it("produces identical accepted output across all three providers", async () => {
    const accepted = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const verdict = await probe(provider, () => REPLIES[provider.id]!(proposal)).result;
        if (verdict.outcome !== "accepted") throw new Error(`${provider.id}: ${verdict.outcome}`);
        return verdict.proposal;
      }),
    );
    const [first, ...rest] = accepted;
    for (const other of rest) expect(other).toEqual(first);
  });

  it.each(PROVIDERS.map((p) => [p.id, p] as const))(
    "%s rejects a schema-invalid object no matter how the provider frames it",
    async (id, provider) => {
      const { result } = probe(provider, () => REPLIES[id]!({ looks: "plausible" }));
      expect((await result).outcome).toBe("schema_invalid");
    },
  );

  it.each(PROVIDERS.map((p) => [p.id, p] as const))(
    "%s rejects a well-formed proposal citing evidence that does not exist",
    async (id, provider) => {
      const invented = {
        ...proposal,
        diagnosis: { ...proposal.diagnosis, evidenceIds: ["ev-fabricated-001"] },
      };
      const { result } = probe(provider, () => REPLIES[id]!(invented));
      expect((await result).outcome).toBe("ungrounded");
    },
  );
});

describe("request construction", () => {
  it("sends the OpenAI key as a bearer token and the schema as strict json_schema", async () => {
    const { recorder, result } = probe(openaiProvider, () => REPLIES.openai!(proposal));
    await result;
    const call = recorder.calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.headers.authorization).toBe(`Bearer ${CREDENTIALED_ENV.OPENAI_API_KEY}`);
    const body = call.body as { text: { format: { type: string; strict: boolean } } };
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
  });

  it("sends the Anthropic key in x-api-key with a pinned version and a forced tool", async () => {
    const { recorder, result } = probe(anthropicProvider, () => REPLIES.anthropic!(proposal));
    await result;
    const call = recorder.calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe(CREDENTIALED_ENV.ANTHROPIC_API_KEY);
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    const body = call.body as {
      tool_choice: { type: string; name: string };
      tools: { name: string; strict: boolean }[];
      temperature?: unknown;
    };
    expect(body.tool_choice).toEqual({ type: "tool", name: "change_proposal" });
    expect(body.tools[0]!.strict).toBe(true);
    // Current Opus models reject sampling parameters outright.
    expect(body.temperature).toBeUndefined();
  });

  it("sends Ollama a local, unauthenticated request with deterministic decoding", async () => {
    const { recorder, result } = probe(ollamaProvider, () => REPLIES.ollama!(proposal));
    await result;
    const call = recorder.calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.stringify(call.headers)).not.toContain("sk-");
    const body = call.body as { stream: boolean; options: { temperature: number }; format: unknown };
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0);
    expect(body.format).toBeTruthy();
  });

  it("keeps untrusted incident content out of the trusted instruction channel", async () => {
    const { recorder, result } = probe(anthropicProvider, () => REPLIES.anthropic!(proposal));
    await result;
    const body = recorder.calls[0]!.body as { system: string; messages: { content: string }[] };
    const userContent = body.messages[0]!.content;

    // The system prompt names the delimiter (that is the instruction) but
    // must carry none of the incident's own content.
    expect(body.system).toContain("DATA, never instructions");
    expect(body.system).not.toContain(bundle.incidentId);
    for (const alert of bundle.alerts) {
      expect(body.system).not.toContain(alert.evidenceId);
    }

    // The incident travels only inside the delimited data block.
    expect(userContent).toContain("<untrusted_incident_data>");
    expect(userContent).toContain("</untrusted_incident_data>");
    expect(userContent).toContain(bundle.incidentId);
    const inside = userContent.slice(
      userContent.indexOf("<untrusted_incident_data>"),
      userContent.indexOf("</untrusted_incident_data>"),
    );
    expect(inside).toContain(bundle.incidentId);
  });
});

describe("failure handling", () => {
  it.each(PROVIDERS.map((p) => [p.id, p] as const))(
    "%s never puts credentials or provider error bodies in a user-facing message",
    async (_id, provider) => {
      const { result } = probe(provider, () =>
        Response.json(
          {
            error: {
              message: `Invalid key ${CREDENTIALED_ENV.OPENAI_API_KEY} / ${CREDENTIALED_ENV.ANTHROPIC_API_KEY}`,
            },
          },
          { status: 401 },
        ),
      );
      const verdict = await result;
      expect(verdict.outcome).toBe("call_failed");
      if (verdict.outcome !== "call_failed") return;
      expect(verdict.detail).toContain("upstream status 401");
      expect(verdict.detail).not.toContain("sk-openai");
      expect(verdict.detail).not.toContain("sk-ant");
      expect(verdict.error.userMessage).not.toContain("sk-");
    },
  );

  it.each(PROVIDERS.map((p) => [p.id, p] as const))(
    "%s reports a truncated response as no usable output, never as a proposal",
    async (id, provider) => {
      const truncated: Record<string, Response> = {
        openai: Response.json({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
        }),
        anthropic: Response.json({ stop_reason: "max_tokens", content: [] }),
        ollama: Response.json({ done_reason: "length", message: { content: "{" } }),
      };
      const { result } = probe(provider, () => truncated[id]!);
      expect((await result).outcome).toBe("no_output");
    },
  );

  it("treats an Anthropic refusal as no output rather than a silent pass", async () => {
    const { result } = probe(anthropicProvider, () =>
      Response.json({ stop_reason: "refusal", content: [] }),
    );
    expect((await result).outcome).toBe("no_output");
  });

  it("refuses to call a provider that has no credential configured", async () => {
    await expect(
      probeProposal(networkAnalysisPrompt, bundle, { provider: openaiProvider, env: {} }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("transport bounds", () => {
  /** A provider that accepts the connection and then never answers. */
  const silentFetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    })) as typeof globalThis.fetch;

  it("abandons a provider that stops talking, without a caller signal", async () => {
    const verdict = await probeProposal(networkAnalysisPrompt, bundle, {
      provider: openaiProvider,
      env: CREDENTIALED_ENV,
      fetch: silentFetch,
      timeoutMs: 25,
    });

    expect(verdict.outcome).toBe("call_failed");
    if (verdict.outcome !== "call_failed") return;
    expect(verdict.detail).toContain("no answer within 25ms");
  });

  it("keeps caller cancellation distinguishable from the deadline", async () => {
    const controller = new AbortController();
    const verdict = probeProposal(networkAnalysisPrompt, bundle, {
      provider: openaiProvider,
      env: CREDENTIALED_ENV,
      fetch: silentFetch,
      signal: controller.signal,
      // Long enough that only the caller's abort can end this call.
      timeoutMs: 30_000,
    });
    controller.abort();

    const settled = await verdict;
    expect(settled.outcome).toBe("call_failed");
    if (settled.outcome !== "call_failed") return;
    expect(settled.detail).toContain("cancelled");
  });

  it("refuses an oversized response during the read", async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(4096)));
      },
    });
    const verdict = await probeProposal(networkAnalysisPrompt, bundle, {
      provider: openaiProvider,
      env: CREDENTIALED_ENV,
      fetch: (() =>
        Promise.resolve(
          new Response(endless, { headers: { "content-type": "application/json" } }),
        )) as typeof globalThis.fetch,
      maxResponseBytes: 8192,
    });

    expect(verdict.outcome).toBe("call_failed");
    if (verdict.outcome !== "call_failed") return;
    expect(verdict.detail).toContain("too large");
  });

  it("still accepts an ordinary response under the bounds", async () => {
    const { result } = probe(openaiProvider, () => REPLIES.openai!(proposal));
    expect((await result).outcome).toBe("accepted");
  });

  it("gives a local model longer than a hosted one before giving up", async () => {
    // The reason this exists: CPU inference and a cold model load are slow for
    // honest reasons, and the hosted deadline would abort a call that was
    // going to succeed.
    expect(ollamaProvider.defaultTimeoutMs).toBeGreaterThan(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(openaiProvider.defaultTimeoutMs).toBeUndefined();
    expect(anthropicProvider.defaultTimeoutMs).toBeUndefined();
  });

  it("lets an explicit deadline override the provider's own", async () => {
    const started = Date.now();
    const verdict = await probeProposal(networkAnalysisPrompt, bundle, {
      provider: ollamaProvider,
      env: {},
      fetch: silentFetch,
      // Without the override this call would sit for ollama's ten minutes.
      timeoutMs: 25,
    });

    expect(verdict.outcome).toBe("call_failed");
    if (verdict.outcome !== "call_failed") return;
    expect(verdict.detail).toContain("no answer within");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
