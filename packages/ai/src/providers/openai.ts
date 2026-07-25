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

/**
 * OpenAI, through the Responses API with Structured Outputs.
 *
 * `strict: true` makes the API constrain generation to the schema, which is
 * the strongest guarantee any provider offers. It is still not trusted: the
 * object goes through the same Zod parse and evidence cross-check as output
 * from a provider with no schema enforcement at all.
 */
export const openaiProvider: ModelProvider = {
  id: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5.6",
  credentialEnvVar: "OPENAI_API_KEY",

  isConfigured(env) {
    return Boolean(env.OPENAI_API_KEY);
  },

  async propose(request: ProposalRequest, call: ProviderCall): Promise<ProviderResult> {
    const baseUrl = call.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    // Reasoning effort is only valid for reasoning models, so it is opt-in
    // rather than assumed — a wrong guess here is a hard 400 on other models.
    const effort = call.env.CHANGESAFE_OPENAI_REASONING_EFFORT;

    const body = await postJson(
      openaiProvider,
      `${baseUrl}/responses`,
      { authorization: `Bearer ${call.env.OPENAI_API_KEY ?? ""}` },
      {
        model: request.model,
        instructions: request.systemInstructions,
        input: request.userContent,
        max_output_tokens: request.maxOutputTokens,
        ...(effort ? { reasoning: { effort } } : {}),
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
      },
      call,
    );

    if (!isRecord(body)) {
      throw invalidOutput(openaiProvider, "the response envelope was not an object");
    }
    if (body.status === "incomplete") {
      const reason =
        isRecord(body.incomplete_details) && typeof body.incomplete_details.reason === "string"
          ? body.incomplete_details.reason
          : "unknown reason";
      throw invalidOutput(openaiProvider, `the response was truncated: ${reason}`);
    }

    const text = extractOutputText(body);
    return {
      data: parseJsonText(openaiProvider, text),
      model: typeof body.model === "string" ? body.model : request.model,
    };
  },
};

/**
 * Pull the assistant's text out of the Responses output array. Reasoning
 * items are interleaved with messages, so this scans rather than indexes, and
 * treats an explicit refusal as a distinct failure from a malformed reply.
 */
function extractOutputText(body: Record<string, unknown>): string {
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "output_text" && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === "refusal") {
        throw invalidOutput(openaiProvider, "the model refused the request");
      }
    }
  }
  throw invalidOutput(openaiProvider, "the response contained no assistant message");
}
