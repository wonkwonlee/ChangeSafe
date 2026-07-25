import {
  invalidOutput,
  isRecord,
  postJson,
  type ModelProvider,
  type ProposalRequest,
  type ProviderCall,
  type ProviderResult,
} from "../provider";

/** Pinned so a future API revision cannot silently change response shape. */
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic, through the Messages API with a forced strict tool call.
 *
 * The Messages API has no "return this JSON object" mode that matches the
 * Responses API one-for-one; the equivalent guarantee comes from declaring a
 * single strict tool whose `input_schema` is the proposal schema and forcing
 * it with `tool_choice`. The model's only legal move is to emit a conforming
 * tool input, which arrives already parsed.
 */
export const anthropicProvider: ModelProvider = {
  id: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-opus-4-8",
  credentialEnvVar: "ANTHROPIC_API_KEY",

  isConfigured(env) {
    return Boolean(env.ANTHROPIC_API_KEY);
  },

  async propose(request: ProposalRequest, call: ProviderCall): Promise<ProviderResult> {
    const baseUrl = call.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";

    const body = await postJson(
      anthropicProvider,
      `${baseUrl}/messages`,
      {
        "x-api-key": call.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: request.systemInstructions,
        messages: [{ role: "user", content: request.userContent }],
        tools: [
          {
            name: request.schemaName,
            description:
              "Record the single change proposal produced for this incident. This is the only way to answer.",
            input_schema: request.jsonSchema,
            strict: true,
          },
        ],
        tool_choice: { type: "tool", name: request.schemaName },
      },
      call,
    );

    if (!isRecord(body)) {
      throw invalidOutput(anthropicProvider, "the response envelope was not an object");
    }
    if (body.stop_reason === "refusal") {
      throw invalidOutput(anthropicProvider, "the model refused the request");
    }
    if (body.stop_reason === "max_tokens") {
      throw invalidOutput(anthropicProvider, "the response was truncated at the token limit");
    }

    const content = Array.isArray(body.content) ? body.content : [];
    for (const block of content) {
      if (isRecord(block) && block.type === "tool_use" && block.name === request.schemaName) {
        return {
          data: block.input,
          model: typeof body.model === "string" ? body.model : request.model,
        };
      }
    }
    throw invalidOutput(anthropicProvider, "the response contained no structured tool call");
  },
};
