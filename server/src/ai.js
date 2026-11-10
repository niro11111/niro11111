// AI gateway: lets signed-in users use the tutor and every AI feature when the academy runs on its own server.
// The browser sends messages (and optional tool definitions); the server adds the API key, applies a daily
// quota and a token cap, calls the Claude API with streaming, and relays the events as Server-Sent Events.
// Tools run in the browser (they read the user's uploaded files), so the tool loop lives in the page.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const Block = z.record(z.string(), z.any());
const Message = z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string().max(200000), z.array(Block).max(100)]) }).strict();
const Tool = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), description: z.string().max(2000), input_schema: z.record(z.string(), z.any()) }).strict();
export const AiRequest = z.object({
  messages: z.array(Message).min(1).max(60),
  system: z.string().max(20000).optional(),
  tools: z.array(Tool).max(10).optional(),
  max_tokens: z.number().int().min(1).max(64000).optional()
}).strict();

const FALLBACK_MODELS = /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/;

export function createAi(config) {
  if (!config.ANTHROPIC_API_KEY || !config.AI_MODEL) return null;
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, ...(config.ANTHROPIC_BASE_URL ? { baseURL: config.ANTHROPIC_BASE_URL } : {}), maxRetries: 2 });
  const useFallbacks = config.AI_FALLBACKS === "on" || (config.AI_FALLBACKS === "auto" && FALLBACK_MODELS.test(config.AI_MODEL));

  // returns the SDK MessageStream for one request
  function stream(body, signal) {
    const params = {
      model: config.AI_MODEL,
      max_tokens: Math.min(body.max_tokens ?? config.AI_MAX_TOKENS, config.AI_MAX_TOKENS),
      messages: body.messages,
      ...(body.system ? { system: body.system } : {}),
      ...(body.tools && body.tools.length ? { tools: body.tools } : {}),
      ...(config.AI_EFFORT ? { output_config: { effort: config.AI_EFFORT } } : {})
    };
    // server-side refusal fallback: on a policy decline the API re-runs the request on a suitable model
    if (useFallbacks) return client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal });
    return client.messages.stream(params, { signal });
  }

  return { stream, model: config.AI_MODEL };
}

// maps SDK errors to what the page understands
export function aiErrorResponse(err) {
  if (err instanceof Anthropic.RateLimitError) return [429, "rate_limited", "שירות ה-AI עמוס כרגע. נסו שוב בעוד דקה."];
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return [502, "ai_misconfigured", "שירות ה-AI לא מוגדר נכון בשרת."];
  if (err instanceof Anthropic.BadRequestError) return [400, "invalid", "הבקשה ל-AI לא תקינה."];
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return [503, "unavailable", "שירות ה-AI לא זמין כרגע. נסו שוב."];
  if (err instanceof Anthropic.APIConnectionError) return [503, "unavailable", "אין חיבור לשירות ה-AI כרגע."];
  return [500, "internal", "שגיאה בשירות ה-AI."];
}
