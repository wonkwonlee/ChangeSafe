import {
  invalidOutput,
  isRecord,
  parseJsonText,
  postJson,
  type ModelProvider,
  type ProposalRequest,
  type ProviderCall,
  type ProviderResult,
} from "../provider";

const DEFAULT_HOST = "http://127.0.0.1:11434";

/**
 * Ollama, for models running on the operator's own machine.
 *
 * This provider exists to make a point the architecture depends on: the gate
 * is unchanged by which model proposes. A local 8B model produces weaker
 * proposals than a frontier model, and the deterministic policies judge both
 * by exactly the same rules — a worse proposer yields more blocks, never a
 * weaker gate.
 *
 * Ollama constrains generation to a JSON Schema via `format`, but enforces
 * fewer keywords than the hosted providers. That difference is absorbed by
 * local validation rather than by trusting the provider.
 */
export const ollamaProvider: ModelProvider = {
  id: "ollama",
  label: "Ollama",
  defaultModel: "llama3.1",
  // Local and unauthenticated: there is no credential to configure or leak.
  credentialEnvVar: null,

  isConfigured() {
    // Reachability cannot be established without a call; `propose` reports a
    // connection failure plainly rather than pretending to know in advance.
    return true;
  },

  async propose(request: ProposalRequest, call: ProviderCall): Promise<ProviderResult> {
    const host = (call.env.CHANGESAFE_OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");

    const body = await postJson(
      ollamaProvider,
      `${host}/api/chat`,
      {},
      {
        model: request.model,
        stream: false,
        format: request.jsonSchema,
        messages: [
          { role: "system", content: request.systemInstructions },
          { role: "user", content: request.userContent },
        ],
        options: {
          // Deterministic decoding: reruns of the eval harness should differ
          // because the model differs, not because sampling did.
          temperature: 0,
          num_predict: request.maxOutputTokens,
        },
      },
      call,
    );

    if (!isRecord(body)) {
      throw invalidOutput(ollamaProvider, "the response envelope was not an object");
    }
    if (body.done_reason === "length") {
      throw invalidOutput(ollamaProvider, "the response was truncated at the token limit");
    }

    const message = body.message;
    if (!isRecord(message) || typeof message.content !== "string" || message.content === "") {
      throw invalidOutput(ollamaProvider, "the response contained no assistant message");
    }

    return {
      data: parseJsonText(ollamaProvider, message.content),
      model: typeof body.model === "string" ? body.model : request.model,
    };
  },
};
